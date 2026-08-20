/* ============================================================================
 *  experiment.js — 실험 실행 엔진
 *
 *  "여러 모델을 똑같은 조건으로 돌린다"를 실제로 수행하는 곳입니다.
 *  화면(학습 실험실·모의투자·종합 점수표)은 전부 이 엔진 하나만 부릅니다.
 *  그래야 화면마다 조건이 조금씩 달라지는 일이 생기지 않습니다.
 *
 *  한 번 실행하면 이런 순서로 돌아갑니다.
 *
 *    1. 피처 만들기      features.js — 모든 모델이 같은 문제지를 받습니다
 *    2. 시간순 분할      splits.js   — 과거로 배우고 그 다음 구간을 맞힙니다
 *    3. 표준화           학습 구간 통계로만 자를 만들어 시험 구간에 적용
 *    4. 폴드마다 학습·예측
 *    5. 채점             맞혔는가(예측력) + 그대로 매매했다면(투자 성과)
 *    6. 시드를 바꿔 반복  난수를 쓰는 모델만
 *
 *  화면이 멈추지 않게 폴드 사이사이에 잠깐씩 양보하고(U.yield_), 진행률을
 *  알려 줍니다. 같은 조건으로 다시 부르면 캐시에서 즉시 돌려줍니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, M = root.M, FEAT = root.FEAT, SPLIT = root.SPLIT, REG = root.REG;

  const EXP = {};

  EXP.DEFAULT = {
    ticker: 'AAPL',
    folds: 5,
    minTrain: 0.5,
    embargo: 5,
    mode: 'expanding',
    seeds: [42, 43, 44, 45, 46],   // 시드 5개 — 한 번 돌린 숫자는 믿지 않습니다
    costBps: 10,                   // 편도 0.1% (매수 0.1% + 매도 0.1%)
    threshold: 0.5                 // 상승 확률이 이 값을 넘으면 삽니다
  };

  // 실험 조건을 한 줄 글로. 화면의 공정성 체크리스트가 이걸 그대로 씁니다.
  EXP.describe = function (cfg) {
    const c = Object.assign({}, EXP.DEFAULT, cfg || {});
    return {
      ticker: c.ticker,
      split: SPLIT.describe(c),
      seeds: c.seeds.length + '개 시드 (' + c.seeds.join(', ') + ')',
      cost: '편도 ' + (c.costBps / 100).toFixed(2) + '% 거래비용',
      threshold: '상승 확률 ' + c.threshold + ' 이상이면 매수'
    };
  };

  /* ------------------------------------------------------------------------
   *  캐시 — {모델, 종목, 기간, 시드, 피처버전, 설정}을 키로
   * ----------------------------------------------------------------------*/
  EXP.cache = {};
  function cfgKey(c) {
    return [c.ticker, c.folds, c.minTrain, c.embargo, c.mode, c.costBps, c.threshold].join(':');
  }
  function modelKey(id, c, seed) {
    return id + '|' + cfgKey(c) + '|' + FEAT.version() + '|' + seed;
  }
  EXP.clearCache = function () { EXP.cache = {}; dataCache = {}; };

  // 피처·분할은 모델마다 다시 만들 필요가 없습니다(모든 모델이 같은 것을 씁니다).
  let dataCache = {};
  function prepare(c) {
    const key = cfgKey(c) + '|' + FEAT.version();
    if (dataCache[key]) return dataCache[key];

    const ds = FEAT.build(c.ticker);
    const splits = SPLIT.walkForward(ds.X.length, c);
    if (!splits.length) throw new Error('표본이 모자라 시간순 분할을 만들 수 없습니다. 전체 기간 데이터가 로드됐는지 확인하세요.');
    const cuts = splits.map(function (sp) { return SPLIT.cut(ds, sp); });
    const std = cuts.map(function (cut) { return SPLIT.standardize(cut.train.X, cut.test.X); });

    // 변동성 모델용 — 같은 날짜 경계로 수익률 시계열을 자릅니다.
    const rs = FEAT.returnSeries(c.ticker);
    const volFolds = cuts.map(function (cut) {
      const trainEnd = cut.train.dates[cut.train.dates.length - 1];
      const testFrom = cut.test.dates[0];
      const testTo = cut.test.dates[cut.test.dates.length - 1];
      const tr = [], te = [], teDates = [];
      for (let i = 0; i < rs.dates.length; i++) {
        const d = rs.dates[i];
        if (d <= trainEnd) tr.push(rs.ret[i]);
        else if (d >= testFrom && d <= testTo) { te.push(rs.ret[i]); teDates.push(d); }
      }
      return { train: { ret: tr }, test: { ret: te, dates: teDates } };
    });

    const pack = { ds: ds, splits: splits, cuts: cuts, std: std, volFolds: volFolds,
      leak: SPLIT.leakCheck(ds, splits) };
    dataCache[key] = pack;
    return pack;
  }
  EXP.prepare = prepare;

  /* ------------------------------------------------------------------------
   *  폴드 하나에 넘길 자료 만들기
   *    X   표준화된 피처 · raw 원본 피처 · y 정답 · ret 다음 날 수익률
   * ----------------------------------------------------------------------*/
  function pack(cut, std) {
    return {
      train: { X: std.train, raw: cut.train.X, y: cut.train.y, ret: cut.train.ret,
        dates: cut.train.dates, idx: cut.train.idx },
      test: { X: std.test, raw: cut.test.X, y: cut.test.y, ret: cut.test.ret,
        dates: cut.test.dates, idx: cut.test.idx }
    };
  }

  // 학습 구간에도 같은 얼굴로 예측을 시켜 봐야 "학습은 잘하는데 시험은 못한다"를
  // 잴 수 있습니다. 판정 페이지(verdict.html)의 과적합 간격이 이걸 씁니다.
  EXP.pack = pack;

  /* ------------------------------------------------------------------------
   *  모의투자 — 확률을 실제 매매로 바꿔 성과를 계산합니다
   *
   *    확률 ≥ 기준값 → 그날 종가에 사서 다음 날 종가에 판다(포지션 1)
   *    그 미만       → 현금으로 쉰다(포지션 0)
   *
   *  ★ 포지션이 바뀔 때마다 거래비용을 뗍니다. 이걸 빼먹으면 하루하루
   *    사고파는 전략이 실제보다 훨씬 좋아 보입니다. 백테스트에서 살아남은
   *    전략의 절반은 거래비용에서 죽습니다.
   * ----------------------------------------------------------------------*/
  function backtest(proba, ret, threshold, costBps) {
    const n = ret.length;
    const cost = costBps / 10000;
    const pos = new Float64Array(n);
    const stratRet = new Float64Array(n);
    let prev = 0, traded = 0;
    for (let i = 0; i < n; i++) {
      pos[i] = (isFinite(proba[i]) && proba[i] >= threshold) ? 1 : 0;
      const change = Math.abs(pos[i] - prev);
      traded += change;
      stratRet[i] = pos[i] * ret[i] - change * cost;
      prev = pos[i];
    }
    return {
      ret: stratRet, pos: pos,
      turnover: n ? traded / n : 0,          // 하루 평균 매매량 (1 = 매일 갈아탐)
      exposure: n ? U.sum(Array.from(pos)) / n : 0
    };
  }
  // 화면에서도 씁니다. 확률과 다음날 수익률만 있으면 비용·기준값을 바꿔 가며
  // 다시 계산할 수 있어, 모델을 다시 학습하지 않고도 민감도 표를 만들 수 있습니다.
  EXP.backtest = backtest;

  /* ------------------------------------------------------------------------
   *  한 모델 · 한 시드 실행
   * ----------------------------------------------------------------------*/
  EXP.runOne = async function (id, c, seed, prep) {
    const key = modelKey(id, c, seed);
    if (EXP.cache[key]) return EXP.cache[key];

    const def = REG.get(id);
    if (!def) throw new Error('알 수 없는 모델: ' + id);
    const ds = prep.ds;
    const folds = [];
    const allRet = [], allDates = [], allBH = [];
    const allY = [], allP = [];            // ROC 곡선을 그리려면 원본 예측이 필요합니다
    const loss = [];                       // 통계 검정용 — 하루하루의 손실값
    let ms = 0;

    for (let k = 0; k < prep.cuts.length; k++) {
      const ctx = { cols: ds.cols, featVer: ds.featVer, seed: seed, ticker: c.ticker, task: def.task };
      const t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();

      if (def.task === 'volatility') {
        const vf = prep.volFolds[k];
        const m = REG.create(id, { seed: seed });
        m.fit(vf.train, ctx);
        const sigma = m.predict(vf.test, ctx);
        ms += ((typeof performance !== 'undefined') ? performance.now() : Date.now()) - t0;

        const sc = M.volScores(sigma, vf.test.ret);
        folds.push({ fold: k + 1, n: vf.test.ret.length, mse: sc.mse, qlike: sc.qlike,
          from: vf.test.dates[0], to: vf.test.dates[vf.test.dates.length - 1] });
        // 손실 = (예측 분산 − 실제 제곱수익률)²  … DM 검정에 씁니다
        for (let i = 1; i < vf.test.ret.length; i++) {
          const real = vf.test.ret[i] * vf.test.ret[i], v = sigma[i] * sigma[i];
          loss.push(Math.pow(v - real, 2));
        }

      } else if (def.task === 'direction') {
        const p = pack(prep.cuts[k], prep.std[k]);
        const m = REG.create(id, { seed: seed });
        m.fit(p.train, ctx);
        const proba = m.predict(p.test, ctx);
        ms += ((typeof performance !== 'undefined') ? performance.now() : Date.now()) - t0;

        const met = M.classify(p.test.y, proba, c.threshold);
        const bt = backtest(proba, p.test.ret, c.threshold, c.costBps);
        const perf = M.perf(bt.ret);
        const bh = M.perf(p.test.ret);

        folds.push({
          fold: k + 1, n: p.test.y.length,
          from: p.test.dates[0], to: p.test.dates[p.test.dates.length - 1],
          auc: met.auc, acc: met.acc, precision: met.precision, recall: met.recall,
          upRate: met.upRate, posRate: met.posRate,
          sharpe: perf.sharpe, cagr: perf.cagr, mdd: perf.mdd,
          turnover: bt.turnover, exposure: bt.exposure,
          bhSharpe: bh.sharpe, bhCagr: bh.cagr
        });

        for (let i = 0; i < p.test.y.length; i++) {
          allRet.push(bt.ret[i]);
          allBH.push(p.test.ret[i]);
          allDates.push(p.test.dates[i]);
          allY.push(p.test.y[i]);
          allP.push(proba[i]);
          // 손실 = 브라이어 점수 (확률이 정답에서 얼마나 멀었나)
          loss.push(Math.pow(proba[i] - p.test.y[i], 2));
        }

      } else {
        // 국면 모델은 점수를 매기지 않습니다(정답이 없으므로). 라벨만 만들어 둡니다.
        const p = pack(prep.cuts[k], prep.std[k]);
        const m = REG.create(id, { seed: seed });
        m.fit(p.train, ctx);
        const lab = m.predict(p.test, ctx);
        ms += ((typeof performance !== 'undefined') ? performance.now() : Date.now()) - t0;
        folds.push({ fold: k + 1, n: lab.length, labels: lab, dates: p.test.dates,
          info: m.inner && m.inner.stats ? m.inner.stats : null });
        for (let i = 0; i < lab.length; i++) {
          allY.push(lab[i]);                       // 국면 번호(또는 이상 점수)
          allDates.push(p.test.dates[i]);
          allBH.push(p.test.ret[i]);
        }
      }

      await U.yield_();
    }

    const out = { id: id, seed: seed, task: def.task, folds: folds, ms: Math.round(ms), loss: loss };

    if (def.task === 'direction') {
      const perf = M.perf(allRet), bh = M.perf(allBH);
      out.overall = {
        auc: U.mean(folds.map(function (f) { return f.auc; }).filter(isFinite)),
        acc: U.mean(folds.map(function (f) { return f.acc; })),
        precision: U.mean(folds.map(function (f) { return f.precision; }).filter(isFinite)),
        sharpe: perf.sharpe, cagr: perf.cagr, mdd: perf.mdd, total: perf.total,
        turnover: U.mean(folds.map(function (f) { return f.turnover; })),
        exposure: U.mean(folds.map(function (f) { return f.exposure; })),
        bhSharpe: bh.sharpe, bhCagr: bh.cagr, bhMdd: bh.mdd,
        n: allRet.length
      };
      out.daily = { ret: allRet, bh: allBH, dates: allDates, cum: Array.from(perf.cum) };
      out.pred = { y: allY, proba: allP };
    } else if (def.task === 'volatility') {
      out.overall = {
        mse: U.mean(folds.map(function (f) { return f.mse; }).filter(isFinite)),
        qlike: U.mean(folds.map(function (f) { return f.qlike; }).filter(isFinite))
      };
    } else {
      // 국면 모델 — 시험 구간 전체의 라벨을 이어 붙여 둡니다.
      // 다른 모델의 하루하루 성적을 이 라벨로 갈라 보는 것이 5번 화면의 전부입니다.
      out.daily = { labels: allY, dates: allDates, ret: allBH };
      out.info = folds.length && folds[0].info ? folds[0].info : null;
    }

    EXP.cache[key] = out;
    return out;
  };

  /* ------------------------------------------------------------------------
   *  여러 모델 · 여러 시드 실행
   *    onProgress({done, total, label}) 로 진행률을 알려 줍니다.
   * ----------------------------------------------------------------------*/
  /*  기준선은 학생이 고르지 않아도 항상 함께 돌립니다.
   *  기준선이 빠지면 점수의 0점을 정할 수가 없습니다 — "이 모델 좋아요?"라는
   *  질문에 "무엇보다 좋다는 거죠?"라고 되물을 수 없게 되는 셈입니다. */
  EXP.withBaselines = function (ids) {
    const out = ids.slice();
    let hasDir = false, hasVol = false;
    ids.forEach(function (id) {
      const d = REG.get(id);
      if (!d) return;
      if (d.task === 'direction') hasDir = true;
      if (d.task === 'volatility') hasVol = true;
    });
    const add = function (id) { if (out.indexOf(id) < 0 && REG.get(id) && REG.get(id).make) out.push(id); };
    if (hasDir) { add('buyhold'); add('coin'); }   // 수익성의 0점 · 예측력의 0점
    if (hasVol) add('ewma');                       // 변동성의 0점
    return out;
  };

  EXP.run = async function (ids, opt, onProgress) {
    const c = Object.assign({}, EXP.DEFAULT, opt || {});
    const prep = prepare(c);
    const asked = ids.slice();
    ids = EXP.withBaselines(ids);

    // 어떤 모델을 몇 번 돌릴지 먼저 계산해 두어야 진행률이 정확합니다.
    const jobs = [];
    ids.forEach(function (id) {
      const def = REG.get(id);
      if (!def || !def.make) return;
      const seeds = def.stochastic ? c.seeds : [c.seeds[0]];
      seeds.forEach(function (s) { jobs.push({ id: id, seed: s }); });
    });

    const byModel = {};
    for (let j = 0; j < jobs.length; j++) {
      const job = jobs[j];
      if (onProgress) onProgress({ done: j, total: jobs.length,
        label: REG.name(job.id) + ' · 시드 ' + job.seed });
      const r = await EXP.runOne(job.id, c, job.seed, prep);
      (byModel[job.id] = byModel[job.id] || []).push(r);
    }
    if (onProgress) onProgress({ done: jobs.length, total: jobs.length, label: '완료' });

    // 시드별 결과를 평균 ± 표준편차로 묶습니다.
    const results = [];
    Object.keys(byModel).forEach(function (id) {
      const runs = byModel[id];
      const def = REG.get(id);
      const r = {
        id: id, name: def.name, task: def.task, exec: def.exec, baseline: !!def.baseline,
        auto: asked.indexOf(id) < 0,          // 학생이 고르지 않았는데 기준선이라 자동 추가된 것
        stochastic: !!def.stochastic, interpret: def.interpret, cost: def.cost,
        runs: runs, seeds: runs.map(function (x) { return x.seed; }),
        ms: U.mean(runs.map(function (x) { return x.ms; })),
        // 폴드별 표·자산곡선·ROC는 첫 시드 것을 씁니다(여러 시드를 겹쳐 그리면 읽기 어려움).
        folds: runs[0].folds,
        daily: runs[0].daily,
        pred: runs[0].pred,
        loss: runs[0].loss,
        info: runs[0].info          // 국면 모델이 붙인 국면 이름·평균
      };
      if (def.task !== 'regime') {
        r.agg = {};
        const keys = Object.keys(runs[0].overall);
        keys.forEach(function (k) {
          const vals = runs.map(function (x) { return x.overall[k]; }).filter(isFinite);
          r.agg[k] = { mean: U.mean(vals), sd: vals.length > 1 ? U.std(vals, 1) : 0, n: vals.length };
        });
      }
      results.push(r);
    });

    const out = { config: c, describe: EXP.describe(c), leak: prep.leak, asked: asked,
      dataset: { rows: prep.ds.X.length, cols: prep.ds.cols, featVer: prep.ds.featVer,
        from: prep.ds.dates[0], to: prep.ds.dates[prep.ds.dates.length - 1],
        upRate: prep.ds.upRate, dropped: prep.ds.dropped },
      splits: prep.splits, results: results };

    // 마지막 실행 결과를 남겨 둡니다. 종합 점수표 화면이 이걸 그대로 채점합니다
    // (같은 실험 결과를 두 화면이 공유해야 숫자가 어긋나지 않습니다).
    EXP.last = out;
    return out;
  };

  EXP.last = null;

  root.EXP = EXP;
})(window.QL = window.QL || {});
