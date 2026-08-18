/* ============================================================================
 *  splits.js — 시간순 분할(walk-forward)과 표준화
 *
 *  ★ 왜 무작위로 섞으면 안 되는가
 *    시험 문제를 미리 보고 시험을 치면 100점이 나옵니다. 주가 데이터도 같습니다.
 *    데이터를 무작위로 섞어 학습/시험을 나누면, 모델은 "미래의 어제"를 이미
 *    본 상태로 오늘을 맞히게 됩니다. 그래서 이 사이트는 무작위 분할을 아예
 *    제공하지 않습니다. 항상 과거로 배우고 그 다음 기간을 맞힙니다.
 *
 *      학습(과거) ──────▶│ 비움 │▶ 시험(미래)
 *
 *  ★ 사이에 '비우는 구간'을 두는 이유
 *    정답이 t+1일을 보기 때문에 학습 마지막 날은 시험 첫날과 겹칩니다(purge).
 *    겹치지 않더라도 바로 옆 날짜는 거의 같은 상황이라 며칠 더 비웁니다(embargo).
 *
 *  ★ 표준화를 여기서 하는 이유
 *    평균·표준편차를 전체 구간에서 계산하면 미래 정보가 새어 들어옵니다.
 *    학습 구간의 통계만으로 자를 만들어 시험 구간에 그대로 적용합니다.
 *    그리고 이 일은 모델이 아니라 바깥에서 해야 모든 모델의 조건이 같아집니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U;
  const S = {};

  S.DEFAULT = { folds: 5, minTrain: 0.5, embargo: 5, mode: 'expanding', window: 756 };

  /* ------------------------------------------------------------------------
   *  워크포워드 분할
   *    n      전체 행 수
   *    folds  시험 구간을 몇 조각으로 나눌 것인가
   *    minTrain 첫 학습에 최소 몇 %를 쓸 것인가
   *    mode   'expanding' 과거를 계속 쌓아 감 / 'rolling' 최근 window일만 씀
   *    반환   [{ fold, trainLo, trainHi, testLo, testHi }]  (hi는 포함하지 않음)
   * ----------------------------------------------------------------------*/
  S.walkForward = function (n, opt) {
    const o = Object.assign({}, S.DEFAULT, opt || {});
    const gap = 1 + Math.max(0, o.embargo);      // purge 1일 + embargo
    const start = Math.floor(n * o.minTrain);
    const block = Math.floor((n - start) / o.folds);
    const out = [];
    if (block < 20) return out;                  // 시험 구간이 너무 짧으면 의미 없음

    for (let k = 0; k < o.folds; k++) {
      const testLo = start + k * block;
      const testHi = (k === o.folds - 1) ? n : testLo + block;
      const trainHi = testLo - gap;
      const trainLo = (o.mode === 'rolling') ? Math.max(0, trainHi - o.window) : 0;
      if (trainHi - trainLo < 100) continue;     // 학습 표본이 100개 미만이면 건너뜀
      out.push({ fold: k + 1, trainLo: trainLo, trainHi: trainHi, testLo: testLo, testHi: testHi });
    }
    return out;
  };

  // 분할 설정을 사람이 읽을 한 줄로
  S.describe = function (opt) {
    const o = Object.assign({}, S.DEFAULT, opt || {});
    return '시간순 ' + o.folds + '겹 워크포워드 · ' +
      (o.mode === 'rolling' ? ('최근 ' + o.window + '일만 학습') : '과거 전체 누적 학습') +
      ' · 학습과 시험 사이 ' + (1 + o.embargo) + '일 비움';
  };

  /* ------------------------------------------------------------------------
   *  잘라내기 도우미
   * ----------------------------------------------------------------------*/
  S.slice = function (arr, lo, hi) { return arr.slice(lo, hi); };

  // 한 겹(fold)에 필요한 조각을 한 번에 꺼냅니다.
  S.cut = function (ds, sp) {
    return {
      train: {
        X: ds.X.slice(sp.trainLo, sp.trainHi),
        y: ds.y.slice(sp.trainLo, sp.trainHi),
        ret: ds.ret.slice(sp.trainLo, sp.trainHi),
        dates: ds.dates.slice(sp.trainLo, sp.trainHi),
        idx: ds.idx.slice(sp.trainLo, sp.trainHi)
      },
      test: {
        X: ds.X.slice(sp.testLo, sp.testHi),
        y: ds.y.slice(sp.testLo, sp.testHi),
        ret: ds.ret.slice(sp.testLo, sp.testHi),
        dates: ds.dates.slice(sp.testLo, sp.testHi),
        idx: ds.idx.slice(sp.testLo, sp.testHi)
      }
    };
  };

  /* ------------------------------------------------------------------------
   *  표준화 (평균 0, 표준편차 1) — 학습 구간 통계만 사용
   * ----------------------------------------------------------------------*/
  function Scaler() { this.mu = null; this.sd = null; }

  Scaler.prototype.fit = function (X) {
    if (!X.length) throw new Error('표준화할 학습 데이터가 비어 있습니다.');
    const p = X[0].length, n = X.length;
    this.mu = new Float64Array(p);
    this.sd = new Float64Array(p);
    for (let j = 0; j < p; j++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += X[i][j];
      const m = s / n;
      let v = 0;
      for (let i = 0; i < n; i++) { const d = X[i][j] - m; v += d * d; }
      this.mu[j] = m;
      this.sd[j] = Math.sqrt(v / n) || 1e-9;
    }
    return this;
  };

  Scaler.prototype.transform = function (X) {
    const mu = this.mu, sd = this.sd, p = mu.length;
    const out = new Array(X.length);
    for (let i = 0; i < X.length; i++) {
      const row = X[i], o = new Float64Array(p);
      for (let j = 0; j < p; j++) o[j] = (row[j] - mu[j]) / sd[j];
      out[i] = o;
    }
    return out;
  };

  S.Scaler = Scaler;

  // 학습 구간으로 자를 만들고 두 구간 모두에 적용합니다.
  S.standardize = function (trainX, testX) {
    const sc = new Scaler().fit(trainX);
    return { scaler: sc, train: sc.transform(trainX), test: sc.transform(testX) };
  };

  /* ------------------------------------------------------------------------
   *  누출 자가 점검 — 화면의 '공정성 체크리스트'가 이 결과를 그대로 보여 줍니다.
   * ----------------------------------------------------------------------*/
  S.leakCheck = function (ds, splits) {
    const issues = [];
    for (let k = 0; k < splits.length; k++) {
      const sp = splits[k];
      if (sp.trainHi > sp.testLo) issues.push(sp.fold + '겹: 학습 구간이 시험 구간과 겹칩니다.');
      if (ds.idx[sp.trainHi - 1] >= ds.idx[sp.testLo]) issues.push(sp.fold + '겹: 날짜 순서가 뒤집혔습니다.');
    }
    return { pass: issues.length === 0, issues: issues };
  };

  root.SPLIT = S;
})(window.QL = window.QL || {});
