/* ============================================================================
 *  ml_lite.js — 브라우저에서 도는 신규 경량 모델들
 *
 *  ml.js 에는 로지스틱·랜덤포레스트·부스팅·MLP 가 이미 있습니다.
 *  여기에는 성격이 완전히 다른 모델들을 더합니다. 비슷한 모델만 모아 두면
 *  비교가 아니라 반복이 되기 때문입니다.
 *
 *    k-최근접 이웃   비슷했던 과거를 찾아본다      (거리 기반)
 *    나이브베이즈    확률 분포를 그려 비교한다      (확률)
 *    SVM (RBF)      경계를 최대한 여유 있게 긋는다  (커널)
 *    Ridge          "몇 % 오를지"를 먼저 맞힌다     (선형 회귀)
 *    ElasticNet     거기에 쓸모없는 피처를 끈다     (선형 회귀 + 변수 선택)
 *    ARIMA(1,1,0)   어제 수익률로 오늘을 설명한다   (통계 기준선)
 *    앙상블         위 모델들의 확률을 평균 낸다    (집단지성)
 *
 *  모두 registry.js 가 정한 약속을 지킵니다.
 *      fit(train, ctx) / predict(test, ctx) → 상승 확률 0~1
 *  train.X 는 이미 표준화된 값입니다(splits.js가 학습 구간 기준으로 처리).
 *  train.raw 는 표준화 전 원본이고, train.ret 는 다음 날 실제 수익률입니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, REG = root.REG, ML = root.ML;

  const sigmoid = function (z) { return 1 / (1 + Math.exp(-U.clamp(z, -35, 35))); };

  /* ========================================================================
   *  0) 작은 선형대수 — 연립방정식 풀이 (Ridge·HAR 회귀에서 씁니다)
   *     A x = b 를 가우스 소거법으로 풉니다. 크기가 15×15 정도라 이걸로 충분합니다.
   * ======================================================================*/
  const LIN = {};
  LIN.solve = function (A, b) {
    const n = b.length;
    const M = A.map(function (row, i) { return Array.prototype.slice.call(row).concat([b[i]]); });
    for (let c = 0; c < n; c++) {
      // 부분 피벗팅: 그 열에서 절대값이 가장 큰 행을 위로 올립니다(수치 안정성).
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) < 1e-12) return null;
      const t = M[c]; M[c] = M[piv]; M[piv] = t;
      const d = M[c][c];
      for (let j = c; j <= n; j++) M[c][j] /= d;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c];
        if (f === 0) continue;
        for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j];
      }
    }
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = M[i][n];
    return x;
  };
  root.LIN = LIN;

  /* ------------------------------------------------------------------------
   *  회귀 모델의 예측값(수익률)을 확률로 바꾸는 공통 규칙
   *  학습 구간 예측값의 퍼짐 정도로 나눠 주면 0~1 안에 고르게 퍼집니다.
   * ----------------------------------------------------------------------*/
  function ProbaScale() { this.sd = 1; }
  ProbaScale.prototype.fit = function (predTrain) {
    const sd = U.std(Array.from(predTrain));
    this.sd = (isFinite(sd) && sd > 1e-12) ? sd : 1;
    return this;
  };
  ProbaScale.prototype.apply = function (pred) {
    const out = new Float64Array(pred.length);
    for (let i = 0; i < pred.length; i++) out[i] = sigmoid(pred[i] / this.sd);
    return out;
  };

  // 학습 구간의 다음 날 수익률. 없으면 정답(0/1)을 대신 씁니다.
  function targetOf(train) {
    if (train.ret && train.ret.length === train.X.length) return train.ret;
    const out = new Float64Array(train.y.length);
    for (let i = 0; i < train.y.length; i++) out[i] = train.y[i] - 0.5;
    return out;
  }

  /* ========================================================================
   *  1) k-최근접 이웃 (k-NN)
   *
   *  "오늘과 가장 비슷했던 과거 k일을 찾아, 그중 오른 날이 몇 %였는지" 그대로
   *  답합니다. 학습이라 부를 것이 없습니다 — 과거를 통째로 외워 둘 뿐입니다.
   *  비슷한 정도는 피처 15개를 좌표로 본 거리(피타고라스)로 잽니다.
   * ======================================================================*/
  function KNN(params) {
    this.k = (params && params.k) || 25;
  }
  KNN.prototype.fit = function (train) {
    this.Z = train.X;
    this.y = train.y;
    return this;
  };
  KNN.prototype.predict = function (test) {
    const Z = this.Z, y = this.y, n = Z.length, p = Z[0].length;
    const k = Math.min(this.k, n);
    const out = new Float64Array(test.X.length);
    const d = new Float64Array(n);
    const idx = new Int32Array(n);

    for (let i = 0; i < test.X.length; i++) {
      const q = test.X[i];
      for (let j = 0; j < n; j++) {
        let s = 0;
        const row = Z[j];
        for (let c = 0; c < p; c++) { const t = q[c] - row[c]; s += t * t; }
        d[j] = s; idx[j] = j;
      }
      // k번째로 가까운 것까지만 골라내면 됩니다(전체 정렬은 낭비).
      const order = Array.prototype.slice.call(idx);
      order.sort(function (a, b) { return d[a] - d[b]; });
      let up = 0;
      for (let m = 0; m < k; m++) up += y[order[m]];
      out[i] = up / k;
    }
    return out;
  };

  /* ========================================================================
   *  2) 가우시안 나이브베이즈
   *
   *  오른 날들과 내린 날들 각각에 대해 피처마다 종 모양 분포를 그려 둡니다.
   *  오늘 값이 어느 쪽 분포에 더 잘 어울리는지를 확률로 비교합니다.
   *  '나이브(순진한)'는 피처끼리 서로 무관하다고 가정한다는 뜻입니다.
   *  주가 피처는 실제로 얽혀 있으니 틀린 가정인데, 그래도 자주 쓸 만합니다.
   * ======================================================================*/
  function GaussianNB() {}
  GaussianNB.prototype.fit = function (train) {
    const Z = train.X, y = train.y, n = Z.length, p = Z[0].length;
    const mu = [new Float64Array(p), new Float64Array(p)];
    const va = [new Float64Array(p), new Float64Array(p)];
    const cnt = [0, 0];
    for (let i = 0; i < n; i++) {
      const c = y[i] ? 1 : 0;
      cnt[c]++;
      for (let j = 0; j < p; j++) mu[c][j] += Z[i][j];
    }
    for (let c = 0; c < 2; c++) for (let j = 0; j < p; j++) mu[c][j] /= Math.max(cnt[c], 1);
    for (let i = 0; i < n; i++) {
      const c = y[i] ? 1 : 0;
      for (let j = 0; j < p; j++) { const t = Z[i][j] - mu[c][j]; va[c][j] += t * t; }
    }
    for (let c = 0; c < 2; c++) {
      for (let j = 0; j < p; j++) va[c][j] = va[c][j] / Math.max(cnt[c] - 1, 1) + 1e-9;
    }
    this.mu = mu; this.va = va; this.p = p;
    this.logPrior = [Math.log((cnt[0] + 1) / (n + 2)), Math.log((cnt[1] + 1) / (n + 2))];
    return this;
  };
  GaussianNB.prototype.predict = function (test) {
    const out = new Float64Array(test.X.length), p = this.p;
    for (let i = 0; i < test.X.length; i++) {
      const x = test.X[i];
      const lp = [this.logPrior[0], this.logPrior[1]];
      for (let c = 0; c < 2; c++) {
        for (let j = 0; j < p; j++) {
          const v = this.va[c][j], t = x[j] - this.mu[c][j];
          lp[c] += -0.5 * (Math.log(2 * Math.PI * v) + t * t / v);
        }
      }
      out[i] = sigmoid(lp[1] - lp[0]);
    }
    return out;
  };

  /* ========================================================================
   *  3) SVM (RBF 커널)
   *
   *  두 무리를 가르는 경계를 긋되, 경계에 가장 가까운 점들과의 간격(마진)이
   *  최대가 되게 긋습니다. RBF 커널은 그 경계를 자유롭게 휘게 해 줍니다.
   *
   *  ★ 브라우저에서 정통 방식(SMO)으로 커널 SVM을 풀면 표본 수의 제곱에
   *    비례해 느려집니다. 그래서 커널을 흉내 내는 무작위 피처 128개를 만들어
   *    선형 SVM을 푸는 방법을 씁니다(Random Fourier Features).
   *    수학적으로 RBF 커널의 근사이고, 표본이 늘어도 느려지지 않습니다.
   *    정확히 같은 모델은 아니므로 화면에도 '근사'라고 적어 둡니다.
   * ======================================================================*/
  function SVM(params) {
    this.opt = Object.assign({ D: 128, gamma: null, C: 1.0, epochs: 20, seed: 42 }, params);
  }
  SVM.prototype._z = function (x) {
    const D = this.opt.D, W = this.W, b = this.bias, p = this.p;
    const z = new Float64Array(D), s = Math.sqrt(2 / D);
    for (let j = 0; j < D; j++) {
      let a = b[j];
      for (let c = 0; c < p; c++) a += W[j * p + c] * x[c];
      z[j] = s * Math.cos(a);
    }
    return z;
  };
  SVM.prototype.fit = function (train, ctx) {
    const o = this.opt, Z = train.X, y = train.y, n = Z.length, p = Z[0].length;
    const rnd = U.rng((ctx && ctx.seed) || o.seed);
    const gamma = o.gamma || (1 / p);          // 표준화된 데이터라 1/피처수가 무난합니다
    this.p = p;

    // 무작위 주파수 만들기
    const D = o.D;
    this.W = new Float64Array(D * p);
    this.bias = new Float64Array(D);
    const scale = Math.sqrt(2 * gamma);
    for (let j = 0; j < D; j++) {
      for (let c = 0; c < p; c++) this.W[j * p + c] = rnd.normal() * scale;
      this.bias[j] = rnd() * 2 * Math.PI;
    }

    // 미리 변환해 둡니다
    const ZT = new Array(n);
    for (let i = 0; i < n; i++) ZT[i] = this._z(Z[i]);

    // Pegasos — 힌지 손실을 확률적 경사하강으로 최소화
    const lam = 1 / (o.C * n);
    const w = new Float64Array(D);
    let t = 0;
    const iters = o.epochs * n;
    for (let it = 0; it < iters; it++) {
      t++;
      const i = rnd.int(n);
      const eta = 1 / (lam * t);
      const yi = y[i] ? 1 : -1;
      let f = 0;
      const zi = ZT[i];
      for (let j = 0; j < D; j++) f += w[j] * zi[j];
      const shrink = 1 - eta * lam;
      if (yi * f < 1) {
        for (let j = 0; j < D; j++) w[j] = shrink * w[j] + eta * yi * zi[j];
      } else {
        for (let j = 0; j < D; j++) w[j] = shrink * w[j];
      }
    }
    this.w = w;

    // 마진 값을 확률로 바꾸는 자(Platt 보정) — 학습 구간에서만 맞춥니다.
    const f = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < D; j++) s += w[j] * ZT[i][j];
      f[i] = s;
    }
    this.platt = plattFit(f, y);
    return this;
  };
  SVM.prototype.predict = function (test) {
    const D = this.opt.D, out = new Float64Array(test.X.length);
    for (let i = 0; i < test.X.length; i++) {
      const z = this._z(test.X[i]);
      let s = 0;
      for (let j = 0; j < D; j++) s += this.w[j] * z[j];
      out[i] = sigmoid(this.platt.a * s + this.platt.b);
    }
    return out;
  };

  // 마진 → 확률 보정 (1차원 로지스틱 회귀)
  function plattFit(f, y) {
    let a = 1, b = 0;
    const n = f.length, lr = 0.5;
    for (let it = 0; it < 300; it++) {
      let ga = 0, gb = 0;
      for (let i = 0; i < n; i++) {
        const e = sigmoid(a * f[i] + b) - y[i];
        ga += e * f[i]; gb += e;
      }
      a -= lr * ga / n; b -= lr * gb / n;
    }
    return { a: a, b: b };
  }

  /* ========================================================================
   *  4) Ridge 회귀
   *
   *  오를지 내릴지가 아니라 "내일 몇 % 오를지"라는 숫자를 먼저 맞히고,
   *  그 값이 양수면 상승으로 봅니다. 가중치가 한쪽으로 쏠리지 않게
   *  제곱합에 벌점을 줍니다(그래서 과적합에 강합니다).
   * ======================================================================*/
  function Ridge(params) {
    this.opt = Object.assign({ lambda: 1.0 }, params);
  }
  Ridge.prototype.fit = function (train) {
    const Z = train.X, n = Z.length, p = Z[0].length;
    const t = targetOf(train);
    let ymean = 0;
    for (let i = 0; i < n; i++) ymean += t[i];
    ymean /= n;

    // 정규방정식: (ZᵀZ + λI) β = Zᵀ(y - ȳ)
    const A = [];
    for (let j = 0; j < p; j++) A.push(new Float64Array(p));
    const bv = new Float64Array(p);
    for (let i = 0; i < n; i++) {
      const row = Z[i], dy = t[i] - ymean;
      for (let j = 0; j < p; j++) {
        bv[j] += row[j] * dy;
        for (let k = j; k < p; k++) A[j][k] += row[j] * row[k];
      }
    }
    for (let j = 0; j < p; j++) {
      for (let k = 0; k < j; k++) A[j][k] = A[k][j];
      A[j][j] += this.opt.lambda;
    }
    this.beta = LIN.solve(A, bv) || new Float64Array(p);
    this.b0 = ymean;
    this.scaler = new ProbaScale().fit(this._raw(Z));
    return this;
  };
  Ridge.prototype._raw = function (X) {
    const out = new Float64Array(X.length), p = this.beta.length;
    for (let i = 0; i < X.length; i++) {
      let s = this.b0;
      for (let j = 0; j < p; j++) s += this.beta[j] * X[i][j];
      out[i] = s;
    }
    return out;
  };
  Ridge.prototype.predict = function (test) { return this.scaler.apply(this._raw(test.X)); };
  Ridge.prototype.importance = function () {
    const a = Array.prototype.map.call(this.beta, Math.abs);
    const s = U.sum(a) || 1;
    return a.map(function (v) { return v / s; });
  };

  /* ========================================================================
   *  5) ElasticNet
   *
   *  Ridge 에 "쓸모없는 피처는 아예 0으로 꺼라"는 규칙(Lasso)을 섞은 것입니다.
   *  좌표하강법 — 피처를 하나씩 돌아가며 그 하나만 최적으로 고칩니다.
   *  살아남은 피처 목록 자체가 곧 설명이 됩니다.
   * ======================================================================*/
  function ElasticNet(params) {
    this.opt = Object.assign({ lambda: 0.02, l1ratio: 0.5, iters: 200 }, params);
  }
  ElasticNet.prototype.fit = function (train) {
    const Z = train.X, n = Z.length, p = Z[0].length;
    const t = targetOf(train);
    let ymean = 0;
    for (let i = 0; i < n; i++) ymean += t[i];
    ymean /= n;
    const ysd = U.std(Array.from(t)) || 1e-9;
    // 목표값을 표준편차 1로 맞춰 두면 벌점 세기가 종목에 상관없이 같은 뜻이 됩니다.
    const yz = new Float64Array(n);
    for (let i = 0; i < n; i++) yz[i] = (t[i] - ymean) / ysd;

    const o = this.opt;
    const l1 = o.lambda * o.l1ratio, l2 = o.lambda * (1 - o.l1ratio);
    const beta = new Float64Array(p);
    const resid = new Float64Array(n);
    for (let i = 0; i < n; i++) resid[i] = yz[i];

    for (let it = 0; it < o.iters; it++) {
      let maxDelta = 0;
      for (let j = 0; j < p; j++) {
        let rho = 0, zz = 0;
        for (let i = 0; i < n; i++) {
          const zij = Z[i][j];
          rho += zij * (resid[i] + zij * beta[j]);
          zz += zij * zij;
        }
        rho /= n; zz /= n;
        // 소프트 임계: 기여도가 벌점보다 작으면 0으로 꺼 버립니다.
        let nb = 0;
        if (rho > l1) nb = (rho - l1) / (zz + l2);
        else if (rho < -l1) nb = (rho + l1) / (zz + l2);
        const delta = nb - beta[j];
        if (delta !== 0) {
          for (let i = 0; i < n; i++) resid[i] -= Z[i][j] * delta;
          beta[j] = nb;
          if (Math.abs(delta) > maxDelta) maxDelta = Math.abs(delta);
        }
      }
      if (maxDelta < 1e-7) break;
    }
    this.beta = beta; this.ysd = ysd; this.ymean = ymean;
    this.scaler = new ProbaScale().fit(this._raw(Z));
    return this;
  };
  ElasticNet.prototype._raw = function (X) {
    const out = new Float64Array(X.length), p = this.beta.length;
    for (let i = 0; i < X.length; i++) {
      let s = 0;
      for (let j = 0; j < p; j++) s += this.beta[j] * X[i][j];
      out[i] = s * this.ysd + this.ymean;
    }
    return out;
  };
  ElasticNet.prototype.predict = function (test) { return this.scaler.apply(this._raw(test.X)); };
  ElasticNet.prototype.importance = function () {
    const a = Array.prototype.map.call(this.beta, Math.abs);
    const s = U.sum(a) || 1;
    return a.map(function (v) { return v / s; });
  };
  ElasticNet.prototype.nonzero = function () {
    let c = 0;
    for (let j = 0; j < this.beta.length; j++) if (this.beta[j] !== 0) c++;
    return c;
  };

  /* ========================================================================
   *  6) ARIMA(1,1,0) — 통계학의 기본 기준선
   *
   *  가격을 차분하면(오늘−어제) 수익률이 됩니다. 그 수익률을 바로 앞 수익률로
   *  설명하는 것이 AR(1)이고, 차분을 한 번 했으니 ARIMA(1,1,0)입니다.
   *  계수가 하나뿐이라 결과를 그대로 읽을 수 있습니다.
   *  대개 계수가 거의 0으로 나오는데, 그것이 바로 "주가는 랜덤워크에 가깝다"는
   *  교과서 결론입니다.
   * ======================================================================*/
  function ARIMA() {}
  ARIMA.prototype.fit = function (train, ctx) {
    const col = ctx.cols.indexOf('ret1');
    const t = targetOf(train);
    const n = train.raw ? train.raw.length : 0;
    this.col = col;
    if (col < 0 || !n) { this.a = 0; this.b = 0; this.scaler = new ProbaScale(); return this; }

    let sx = 0, sy = 0;
    for (let i = 0; i < n; i++) { sx += train.raw[i][col]; sy += t[i]; }
    const mx = sx / n, my = sy / n;
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) {
      const dx = train.raw[i][col] - mx;
      sxy += dx * (t[i] - my); sxx += dx * dx;
    }
    this.b = sxx > 0 ? sxy / sxx : 0;          // AR(1) 계수 φ
    this.a = my - this.b * mx;
    const pr = new Float64Array(n);
    for (let i = 0; i < n; i++) pr[i] = this.a + this.b * train.raw[i][col];
    this.scaler = new ProbaScale().fit(pr);
    return this;
  };
  ARIMA.prototype.predict = function (test) {
    const n = test.raw.length, pr = new Float64Array(n);
    for (let i = 0; i < n; i++) pr[i] = this.a + this.b * (this.col >= 0 ? test.raw[i][this.col] : 0);
    return this.scaler.apply(pr);
  };
  ARIMA.prototype.phi = function () { return this.b; };

  /* ========================================================================
   *  7) 앙상블 (소프트 보팅)
   *
   *  여러 모델이 낸 확률을 그냥 평균 냅니다. 서로 다른 실수를 하는 모델들이라면
   *  실수끼리 상쇄되어 평균이 개별 모델보다 나아집니다.
   *  "왜 여러 모델을 쓰는가"에 대한 가장 단순한 답입니다.
   * ======================================================================*/
  function Ensemble(params) {
    this.members = (params && params.members) || ['logistic', 'forest', 'boosting', 'knn', 'gnb'];
  }
  Ensemble.prototype.fit = function (train, ctx) {
    const self = this;
    this.models = [];
    this.used = [];
    this.members.forEach(function (id) {
      if (!REG.has(id) || !REG.get(id).make) return;
      const m = REG.create(id);
      m.fit(train, ctx);
      self.models.push(m);
      self.used.push(id);
    });
    if (!this.models.length) throw new Error('앙상블에 넣을 수 있는 모델이 하나도 없습니다.');
    return this;
  };
  Ensemble.prototype.predict = function (test, ctx) {
    const n = test.X ? test.X.length : test.raw.length;
    const out = new Float64Array(n);
    this.models.forEach(function (m) {
      const p = m.predict(test, ctx);
      for (let i = 0; i < n; i++) out[i] += p[i];
    });
    for (let i = 0; i < n; i++) out[i] /= this.models.length;
    return out;
  };
  Ensemble.prototype.memberIds = function () { return this.used.slice(); };

  /* ========================================================================
   *  등록 — registry.js 의 빈 자리를 채웁니다
   * ======================================================================*/
  function wrap(Ctor) {
    return function (params) {
      const m = new Ctor(params);
      return {
        fit: function (train, ctx) { m.fit(train, ctx); return this; },
        predict: function (test, ctx) { return m.predict(test, ctx); },
        importance: function () { return m.importance ? m.importance() : null; },
        inner: m
      };
    };
  }

  REG.impl('knn', wrap(KNN));
  REG.impl('gnb', wrap(GaussianNB));
  REG.impl('svm', wrap(SVM));
  REG.impl('ridge', wrap(Ridge));
  REG.impl('elastic', wrap(ElasticNet));
  REG.impl('arima', wrap(ARIMA));
  REG.impl('ensemble', wrap(Ensemble));

  root.MLX = {
    KNN: KNN, GaussianNB: GaussianNB, SVM: SVM,
    Ridge: Ridge, ElasticNet: ElasticNet, ARIMA: ARIMA, Ensemble: Ensemble
  };
})(window.QL = window.QL || {});
