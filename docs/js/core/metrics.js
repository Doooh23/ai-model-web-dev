/* ============================================================================
 *  metrics.js — 성적표 계산
 *   분류 지표(정확도·정밀도·재현율·F1·AUC·MCC·혼동행렬·기준선·p값)
 *   투자 성과 지표(누적수익·연평균·샤프·최대낙폭)
 *   변동성 모델(EWMA, GARCH(1,1)) — Phase 1-c에 대응
 *
 *  ★ 정확도 하나만 보면 속습니다. 상승일이 많은 구간에서는 "무조건 상승"만
 *    찍어도 정확도가 높게 나옵니다. 그래서 AUC와 '상승예측비율'을 함께 봅니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U;
  const M = {};

  /* --------------------------------------------------------------------------
   *  AUC — 오를 날과 내릴 날을 얼마나 잘 '구별'하는지 (0.5면 실력 없음)
   *  순위 기반(Mann-Whitney) 계산: 동점은 평균 순위로 처리
   * ------------------------------------------------------------------------*/
  M.auc = function (y, score) {
    const n = y.length;
    const idx = U.range(n).sort(function (a, b) { return score[a] - score[b]; });
    const rank = new Float64Array(n);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && score[idx[j + 1]] === score[idx[i]]) j++;
      const r = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) rank[idx[k]] = r;
      i = j + 1;
    }
    let pos = 0, sumRankPos = 0;
    for (let k = 0; k < n; k++) if (y[k] === 1) { pos++; sumRankPos += rank[k]; }
    const neg = n - pos;
    if (pos === 0 || neg === 0) return NaN;
    return (sumRankPos - pos * (pos + 1) / 2) / (pos * neg);
  };

  M.rocCurve = function (y, score) {
    const n = y.length;
    const idx = U.range(n).sort(function (a, b) { return score[b] - score[a]; });
    let pos = 0; for (let k = 0; k < n; k++) pos += y[k];
    const neg = n - pos;
    const pts = [{ x: 0, y: 0 }];
    let tp = 0, fp = 0;
    for (let k = 0; k < n; k++) {
      if (y[idx[k]] === 1) tp++; else fp++;
      if (k === n - 1 || score[idx[k]] !== score[idx[k + 1]]) {
        pts.push({ x: neg ? fp / neg : 0, y: pos ? tp / pos : 0 });
      }
    }
    return pts;
  };

  /* --------------------------------------------------------------------------
   *  분류 성적표
   *  baseline(기준선) = 시험 구간에서 많은 쪽 클래스의 비율.
   *  "이 점수를 넘지 못하면 모델은 아무 값어치가 없다"는 뜻의 기준입니다.
   * ------------------------------------------------------------------------*/
  M.classify = function (y, proba, threshold) {
    const th = (threshold === undefined) ? 0.5 : threshold;
    const n = y.length;
    let tp = 0, fp = 0, tn = 0, fn = 0, up = 0, posTrue = 0;
    for (let i = 0; i < n; i++) {
      const pred = proba[i] >= th ? 1 : 0;
      up += pred; posTrue += y[i];
      if (pred === 1 && y[i] === 1) tp++;
      else if (pred === 1 && y[i] === 0) fp++;
      else if (pred === 0 && y[i] === 0) tn++;
      else fn++;
    }
    const acc = (tp + tn) / n;
    const posRate = posTrue / n;
    const baseline = Math.max(posRate, 1 - posRate);
    const precision = (tp + fp) ? tp / (tp + fp) : NaN;
    const recall = (tp + fn) ? tp / (tp + fn) : NaN;
    const f1 = (isFinite(precision) && isFinite(recall) && precision + recall > 0)
      ? 2 * precision * recall / (precision + recall) : NaN;
    const spec = (tn + fp) ? tn / (tn + fp) : NaN;
    const balAcc = (isFinite(recall) && isFinite(spec)) ? (recall + spec) / 2 : NaN;
    const den = Math.sqrt((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn));
    const mcc = den > 0 ? (tp * tn - fp * fn) / den : NaN;
    const auc = M.auc(y, proba);

    return {
      n: n, acc: acc, baseline: baseline, edge: acc - baseline,
      precision: precision, recall: recall, f1: f1,
      auc: auc, mcc: mcc, balAcc: balAcc,
      upRate: up / n, posRate: posRate,
      tp: tp, fp: fp, tn: tn, fn: fn,
      pVsBaseline: U.binomP(tp + tn, n, baseline),
      warnings: M.warnings({ upRate: up / n, auc: auc, acc: acc, baseline: baseline })
    };
  };

  // 결과를 잘못 읽지 않도록 자동으로 붙는 경고 (파이썬 코드와 같은 규칙)
  M.warnings = function (m) {
    const w = [];
    if (m.upRate >= 0.9) w.push('모델이 예측의 ' + U.pct(m.upRate, 0) + '를 "상승"으로 찍고 있습니다. 예측이 아니라 다수결 흉내일 가능성이 큽니다.');
    if (m.upRate <= 0.1) w.push('모델이 예측의 ' + U.pct(1 - m.upRate, 0) + '를 "하락"으로 찍고 있습니다. 한쪽으로 쏠려 있습니다.');
    if (isFinite(m.auc) && Math.abs(m.auc - 0.5) < 0.02) w.push('AUC가 0.5 근처입니다. 오를 날과 내릴 날을 구별하지 못하고 있습니다.');
    if (m.acc - m.baseline <= 0) w.push('정확도가 기준선을 넘지 못했습니다. 모델이 기준선보다 낫다고 말할 수 없습니다.');
    if (isFinite(m.auc) && m.auc > 0.75) w.push('AUC가 비정상적으로 높습니다. 데이터 누수(미래 정보 유입)를 의심하세요.');
    return w;
  };

  /* --------------------------------------------------------------------------
   *  투자 성과 지표 — phase1b_backtest.py의 perf_metrics와 같은 정의
   * ------------------------------------------------------------------------*/
  M.TRADING_DAYS = 252;
  M.perf = function (r) {
    const n = r.length;
    if (!n) return { total: NaN, cagr: NaN, sharpe: NaN, mdd: NaN, cum: [] };
    const cum = new Float64Array(n);
    let c = 1;
    for (let i = 0; i < n; i++) { c *= (1 + r[i]); cum[i] = c; }
    const years = n / M.TRADING_DAYS;
    const mu = U.mean(r), sd = U.std(r);
    let peak = -Infinity, mdd = 0;
    for (let i = 0; i < n; i++) { if (cum[i] > peak) peak = cum[i]; const dd = cum[i] / peak - 1; if (dd < mdd) mdd = dd; }
    let winDays = 0, activeDays = 0;
    for (let i = 0; i < n; i++) { if (r[i] !== 0) { activeDays++; if (r[i] > 0) winDays++; } }
    // 하방 변동성(손실 난 날만)으로 계산하는 소르티노
    const down = [];
    for (let i = 0; i < n; i++) if (r[i] < 0) down.push(r[i]);
    const dsd = down.length > 2 ? U.std(down, 1) : NaN;

    return {
      total: cum[n - 1] - 1,
      cagr: years > 0 ? Math.pow(cum[n - 1], 1 / years) - 1 : NaN,
      vol: sd * Math.sqrt(M.TRADING_DAYS),
      sharpe: sd > 0 ? (mu / sd) * Math.sqrt(M.TRADING_DAYS) : NaN,
      sortino: (isFinite(dsd) && dsd > 0) ? (mu / dsd) * Math.sqrt(M.TRADING_DAYS) : NaN,
      // t값: 평균 수익이 0과 다르다고 볼 수 있는가. |t|>2면 우연으로 보기 어렵습니다.
      t_stat: sd > 0 ? mu / (sd / Math.sqrt(n)) : NaN,
      mdd: mdd, cum: cum, winRate: activeDays ? winDays / activeDays : NaN,
      years: years, n: n
    };
  };

  /* --------------------------------------------------------------------------
   *  변동성 — Phase 1-c 대응
   *  EWMA: 최근 값에 더 큰 무게를 주는 단순한 변동성 추정 (RiskMetrics λ=0.94)
   *  GARCH(1,1): σ²ₜ = ω + α·e²ₜ₋₁ + β·σ²ₜ₋₁
   *              분산 타게팅(ω = var·(1-α-β))으로 두고 α, β만 격자 탐색으로 찾습니다.
   * ------------------------------------------------------------------------*/
  M.ewma = function (ret, lambda) {
    const lam = lambda || 0.94, n = ret.length;
    const out = new Float64Array(n);
    let v = Math.pow(U.std(ret), 2);
    for (let i = 0; i < n; i++) { v = lam * v + (1 - lam) * ret[i] * ret[i]; out[i] = Math.sqrt(v); }
    return out;
  };

  M.garch = function (ret) {
    const n = ret.length;
    const mu = U.mean(ret);
    const e = new Float64Array(n);
    for (let i = 0; i < n; i++) e[i] = ret[i] - mu;
    const uncond = Math.pow(U.std(e), 2);

    const nll = function (alpha, beta) {
      const omega = uncond * (1 - alpha - beta);
      if (omega <= 0) return Infinity;
      let v = uncond, s = 0;
      for (let i = 0; i < n; i++) {
        if (i > 0) v = omega + alpha * e[i - 1] * e[i - 1] + beta * v;
        if (v <= 0) return Infinity;
        s += Math.log(v) + (e[i] * e[i]) / v;
      }
      return 0.5 * s;
    };

    // 성긴 격자 → 촘촘한 격자 (좌표하강 대신 단순하고 안정적인 2단계 탐색)
    let best = { a: 0.08, b: 0.9, nll: Infinity };
    for (let a = 0.01; a <= 0.30001; a += 0.01) {
      for (let b = 0.50; b <= 0.98001; b += 0.02) {
        if (a + b >= 0.999) continue;
        const v = nll(a, b);
        if (v < best.nll) best = { a: a, b: b, nll: v };
      }
    }
    for (let a = Math.max(0.005, best.a - 0.01); a <= best.a + 0.01001; a += 0.002) {
      for (let b = Math.max(0.4, best.b - 0.02); b <= best.b + 0.02001; b += 0.004) {
        if (a + b >= 0.999) continue;
        const v = nll(a, b);
        if (v < best.nll) best = { a: a, b: b, nll: v };
      }
    }
    const omega = uncond * (1 - best.a - best.b);
    const sigma = new Float64Array(n);
    let v = uncond;
    for (let i = 0; i < n; i++) {
      if (i > 0) v = omega + best.a * e[i - 1] * e[i - 1] + best.b * v;
      sigma[i] = Math.sqrt(v);
    }
    return {
      omega: omega, alpha: best.a, beta: best.b, mu: mu,
      persistence: best.a + best.b,
      longRunVol: Math.sqrt(uncond),
      sigma: sigma, logLik: -best.nll
    };
  };

  // 변동성 예측 평가 지표 (정확도 대신 씁니다. 둘 다 낮을수록 좋음)
  M.volScores = function (sigma, ret) {
    let mse = 0, qlike = 0, k = 0;
    for (let i = 1; i < ret.length; i++) {
      const real = ret[i] * ret[i], v = sigma[i] * sigma[i];
      if (v <= 0) continue;
      mse += Math.pow(v - real, 2);
      qlike += Math.log(v) + real / v;
      k++;
    }
    return { mse: k ? mse / k : NaN, qlike: k ? qlike / k : NaN };
  };

  root.M = M;
})(window.QL = window.QL || {});
