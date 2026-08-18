/* ============================================================================
 *  ml.js — 브라우저에서 돌아가는 머신러닝 모델들
 *
 *  파이썬의 scikit-learn / XGBoost / 케라스를 쓸 수 없으므로 같은 아이디어를
 *  자바스크립트로 직접 구현했습니다. 구조는 원본과 같습니다.
 *    로지스틱 회귀   ← 가장 단순한 분류 모델(기준점)
 *    랜덤포레스트    ← 나무 여러 그루의 다수결 (배깅)
 *    그래디언트부스팅 ← 틀린 것을 다음 나무가 보완 (XGBoost와 같은 계열)
 *    신경망(MLP)     ← 딥러닝 계열. 브라우저에서 LSTM은 무거워 MLP로 대신합니다.
 *  그리고 비교용 기준선: 항상 상승 / 모멘텀 규칙 / 무작위
 *
 *  공통 규칙
 *   - 학습은 항상 '과거 구간'만 보고, 예측은 '그 뒤 구간'에 합니다(누수 방지).
 *   - 클래스 가중치를 켜면 소수 클래스에 가중치를 줘서 다수결 흉내를 막습니다.
 *   - 시드를 고정해 같은 설정이면 같은 결과가 나옵니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U;
  const ML = {};

  ML.MODELS = [
    { id: 'logistic', name: '로지스틱 회귀', kind: 'ai', desc: '선형 모델. 빠르고 해석이 쉬움' },
    { id: 'forest', name: '랜덤포레스트', kind: 'ai', desc: '결정나무 여러 그루의 평균(배깅)' },
    { id: 'boosting', name: '그래디언트부스팅', kind: 'ai', desc: 'XGBoost 계열. 오차를 순차적으로 보완' },
    { id: 'mlp', name: '신경망(MLP)', kind: 'ai', desc: '딥러닝 계열. 은닉층 1개' },
    { id: 'momentum', name: '모멘텀 규칙', kind: 'rule', desc: '5일평균>20일평균이면 상승 (AI 아님)' },
    { id: 'alwaysup', name: '항상 상승', kind: 'rule', desc: '무조건 오른다고 찍는 기준선' },
    { id: 'random', name: '무작위', kind: 'rule', desc: '동전 던지기 (시드 고정)' }
  ];
  ML.modelName = function (id) {
    for (let i = 0; i < ML.MODELS.length; i++) if (ML.MODELS[i].id === id) return ML.MODELS[i].name;
    return id;
  };

  /* ------------------------------------------------------------------------
   *  표준화 (평균 0, 표준편차 1) — 학습 구간의 통계만 사용
   * ----------------------------------------------------------------------*/
  function Scaler() { this.mu = null; this.sd = null; }
  Scaler.prototype.fit = function (X) {
    const p = X[0].length, n = X.length;
    this.mu = new Float64Array(p); this.sd = new Float64Array(p);
    for (let j = 0; j < p; j++) {
      let s = 0; for (let i = 0; i < n; i++) s += X[i][j];
      const m = s / n; let v = 0;
      for (let i = 0; i < n; i++) { const d = X[i][j] - m; v += d * d; }
      this.mu[j] = m; this.sd[j] = Math.sqrt(v / n) || 1e-9;
    }
    return this;
  };
  Scaler.prototype.transform = function (X) {
    const p = this.mu.length;
    return X.map(function (row) {
      const o = new Float64Array(p);
      for (let j = 0; j < p; j++) o[j] = (row[j] - this.mu[j]) / this.sd[j];
      return o;
    }, this);
  };

  // 클래스 가중치: 소수 클래스에 더 큰 무게
  function classWeights(y, use) {
    let pos = 0;
    for (let i = 0; i < y.length; i++) pos += y[i];
    const neg = y.length - pos;
    if (!use || pos === 0 || neg === 0) return { w1: 1, w0: 1 };
    return { w1: y.length / (2 * pos), w0: y.length / (2 * neg) };
  }

  const sigmoid = function (z) { return 1 / (1 + Math.exp(-U.clamp(z, -35, 35))); };

  /* ========================================================================
   *  구간 나누기(binning) — 나무 모델을 빠르게 만들기 위한 준비
   *  각 특징을 32개 구간으로 쪼개 두면 분할 지점을 아주 빨리 찾을 수 있습니다.
   *  (LightGBM이 쓰는 히스토그램 방식과 같은 아이디어)
   * ======================================================================*/
  const NBINS = 32;
  function makeBins(X) {
    const n = X.length, p = X[0].length;
    const th = [];
    for (let j = 0; j < p; j++) {
      const col = new Float64Array(n);
      for (let i = 0; i < n; i++) col[i] = X[i][j];
      col.sort();
      const t = new Float64Array(NBINS - 1);
      for (let b = 1; b < NBINS; b++) {
        const pos = (n - 1) * b / NBINS;
        const lo = Math.floor(pos), hi = Math.ceil(pos);
        t[b - 1] = col[lo] + (col[hi] - col[lo]) * (pos - lo);
      }
      th.push(t);
    }
    return th;
  }
  function binize(X, th) {
    const n = X.length, p = th.length;
    const B = new Uint8Array(n * p);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < p; j++) {
        const v = X[i][j], t = th[j];
        let lo = 0, hi = t.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (v > t[mid]) lo = mid + 1; else hi = mid; }
        B[i * p + j] = lo;
      }
    }
    return B;
  }

  /* ------------------------------------------------------------------------
   *  분류용 결정나무 (랜덤포레스트의 한 그루)
   *  지니 불순도를 가장 많이 줄이는 지점에서 가지를 나눕니다.
   * ----------------------------------------------------------------------*/
  function fitClassTree(B, p, y, idx, w1, w0, maxDepth, minLeaf, mtry, rnd, gainAcc) {
    const feat = [], thr = [], left = [], right = [], val = [];
    function newNode() { feat.push(-1); thr.push(0); left.push(-1); right.push(-1); val.push(0); return feat.length - 1; }

    function wsum(ids) {
      let sw = 0, sp = 0;
      for (let k = 0; k < ids.length; k++) { const w = y[ids[k]] ? w1 : w0; sw += w; sp += y[ids[k]] ? w : 0; }
      return [sw, sp];
    }
    function gini(sw, sp) { if (sw <= 0) return 0; const q = sp / sw; return 1 - q * q - (1 - q) * (1 - q); }

    function build(ids, depth) {
      const node = newNode();
      const s = wsum(ids);
      val[node] = s[0] > 0 ? s[1] / s[0] : 0.5;
      if (depth >= maxDepth || ids.length < 2 * minLeaf || s[1] === 0 || s[1] === s[0]) return node;

      const parentImp = gini(s[0], s[1]) * s[0];
      let best = null;
      // 특징 일부만 후보로 (랜덤포레스트의 핵심: 나무마다 다르게 보게 함)
      const order = U.range(p);
      for (let i = p - 1; i > 0; i--) { const j = rnd.int(i + 1); const t = order[i]; order[i] = order[j]; order[j] = t; }
      const cand = order.slice(0, mtry);

      const hw = new Float64Array(NBINS), hp = new Float64Array(NBINS), hc = new Float64Array(NBINS);
      for (let ci = 0; ci < cand.length; ci++) {
        const j = cand[ci];
        hw.fill(0); hp.fill(0); hc.fill(0);
        for (let k = 0; k < ids.length; k++) {
          const i = ids[k], b = B[i * p + j], w = y[i] ? w1 : w0;
          hw[b] += w; hp[b] += y[i] ? w : 0; hc[b] += 1;
        }
        let cw = 0, cp = 0, cc = 0;
        for (let b = 0; b < NBINS - 1; b++) {
          cw += hw[b]; cp += hp[b]; cc += hc[b];
          if (cc < minLeaf || ids.length - cc < minLeaf) continue;
          const rw = s[0] - cw, rp = s[1] - cp;
          const g = parentImp - (gini(cw, cp) * cw + gini(rw, rp) * rw);
          if (g > 1e-12 && (!best || g > best.gain)) best = { gain: g, feat: j, bin: b };
        }
      }
      if (!best) return node;

      const L = [], R = [];
      for (let k = 0; k < ids.length; k++) {
        const i = ids[k];
        if (B[i * p + best.feat] <= best.bin) L.push(i); else R.push(i);
      }
      if (!L.length || !R.length) return node;
      if (gainAcc) gainAcc[best.feat] += best.gain;
      feat[node] = best.feat; thr[node] = best.bin;
      left[node] = build(L, depth + 1);
      right[node] = build(R, depth + 1);
      return node;
    }
    build(idx, 0);
    return { feat: feat, thr: thr, left: left, right: right, val: val };
  }

  /* ------------------------------------------------------------------------
   *  회귀용 나무 (그래디언트부스팅의 한 그루)
   *  gradient/hessian 합으로 이득을 계산하는 XGBoost 방식
   * ----------------------------------------------------------------------*/
  function fitGradTree(B, p, g, h, idx, maxDepth, minLeaf, lambda, colRate, rnd, gainAcc) {
    const feat = [], thr = [], left = [], right = [], val = [];
    function newNode() { feat.push(-1); thr.push(0); left.push(-1); right.push(-1); val.push(0); return feat.length - 1; }
    function sums(ids) {
      let G = 0, H = 0;
      for (let k = 0; k < ids.length; k++) { G += g[ids[k]]; H += h[ids[k]]; }
      return [G, H];
    }
    function score(G, H) { return (G * G) / (H + lambda); }

    function build(ids, depth) {
      const node = newNode();
      const s = sums(ids);
      val[node] = -s[0] / (s[1] + lambda);
      if (depth >= maxDepth || ids.length < 2 * minLeaf) return node;
      const parent = score(s[0], s[1]);
      let best = null;
      const order = U.range(p);
      for (let i = p - 1; i > 0; i--) { const j = rnd.int(i + 1); const t = order[i]; order[i] = order[j]; order[j] = t; }
      const mtry = Math.max(1, Math.round(p * colRate));
      const cand = order.slice(0, mtry);
      const hg = new Float64Array(NBINS), hh = new Float64Array(NBINS), hc = new Float64Array(NBINS);
      for (let ci = 0; ci < cand.length; ci++) {
        const j = cand[ci];
        hg.fill(0); hh.fill(0); hc.fill(0);
        for (let k = 0; k < ids.length; k++) {
          const i = ids[k], b = B[i * p + j];
          hg[b] += g[i]; hh[b] += h[i]; hc[b] += 1;
        }
        let cg = 0, ch = 0, cc = 0;
        for (let b = 0; b < NBINS - 1; b++) {
          cg += hg[b]; ch += hh[b]; cc += hc[b];
          if (cc < minLeaf || ids.length - cc < minLeaf) continue;
          const gain = score(cg, ch) + score(s[0] - cg, s[1] - ch) - parent;
          if (gain > 1e-9 && (!best || gain > best.gain)) best = { gain: gain, feat: j, bin: b };
        }
      }
      if (!best) return node;
      const L = [], R = [];
      for (let k = 0; k < ids.length; k++) {
        const i = ids[k];
        if (B[i * p + best.feat] <= best.bin) L.push(i); else R.push(i);
      }
      if (!L.length || !R.length) return node;
      if (gainAcc) gainAcc[best.feat] += best.gain;
      feat[node] = best.feat; thr[node] = best.bin;
      left[node] = build(L, depth + 1);
      right[node] = build(R, depth + 1);
      return node;
    }
    build(idx, 0);
    return { feat: feat, thr: thr, left: left, right: right, val: val };
  }

  function treePredict(tree, B, p, i) {
    let node = 0;
    while (tree.feat[node] >= 0) {
      node = (B[i * p + tree.feat[node]] <= tree.thr[node]) ? tree.left[node] : tree.right[node];
    }
    return tree.val[node];
  }

  /* ========================================================================
   *  모델들
   * ======================================================================*/

  // --- 로지스틱 회귀 --------------------------------------------------------
  function Logistic(opt) {
    this.opt = Object.assign({ lr: 0.5, iters: 400, l2: 1e-3, classWeight: true }, opt);
  }
  Logistic.prototype.fit = function (X, y) {
    this.sc = new Scaler().fit(X);
    const Z = this.sc.transform(X), n = Z.length, p = Z[0].length;
    const cw = classWeights(y, this.opt.classWeight);
    const w = new Float64Array(p); let b = 0;
    const mw = new Float64Array(p); let mb = 0;
    const o = this.opt;
    for (let it = 0; it < o.iters; it++) {
      const gw = new Float64Array(p); let gb = 0, wsum = 0;
      for (let i = 0; i < n; i++) {
        let z = b;
        for (let j = 0; j < p; j++) z += w[j] * Z[i][j];
        const pr = sigmoid(z);
        const cwi = y[i] ? cw.w1 : cw.w0;
        const e = (pr - y[i]) * cwi;
        for (let j = 0; j < p; j++) gw[j] += e * Z[i][j];
        gb += e; wsum += cwi;
      }
      for (let j = 0; j < p; j++) {
        const grad = gw[j] / wsum + o.l2 * w[j];
        mw[j] = 0.9 * mw[j] - o.lr * grad;      // 모멘텀 경사하강
        w[j] += mw[j];
      }
      mb = 0.9 * mb - o.lr * (gb / wsum); b += mb;
    }
    this.w = w; this.b = b;
    return this;
  };
  Logistic.prototype.predictProba = function (X) {
    const Z = this.sc.transform(X), out = new Float64Array(Z.length);
    for (let i = 0; i < Z.length; i++) {
      let z = this.b;
      for (let j = 0; j < this.w.length; j++) z += this.w[j] * Z[i][j];
      out[i] = sigmoid(z);
    }
    return out;
  };
  Logistic.prototype.importance = function () {
    const a = Array.prototype.map.call(this.w, Math.abs);
    const s = U.sum(a) || 1;
    return a.map(function (v) { return v / s; });
  };

  // --- 랜덤포레스트 ---------------------------------------------------------
  function Forest(opt) {
    this.opt = Object.assign({ trees: 60, maxDepth: 5, minLeaf: 20, seed: 42, classWeight: true, sampleRate: 0.8 }, opt);
  }
  Forest.prototype.fit = function (X, y) {
    const o = this.opt, n = X.length, p = X[0].length;
    const rnd = U.rng(o.seed);
    this.th = makeBins(X);
    const B = binize(X, this.th);
    const cw = classWeights(y, o.classWeight);
    const mtry = Math.max(1, Math.round(Math.sqrt(p) + 0.5));
    this.gain = new Float64Array(p);
    this.trees = [];
    const m = Math.max(50, Math.round(n * o.sampleRate));
    for (let t = 0; t < o.trees; t++) {
      const ids = new Array(m);
      for (let k = 0; k < m; k++) ids[k] = rnd.int(n);      // 부트스트랩 표본
      this.trees.push(fitClassTree(B, p, y, ids, cw.w1, cw.w0, o.maxDepth, o.minLeaf, mtry, rnd, this.gain));
    }
    this.p = p;
    return this;
  };
  Forest.prototype.predictProba = function (X) {
    const B = binize(X, this.th), out = new Float64Array(X.length);
    for (let i = 0; i < X.length; i++) {
      let s = 0;
      for (let t = 0; t < this.trees.length; t++) s += treePredict(this.trees[t], B, this.p, i);
      out[i] = s / this.trees.length;
    }
    return out;
  };
  Forest.prototype.importance = function () {
    const a = Array.from(this.gain), s = U.sum(a) || 1;
    return a.map(function (v) { return v / s; });
  };

  // --- 그래디언트 부스팅 ----------------------------------------------------
  function Boosting(opt) {
    this.opt = Object.assign({ trees: 120, lr: 0.06, maxDepth: 3, minLeaf: 20, lambda: 1.0, colRate: 0.9, subsample: 0.9, seed: 42, classWeight: true }, opt);
  }
  Boosting.prototype.fit = function (X, y) {
    const o = this.opt, n = X.length, p = X[0].length;
    const rnd = U.rng(o.seed);
    this.th = makeBins(X);
    const B = binize(X, this.th);
    const cw = classWeights(y, o.classWeight);
    let pos = 0; for (let i = 0; i < n; i++) pos += y[i];
    const base = Math.log((pos + 1) / (n - pos + 1));
    const F = new Float64Array(n); F.fill(base);
    const g = new Float64Array(n), h = new Float64Array(n);
    this.gain = new Float64Array(p);
    this.trees = [];
    for (let t = 0; t < o.trees; t++) {
      for (let i = 0; i < n; i++) {
        const pr = sigmoid(F[i]);
        const w = y[i] ? cw.w1 : cw.w0;
        g[i] = w * (pr - y[i]);
        h[i] = w * Math.max(pr * (1 - pr), 1e-6);
      }
      const ids = [];
      for (let i = 0; i < n; i++) if (rnd() < o.subsample) ids.push(i);
      if (ids.length < 40) for (let i = 0; i < n; i++) ids.push(i);
      const tree = fitGradTree(B, p, g, h, ids, o.maxDepth, o.minLeaf, o.lambda, o.colRate, rnd, this.gain);
      for (let i = 0; i < n; i++) F[i] += o.lr * treePredict(tree, B, p, i);
      this.trees.push(tree);
    }
    this.base = base; this.p = p;
    return this;
  };
  Boosting.prototype.predictProba = function (X) {
    const B = binize(X, this.th), out = new Float64Array(X.length);
    for (let i = 0; i < X.length; i++) {
      let f = this.base;
      for (let t = 0; t < this.trees.length; t++) f += this.opt.lr * treePredict(this.trees[t], B, this.p, i);
      out[i] = sigmoid(f);
    }
    return out;
  };
  Boosting.prototype.importance = Forest.prototype.importance;

  // --- 신경망(MLP) ----------------------------------------------------------
  function MLP(opt) {
    this.opt = Object.assign({ hidden: 8, epochs: 120, lr: 0.05, l2: 1e-4, seed: 42, classWeight: true, batch: 64 }, opt);
  }
  MLP.prototype.fit = function (X, y) {
    const o = this.opt;
    this.sc = new Scaler().fit(X);
    const Z = this.sc.transform(X), n = Z.length, p = Z[0].length, H = o.hidden;
    const rnd = U.rng(o.seed);
    const cw = classWeights(y, o.classWeight);
    const W1 = new Float64Array(p * H), b1 = new Float64Array(H);
    const W2 = new Float64Array(H); let b2 = 0;
    const s1 = Math.sqrt(2 / (p + H)), s2 = Math.sqrt(2 / (H + 1));
    for (let k = 0; k < W1.length; k++) W1[k] = rnd.normal() * s1;
    for (let k = 0; k < H; k++) W2[k] = rnd.normal() * s2;

    // Adam
    const mW1 = new Float64Array(p * H), vW1 = new Float64Array(p * H);
    const mb1 = new Float64Array(H), vb1 = new Float64Array(H);
    const mW2 = new Float64Array(H), vW2 = new Float64Array(H);
    let mb2 = 0, vb2 = 0, step = 0;
    const b1_ = 0.9, b2_ = 0.999, eps = 1e-8;

    const idx = U.range(n);
    const hbuf = new Float64Array(H);
    for (let ep = 0; ep < o.epochs; ep++) {
      for (let i = n - 1; i > 0; i--) { const j = rnd.int(i + 1); const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
      for (let start = 0; start < n; start += o.batch) {
        const end = Math.min(n, start + o.batch), m = end - start;
        const gW1 = new Float64Array(p * H), gb1 = new Float64Array(H);
        const gW2 = new Float64Array(H); let gb2 = 0, wtot = 0;
        for (let k = start; k < end; k++) {
          const i = idx[k], row = Z[i];
          for (let q = 0; q < H; q++) {
            let z = b1[q];
            for (let j = 0; j < p; j++) z += W1[j * H + q] * row[j];
            hbuf[q] = Math.tanh(z);
          }
          let z2 = b2;
          for (let q = 0; q < H; q++) z2 += W2[q] * hbuf[q];
          const pr = sigmoid(z2);
          const w = y[i] ? cw.w1 : cw.w0;
          const d2 = (pr - y[i]) * w;
          wtot += w;
          for (let q = 0; q < H; q++) {
            gW2[q] += d2 * hbuf[q];
            const d1 = d2 * W2[q] * (1 - hbuf[q] * hbuf[q]);
            gb1[q] += d1;
            for (let j = 0; j < p; j++) gW1[j * H + q] += d1 * row[j];
          }
          gb2 += d2;
        }
        const scale = 1 / Math.max(wtot, 1e-9);
        step++;
        const bc1 = 1 - Math.pow(b1_, step), bc2 = 1 - Math.pow(b2_, step);
        const upd = function (W, g, mArr, vArr, k, gval) {
          mArr[k] = b1_ * mArr[k] + (1 - b1_) * gval;
          vArr[k] = b2_ * vArr[k] + (1 - b2_) * gval * gval;
          W[k] -= o.lr * (mArr[k] / bc1) / (Math.sqrt(vArr[k] / bc2) + eps);
        };
        for (let k = 0; k < W1.length; k++) upd(W1, gW1, mW1, vW1, k, gW1[k] * scale + o.l2 * W1[k]);
        for (let k = 0; k < H; k++) upd(b1, gb1, mb1, vb1, k, gb1[k] * scale);
        for (let k = 0; k < H; k++) upd(W2, gW2, mW2, vW2, k, gW2[k] * scale + o.l2 * W2[k]);
        mb2 = b1_ * mb2 + (1 - b1_) * (gb2 * scale);
        vb2 = b2_ * vb2 + (1 - b2_) * Math.pow(gb2 * scale, 2);
        b2 -= o.lr * (mb2 / bc1) / (Math.sqrt(vb2 / bc2) + eps);
      }
    }
    this.W1 = W1; this.b1 = b1; this.W2 = W2; this.b2 = b2; this.H = H; this.p = p;
    return this;
  };
  MLP.prototype.predictProba = function (X) {
    const Z = this.sc.transform(X), out = new Float64Array(Z.length), H = this.H, p = this.p;
    for (let i = 0; i < Z.length; i++) {
      let z2 = this.b2;
      for (let q = 0; q < H; q++) {
        let z = this.b1[q];
        for (let j = 0; j < p; j++) z += this.W1[j * H + q] * Z[i][j];
        z2 += this.W2[q] * Math.tanh(z);
      }
      out[i] = sigmoid(z2);
    }
    return out;
  };
  MLP.prototype.importance = function () {
    // 입력→은닉 가중치 크기 × 은닉→출력 가중치 크기 (대략적인 기여도)
    const p = this.p, H = this.H, a = new Array(p).fill(0);
    for (let j = 0; j < p; j++) {
      for (let q = 0; q < H; q++) a[j] += Math.abs(this.W1[j * H + q] * this.W2[q]);
    }
    const s = U.sum(a) || 1;
    return a.map(function (v) { return v / s; });
  };

  // --- 규칙 기반 기준선 -----------------------------------------------------
  function RuleModel(kind, opt) {
    this.kind = kind;
    this.opt = opt || {};
    this.rnd = U.rng(this.opt.seed || 42);
  }
  RuleModel.prototype.fit = function () { return this; };
  RuleModel.prototype.predictProba = function (X) {
    const out = new Float64Array(X.length);
    const mi = this.opt.momentumIndex === undefined ? -1 : this.opt.momentumIndex;
    for (let i = 0; i < X.length; i++) {
      if (this.kind === 'alwaysup') out[i] = 1;
      else if (this.kind === 'random') out[i] = this.rnd();
      else out[i] = (mi >= 0 ? (X[i][mi] > 0 ? 0.75 : 0.25) : 0.5);
    }
    return out;
  };
  RuleModel.prototype.importance = function () { return null; };

  /* ========================================================================
   *  회귀 모델 — Phase 3(종목 순위 예측)에서 '다음 달 수익률'을 맞히는 데 씁니다.
   *  분류가 아니라 숫자를 예측하므로 손실이 다릅니다(제곱오차).
   *  나무를 만드는 코드는 위의 fitGradTree를 그대로 씁니다.
   *    g = 예측 - 실제, h = 1  →  잎의 값이 그 구간의 평균이 되고,
   *    분할 이득은 분산 감소량과 같아집니다.
   * ======================================================================*/
  function ForestReg(opt) {
    this.opt = Object.assign({ trees: 40, maxDepth: 6, minLeaf: 20, seed: 42, sampleRate: 0.8 }, opt);
  }
  ForestReg.prototype.fit = function (X, y) {
    const o = this.opt, n = X.length, p = X[0].length;
    const rnd = U.rng(o.seed);
    this.th = makeBins(X);
    const B = binize(X, this.th);
    const g = new Float64Array(n), h = new Float64Array(n);
    for (let i = 0; i < n; i++) { g[i] = -y[i]; h[i] = 1; }
    this.gain = new Float64Array(p);
    this.trees = [];
    const m = Math.max(50, Math.round(n * o.sampleRate));
    const colRate = Math.max(1 / p, Math.sqrt(p) / p);
    for (let t = 0; t < o.trees; t++) {
      const ids = new Array(m);
      for (let k = 0; k < m; k++) ids[k] = rnd.int(n);
      this.trees.push(fitGradTree(B, p, g, h, ids, o.maxDepth, o.minLeaf, 1e-6, colRate, rnd, this.gain));
    }
    this.p = p;
    return this;
  };
  ForestReg.prototype.predict = function (X) {
    const B = binize(X, this.th), out = new Float64Array(X.length);
    for (let i = 0; i < X.length; i++) {
      let s = 0;
      for (let t = 0; t < this.trees.length; t++) s += treePredict(this.trees[t], B, this.p, i);
      out[i] = s / this.trees.length;
    }
    return out;
  };
  ForestReg.prototype.importance = Forest.prototype.importance;

  function BoostingReg(opt) {
    this.opt = Object.assign({ trees: 80, lr: 0.06, maxDepth: 3, minLeaf: 20, lambda: 1.0, colRate: 0.9, subsample: 0.9, seed: 42 }, opt);
  }
  BoostingReg.prototype.fit = function (X, y) {
    const o = this.opt, n = X.length, p = X[0].length;
    const rnd = U.rng(o.seed);
    this.th = makeBins(X);
    const B = binize(X, this.th);
    let base = 0;
    for (let i = 0; i < n; i++) base += y[i];
    base /= n;
    const F = new Float64Array(n); F.fill(base);
    const g = new Float64Array(n), h = new Float64Array(n);
    this.gain = new Float64Array(p);
    this.trees = [];
    for (let t = 0; t < o.trees; t++) {
      for (let i = 0; i < n; i++) { g[i] = F[i] - y[i]; h[i] = 1; }
      const ids = [];
      for (let i = 0; i < n; i++) if (rnd() < o.subsample) ids.push(i);
      if (ids.length < 40) for (let i = 0; i < n; i++) ids.push(i);
      const tree = fitGradTree(B, p, g, h, ids, o.maxDepth, o.minLeaf, o.lambda, o.colRate, rnd, this.gain);
      for (let i = 0; i < n; i++) F[i] += o.lr * treePredict(tree, B, p, i);
      this.trees.push(tree);
    }
    this.base = base; this.p = p;
    return this;
  };
  BoostingReg.prototype.predict = function (X) {
    const B = binize(X, this.th), out = new Float64Array(X.length);
    for (let i = 0; i < X.length; i++) {
      let f = this.base;
      for (let t = 0; t < this.trees.length; t++) f += this.opt.lr * treePredict(this.trees[t], B, this.p, i);
      out[i] = f;
    }
    return out;
  };
  BoostingReg.prototype.importance = Forest.prototype.importance;

  // 규칙 기반 순위: 특정 특징값을 그대로 점수로 씁니다 (예: 6개월 모멘텀이 높은 순).
  function RuleReg(opt) { this.opt = opt || {}; }
  RuleReg.prototype.fit = function () { return this; };
  RuleReg.prototype.predict = function (X) {
    const j = this.opt.index === undefined ? 0 : this.opt.index;
    const out = new Float64Array(X.length);
    const rnd = U.rng(this.opt.seed || 42);
    for (let i = 0; i < X.length; i++) out[i] = this.opt.random ? rnd() : X[i][j];
    return out;
  };
  RuleReg.prototype.importance = function () { return null; };

  ML.REGRESSORS = [
    { id: 'boosting', name: '그래디언트부스팅', kind: 'ai' },
    { id: 'forest', name: '랜덤포레스트', kind: 'ai' },
    { id: 'momentum', name: '6개월 모멘텀 규칙', kind: 'rule' },
    { id: 'random', name: '무작위 선택', kind: 'rule' }
  ];
  ML.createReg = function (id, opt) {
    opt = opt || {};
    const fc = opt.featureCols || [];
    switch (id) {
      case 'boosting': return new BoostingReg(opt);
      case 'forest': return new ForestReg(opt);
      case 'momentum': return new RuleReg({ index: Math.max(0, fc.indexOf('mom_6m')) });
      case 'random': return new RuleReg({ random: true, seed: opt.seed || 42 });
      default: throw new Error('알 수 없는 회귀 모델: ' + id);
    }
  };
  ML.regName = function (id) {
    for (let i = 0; i < ML.REGRESSORS.length; i++) if (ML.REGRESSORS[i].id === id) return ML.REGRESSORS[i].name;
    return id;
  };

  /* ------------------------------------------------------------------------
   *  모델 만들기
   *  featureCols는 모멘텀 규칙이 어느 열을 봐야 하는지 알려주는 데 씁니다.
   * ----------------------------------------------------------------------*/
  ML.create = function (id, opt) {
    opt = opt || {};
    const fc = opt.featureCols || [];
    switch (id) {
      case 'logistic': return new Logistic(opt);
      case 'forest': return new Forest(opt);
      case 'boosting': return new Boosting(opt);
      case 'mlp': return new MLP(opt);
      case 'momentum': return new RuleModel('momentum', Object.assign({ momentumIndex: fc.indexOf('ma5_vs_ma20') }, opt));
      case 'alwaysup': return new RuleModel('alwaysup', opt);
      case 'random': return new RuleModel('random', opt);
      default: throw new Error('알 수 없는 모델: ' + id);
    }
  };
  ML.isRule = function (id) { return ['momentum', 'alwaysup', 'random'].indexOf(id) >= 0; };

  root.ML = ML;
})(window.QL = window.QL || {});
