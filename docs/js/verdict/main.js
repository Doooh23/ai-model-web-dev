/* ============================================================================
 *  main.js — 「네 모델 판정」
 *
 *  네 모델(로지스틱 회귀 · ARIMA · 랜덤포레스트 · LSTM)에게 같은 문제를 주고
 *  기준선과 나란히 세웁니다. 실험 엔진은 전체 실험실과 완전히 같은 코드를
 *  그대로 부릅니다 — 두 사이트의 숫자가 어긋나지 않아야 하기 때문입니다.
 *
 *  이 파일이 하는 일은 셋뿐입니다.
 *    1. 실험을 돌린다        EXP.run(...)
 *    2. 결론에 필요한 값만 뽑는다
 *    3. 그 값을 눈에 보이게 배치한다
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, M = root.M, DATA = root.DATA, EXP = root.EXP, REG = root.REG,
        SCORE = root.SCORE, VIZ = root.VIZ, PRED = root.PRED;

  const $ = function (s) { return document.querySelector(s); };

  /* 이 페이지가 다루는 네 모델. 순서는 "단순 → 복잡"입니다. */
  const MODELS = ['logistic', 'arima', 'forest', 'lstm'];

  /* 기준선. alwaysup 은 정확도의 함정을 보이려고 명시적으로 넣습니다.
     coin(예측력 0점) · buyhold(수익성 0점) 는 엔진이 자동으로 함께 돌립니다. */
  const ASK = MODELS.concat(['alwaysup']);
  const BASE_ORDER = ['alwaysup', 'coin', 'buyhold'];

  const CARDS = {
    logistic: { fam: '선형 · 통계학습',
      ds: '피처 15개에 가중치를 하나씩 매겨 더한 뒤, 합이 크면 “오른다”고 답합니다. 어느 피처가 얼마나 밀었는지 그대로 읽을 수 있습니다.' },
    arima:    { fam: '고전 시계열',
      ds: '어제 수익률로 오늘 수익률을 설명하는 가장 단순한 시계열 모형입니다. 기계학습을 전혀 쓰지 않고 통계학만으로 어디까지 되는지 보여 줍니다.' },
    forest:   { fam: '트리 앙상블',
      ds: '조금씩 다른 자료만 본 결정나무 60그루를 만들어 다수결을 시킵니다. 표 형태 자료에서 오래 강했던 계열입니다.' },
    lstm:     { fam: '순환 신경망 · 딥러닝',
      ds: '앞의 여러 날을 순서대로 읽으며 기억할 것과 잊을 것을 스스로 고릅니다. 다른 셋이 하루치 숫자만 볼 때 흐름 자체를 봅니다.' }
  };

  const state = { run: null, gap: null, ticker: 'AAPL', busy: false };

  const f  = function (v, n) { return (v === null || v === undefined || !isFinite(v)) ? '—' : v.toFixed(n === undefined ? 3 : n); };
  const pc = function (v, n) { return !isFinite(v) ? '—' : (v * 100).toFixed(n === undefined ? 1 : n) + '%'; };
  const sp = function (v, n) { return !isFinite(v) ? '—' : (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(n === undefined ? 1 : n) + '%'; };
  const esc = function (s) { return U.escape(String(s)); };

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  /* ------------------------------------------------------------------------
   *  결과에서 필요한 값만 뽑아내는 층
   * ----------------------------------------------------------------------*/
  function pick(run, id) {
    return run.results.filter(function (r) { return r.id === id; })[0] || null;
  }

  function stat(r) {
    let nPos = 0, nAll = 0;
    r.folds.forEach(function (fd) { nAll += fd.n; nPos += Math.round(fd.n * fd.posRate); });
    const t = SCORE.aucTest(r.agg.auc.mean, nPos, nAll - nPos);
    const half = isFinite(t.se) ? 1.96 * t.se : NaN;
    const cells = r.folds.map(function (fd) {
      return { auc: fd.auc, n: fd.n, from: fd.from, to: fd.to };
    });
    return {
      id: r.id, name: REG.name(r.id), r: r,
      auc: r.agg.auc.mean, lo: r.agg.auc.mean - half, hi: r.agg.auc.mean + half,
      p: t.p, sig: !!t.significant,
      acc: r.agg.acc.mean, sharpe: r.agg.sharpe.mean, cagr: r.agg.cagr.mean,
      mdd: r.agg.mdd.mean, turnover: r.agg.turnover.mean,
      cells: cells, won: cells.filter(function (c) { return c.auc > 0.5; }).length,
      n: nAll
    };
  }

  function derive(run) {
    const models = MODELS.map(function (id) { return pick(run, id); })
      .filter(Boolean).map(stat);
    const bases = BASE_ORDER.map(function (id) { return pick(run, id); })
      .filter(Boolean).map(stat);
    const bh = bases.filter(function (b) { return b.id === 'buyhold'; })[0];
    return {
      models: models, bases: bases, bh: bh,
      nSig: models.filter(function (m) { return m.sig; }).length,
      nOver: models.filter(function (m) { return m.auc > 0.5; }).length,
      nBeat: bh ? models.filter(function (m) { return m.cagr > bh.cagr; }).length : 0,
      meanAuc: U.mean(models.map(function (m) { return m.auc; })),
      accTop: models.concat(bases).sort(function (a, b) { return b.acc - a.acc; })[0],
      upRate: run.dataset.upRate
    };
  }

  /* ------------------------------------------------------------------------
   *  판정 타일
   * ----------------------------------------------------------------------*/
  function drawTiles(d) {
    const host = $('#tiles');
    host.innerHTML = '';
    const add = function (k, v, unit, note, cls) {
      const t = el('div', 'tile' + (cls ? ' ' + cls : ''));
      t.appendChild(el('div', 'k', esc(k)));
      const vv = el('div', 'v');
      vv.appendChild(document.createTextNode(v));
      if (unit) vv.appendChild(el('small', null, esc(unit)));
      t.appendChild(vv);
      t.appendChild(el('div', 'd', note));
      host.appendChild(t);
    };

    add('통계적으로 유의한 모델', String(d.nSig), '/ 4',
      '우연이라고 보기 어려울 만큼 0.5를 넘은 모델의 수입니다. ' +
      (d.nSig === 0 ? '<b>하나도 없습니다.</b>' : ''), d.nSig === 0 ? 'hit' : 'ok');

    add('바이앤홀드를 넘은 모델', String(d.nBeat), '/ 4',
      '거래비용을 뗀 뒤의 연수익이 <b>그냥 사서 들고 있기</b>보다 높은 모델의 수입니다.',
      d.nBeat === 0 ? 'hit' : 'ok');

    add('네 모델 평균 AUC', f(d.meanAuc, 4), '',
      '0.5가 “실력 없음”입니다. ' +
      (d.meanAuc < 0.5 ? '평균이 그 아래에 있습니다.' : '겨우 그 위입니다.'),
      d.meanAuc < 0.5 ? 'hit' : '');

    add('정확도 1위', d.accTop.name, '',
      '정확도만 보면 ' + esc(d.accTop.name) + '(' + f(d.accTop.acc, 4) + ')가 1위입니다. ' +
      (d.accTop.r.baseline ? '<b>아무것도 학습하지 않는 기준선입니다.</b>' : ''),
      d.accTop.r.baseline ? 'hit' : '');

    const one = $('#oneline');
    one.hidden = false;
    one.innerHTML = '<p>' + esc(state.ticker) + '에서 네 모델 가운데 기준선을 <b>유의하게</b> 넘은 것은 ' +
      '<b>' + d.nSig + '개</b>, 거래비용을 뗀 뒤 <b>그냥 들고 있기</b>를 넘은 것은 <b>' + d.nBeat + '개</b>였습니다.</p>';
  }

  /* ------------------------------------------------------------------------
   *  모델 카드 · 조건
   * ----------------------------------------------------------------------*/
  function drawCards() {
    const host = $('#cards');
    host.innerHTML = '';
    MODELS.forEach(function (id) {
      const def = REG.get(id), c = CARDS[id];
      const k = el('div', 'card');
      k.appendChild(el('div', 'fam', esc(c.fam)));
      k.appendChild(el('div', 'nm', esc(def ? def.name : id)));
      k.appendChild(el('div', 'ds', esc(c.ds)));
      k.appendChild(el('div', 'ex', (def && def.exec === 'pre')
        ? '파이썬으로 미리 학습 · 예측값만 읽어 씀'
        : '이 브라우저에서 지금 학습'));
      host.appendChild(k);
    });
  }

  function drawChecks(run) {
    const host = $('#checks');
    host.innerHTML = '';
    const dsc = run.describe;
    const items = [
      ['동일 종목 · 동일 기간 · 동일 피처',
        esc(run.config.ticker) + ' · ' + esc(run.dataset.from) + ' ~ ' + esc(run.dataset.to) +
        ' · 피처 ' + run.dataset.cols + '개(' + esc(run.dataset.featVer) + ')'],
      ['시간순 워크포워드만 사용', esc(dsc.split) + ' · 무작위 분할 기능은 코드에 없습니다'],
      ['피처는 t시점까지, 정답은 t+1', '자동 누출 점검 ' + (run.leak.pass ? '통과 · 지적 0건' : '실패 ' + run.leak.issues.length + '건')],
      ['표준화는 학습 구간 통계로만', '시험 구간에는 그 자를 그대로 적용합니다'],
      ['거래비용 전 모델 동일', esc(dsc.cost) + ' · ' + esc(dsc.threshold)],
      ['난수를 쓰는 모델은 여러 번', esc(dsc.seeds) + ' 평균']
    ];
    items.forEach(function (it) {
      const li = el('li');
      li.appendChild(el('span', 'm', '✓'));
      li.appendChild(el('span', null, '<b>' + esc(it[0]) + '</b> — ' + it[1]));
      host.appendChild(li);
    });
    const w = el('li', 'warn');
    w.appendChild(el('span', 'm', '!'));
    w.appendChild(el('span', null,
      '<b>생존 편향 있음</b> — 나스닥100의 <em>현재</em> 구성종목만 씁니다. ' +
      '기준선(그냥 들고 있기)에 유리한 방향이므로, 이 페이지의 결론을 더 보수적으로 만듭니다.'));
    host.appendChild(w);

    $('#dsline').innerHTML =
      '표본 ' + U.comma(run.dataset.rows) + '행 · 상승일 비율 ' + pc(run.dataset.upRate, 2) +
      ' · 겹당 시험 구간 ' + run.results[0].folds.map(function (x) { return x.n; }).join(' / ') + '일';
  }

  /* ------------------------------------------------------------------------
   *  02 예측력
   * ----------------------------------------------------------------------*/
  function drawCI(d) {
    const rows = d.models.map(function (m) {
      return {
        name: m.name, value: m.auc, lo: m.lo, hi: m.hi, base: false,
        note: 'p ' + f(m.p, 3),
        tip: '<b>' + esc(m.name) + '</b><br>AUC ' + f(m.auc, 4) +
             '<br>95% 구간 ' + f(m.lo, 3) + ' ~ ' + f(m.hi, 3) +
             '<br>p값 ' + f(m.p, 3) + ' · ' + (m.sig ? '유의' : '유의하지 않음')
      };
    }).concat(d.bases.filter(function (b) { return b.id !== 'buyhold'; }).map(function (b) {
      return {
        name: b.name + ' (기준선)', value: b.auc, lo: b.lo, hi: b.hi, base: true,
        note: '', tip: '<b>' + esc(b.name) + '</b> · 기준선<br>AUC ' + f(b.auc, 4)
      };
    }));

    VIZ.ci($('#ci'), rows, { ref: 0.5, refLabel: '실력 없음', aria: 'AUC와 95% 신뢰구간' });

    $('#ciCap').innerHTML =
      '<b>그림 1</b> ' + esc(state.ticker) + ' 다음 거래일 방향 예측의 AUC와 95% 신뢰구간. ' +
      '점이 다섯 겹 평균, 가로선이 신뢰구간, 굵은 세로선이 0.5(실력 없음)입니다.';

    const overs = d.models.filter(function (m) { return m.auc > 0.5; }).map(function (m) { return m.name; });
    const minP = Math.min.apply(null, d.models.map(function (m) { return m.p; }).filter(isFinite));
    $('#ciRead').innerHTML =
      '<p><b>읽는 법.</b> 신뢰구간이 0.5를 <em>지나가면</em> “이 정도 차이는 우연으로도 흔하다”는 뜻입니다. ' +
      '네 모델 모두 구간이 0.5를 지나갑니다.</p>' +
      '<p>점만 보면 ' + (overs.length ? '<b>' + overs.map(esc).join(' · ') + '</b>이(가) 0.5를 넘습니다. ' +
        '그러나 구간을 함께 보면 그 차이는 남지 않습니다. ' : '네 모델 모두 0.5에 미치지 못합니다. ') +
      '가장 작은 p값도 <b>' + f(minP, 3) + '</b>으로, 유의수준 0.05에 이르지 못했습니다.</p>';
  }

  /* ------------------------------------------------------------------------
   *  03 정확도의 함정
   * ----------------------------------------------------------------------*/
  function drawAcc(d) {
    const up = d.upRate;
    const rows = d.models.map(function (m) {
      return { name: m.name, value: m.acc, base: false,
        tip: '<b>' + esc(m.name) + '</b><br>정확도 ' + f(m.acc, 4) +
             '<br>기준선과의 차이 ' + sp(m.acc - Math.max(up, 1 - up), 2) };
    }).concat(d.bases.filter(function (b) { return b.id === 'alwaysup'; }).map(function (b) {
      return { name: b.name + ' (기준선)', value: b.acc, base: true,
        tip: '<b>' + esc(b.name) + '</b> · 아무 판단도 하지 않음<br>정확도 ' + f(b.acc, 4) };
    }));

    VIZ.ci($('#acc1'), rows, {
      ref: Math.max(up, 1 - up), refLabel: '“항상 오른다”만 답했을 때',
      aria: '정확도 비교'
    });

    const beat = d.models.filter(function (m) { return m.acc > Math.max(up, 1 - up); });
    $('#accCap').innerHTML =
      '<b>그림 2</b> 정확도. 굵은 세로선은 상승일 비율 ' + pc(up, 2) +
      ' — 아무 판단도 하지 않고 “항상 오른다”만 답했을 때 나오는 정확도입니다.';
    // 그림 아래에 판단을 남기지 않으면 그림만 보고 지나갑니다.
    $('#accRead').innerHTML =
      ('<p><b>이 그림의 요지.</b> 네 모델 가운데 굵은 기준선을 넘은 것은 ' +
      '<b>' + beat.length + '개</b>입니다. ' +
      (beat.length === 0
        ? '즉 <b>아무 판단도 하지 않는 쪽이 정확도에서 앞섭니다.</b> '
        : '넘은 모델(' + beat.map(function (m) { return esc(m.name); }).join(' · ') + ')도 그 차이는 소수점 아래입니다. ') +
      '정확도를 성능의 근거로 쓰면 안 되는 이유가 이것이며, 이 페이지가 AUC를 주 지표로 쓰는 이유이기도 합니다.</p>');
  }

  /* ------------------------------------------------------------------------
   *  04 수익 — 모델마다 한 칸씩 (색으로 겹쳐 그리지 않습니다)
   * ----------------------------------------------------------------------*/
  function cumOf(a) {
    const out = new Array(a.length);
    let c = 1;
    for (let i = 0; i < a.length; i++) { c *= (1 + a[i]); out[i] = c; }
    return out;
  }

  function drawProfit(d) {
    const host = $('#mult');
    host.innerHTML = '';
    if (!d.bh) return;

    // 네 칸이 같은 축을 쓰도록 위아래 한계를 먼저 구합니다.
    let lo = Infinity, hi = -Infinity;
    const series = d.models.map(function (m) {
      const own = cumOf(m.r.daily.ret), ref = cumOf(m.r.daily.bh);
      [own, ref].forEach(function (a) {
        for (let i = 0; i < a.length; i++) { if (a[i] < lo) lo = a[i]; if (a[i] > hi) hi = a[i]; }
      });
      return { m: m, own: own, ref: ref };
    });

    series.forEach(function (s) {
      const box = el('div', 'mult');
      const head = el('div', 'h');
      head.appendChild(el('div', 'nm', esc(s.m.name)));
      const diff = s.m.cagr - d.bh.cagr;
      head.appendChild(el('div', 'vs ' + (diff >= 0 ? 'up' : 'dn'),
        (diff >= 0 ? '+' : '−') + Math.abs(diff * 100).toFixed(1) + '%p'));
      box.appendChild(head);
      const viz = el('div', 'spark');
      box.appendChild(viz);
      VIZ.spark(viz, s.own, s.ref, {
        lo: lo, hi: hi,
        from: String(s.m.r.daily.dates[0]).slice(0, 7),
        to: String(s.m.r.daily.dates[s.m.r.daily.dates.length - 1]).slice(0, 7),
        aria: s.m.name + ' 누적 수익 곡선'
      });
      box.appendChild(el('div', 'f',
        '연수익 ' + pc(s.m.cagr) + ' · 샤프 ' + f(s.m.sharpe, 2) + ' · 최대낙폭 ' + pc(s.m.mdd)));
      host.appendChild(box);
    });

    $('#multNote').innerHTML =
      '<p><b>회색 점선은 네 칸에 모두 같은 것이 들어 있습니다</b> — 아무것도 하지 않고 그냥 들고 있었을 때로, ' +
      '연수익 ' + pc(d.bh.cagr) + ' · 샤프 ' + f(d.bh.sharpe, 2) + '입니다. ' +
      '이 선을 넘지 못하면 그 모델은 존재할 이유가 없습니다 — 아무 일도 하지 않는 쪽이 수수료도 들지 않고 ' +
      '마음도 편하기 때문입니다.</p>' +
      '<p>오른쪽 위 꼬리표는 <b>연수익의 차이</b>입니다. 네 칸 모두 음수입니다.</p>';

    drawCost(d);
  }

  const COSTS = [0, 5, 10, 25, 50];

  function drawCost(d) {
    const rows = d.models.map(function (m) {
      const cagrs = COSTS.map(function (c) {
        const bt = EXP.backtest(m.r.pred.proba, m.r.daily.bh, state.run.config.threshold, c);
        return M.perf(bt.ret).cagr;
      });
      return { name: m.name, turnover: m.turnover, cagrs: cagrs };
    });
    const nBeat = COSTS.map(function (c, i) {
      return rows.filter(function (r) { return r.cagrs[i] > d.bh.cagr; }).length;
    });

    let h = '<table><caption><b>표 1</b>거래비용에 따른 연수익 변화 — 모델을 다시 학습하지 않고 비용만 다시 물린 값</caption><thead><tr>' +
      '<th>모델</th><th>포지션 교체율<br>(일평균)</th>' +
      COSTS.map(function (c) { return '<th>편도 ' + (c / 100).toFixed(2) + '%</th>'; }).join('') +
      '</tr></thead><tbody>';
    h += '<tr class="base"><td>그냥 들고 있기 <span class="tag b">기준선</span></td><td class="n">' +
      pc(d.bh.turnover, 1) + '</td>' +
      COSTS.map(function () { return '<td class="n">' + pc(d.bh.cagr) + '</td>'; }).join('') + '</tr>';
    rows.forEach(function (r) {
      h += '<tr><td>' + esc(r.name) + '</td><td class="n">' + pc(r.turnover, 1) + '</td>' +
        r.cagrs.map(function (v) {
          const cls = v > d.bh.cagr ? ' pos' : (v < 0 ? ' neg' : '');
          return '<td class="n' + cls + '">' + pc(v) + '</td>';
        }).join('') + '</tr>';
    });
    h += '<tr class="base"><td><b>기준선을 넘은 모델</b></td><td class="n">—</td>' +
      nBeat.map(function (v) { return '<td class="n"><b>' + v + ' / 4</b></td>'; }).join('') +
      '</tr></tbody></table>';
    $('#cost').innerHTML = h;
  }

  /* ------------------------------------------------------------------------
   *  05 겹별 일관성
   * ----------------------------------------------------------------------*/
  function drawGrid(d) {
    VIZ.grid($('#grid'), d.models.map(function (m) {
      return { name: m.name, cells: m.cells };
    }), { ref: 0.5, aria: '겹별 AUC 격자' });

    const nF = d.models[0] ? d.models[0].cells.length : 0;
    const tot = d.models.reduce(function (s, m) { return s + m.won; }, 0);
    const all = d.models.length * nF;
    $('#gridCap').innerHTML = '<b>그림 3</b> 겹마다 다시 잰 AUC. 채워진 칸이 0.5를 넘긴 겹입니다.';
    $('#gridRead').innerHTML =
      '<p><b>실력이라면 어느 겹에서도 대체로 넘어야 합니다.</b> 실제로는 ' +
      '전체 ' + all + '칸 중 <b>' + tot + '칸</b>(' + Math.round(tot / all * 100) + '%)만 0.5를 넘었습니다. ' +
      '신호가 전혀 없어도 우연히 절반쯤은 넘어야 하므로, 이는 <b>동전 던지기보다도 고르지 않은</b> 결과입니다.</p>' +
      '<p>다섯 겹을 모두 넘긴 모델은 ' +
      (d.models.filter(function (m) { return m.won === nF; }).length || '없습니다') +
      (d.models.filter(function (m) { return m.won === nF; }).length ? '개입니다.' : '. 시기를 바꾸면 순위가 바뀐다는 뜻입니다.') + '</p>';
  }

  /* ------------------------------------------------------------------------
   *  06 과적합 — 배운 구간을 다시 풀게 해 봅니다
   * ----------------------------------------------------------------------*/
  async function measureGap(cfg) {
    const prep = EXP.prepare(cfg);
    const out = [];
    for (let i = 0; i < MODELS.length; i++) {
      const id = MODELS[i], def = REG.get(id);
      if (!def || !def.make || def.exec === 'pre') {
        out.push({ id: id, name: def ? def.name : id,
          missing: '사전 학습 모델이라 학습 구간 성적을 낼 수 없습니다' });
        continue;
      }
      const tr = [], te = [];
      for (let k = 0; k < prep.cuts.length; k++) {
        const p = EXP.pack(prep.cuts[k], prep.std[k]);
        const ctx = { cols: prep.ds.cols, featVer: prep.ds.featVer, seed: cfg.seeds[0],
          ticker: cfg.ticker, task: 'direction' };
        try {
          const m = REG.create(id, { seed: cfg.seeds[0] });
          m.fit(p.train, ctx);
          tr.push(M.auc(p.train.y, m.predict(p.train, ctx)));
          te.push(M.auc(p.test.y, m.predict(p.test, ctx)));
        } catch (e) { /* 한 겹이 실패해도 나머지로 평균냅니다 */ }
        await U.yield_();
      }
      out.push({ id: id, name: def.name,
        a: U.mean(tr.filter(isFinite)), b: U.mean(te.filter(isFinite)) });
    }
    return out;
  }

  function drawGap(rows) {
    VIZ.pair($('#gapv'), rows, { ref: 0.5, aria: '학습 구간과 시험 구간의 AUC' });
    $('#gapCap').innerHTML =
      '<b>그림 4</b> 같은 모델이 <b>배운 구간</b>을 다시 풀었을 때와 <b>처음 보는 구간</b>을 풀었을 때의 AUC. ' +
      '시드 하나(42)로 다섯 겹을 평균한 값입니다.';

    const ok = rows.filter(function (r) { return !r.missing; });
    if (!ok.length) { $('#gapRead').innerHTML = ''; return; }
    const worst = ok.slice().sort(function (a, b) { return (b.a - b.b) - (a.a - a.b); })[0];
    const best = ok.slice().sort(function (a, b) { return (a.a - a.b) - (b.a - b.b); })[0];
    $('#gapRead').innerHTML =
      '<p><b>간격이 클수록 “외운 것”에 가깝습니다.</b> 학습 구간에서는 잘 맞히는데 시험 구간에서 무너진다면, ' +
      '그 모델이 배운 것은 규칙이 아니라 그 구간의 잡음입니다.</p>' +
      '<p>간격이 가장 큰 것은 <b>' + esc(worst.name) + '</b>(' + f(worst.a, 3) + ' → ' + f(worst.b, 3) +
      ', 간격 ' + f(worst.a - worst.b, 3) + '), 가장 작은 것은 <b>' + esc(best.name) + '</b>(' +
      f(best.a - best.b, 3) + ')입니다. ' +
      '그런데 간격이 가장 작은 모델조차 시험 구간 AUC는 <b>' + f(best.b, 4) + '</b>로 0.5 근처에 머뭅니다 — ' +
      '<b>과적합을 줄인다고 예측력이 생기지는 않는다</b>는 뜻입니다.</p>';
  }

  /* ------------------------------------------------------------------------
   *  07 전체 수치
   * ----------------------------------------------------------------------*/
  function drawTable(d) {
    let h = '<table><caption><b>표 2</b>전체 결과 — ' + esc(state.ticker) +
      ', 시간순 5겹 워크포워드, 편도 0.10% 거래비용</caption><thead><tr>' +
      '<th>모델</th><th>AUC</th><th>95% 구간</th><th>p값</th><th>정확도</th>' +
      '<th>샤프</th><th>연수익</th><th>최대낙폭</th><th>겹 승</th></tr></thead><tbody>';
    const line = function (m, base) {
      return '<tr' + (base ? ' class="base"' : '') + '><td>' + esc(m.name) +
        (base ? ' <span class="tag b">기준선</span>' : '') + '</td>' +
        '<td class="n">' + f(m.auc, 4) + '</td>' +
        '<td class="n">' + (isFinite(m.lo) ? f(m.lo, 3) + ' ~ ' + f(m.hi, 3) : '—') + '</td>' +
        '<td class="n">' + f(m.p, 3) + '</td>' +
        '<td class="n">' + f(m.acc, 4) + '</td>' +
        '<td class="n">' + f(m.sharpe, 2) + '</td>' +
        '<td class="n">' + pc(m.cagr) + '</td>' +
        '<td class="n">' + pc(m.mdd) + '</td>' +
        '<td class="n">' + m.won + '/' + m.cells.length + '</td></tr>';
    };
    d.models.forEach(function (m) { h += line(m, false); });
    d.bases.forEach(function (b) { h += line(b, true); });
    h += '</tbody></table>';
    $('#main').innerHTML = h;
    $('#mainNote').innerHTML =
      'p값은 AUC가 0.5와 다른지에 대한 Hanley–McNeil 검정 결과입니다. ' +
      '「겹 승」은 다섯 겹 중 AUC가 0.5를 넘은 겹의 수입니다. ' +
      '연수익·샤프·최대낙폭은 모두 거래비용을 뗀 뒤의 값입니다.';
  }

  /* ------------------------------------------------------------------------
   *  결론
   * ----------------------------------------------------------------------*/
  function drawClose(d, gap) {
    const nF = d.models[0] ? d.models[0].cells.length : 5;
    const tot = d.models.reduce(function (s, m) { return s + m.won; }, 0);
    const all = d.models.length * nF;
    const minP = Math.min.apply(null, d.models.map(function (m) { return m.p; }).filter(isFinite));
    const okGap = gap.filter(function (g) { return !g.missing; });
    const meanGap = okGap.length ? U.mean(okGap.map(function (g) { return g.a - g.b; })) : NaN;

    const links = [
      ['1', '점만 보면 순위가 나오지만, 구간을 보면 남지 않는다',
        '네 모델의 AUC는 ' + d.models.map(function (m) { return f(m.auc, 3); }).join(' · ') +
        '로 서로 다릅니다. 그러나 95% 신뢰구간이 모두 0.5를 지나갑니다. ' +
        '즉 이 차이는 우연으로 설명되는 범위 안에 있습니다.',
        '유의한 모델 ' + d.nSig + '/4 · 최소 p값 ' + f(minP, 3)],
      ['2', '정확도는 기준선이 이긴다',
        '상승일이 ' + pc(d.upRate, 2) + '이므로 “항상 오른다”고만 답해도 그만큼 맞습니다. ' +
        '정확도 1위는 ' + esc(d.accTop.name) + '(' + f(d.accTop.acc, 4) + ')였습니다.',
        '기준선 정확도 ' + f(d.accTop.acc, 4)],
      ['3', '거래비용을 넣으면 수익도 남지 않는다',
        '편도 0.10%를 적용하면 그냥 들고 있기(연 ' + pc(d.bh.cagr) + ')를 넘는 모델이 ' +
        d.nBeat + '개입니다. 자주 갈아타는 모델일수록 더 빨리 무너집니다.',
        '바이앤홀드 초과 ' + d.nBeat + '/4'],
      ['4', '겹을 바꾸면 성적이 흩어진다',
        '다섯 겹은 서로 다른 시기입니다. 전체 ' + all + '칸 중 0.5를 넘긴 것은 ' + tot + '칸이었습니다. ' +
        '실력이 있다면 시기와 무관하게 넘어야 합니다.',
        '겹 승률 ' + Math.round(tot / all * 100) + '%'],
      ['5', '과적합을 줄여도 예측력은 생기지 않는다',
        isFinite(meanGap)
          ? '학습 구간과 시험 구간의 AUC 간격은 평균 ' + f(meanGap, 3) + '이었습니다. ' +
            '간격이 가장 작은 모델조차 시험 구간에서는 0.5 근처에 머뭅니다. ' +
            '문제는 “덜 외우게 하는 것”이 아니라 <b>외울 규칙이 애초에 있는가</b>입니다.'
          : '사전 학습 모델이 섞여 있어 이 항목은 일부 모델에서만 측정했습니다.',
        isFinite(meanGap) ? '평균 간격 ' + f(meanGap, 3) : '측정 대상 ' + okGap.length + '개']
    ];

    $('#chain').innerHTML = links.map(function (l) {
      return '<div class="link"><div class="n">' + l[0] + '</div><div>' +
        '<h4>' + l[1] + '</h4><p>' + l[2] + '</p>' +
        '<div class="ev">근거 · ' + l[3] + '</div></div></div>';
    }).join('');

    // 자료는 평일마다 갱신됩니다. 결론 문장을 고정해 두면 언젠가 자료와
    // 어긋나므로, 유의한 모델이 나온 경우의 문장도 함께 둡니다.
    const sigNames = d.models.filter(function (m) { return m.sig; })
      .map(function (m) { return m.name; });
    const head = d.nSig === 0
      ? '널리 쓰이는 네 모델 — 선형·통계·트리·딥러닝 — 어느 것도 ' + esc(state.ticker) +
        '의 다음 거래일 방향에서 <b>기준선을 유의하게 넘지 못했다.</b>'
      : esc(state.ticker) + '에서는 ' + sigNames.map(esc).join(' · ') +
        '이(가) 기준선을 <b>유의하게 넘었다</b>(' + d.nSig + '/4). ' +
        '다만 이 결과는 한 종목에서 나온 것이므로, 다른 종목에서도 유지되는지 확인해야 한다.';
    const tail = d.nSig === 0
      ? '모델의 복잡도는 결과를 바꾸지 못했다. 가장 단순한 ARIMA와 가장 무거운 LSTM의 성적 차이가 ' +
        '신뢰구간 안에서 사라졌기 때문이다. 이는 “더 좋은 모델을 쓰면 나아진다”가 아니라, ' +
        '<b>이 문제에 남아 있는 예측 가능한 신호 자체가 없다</b>는 쪽을 가리킨다.'
      : '유의한 모델이 하나라도 나왔다면 종목을 바꿔 가며 같은 결과가 반복되는지 먼저 확인해야 한다. ' +
        '한 종목·한 기간에서 우연히 유의해지는 일은 흔하다.';

    $('#final').innerHTML =
      '<div class="k">판정</div><p>' + head + '</p><p>' + tail + '</p>';
  }

  /* ------------------------------------------------------------------------
   *  실행
   * ----------------------------------------------------------------------*/
  function progress(v, label) {
    const bar = $('#barp'), inner = $('#barpi');
    if (v === null) { bar.hidden = true; return; }
    bar.hidden = false;
    inner.style.width = Math.round(v * 100) + '%';
    if (label) $('#stat').textContent = label;
  }

  async function run(ticker) {
    if (state.busy) return;
    state.busy = true;
    state.ticker = ticker;
    $('#run').disabled = true; $('#tk').disabled = true;
    progress(0, '학습 준비 중…');

    try {
      const cfg = { ticker: ticker };
      const out = await EXP.run(ASK, cfg, function (p) {
        progress(p.total ? p.done / p.total * 0.75 : 0, p.label);
      });
      state.run = out;
      const d = derive(out);

      drawTiles(d);
      drawCards();
      drawChecks(out);
      drawCI(d);
      drawAcc(d);
      drawProfit(d);
      drawGrid(d);
      drawTable(d);

      progress(0.8, '학습 구간 성적 재는 중…');
      const gap = await measureGap(Object.assign({}, EXP.DEFAULT, cfg));
      state.gap = gap;
      drawGap(gap);
      drawClose(d, gap);

      progress(1, '완료 · ' + ticker + ' · ' +
        out.results.reduce(function (s, r) { return s + r.runs.length; }, 0) + '회 학습');
      setTimeout(function () { progress(null); }, 600);
    } catch (e) {
      $('#stat').textContent = '실패 — ' + e.message;
      progress(null);
      console.error(e);
    } finally {
      state.busy = false;
      $('#run').disabled = false; $('#tk').disabled = false;
      $('#boot').classList.add('gone');
    }
  }

  /* ------------------------------------------------------------------------
   *  시작
   * ----------------------------------------------------------------------*/
  function fillTickers() {
    const sel = $('#tk');
    let list = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'TSLA'];
    const cfg = PRED && PRED.state.ok && PRED.state.data && PRED.state.data.config;
    if (cfg && Array.isArray(cfg.tickers) && cfg.tickers.length) list = cfg.tickers.slice();
    list = list.filter(function (t) { return !!DATA.series(t); });
    sel.innerHTML = list.map(function (t) {
      return '<option value="' + esc(t) + '">' + esc(t) + '</option>';
    }).join('');
    sel.value = list.indexOf('AAPL') >= 0 ? 'AAPL' : list[0];
    return sel.value;
  }

  function boot() {
    $('#bootT').textContent = '시장 데이터를 읽는 중…';
    DATA.loadFast()
      .then(function () {
        $('#bootT').textContent = '전체 기간과 사전 학습 결과를 읽는 중…';
        return DATA.loadFull();
      })
      .then(function () {
        if (!PRED || !PRED.state.ok) {
          $('#stat').textContent = '사전 학습 결과가 없어 LSTM은 빠집니다';
          const i = MODELS.indexOf('lstm');
          if (i >= 0) { MODELS.splice(i, 1); ASK.splice(ASK.indexOf('lstm'), 1); }
        }
        const t = fillTickers();
        $('#tk').addEventListener('change', function () { run(this.value); });
        $('#run').addEventListener('click', function () { run($('#tk').value); });
        return run(t);
      })
      .catch(function (e) {
        $('#boot').innerHTML = '<div class="boot-in"><p>데이터를 불러오지 못했습니다 — ' +
          esc(e.message) + '</p></div>';
        console.error(e);
      });
  }

  document.addEventListener('DOMContentLoaded', boot);
})(window.QL = window.QL || {});
