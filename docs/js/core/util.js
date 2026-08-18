/* ============================================================================
 *  util.js — 공통 도우미
 *  난수(시드 고정), 숫자 서식, 통계 함수, DOM 단축 함수
 *  파이썬 쪽 SEED=42 고정과 같은 목적: 같은 설정이면 같은 결과가 나오게 합니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = {};

  // --- 시드 고정 난수 (mulberry32) ------------------------------------------
  U.rng = function (seed) {
    let a = seed >>> 0;
    const f = function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    // 표준정규 (Box-Muller)
    f.normal = function () {
      let u = 0, v = 0;
      while (u === 0) u = f();
      while (v === 0) v = f();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    f.int = function (n) { return Math.floor(f() * n); };
    return f;
  };

  // --- 숫자 서식 -------------------------------------------------------------
  U.fmt = function (x, d) {
    if (x === null || x === undefined || !isFinite(x)) return '—';
    d = (d === undefined) ? 3 : d;
    return x.toFixed(d);
  };
  U.pct = function (x, d) {
    if (x === null || x === undefined || !isFinite(x)) return '—';
    d = (d === undefined) ? 2 : d;
    return (x * 100).toFixed(d) + '%';
  };
  U.signPct = function (x, d) {
    if (x === null || x === undefined || !isFinite(x)) return '—';
    return (x >= 0 ? '+' : '') + U.pct(x, d);
  };
  U.won = function (x) {
    if (!isFinite(x)) return '—';
    return Math.round(x).toLocaleString('ko-KR') + '원';
  };
  U.comma = function (x) {
    if (!isFinite(x)) return '—';
    return Math.round(x).toLocaleString('ko-KR');
  };
  U.compact = function (x) {
    const a = Math.abs(x);
    if (a >= 1e12) return (x / 1e12).toFixed(1) + '조';
    if (a >= 1e8) return (x / 1e8).toFixed(1) + '억';
    if (a >= 1e4) return (x / 1e4).toFixed(0) + '만';
    return U.comma(x);
  };

  // --- 배열/통계 -------------------------------------------------------------
  U.mean = function (a) {
    if (!a.length) return NaN;
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i];
    return s / a.length;
  };
  U.std = function (a, ddof) {
    ddof = ddof || 0;
    const n = a.length;
    if (n - ddof <= 0) return NaN;
    const m = U.mean(a);
    let s = 0;
    for (let i = 0; i < n; i++) { const d = a[i] - m; s += d * d; }
    return Math.sqrt(s / (n - ddof));
  };
  U.quantile = function (arr, q) {
    if (!arr.length) return NaN;
    const a = Float64Array.from(arr).sort();
    const pos = (a.length - 1) * q;
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    if (lo === hi) return a[lo];
    return a[lo] + (a[hi] - a[lo]) * (pos - lo);
  };
  U.sum = function (a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
  U.range = function (n) { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = i; return a; };
  U.clamp = function (x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); };

  // --- 분포 함수 -------------------------------------------------------------
  // 표준정규 누적분포 (오차함수 근사, Abramowitz & Stegun 7.1.26)
  U.normCdf = function (z) {
    const s = z < 0 ? -1 : 1;
    const x = Math.abs(z) / Math.SQRT2;
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return 0.5 * (1 + s * y);
  };
  // 양측 p값 (정규근사)
  U.twoSidedP = function (z) { return 2 * (1 - U.normCdf(Math.abs(z))); };

  // 두 집단 평균 비교 (Welch t검정, 정규근사 p값)
  U.welchT = function (a, b) {
    const na = a.length, nb = b.length;
    if (na < 2 || nb < 2) return { t: NaN, p: NaN, ma: NaN, mb: NaN };
    const ma = U.mean(a), mb = U.mean(b);
    const va = Math.pow(U.std(a, 1), 2), vb = Math.pow(U.std(b, 1), 2);
    const se = Math.sqrt(va / na + vb / nb);
    const t = se > 0 ? (ma - mb) / se : NaN;
    return { t: t, p: isFinite(t) ? U.twoSidedP(t) : NaN, ma: ma, mb: mb, na: na, nb: nb };
  };

  // 피어슨 상관계수와 그 p값(정규근사). 두 값이 함께 움직이는 정도.
  U.pearson = function (a, b) {
    const n = Math.min(a.length, b.length);
    if (n < 4) return { r: NaN, p: NaN, n: n };
    const ma = U.mean(a), mb = U.mean(b);
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < n; i++) {
      const da = a[i] - ma, db = b[i] - mb;
      sab += da * db; saa += da * da; sbb += db * db;
    }
    const r = (saa > 0 && sbb > 0) ? sab / Math.sqrt(saa * sbb) : NaN;
    if (!isFinite(r) || Math.abs(r) >= 1) return { r: r, p: 0, n: n };
    const t = r * Math.sqrt((n - 2) / (1 - r * r));
    return { r: r, p: U.twoSidedP(t), n: n };
  };

  // 이항검정(정규근사): 정확도가 기준선보다 유의하게 높은가
  U.binomP = function (successes, n, p0) {
    if (!n || !isFinite(p0)) return NaN;
    const se = Math.sqrt(p0 * (1 - p0) / n);
    if (se <= 0) return NaN;
    const z = (successes / n - p0) / se;
    return U.twoSidedP(z);
  };

  // --- 날짜 -----------------------------------------------------------------
  U.dstr = function (d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + dd;
  };
  U.parseDate = function (s) {
    const p = String(s).trim().slice(0, 10).split(/[-/.]/);
    if (p.length < 3) return null;
    const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return isNaN(d.getTime()) ? null : d;
  };

  // --- DOM ------------------------------------------------------------------
  U.$ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  U.$$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };
  U.el = function (tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  // 표 만들기: headers = [문자열], rows = [[값]]
  U.table = function (headers, rows, opts) {
    opts = opts || {};
    const numCls = opts.text ? '' : 'num';      // opts.text=true면 모든 칸을 왼쪽 정렬(글자 표)
    const t = U.el('table', 'tbl' + (opts.cls ? ' ' + opts.cls : ''));
    const thead = U.el('thead');
    const tr = U.el('tr');
    headers.forEach(function (h, j) {
      const th = U.el('th', j === 0 ? '' : numCls, h);
      tr.appendChild(th);
    });
    thead.appendChild(tr); t.appendChild(thead);
    const tb = U.el('tbody');
    rows.forEach(function (r) {
      const tr2 = U.el('tr');
      if (r.__cls) tr2.className = r.__cls;
      r.forEach(function (c, j) {
        const td = U.el('td', j === 0 ? '' : numCls);
        if (c && c.nodeType) td.appendChild(c);
        else td.innerHTML = (c === null || c === undefined) ? '' : String(c);
        tr2.appendChild(td);
      });
      tb.appendChild(tr2);
    });
    t.appendChild(tb);
    return t;
  };

  // 다음 프레임까지 양보 (긴 계산 중 화면이 멈추지 않게)
  U.yield_ = function () {
    return new Promise(function (res) { setTimeout(res, 0); });
  };

  // HTML에 그대로 넣어도 안전하도록 특수문자를 바꿔 줍니다.
  U.escape = function (s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  root.U = U;
})(window.QL = window.QL || {});
