/* ============================================================================
 *  score.js — 점수 매기기와 통계 검정
 *
 *  점수표는 늘 같은 세 곳에서 공격받습니다.
 *      "왜 그 지표?"  "왜 그 가중치?"  "그거 우연 아냐?"
 *  이 파일은 그 셋에 답하려고 만들었습니다.
 *
 *  ① 기준선 대비로 매깁니다 — 0점 = 기준선과 똑같음, 음수 = 기준선보다 못함.
 *     절대값으로 매기면 "AUC 0.52면 몇 점인가?"에서 다툼이 끝나지 않습니다.
 *     기준선을 0점으로 두면 해석에 다툼의 여지가 없어집니다.
 *
 *  ② 다른 모델과 견주어 매기지 않습니다(min-max 정규화 금지).
 *     그렇게 하면 모델을 하나 추가하거나 빼는 것만으로 모든 점수가 흔들려서
 *     "숫자를 짜맞췄다"는 인상을 줍니다. 여기 나오는 모든 점수는 그 모델
 *     하나만 보고 계산되며, 다른 모델이 몇 개든 값이 바뀌지 않습니다.
 *
 *  ③ 가중치는 기본값만 제시하고 화면에서 바꿀 수 있게 열어 둡니다.
 *
 *  ④ 우연을 통계로 걸러 냅니다 — 시드 반복, 폴드별 승률, 부트스트랩
 *     신뢰구간, Diebold-Mariano 검정, 시도한 하이퍼파라미터 조합 수 공개.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, REG = root.REG;
  const S = {};

  /* ========================================================================
   *  네 개의 축
   *
   *  ★ 축마다 '0점의 뜻'이 다릅니다. 이걸 숨기면 안 됩니다.
   *    예측력·투자 성과 → 0점은 '기준선과 같음'. 음수가 나올 수 있습니다.
   *    안정성·실용성   → 0점은 '고정 기준의 밑바닥'. 비교 대상이 아니라
   *                      미리 정해 둔 자에 대고 잰 값입니다.
   *    (안정성은 승률 부분만 기준선 대비라 음수가 나올 수 있습니다.)
   * ======================================================================*/
  S.AXES = [
    {
      id: 'skill', name: '예측력', weight: 30,
      zero: '기준선과 같으면 0점',
      what: '얼마나 잘 맞히는가',
      how: '방향 예측 = (AUC − 0.5) ÷ 0.05 × 100 · 변동성 예측 = (EWMA 대비 MSE 개선율) ÷ 20% × 100',
      why: '정확도 대신 AUC를 쓰는 이유는 정확도가 속기 쉽기 때문입니다. 상승일이 많은 ' +
        '구간에서는 "무조건 오른다"만 찍어도 정확도가 53%쯤 나옵니다.'
    },
    {
      id: 'profit', name: '투자 성과', weight: 30,
      zero: '바이앤홀드와 같으면 0점',
      what: '실제로 돈이 되는가',
      how: '(모델의 샤프지수 − 바이앤홀드의 샤프지수) ÷ 1.0 × 100',
      why: '잘 맞히는 것과 돈을 버는 것은 다른 문제입니다. 거래비용을 물린 뒤의 ' +
        '샤프지수를, 그냥 사서 묻어 둔 것과 비교합니다.'
    },
    {
      id: 'stability', name: '안정성', weight: 25,
      zero: '폴드 절반을 이기고 보통만큼 흔들리면 0점',
      what: '어쩌다 한 번 잘한 게 아닌가',
      how: '폴드 승률 50% + 폴드 간 편차 30% + 시드 간 편차 20%',
      why: '한 기간만 잘 맞은 모델은 대개 과적합입니다. 이 축이 그것을 잡아냅니다. ' +
        '비중을 낮게 잡으면 안 되는 이유입니다.'
    },
    {
      id: 'practical', name: '실용성', weight: 15,
      zero: '1초 학습 + 해석 가능성 중이면 0점',
      what: '실제로 쓸 수 있는가',
      how: '학습 시간 — 10배 빨라질 때마다 +25점 · 해석 가능성 — 상 +40 / 중 0 / 하 −40',
      why: '성적이 조금 좋아도 100배 느리고 왜 그렇게 답했는지 설명할 수 없다면 ' +
        '학교 과제로도, 실무에서도 쓰기 어렵습니다.'
    }
  ];

  S.DEFAULT_WEIGHTS = { skill: 30, profit: 30, stability: 25, practical: 15 };

  /*  ★ 100점의 뜻을 축마다 고정해 둡니다
   *
   *  네 축의 점수를 더하려면 "1점"의 크기가 축끼리 비슷해야 합니다. 그러지
   *  않으면 가중치를 아무리 조절해도 한 축이 총점을 독차지합니다.
   *  (실제로 겪은 문제입니다. AUC를 0.5로 나누면 현실적인 차이가 ±4점밖에
   *   안 나오는데 실용성은 0~100점이라, 느리든 말든 예측을 못 하는 모델이
   *   1등을 했습니다.)
   *
   *  그래서 축마다 **100점 = 실무에서 "대단히 좋다"고 할 만한 수준**으로
   *  자를 맞췄습니다. 이 값들은 다른 모델을 보고 정하는 것이 아니라 미리
   *  고정된 값이라, 모델을 추가하거나 빼도 남의 점수가 흔들리지 않습니다. */
  S.ANCHOR = {
    skillDirection: 0.05,    // AUC 0.55 = 100점 (일간 방향 예측에서 이 정도면 대단합니다)
    skillVolatility: 0.20,   // EWMA 대비 MSE 20% 개선 = 100점
    profitSharpe: 1.0,       // 바이앤홀드보다 샤프지수 1.0 높으면 = 100점
    timeMid: 1000,           // 학습 1초 = 0점
    timeDecade: 25           // 10배 빨라질 때마다 +25점 (최대 ±50)
  };

  // 안정성: 이만큼 흔들리면 0점, 전혀 안 흔들리면 +100점
  S.SD_REF = { direction: 0.05, volatility: 10 };   // AUC 기준 0.05 · 상대 MSE 기준 10%p
  const INTERP_SCORE = { '상': 40, '중': 0, '하': -40 };

  function clip(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

  /* ========================================================================
   *  축별 점수
   * ======================================================================*/

  // 예측력 — 과제마다 자가 다릅니다
  S.skillScore = function (r, refs) {
    if (r.task === 'direction') {
      const auc = r.agg.auc.mean;
      return isFinite(auc) ? (auc - 0.5) / S.ANCHOR.skillDirection * 100 : null;
    }
    if (r.task === 'volatility') {
      const mse = r.agg.mse.mean;
      if (!isFinite(mse) || !isFinite(refs.mseEwma) || refs.mseEwma <= 0) return null;
      return (1 - mse / refs.mseEwma) / S.ANCHOR.skillVolatility * 100;
    }
    return null;
  };

  // 투자 성과 — 변동성 모델은 매매 신호가 없으므로 해당 없음(null)
  S.profitScore = function (r, refs) {
    if (r.task !== 'direction') return null;
    const sh = r.agg.sharpe.mean;
    if (!isFinite(sh) || !isFinite(refs.sharpeBH)) return null;
    return (sh - refs.sharpeBH) / S.ANCHOR.profitSharpe * 100;
  };

  // 폴드별로 기준선을 이겼는가
  S.foldWins = function (r, refs) {
    const wins = [];
    r.folds.forEach(function (f, k) {
      if (r.task === 'direction') wins.push(isFinite(f.auc) ? f.auc > 0.5 : null);
      else if (r.task === 'volatility') {
        const ref = refs.ewmaFoldMse && refs.ewmaFoldMse[k];
        wins.push(isFinite(f.mse) && isFinite(ref) ? f.mse < ref : null);
      }
    });
    const valid = wins.filter(function (w) { return w !== null; });
    return { wins: wins, rate: valid.length ? valid.filter(Boolean).length / valid.length : NaN,
      won: valid.filter(Boolean).length, total: valid.length };
  };

  // 안정성 — 승률 · 폴드 간 편차 · 시드 간 편차
  S.stabilityScore = function (r, refs) {
    const fw = S.foldWins(r, refs);
    if (!isFinite(fw.rate)) return null;
    const ref = S.SD_REF[r.task] || 0.10;

    // ① 승률 — 절반을 이기면 0점, 전부 이기면 +100, 전부 지면 −100
    const winPart = (fw.rate - 0.5) * 200;

    // ② 폴드 간 편차 — 기간이 바뀌어도 성적이 유지되는가
    // ★ 변동성은 '그 폴드의 EWMA'와 비교해야 합니다. 전체 평균 EWMA와 비교하면
    //   폴드마다 시장 상황이 달라 생긴 차이까지 모델 탓으로 잡히고, EWMA 자신조차
    //   불안정한 모델로 나옵니다.
    let vals;
    if (r.task === 'direction') vals = r.folds.map(function (f) { return f.auc; }).filter(isFinite);
    else vals = r.folds.map(function (f, k) {
      const ref2 = refs.ewmaFoldMse && refs.ewmaFoldMse[k];
      return isFinite(f.mse) && isFinite(ref2) && ref2 > 0 ? (1 - f.mse / ref2) * 100 : NaN;
    }).filter(isFinite);
    const sdFold = vals.length > 1 ? U.std(vals, 1) : 0;
    const foldPart = clip(100 * (1 - sdFold / ref), -100, 100);

    // ③ 시드 간 편차 — 난수를 안 쓰는 모델은 몇 번을 돌려도 같은 답이라 만점
    let seedPart = 100;
    if (r.stochastic) {
      const key = r.task === 'direction' ? 'auc' : 'mse';
      const sd = r.agg[key] ? r.agg[key].sd : 0;
      const sdRel = r.task === 'direction' ? sd : (refs.mseEwma > 0 ? sd / refs.mseEwma * 100 : 0);
      seedPart = clip(100 * (1 - sdRel / (ref / 2)), -100, 100);
    }

    return 0.5 * winPart + 0.3 * foldPart + 0.2 * seedPart;
  };

  // 실용성 — 학습 시간(로그 눈금)과 해석 가능성. 1초 + 해석'중' 이 0점입니다.
  S.timeScore = function (ms) {
    const t = Math.max(ms, 1);
    const decades = Math.log10(t) - Math.log10(S.ANCHOR.timeMid);
    return clip(-S.ANCHOR.timeDecade * decades, -50, 50);
  };
  S.practicalScore = function (r) {
    const t = S.timeScore(r.ms);
    const i = INTERP_SCORE[r.interpret] !== undefined ? INTERP_SCORE[r.interpret] : 0;
    return t + i;
  };

  /* ========================================================================
   *  통계 — "우연 아냐?"에 답하는 장치들
   * ======================================================================*/

  /*  AUC가 0.5보다 유의하게 큰가 (Hanley–McNeil 표준오차)
   *  AUC는 표본이 적으면 우연히 0.55쯤 나오기도 합니다. 표본 수를 넣어
   *  "이 정도 차이는 우연으로도 흔한가"를 봅니다. */
  S.aucTest = function (auc, nPos, nNeg) {
    if (!isFinite(auc) || nPos < 2 || nNeg < 2) return { se: NaN, z: NaN, p: NaN };
    const q1 = auc / (2 - auc);
    const q2 = 2 * auc * auc / (1 + auc);
    const v = (auc * (1 - auc) + (nPos - 1) * (q1 - auc * auc) + (nNeg - 1) * (q2 - auc * auc)) / (nPos * nNeg);
    const se = Math.sqrt(Math.max(v, 1e-12));
    const z = (auc - 0.5) / se;
    return { se: se, z: z, p: U.twoSidedP(z), significant: U.twoSidedP(z) < 0.05 };
  };

  /*  이동 블록 부트스트랩
   *
   *  같은 자료를 여러 번 다시 뽑아 "이 평균이 얼마나 흔들릴 수 있는지"를 봅니다.
   *  주가 수익률은 하루하루가 서로 얽혀 있어서(변동성 뭉침) 한 개씩 뽑으면
   *  안 됩니다. 20일씩 덩어리째 뽑아야 그 얽힘이 유지됩니다.
   *  결과 구간이 0을 걸치면 "유의차 없음" — 우연으로도 이 정도는 나옵니다. */
  S.blockBootstrap = function (x, opt) {
    const o = Object.assign({ B: 2000, block: 20, seed: 7, level: 0.95 }, opt || {});
    const n = x.length;
    if (n < 30) return { lo: NaN, hi: NaN, mean: n ? U.mean(x) : NaN, n: n };
    const rnd = U.rng(o.seed);
    const nb = Math.ceil(n / o.block);
    const means = new Float64Array(o.B);
    for (let b = 0; b < o.B; b++) {
      let s = 0, cnt = 0;
      for (let k = 0; k < nb && cnt < n; k++) {
        const start = rnd.int(Math.max(1, n - o.block));
        for (let i = 0; i < o.block && cnt < n; i++) { s += x[start + i]; cnt++; }
      }
      means[b] = s / cnt;
    }
    const a = (1 - o.level) / 2;
    return {
      mean: U.mean(x),
      lo: U.quantile(means, a),
      hi: U.quantile(means, 1 - a),
      n: n, B: o.B, block: o.block,
      crossesZero: U.quantile(means, a) <= 0 && U.quantile(means, 1 - a) >= 0
    };
  };

  /*  Diebold-Mariano 검정
   *
   *  두 모델의 '하루하루 틀린 정도'를 나란히 놓고 뺀 다음, 그 차이의 평균이
   *  0과 다르다고 볼 수 있는지 봅니다. 옆 날짜끼리 비슷한 성질이 있어서
   *  분산은 Newey-West 방식으로(이웃 날짜의 상관까지 반영해) 계산합니다.
   *
   *  손실이 작을수록 좋은 모델이므로, 차이의 평균이 음수면 A가 낫습니다.
   *  학생에게는 수식 대신 결과만 보여 줍니다 — "차이 있음 ✓ / 없음 ✗". */
  S.dm = function (lossA, lossB, opt) {
    const o = opt || {};
    const n = Math.min(lossA.length, lossB.length);
    if (n < 30) return { stat: NaN, p: NaN, n: n };
    const d = new Float64Array(n);
    for (let i = 0; i < n; i++) d[i] = lossA[i] - lossB[i];
    const dbar = U.mean(d);
    const L = o.lag || Math.max(1, Math.round(Math.pow(n, 1 / 3)));

    function gamma(k) {
      let s = 0;
      for (let i = k; i < n; i++) s += (d[i] - dbar) * (d[i - k] - dbar);
      return s / n;
    }
    let v = gamma(0);
    for (let k = 1; k <= L; k++) v += 2 * (1 - k / (L + 1)) * gamma(k);
    if (!(v > 0)) return { stat: NaN, p: NaN, n: n };

    const stat = dbar / Math.sqrt(v / n);
    const p = U.twoSidedP(stat);
    return {
      stat: stat, p: p, n: n, lag: L, dbar: dbar,
      significant: p < 0.05,
      winner: p < 0.05 ? (dbar < 0 ? 'A' : 'B') : null
    };
  };

  /*  시도한 하이퍼파라미터 조합 수
   *  많이 시도할수록 "그중 잘 나온 것 하나"를 고를 확률이 올라갑니다(다중검정).
   *  숨기지 않고 밝히는 편이 신뢰도를 올립니다. 브라우저 모델은 설정을 아예
   *  건드리지 않았으므로 1입니다. */
  S.hparamsTried = function (id) {
    const PRED = root.PRED;
    if (PRED && PRED.state.ok) {
      const v = PRED.hparamsTried(id);
      if (v !== null && v !== undefined) return v;
    }
    const def = REG.get(id);
    return (def && def.exec === 'pre') ? null : 1;
  };

  /* ========================================================================
   *  점수표 만들기
   * ======================================================================*/
  S.normalizeWeights = function (w) {
    const ww = Object.assign({}, S.DEFAULT_WEIGHTS, w || {});
    let sum = 0;
    S.AXES.forEach(function (a) { ww[a.id] = Math.max(0, +ww[a.id] || 0); sum += ww[a.id]; });
    if (sum <= 0) return Object.assign({}, S.DEFAULT_WEIGHTS);
    return ww;
  };

  // 실험 결과에서 기준선 값들을 뽑아냅니다.
  S.refs = function (run) {
    const refs = { sharpeBH: NaN, mseEwma: NaN, ewmaFoldMse: null, cagrBH: NaN, mddBH: NaN };
    run.results.forEach(function (r) {
      if (r.task === 'direction' && r.agg && isFinite(r.agg.bhSharpe.mean) && !isFinite(refs.sharpeBH)) {
        refs.sharpeBH = r.agg.bhSharpe.mean;
        refs.cagrBH = r.agg.bhCagr.mean;
        refs.mddBH = r.agg.bhMdd ? r.agg.bhMdd.mean : NaN;
      }
      if (r.id === 'ewma') {
        refs.mseEwma = r.agg.mse.mean;
        refs.ewmaFoldMse = r.folds.map(function (f) { return f.mse; });
        refs.ewmaLoss = r.loss;
      }
      if (r.id === 'coin') refs.coinLoss = r.loss;
    });
    return refs;
  };

  S.build = function (run, weights) {
    const w = S.normalizeWeights(weights);
    const refs = S.refs(run);
    const rows = [];

    run.results.forEach(function (r) {
      if (r.task === 'regime') return;           // 국면 모델은 채점 대상이 아닙니다

      const axes = {
        skill: S.skillScore(r, refs),
        profit: S.profitScore(r, refs),
        stability: S.stabilityScore(r, refs),
        practical: S.practicalScore(r)
      };

      // 해당 없는 축은 빼고 나머지 가중치를 다시 100%로 맞춥니다.
      let num = 0, den = 0;
      S.AXES.forEach(function (a) {
        if (axes[a.id] === null || !isFinite(axes[a.id])) return;
        num += w[a.id] * axes[a.id];
        den += w[a.id];
      });
      const total = den > 0 ? num / den : NaN;

      const fw = S.foldWins(r, refs);
      const stats = { foldWin: fw, hparams: S.hparamsTried(r.id) };

      if (r.task === 'direction') {
        // AUC 유의성 — 전체 시험 구간을 합쳐서
        let nPos = 0, nAll = 0;
        r.folds.forEach(function (f) {
          nAll += f.n;
          nPos += Math.round(f.n * (isFinite(f.posRate) ? f.posRate : 0.5));
        });
        stats.auc = S.aucTest(r.agg.auc.mean, nPos, nAll - nPos);

        // 바이앤홀드보다 많이 벌었는가 — 초과수익의 신뢰구간
        if (r.daily && r.daily.ret.length) {
          const ex = [];
          for (let i = 0; i < r.daily.ret.length; i++) ex.push(r.daily.ret[i] - r.daily.bh[i]);
          const ci = S.blockBootstrap(ex);
          stats.excess = {
            annual: ci.mean * 252, lo: ci.lo * 252, hi: ci.hi * 252,
            crossesZero: ci.crossesZero, n: ci.n
          };
        }
        // 기준선(동전)과의 DM 검정
        // ※ 동전은 확률을 아무렇게나 찍으므로 이 비교에서 이기는 것은 쉽습니다.
        //   "우연이 아닌가"의 진짜 답은 위의 AUC 검정 쪽을 보세요.
        if (refs.coinLoss && r.id !== 'coin') {
          stats.dmVsBaseline = S.dm(r.loss, refs.coinLoss);
          stats.dmVsBaseline.against = '동전 던지기';
        }
      } else if (r.task === 'volatility') {
        if (refs.ewmaLoss && r.id !== 'ewma') {
          stats.dmVsBaseline = S.dm(r.loss, refs.ewmaLoss);
          stats.dmVsBaseline.against = 'EWMA';
        }
      }

      rows.push({
        id: r.id, name: r.name, task: r.task, exec: r.exec, baseline: r.baseline,
        stochastic: r.stochastic, interpret: r.interpret, ms: r.ms,
        axes: axes, total: total, agg: r.agg, folds: r.folds, stats: stats,
        seeds: r.seeds.length
      });
    });

    /*  ★ 순위는 같은 과제 안에서만 매깁니다
     *
     *  방향 예측 모델과 변동성 예측 모델을 한 줄로 세우면 안 됩니다. 변동성
     *  모델은 매매 신호가 없어 '투자 성과' 축이 아예 없는데, 없는 축을 빼고
     *  나머지 가중치를 다시 100%로 맞추면 "그 축에서 점수를 못 받는 일 자체가
     *  없다"는 이유로 유리해집니다. 실제로 처음 만들었을 때 변동성 모델이
     *  전체 1등을 했습니다. 문제를 아예 다르게 푸는 모델끼리는 비교하지
     *  않는 것이 맞습니다. */
    const groups = {};
    rows.forEach(function (r) { (groups[r.task] = groups[r.task] || []).push(r); });
    Object.keys(groups).forEach(function (t) {
      groups[t].sort(function (a, b) { return (b.total || -1e9) - (a.total || -1e9); });
      groups[t].forEach(function (r, i) { r.rank = i + 1; r.rankOf = groups[t].length; });
    });
    rows.sort(function (a, b) {
      if (a.task !== b.task) return a.task === 'direction' ? -1 : 1;
      return (b.total || -1e9) - (a.total || -1e9);
    });

    return { weights: w, refs: refs, rows: rows, groups: groups,
      anchors: S.ANCHOR, config: run.config, describe: run.describe };
  };

  /*  축별 승자
   *  최종 결론을 "1등 모델"로 내지 않는 이유는, 그 한 줄이 거의 항상 틀리기
   *  때문입니다. 방향 예측에 강한 모델과 변동성 예측에 강한 모델은 다릅니다. */
  S.TASK_NAME = { direction: '방향 예측', volatility: '변동성 예측' };

  S.winners = function (table) {
    const byTask = {};
    Object.keys(table.groups).forEach(function (task) {
      // 기준선은 승자가 될 수 없습니다. 0점을 정하는 쪽이 1등을 할 수는 없으니까요.
      const rows = table.groups[task].filter(function (r) { return !r.baseline; });
      const axes = [];
      S.AXES.forEach(function (a) {
        let best = null;
        rows.forEach(function (r) {
          const v = r.axes[a.id];
          if (v === null || !isFinite(v)) return;
          if (!best || v > best.score) best = { id: r.id, name: r.name, score: v };
        });
        if (best) axes.push({ axis: a.id, axisName: a.name, winner: best });
      });
      byTask[task] = { task: task, taskName: S.TASK_NAME[task] || task, axes: axes,
        overall: rows.length ? { id: rows[0].id, name: rows[0].name, total: rows[0].total } : null };
    });
    return byTask;
  };

  /*  한 줄 결론
   *
   *  ★ "1등 모델은 XX입니다"라고 쓰지 않습니다. 그 한 줄은 거의 항상 틀립니다.
   *    방향 예측을 잘하는 모델과 변동성 예측을 잘하는 모델은 다르고, 잘 맞히는
   *    모델과 돈을 버는 모델도 다릅니다. 그래서 축별로 나눠 말합니다. */
  S.verdict = function (table) {
    const wn = S.winners(table);
    const parts = [];
    Object.keys(wn).forEach(function (task) {
      const g = wn[task];
      const skill = g.axes.filter(function (a) { return a.axis === 'skill'; })[0];
      // ★ 1등이 있어도 점수가 음수면 "기준선보다 못하다"는 뜻입니다. 그럴 때
      //   승자 이름만 적으면 없는 성과를 있는 것처럼 말하게 됩니다.
      if (skill) {
        parts.push(skill.winner.score > 0
          ? g.taskName + '엔 ' + skill.winner.name
          : g.taskName + '에서는 기준선을 이긴 모델이 없음');
      }
      const prof = g.axes.filter(function (a) { return a.axis === 'profit'; })[0];
      if (prof) {
        parts.push(prof.winner.score > 0
          ? '수익성엔 ' + prof.winner.name
          : '수익성은 어느 모델도 바이앤홀드를 못 이김');
      }
    });
    return parts.length ? parts.join(', ') : '아직 기준선을 이긴 모델이 없습니다.';
  };

  root.SCORE = S;
})(window.QL = window.QL || {});
