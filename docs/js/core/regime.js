/* ============================================================================
 *  regime.js — 국면 나누기와 이상한 날 찾기
 *
 *  앞의 모델들과 결정적으로 다른 점: **정답이 없습니다.**
 *  "이 날은 상승장이었다"라고 적힌 라벨이 세상에 없기 때문에, 맞고 틀리고를
 *  따질 수가 없습니다. 이런 것을 비지도 학습이라고 합니다.
 *
 *  그럼 왜 하는가? 다른 모델들의 성적을 **나눠 보는 자**로 쓰기 위해서입니다.
 *  "부스팅이 좋다"가 아니라 "부스팅은 고변동 구간에서 특히 좋다"까지 말할 수
 *  있게 됩니다. 국면 분석 화면의 가로축이 여기서 나옵니다.
 *
 *    k-means         비슷한 날끼리 세 무리로 묶는다
 *    Isolation Forest 혼자 뚝 떨어진 날(급등락)을 찾는다
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, REG = root.REG;

  /*  국면 번호의 뜻 (이름은 fit 후 실제 평균을 보고 붙입니다 — KMeans.nameOf 참고)
   *    0번 = 변동성이 큰 쪽을 뺀 둘 중 수익률이 높은 무리
   *    1번 = 그 나머지
   *    2번 = 변동성이 가장 큰 무리
   *  아래 값은 아직 학습하지 않았을 때 쓰는 임시 이름입니다. */
  const LABELS = ['상승 국면', '횡보 국면', '고변동 국면'];
  const LABEL_DESC = [
    '오름세가 이어지는 구간. 대부분의 모델이 편안해합니다.',
    '방향이 뚜렷하지 않고 출렁임도 작은 구간.',
    '하루하루 크게 흔들리는 구간. 여기서 모델 순위가 가장 크게 바뀝니다.'
  ];

  /* ========================================================================
   *  1) k-means — 세 무리로 묶기
   *
   *  ① 대표점(중심) 세 개를 찍는다
   *  ② 각 날짜를 가장 가까운 중심에 배정한다
   *  ③ 배정된 날짜들의 평균으로 중심을 옮긴다
   *  ④ 중심이 더 안 움직일 때까지 ②③ 반복
   *
   *  쓰는 좌표는 두 개뿐입니다 — 한 달 수익률(ret21)과 변동성(vol20).
   *  "얼마나 올랐나"와 "얼마나 흔들렸나"면 장세를 나누기에 충분하고,
   *  두 개라 그림으로 그려 눈으로 확인할 수 있습니다.
   *
   *  ★ 약점도 분명합니다. 날짜 순서를 전혀 모릅니다. 그래서 어제는 상승 국면,
   *    오늘은 고변동 국면처럼 하루 단위로 튈 수 있습니다. 국면이 잘 안 바뀐다는
   *    성질까지 담으려면 HMM(사전 학습)이 필요합니다.
   * ======================================================================*/
  function KMeans(params) {
    this.opt = Object.assign({ k: 3, iters: 60, seed: 42 }, params);
  }

  /*  좌표 만들기 — 표준화되기 전의 원본 값(raw)에서 두 축을 뽑습니다.
   *
   *  ★ 변동성에는 로그를 씌웁니다. 변동성 분포는 오른쪽으로 길게 늘어져 있어서
   *    (대부분 20% 근처인데 폭락 때만 80%까지 튐), 그대로 쓰면 k-means가
   *    "아주 드문 폭락일 몇 개"만 따로 떼어 내고 나머지를 둘로 나눠 버립니다.
   *    로그를 씌우면 분포가 종 모양에 가까워져 국면이 셋으로 제대로 갈라집니다.
   *  그리고 두 축의 단위가 다르므로(수익률 %, 변동성 %) 학습 구간 기준으로
   *  표준화합니다. 이 표준화는 이 모델이 고른 두 축에만 적용되는 것이라
   *  바깥에서 이미 끝낸 전체 피처 표준화와는 별개입니다.
   * ----------------------------------------------------------------------*/
  KMeans.prototype._coords = function (raw) {
    const jR = this.jRet, jV = this.jVol;
    const out = new Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      out[i] = new Float64Array([raw[i][jR], Math.log(Math.max(raw[i][jV], 1e-6))]);
    }
    return out;
  };
  KMeans.prototype._scale = function (Z) {
    const out = new Array(Z.length);
    for (let i = 0; i < Z.length; i++) {
      out[i] = new Float64Array([(Z[i][0] - this.mu[0]) / this.sd[0], (Z[i][1] - this.mu[1]) / this.sd[1]]);
    }
    return out;
  };

  KMeans.prototype.fit = function (train, ctx) {
    const o = this.opt;
    const cols = (ctx && ctx.cols) || [];
    this.jRet = Math.max(0, cols.indexOf('ret21'));
    this.jVol = Math.max(1, cols.indexOf('vol20'));

    const raw = train.raw || train.X;
    const Z0 = this._coords(raw);
    this.mu = [0, 0]; this.sd = [1, 1];
    for (let q = 0; q < 2; q++) {
      const col = Z0.map(function (r) { return r[q]; });
      this.mu[q] = U.mean(col);
      this.sd[q] = U.std(col) || 1e-9;
    }
    const Z = this._scale(Z0);
    const n = Z.length, d = 2, k = o.k;
    const rnd = U.rng((ctx && ctx.seed) || o.seed);

    // k-means++ 초기화: 첫 중심은 무작위, 그다음부터는 기존 중심에서 먼 점일수록
    // 뽑힐 확률이 높게. 처음부터 세 점이 몰려 있으면 결과가 나빠지기 때문입니다.
    const C = [];
    C.push(Float64Array.from(Z[rnd.int(n)]));
    const dist = new Float64Array(n);
    for (let c = 1; c < k; c++) {
      let tot = 0;
      for (let i = 0; i < n; i++) {
        let best = Infinity;
        for (let j = 0; j < C.length; j++) {
          let s = 0;
          for (let q = 0; q < d; q++) { const t = Z[i][q] - C[j][q]; s += t * t; }
          if (s < best) best = s;
        }
        dist[i] = best; tot += best;
      }
      let r = rnd() * tot, pick = n - 1;
      for (let i = 0; i < n; i++) { r -= dist[i]; if (r <= 0) { pick = i; break; } }
      C.push(Float64Array.from(Z[pick]));
    }

    const assign = new Int32Array(n);
    for (let it = 0; it < o.iters; it++) {
      let moved = 0;
      for (let i = 0; i < n; i++) {
        let best = 0, bd = Infinity;
        for (let j = 0; j < k; j++) {
          let s = 0;
          for (let q = 0; q < d; q++) { const t = Z[i][q] - C[j][q]; s += t * t; }
          if (s < bd) { bd = s; best = j; }
        }
        if (assign[i] !== best) { assign[i] = best; moved++; }
      }
      const sum = [], cnt = new Int32Array(k);
      for (let j = 0; j < k; j++) sum.push(new Float64Array(d));
      for (let i = 0; i < n; i++) {
        cnt[assign[i]]++;
        for (let q = 0; q < d; q++) sum[assign[i]][q] += Z[i][q];
      }
      for (let j = 0; j < k; j++) {
        if (!cnt[j]) continue;
        for (let q = 0; q < d; q++) C[j][q] = sum[j][q] / cnt[j];
      }
      if (!moved) break;
    }

    // 무리에 번호 붙이기 — 계산 순서는 아무 뜻이 없으므로 다시 정합니다.
    // 변동성이 가장 큰 무리 → 2번. 나머지 중 수익률이 높은 쪽 → 0번.
    const order = U.range(k).sort(function (a, b) { return C[b][1] - C[a][1]; });
    const map = new Int32Array(k);
    map[order[0]] = 2;
    const rest = [order[1], order[2] !== undefined ? order[2] : order[1]];
    if (C[rest[0]][0] >= C[rest[1]][0]) { map[rest[0]] = 0; map[rest[1]] = 1; }
    else { map[rest[0]] = 1; map[rest[1]] = 0; }

    this.C = C; this.map = map; this.d = d;

    /*  이름은 미리 정해 두지 않고 무리의 실제 평균으로 붙입니다.
     *  "2번은 고변동이다"라고 못 박아 두면, 종목이나 기간에 따라 무리의 성격이
     *  달라졌을 때 이름과 내용이 어긋납니다. 숫자를 보고 이름을 붙이는 편이
     *  정직하고, 학생이 이름의 근거를 표에서 바로 확인할 수 있습니다. */
    const acc = [];
    for (let g = 0; g < k; g++) acc.push({ n: 0, ret: 0, vol: 0 });
    for (let i = 0; i < n; i++) {
      const g = map[assign[i]];
      acc[g].n++;
      acc[g].ret += raw[i][this.jRet];
      acc[g].vol += raw[i][this.jVol];
    }
    this.stats = acc.map(function (a, g) {
      const ret = a.n ? a.ret / a.n : NaN, vol = a.n ? a.vol / a.n : NaN;
      return { id: g, n: a.n, ret: ret, vol: vol, name: '' };
    });
    // 이름은 서로 견주어 붙입니다(절대 기준으로 붙이면 두 무리가 같은 이름이 될 수 있음).
    //   2번 = 변동성이 가장 큰 무리 · 0번 = 나머지 중 수익률이 높은 쪽 · 1번 = 그 반대
    if (this.stats.length === 3) {
      this.stats[2].name = (this.stats[2].ret < -0.02) ? '하락·고변동 국면' : '고변동 국면';
      this.stats[0].name = '상승 국면';
      this.stats[1].name = (this.stats[1].ret < -0.02) ? '하락 국면' : '횡보 국면';
    } else {
      this.stats.forEach(function (s) { s.name = (s.id + 1) + '번 국면'; });
    }
    return this;
  };
  KMeans.prototype.labels = function () {
    return (this.stats || []).map(function (s) { return s.name; });
  };

  KMeans.prototype.predict = function (test) {
    const Z = this._scale(this._coords(test.raw || test.X));
    const out = new Float64Array(Z.length), k = this.C.length, d = this.d;
    for (let i = 0; i < Z.length; i++) {
      let best = 0, bd = Infinity;
      for (let j = 0; j < k; j++) {
        let s = 0;
        for (let q = 0; q < d; q++) { const t = Z[i][q] - this.C[j][q]; s += t * t; }
        if (s < bd) { bd = s; best = j; }
      }
      out[i] = this.map[best];
    }
    return out;
  };
  KMeans.prototype.centers = function () { return this.C; };

  /* ========================================================================
   *  2) Isolation Forest — 혼자 뚝 떨어진 날 찾기
   *
   *  발상이 거꾸로입니다. 보통은 "정상은 어떤 모습인가"를 배운 뒤 거기서
   *  벗어난 것을 찾습니다. 이 모델은 그냥 **아무 기준으로나 데이터를 계속
   *  반으로 자릅니다.** 그리고 몇 번 만에 혼자 남는지를 셉니다.
   *
   *    평범한 날 → 비슷한 날이 잔뜩 있어서 혼자 남기까지 여러 번 잘라야 함
   *    이상한 날 → 몇 번만 잘라도 금방 혼자 떨어져 나옴
   *
   *  자르는 횟수가 짧을수록 이상 점수가 높습니다(0~1, 0.6 넘으면 눈여겨볼 만함).
   *  ★ '이상'이 곧 '위험'이나 '기회'는 아닙니다. 해석은 사람 몫입니다.
   * ======================================================================*/
  function IForest(params) {
    // 피처를 전부 넣으면 15차원이 되어 "혼자 떨어져 있다"는 판단이 흐려집니다.
    // 급등락을 찾는 것이 목적이니 하루 움직임·변동성 확대·거래량 급증만 봅니다.
    this.opt = Object.assign({
      trees: 100, sample: 256, seed: 42,
      cols: ['ret1', 'ret5', 'vol20', 'vol_ratio', 'vratio']
    }, params);
  }
  IForest.prototype._pick = function (X) {
    const ci = this.colIdx;
    const out = new Array(X.length);
    for (let i = 0; i < X.length; i++) {
      const row = new Float64Array(ci.length);
      for (let j = 0; j < ci.length; j++) row[j] = X[i][ci[j]];
      out[i] = row;
    }
    return out;
  };

  // 표본 n개를 무작위로 나눌 때 평균 몇 번 잘라야 하는지 (정규화 상수)
  function cFactor(n) {
    if (n <= 1) return 1;
    const H = Math.log(n - 1) + 0.5772156649;
    return 2 * H - (2 * (n - 1) / n);
  }

  IForest.prototype.fit = function (train, ctx) {
    const o = this.opt;
    const cols = (ctx && ctx.cols) || [];
    this.colIdx = o.cols.map(function (c) { return cols.indexOf(c); })
      .filter(function (i) { return i >= 0; });
    if (!this.colIdx.length) this.colIdx = U.range(train.X[0].length);

    const X = this._pick(train.X), n = X.length, p = X[0].length;
    const rnd = U.rng((ctx && ctx.seed) || o.seed);
    const m = Math.min(o.sample, n);
    const limit = Math.ceil(Math.log2(Math.max(m, 2)));
    this.trees = [];
    this.c = cFactor(m);

    const build = function (ids, depth) {
      if (depth >= limit || ids.length <= 1) return { leaf: true, size: ids.length };
      const f = rnd.int(p);
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < ids.length; i++) {
        const v = X[ids[i]][f];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (!(hi > lo)) return { leaf: true, size: ids.length };
      const split = lo + rnd() * (hi - lo);
      const L = [], R = [];
      for (let i = 0; i < ids.length; i++) (X[ids[i]][f] < split ? L : R).push(ids[i]);
      if (!L.length || !R.length) return { leaf: true, size: ids.length };
      return { leaf: false, f: f, split: split, L: build(L, depth + 1), R: build(R, depth + 1) };
    };

    for (let t = 0; t < o.trees; t++) {
      const ids = new Array(m);
      for (let i = 0; i < m; i++) ids[i] = rnd.int(n);
      this.trees.push(build(ids, 0));
    }
    return this;
  };

  IForest.prototype.predict = function (test) {
    const X = this._pick(test.X), out = new Float64Array(X.length);
    const trees = this.trees, c = this.c;
    for (let i = 0; i < X.length; i++) {
      let h = 0;
      for (let t = 0; t < trees.length; t++) {
        let node = trees[t], depth = 0;
        while (!node.leaf) {
          node = (X[i][node.f] < node.split) ? node.L : node.R;
          depth++;
        }
        h += depth + cFactor(node.size);      // 잎에 여러 개 남았으면 남은 만큼 보정
      }
      out[i] = Math.pow(2, -(h / trees.length) / c);
    }
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

  REG.impl('kmeans3', wrap(KMeans));
  REG.impl('iforest', wrap(IForest));

  root.REGIME = {
    LABELS: LABELS, LABEL_DESC: LABEL_DESC,
    KMeans: KMeans, IForest: IForest
  };
})(window.QL = window.QL || {});
