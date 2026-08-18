/* ============================================================================
 *  vol.js — 변동성 예측 모델 (신규분)
 *
 *  변동성은 "얼마나 출렁이는가"입니다. 방향과 달리 이건 꽤 잘 맞습니다.
 *  변동성에는 아주 뚜렷한 성질이 하나 있기 때문입니다.
 *
 *      변동성은 뭉쳐서 온다 — 크게 흔들린 날 다음날도 크게 흔들린다.
 *
 *  metrics.js 에 이미 EWMA(기준선)와 GARCH(1,1)이 있습니다. 여기에 더합니다.
 *
 *    GJR-GARCH  "떨어진 날의 충격은 더 세게 친다"는 비대칭을 추가
 *    HAR-RV     어제·지난주·지난달 변동성 세 개로 회귀 — 식이 세 줄인데 강함
 *    RF-Vol     같은 재료를 랜덤포레스트에 넣은 AI 계열 대항마
 *
 *  공통 약속 (registry.js)
 *      fit(train, ctx)   train.ret = 학습 구간의 일별 수익률
 *      predict(test,ctx) test.ret 구간을 하루씩 굴리며 '내일의 σ'를 냅니다
 *  ★ 오늘의 σ를 만들 때 오늘 수익률은 쓰지 않습니다(그건 미래를 보는 것).
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, REG = root.REG, ML = root.ML, LIN = root.LIN;

  /* ========================================================================
   *  1) GJR-GARCH(1,1,1)
   *
   *      σ²ₜ = ω + (α + γ·[어제 떨어졌으면 1]) · e²ₜ₋₁ + β · σ²ₜ₋₁
   *
   *  GARCH와 딱 한 항 다릅니다. 그 한 항이 '레버리지 효과'를 담습니다 —
   *  같은 크기라도 하락 충격이 상승 충격보다 변동성을 더 키운다는 사실.
   *  실제 시장에서 아주 뚜렷하게 관찰됩니다.
   *
   *  ω 는 직접 찾지 않고 분산 타게팅으로 묶습니다.
   *      ω = 전체분산 × (1 − α − γ/2 − β)
   *  이러면 찾을 값이 셋(α, γ, β)뿐이라 격자 탐색으로 안정적으로 풀립니다.
   * ======================================================================*/
  function fitGJR(ret) {
    const n = ret.length;
    const mu = U.mean(ret);
    const e = new Float64Array(n);
    for (let i = 0; i < n; i++) e[i] = ret[i] - mu;
    const uncond = Math.pow(U.std(e), 2) || 1e-6;

    function nll(a, g, b) {
      const persist = a + g / 2 + b;
      if (persist >= 0.999) return Infinity;
      const omega = uncond * (1 - persist);
      if (omega <= 0) return Infinity;
      let v = uncond, s = 0;
      for (let i = 0; i < n; i++) {
        if (i > 0) {
          const prev = e[i - 1];
          const shock = (a + (prev < 0 ? g : 0)) * prev * prev;
          v = omega + shock + b * v;
        }
        if (v <= 0) return Infinity;
        s += Math.log(v) + (e[i] * e[i]) / v;
      }
      return 0.5 * s;
    }

    // 성긴 격자 → 촘촘한 격자 (metrics.js 의 GARCH와 같은 전략)
    let best = { a: 0.03, g: 0.08, b: 0.9, nll: Infinity };
    for (let a = 0.00; a <= 0.1501; a += 0.01) {
      for (let g = 0.00; g <= 0.2401; g += 0.03) {
        for (let b = 0.70; b <= 0.9701; b += 0.03) {
          const v = nll(a, g, b);
          if (v < best.nll) best = { a: a, g: g, b: b, nll: v };
        }
      }
    }
    for (let a = Math.max(0, best.a - 0.01); a <= best.a + 0.0101; a += 0.005) {
      for (let g = Math.max(0, best.g - 0.03); g <= best.g + 0.0301; g += 0.01) {
        for (let b = Math.max(0.5, best.b - 0.03); b <= best.b + 0.0301; b += 0.01) {
          const v = nll(a, g, b);
          if (v < best.nll) best = { a: a, g: g, b: b, nll: v };
        }
      }
    }

    const persist = best.a + best.g / 2 + best.b;
    const omega = uncond * (1 - persist);
    // 학습 구간 마지막의 상태(σ², e)를 기억해 두었다가 시험 구간에서 이어 갑니다.
    let v = uncond;
    for (let i = 1; i < n; i++) {
      const prev = e[i - 1];
      v = omega + (best.a + (prev < 0 ? best.g : 0)) * prev * prev + best.b * v;
    }
    return {
      mu: mu, omega: omega, alpha: best.a, gamma: best.g, beta: best.b,
      persistence: persist, longRunVol: Math.sqrt(uncond),
      lastVar: v, lastE: n ? e[n - 1] : 0, logLik: -best.nll
    };
  }

  function GJR() {}
  GJR.prototype.fit = function (train) {
    this.par = fitGJR(train.ret);
    return this;
  };
  GJR.prototype.predict = function (test) {
    const p = this.par, r = test.ret, n = r.length, out = new Float64Array(n);
    let v = p.lastVar, e = p.lastE;
    for (let i = 0; i < n; i++) {
      v = p.omega + (p.alpha + (e < 0 ? p.gamma : 0)) * e * e + p.beta * v;
      out[i] = Math.sqrt(v);
      e = r[i] - p.mu;
    }
    return out;
  };
  GJR.prototype.params = function () { return this.par; };

  /* ========================================================================
   *  2) HAR-RV
   *
   *      log RVₜ₊₁ = c + β_d·log RV_어제 + β_w·log RV_지난주 + β_m·log RV_지난달
   *
   *  발상이 재미있습니다. 시장에는 하루 단위로 보는 사람, 주 단위로 보는 사람,
   *  월 단위로 보는 사람이 섞여 있습니다. 그래서 세 시간대의 변동성을 각각
   *  넣어 주면 된다는 것입니다. 식이 세 줄인데 훨씬 복잡한 모델을 자주 이깁니다.
   *  실현변동성 예측의 학계 표준 벤치마크입니다.
   *
   *  RV(실현변동성)는 그날 수익률의 제곱으로 잡습니다. 로그를 씌우는 이유는
   *  변동성이 한쪽으로 심하게 치우친 값이라 그대로 회귀하면 큰 값에 끌려가고,
   *  예측값이 음수로 튈 수 있기 때문입니다.
   * ======================================================================*/
  const EPS = 1e-10;

  /* 로그를 되돌릴 때의 보정값
   *   하루 수익률을 r = σ·z (z는 표준정규)라고 보면 log(r²) = log(σ²) + log(z²) 입니다.
   *   그런데 log(z²)의 평균은 0이 아니라 −1.2704 입니다(제곱한 정규분포의 성질).
   *   즉 회귀로 얻은 값은 실제 log(σ²)보다 평균적으로 1.2704 만큼 작습니다.
   *   되돌릴 때 이만큼 더해 주지 않으면 변동성을 계속 과소평가하게 됩니다.
   *   (잔차 분산의 절반을 더하는 흔한 방식은 여기서 쓰면 안 됩니다. 그 잡음은
   *    모델이 못 맞힌 부분이 아니라 하루짜리 제곱수익률 자체의 잡음이라,
   *    그 방식으로는 예측값이 10배 넘게 부풀어 오릅니다.) */
  const LOG_CHI2 = 1.2703628454614782;

  // 최근 수익률 기록에서 (어제·지난주·지난달) 실현변동성 세 개를 뽑습니다.
  function rvFeatures(hist) {
    const n = hist.length;
    function avgSq(k) {
      let s = 0, c = 0;
      for (let i = Math.max(0, n - k); i < n; i++) { s += hist[i] * hist[i]; c++; }
      return c ? s / c : 0;
    }
    return [Math.log(avgSq(1) + EPS), Math.log(avgSq(5) + EPS), Math.log(avgSq(22) + EPS)];
  }

  function harDesign(ret) {
    const X = [], y = [];
    for (let t = 22; t < ret.length - 1; t++) {
      X.push(rvFeatures(ret.slice(0, t + 1)));
      y.push(Math.log(ret[t + 1] * ret[t + 1] + EPS));
    }
    return { X: X, y: y };
  }

  function olsFit(X, y) {
    const p = X[0].length + 1, n = X.length;
    const A = [];
    for (let j = 0; j < p; j++) A.push(new Float64Array(p));
    const b = new Float64Array(p);
    for (let i = 0; i < n; i++) {
      const row = [1].concat(X[i]);
      for (let j = 0; j < p; j++) {
        b[j] += row[j] * y[i];
        for (let k = 0; k < p; k++) A[j][k] += row[j] * row[k];
      }
    }
    for (let j = 0; j < p; j++) A[j][j] += 1e-8;      // 수치 안정용 아주 작은 벌점
    return LIN.solve(A, b) || new Float64Array(p);
  }

  function HAR() {}
  HAR.prototype.fit = function (train) {
    const d = harDesign(train.ret);
    if (d.X.length < 30) { this.beta = null; this.fallback = U.std(train.ret) || 0.01; return this; }
    this.beta = olsFit(d.X, d.y);
    this.hist = train.ret.slice(Math.max(0, train.ret.length - 22));
    return this;
  };
  HAR.prototype.predict = function (test) {
    const n = test.ret.length, out = new Float64Array(n);
    if (!this.beta) { out.fill(this.fallback); return out; }
    const hist = this.hist.slice();
    for (let i = 0; i < n; i++) {
      const row = [1].concat(rvFeatures(hist));
      let f = 0;
      for (let j = 0; j < row.length; j++) f += this.beta[j] * row[j];
      const rv = Math.exp(f + LOG_CHI2);
      out[i] = Math.sqrt(Math.max(rv, EPS));
      hist.push(test.ret[i]);
      if (hist.length > 30) hist.shift();
    }
    return out;
  };
  HAR.prototype.coefs = function () { return this.beta; };

  /* ========================================================================
   *  3) RF-Vol
   *
   *  HAR과 똑같은 재료(어제·지난주·지난달 변동성 + 어제 움직임의 크기)를
   *  랜덤포레스트에 넣습니다. 재료가 같으니 성적 차이는 순수하게
   *  "직선으로 푸느냐(HAR), 나무로 푸느냐(RF)"의 차이입니다.
   *  AI가 항상 이기지는 않는다는 것을 보는 자리입니다.
   * ======================================================================*/
  function rfFeatures(hist) {
    const f = rvFeatures(hist);
    const last = hist.length ? hist[hist.length - 1] : 0;
    return f.concat([Math.abs(last), last < 0 ? 1 : 0]);
  }

  function RFVol(params) {
    this.opt = Object.assign({ trees: 40, maxDepth: 5, minLeaf: 30, seed: 42 }, params);
  }
  RFVol.prototype.fit = function (train, ctx) {
    const ret = train.ret;
    const X = [], y = [];
    for (let t = 22; t < ret.length - 1; t++) {
      X.push(rfFeatures(ret.slice(0, t + 1)));
      y.push(Math.log(ret[t + 1] * ret[t + 1] + EPS));
    }
    if (X.length < 60) { this.model = null; this.fallback = U.std(ret) || 0.01; return this; }
    this.model = ML.createReg('forest', Object.assign({}, this.opt, { seed: (ctx && ctx.seed) || this.opt.seed }));
    this.model.fit(X, y);
    this.hist = ret.slice(Math.max(0, ret.length - 22));
    return this;
  };
  RFVol.prototype.predict = function (test) {
    const n = test.ret.length, out = new Float64Array(n);
    if (!this.model) { out.fill(this.fallback); return out; }
    const hist = this.hist.slice();
    const rows = [];
    // 예측은 한 줄씩 굴려야 하지만, 나무 예측 자체는 묶어서 하면 빠릅니다.
    for (let i = 0; i < n; i++) {
      rows.push(rfFeatures(hist));
      hist.push(test.ret[i]);
      if (hist.length > 30) hist.shift();
    }
    const pr = this.model.predict(rows);
    for (let i = 0; i < n; i++) out[i] = Math.sqrt(Math.max(Math.exp(pr[i] + LOG_CHI2), EPS));
    return out;
  };

  /* ------------------------------------------------------------------------
   *  등록
   * ----------------------------------------------------------------------*/
  function wrap(Ctor) {
    return function (params) {
      const m = new Ctor(params);
      return {
        fit: function (train, ctx) { m.fit(train, ctx); return this; },
        predict: function (test, ctx) { return m.predict(test, ctx); },
        importance: function () { return null; },
        inner: m
      };
    };
  }

  REG.impl('gjr', wrap(GJR));
  REG.impl('har', wrap(HAR));
  REG.impl('rf_vol', wrap(RFVol));

  root.VOL = { fitGJR: fitGJR, GJR: GJR, HAR: HAR, RFVol: RFVol, rvFeatures: rvFeatures };
})(window.QL = window.QL || {});
