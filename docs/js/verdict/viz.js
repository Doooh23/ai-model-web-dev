/* ============================================================================
 *  viz.js — 판정 페이지 전용 그림
 *
 *  캔버스를 쓰지 않고 SVG 로 그립니다. 이 페이지의 그림은 전부
 *  "값이 기준선의 어느 쪽에 있는가" 하나만 말하면 되므로, 애니메이션도
 *  다시 그리기도 필요하지 않고 인쇄와 확대에 강한 쪽이 낫습니다.
 *
 *  색으로 모델을 구분하지 않습니다 — 한 그림에 여러 모델이 색으로 겹치면
 *  색각 이상에서 구분이 무너지기 때문에, 모델은 이름표로 구분하고
 *  색은 "기준선 대비 어느 쪽인가"에만 씁니다.
 * ==========================================================================*/
(function (root) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const V = {};

  function el(tag, attrs, text) {
    const e = document.createElementNS(NS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
    });
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function svg(w, h, minW) {
    const s = el('svg', {
      viewBox: '0 0 ' + w + ' ' + h, role: 'img',
      preserveAspectRatio: 'xMidYMid meet'
    });
    s.style.minWidth = (minW || Math.min(w, 520)) + 'px';
    return s;
  }
  function title(node, txt) { node.appendChild(el('title', null, txt)); return node; }
  const f = function (v, n) { return (v === null || v === undefined || !isFinite(v)) ? '—' : v.toFixed(n === undefined ? 3 : n); };
  const pc = function (v, n) { return (!isFinite(v)) ? '—' : (v * 100).toFixed(n === undefined ? 1 : n) + '%'; };

  /* ------------------------------------------------------------------------
   *  떠 있는 설명 상자 — 모든 그림이 함께 씁니다.
   *  마크에 data-tip 을 달아 두면 알아서 붙습니다.
   * ----------------------------------------------------------------------*/
  function wire(host, node) {
    let tip = host.querySelector('.vtip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'vtip';
      tip.setAttribute('role', 'status');
      host.appendChild(tip);
      host.style.position = 'relative';
    }
    const show = function (e) {
      const t = e.currentTarget.getAttribute('data-tip');
      if (!t) return;
      tip.innerHTML = t;
      tip.classList.add('on');
      const hb = host.getBoundingClientRect();
      const mb = e.currentTarget.getBoundingClientRect();
      const x = mb.left - hb.left + mb.width / 2;
      const y = mb.top - hb.top;
      tip.style.left = Math.max(6, Math.min(hb.width - tip.offsetWidth - 6, x - tip.offsetWidth / 2)) + 'px';
      tip.style.top = Math.max(2, y - tip.offsetHeight - 8) + 'px';
    };
    const hide = function () { tip.classList.remove('on'); };
    node.querySelectorAll('[data-tip]').forEach(function (m) {
      m.setAttribute('tabindex', '0');
      m.addEventListener('mouseenter', show);
      m.addEventListener('focus', show);
      m.addEventListener('mouseleave', hide);
      m.addEventListener('blur', hide);
    });
  }

  function mount(host, node) {
    host.innerHTML = '';
    host.appendChild(node);
    wire(host, node);
    return node;
  }

  /* ------------------------------------------------------------------------
   *  1) 신뢰구간 도표 — 값 하나 + 구간 하나를 기준선과 견줍니다
   *
   *  rows: [{ name, value, lo, hi, base, note, tip }]
   *  opt : { ref, refLabel, domain:[lo,hi], unit, caption }
   * ----------------------------------------------------------------------*/
  V.ci = function (host, rows, opt) {
    opt = opt || {};
    const ref = opt.ref === undefined ? 0.5 : opt.ref;
    const LAB = 148, RIGHT = 118, PAD = 20;
    const W = 760, ROW = 34, TOP = 46;
    const H = TOP + rows.length * ROW + 26;
    const x0 = LAB + PAD, x1 = W - RIGHT - PAD;

    let lo = ref, hi = ref;
    rows.forEach(function (r) {
      [r.lo, r.hi, r.value].forEach(function (v) {
        if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      });
    });
    const pad = Math.max((hi - lo) * 0.12, 0.004);
    lo -= pad; hi += pad;
    const X = function (v) { return x0 + (v - lo) / (hi - lo) * (x1 - x0); };

    const s = svg(W, H, 620);
    s.setAttribute('aria-label', opt.aria || '신뢰구간 도표');

    // 눈금
    const step = niceStep(hi - lo);
    for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) {
      if (Math.abs(t - ref) < step * 0.35) continue;      // 기준선 눈금과 겹치면 생략
      const x = X(t);
      s.appendChild(el('line', { x1: x, y1: TOP - 12, x2: x, y2: H - 24, class: 'g-line' }));
      s.appendChild(el('text', { x: x, y: TOP - 18, 'text-anchor': 'middle', class: 't-mut' }, f(t, 2)));
    }

    // 기준선 — 이 그림에서 가장 굵은 선
    const rx = X(ref);
    s.appendChild(el('line', { x1: rx, y1: TOP - 12, x2: rx, y2: H - 24, class: 'g-base' }));
    s.appendChild(el('text', { x: rx, y: TOP - 18, 'text-anchor': 'middle', class: 't-num' }, f(ref, 2)));
    s.appendChild(el('text', { x: rx, y: H - 8, 'text-anchor': 'middle', class: 't-sub' },
      opt.refLabel || '기준선'));

    rows.forEach(function (r, i) {
      const y = TOP + i * ROW + ROW / 2;
      const g = el('g', {
        'data-tip': r.tip || (r.name + ' · ' + f(r.value, 4)),
        class: r.base ? 'ci-row base' : 'ci-row'
      });
      title(g, r.name + ' ' + f(r.value, 4) + (isFinite(r.lo) ? ' (95% 구간 ' + f(r.lo, 3) + '~' + f(r.hi, 3) + ')' : ''));

      // 이름표
      g.appendChild(el('text', { x: LAB, y: y + 4, 'text-anchor': 'end',
        class: r.base ? 't-sub' : 't-lab' }, r.name));

      // 구간
      if (isFinite(r.lo) && isFinite(r.hi)) {
        g.appendChild(el('line', { x1: X(r.lo), y1: y, x2: X(r.hi), y2: y,
          class: 'ci-w' + (r.base ? ' base' : '') }));
        [r.lo, r.hi].forEach(function (v) {
          g.appendChild(el('line', { x1: X(v), y1: y - 5, x2: X(v), y2: y + 5,
            class: 'ci-w' + (r.base ? ' base' : '') }));
        });
      }
      // 점 — 지름 10px
      g.appendChild(el('circle', { cx: X(r.value), cy: y, r: 5,
        class: 'ci-d' + (r.base ? ' base' : '') }));

      // 오른쪽 수치
      g.appendChild(el('text', { x: W - RIGHT + 8, y: y + 4, class: 't-num' }, f(r.value, 4)));
      if (r.note) g.appendChild(el('text', { x: W - 6, y: y + 4, 'text-anchor': 'end', class: 't-mut' }, r.note));

      s.appendChild(g);
    });

    return mount(host, s);
  };

  function niceStep(span) {
    const raw = span / 5;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  }

  /* ------------------------------------------------------------------------
   *  2) 아령 도표 — 학습 구간과 시험 구간을 점 두 개로 잇습니다
   *
   *  막대를 쓰지 않는 이유: 가로축이 0에서 시작하지 않으므로 막대 길이가
   *  값에 비례하지 않습니다. 점 두 개와 그 사이를 잇는 선으로 바꾸면
   *  "간격" 자체가 선의 길이로 그대로 보입니다.
   *
   *  rows: [{ name, a(학습), b(시험), missing }]
   * ----------------------------------------------------------------------*/
  V.pair = function (host, rows, opt) {
    opt = opt || {};
    const ref = opt.ref === undefined ? 0.5 : opt.ref;
    const LAB = 148, RIGHT = 196, PAD = 22;
    const W = 800, ROW = 40, TOP = 48;
    const H = TOP + rows.length * ROW + 40;
    const x0 = LAB + PAD, x1 = W - RIGHT - PAD;

    let lo = ref, hi = ref;
    rows.forEach(function (r) {
      [r.a, r.b].forEach(function (v) { if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
    });
    const pad = Math.max((hi - lo) * 0.1, 0.01); lo -= pad; hi += pad;
    const X = function (v) { return x0 + (v - lo) / (hi - lo) * (x1 - x0); };

    const s = svg(W, H, 660);
    s.setAttribute('aria-label', opt.aria || '학습 구간과 시험 구간의 성적');

    const step = niceStep(hi - lo);
    for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) {
      if (Math.abs(t - ref) < step * 0.35) continue;
      const x = X(t);
      s.appendChild(el('line', { x1: x, y1: TOP - 12, x2: x, y2: H - 32, class: 'g-line' }));
      s.appendChild(el('text', { x: x, y: TOP - 18, 'text-anchor': 'middle', class: 't-mut' }, f(t, 2)));
    }
    const rx = X(ref);
    s.appendChild(el('line', { x1: rx, y1: TOP - 12, x2: rx, y2: H - 32, class: 'g-base' }));
    s.appendChild(el('text', { x: rx, y: TOP - 18, 'text-anchor': 'middle', class: 't-num' }, f(ref, 2)));


    rows.forEach(function (r, i) {
      const y = TOP + i * ROW + ROW / 2 - 4;
      const g = el('g');
      g.appendChild(el('text', { x: LAB, y: y + 4, 'text-anchor': 'end', class: 't-lab' }, r.name));

      if (r.missing) {
        g.appendChild(el('text', { x: x0, y: y + 4, class: 't-mut' }, r.missing));
        s.appendChild(g);
        return;
      }
      const xa = X(r.a), xb = X(r.b), d = r.a - r.b;
      const mk = el('g', { 'data-tip': '<b>' + r.name + '</b><br>학습 구간 ' + f(r.a, 4) +
        '<br>시험 구간 ' + f(r.b, 4) + '<br>간격 ' + (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(3) });
      title(mk, r.name + ' 학습 ' + f(r.a, 4) + ' · 시험 ' + f(r.b, 4));
      mk.appendChild(el('line', { x1: xa, y1: y, x2: xb, y2: y, class: 'dbell' }));
      mk.appendChild(el('circle', { cx: xa, cy: y, r: 5, class: 'dot a' }));
      mk.appendChild(el('circle', { cx: xb, cy: y, r: 5, class: 'dot b' }));
      g.appendChild(mk);

      g.appendChild(el('text', { x: W - RIGHT + 88, y: y + 4, 'text-anchor': 'end', class: 't-num' },
        f(r.a, 4) + ' → ' + f(r.b, 4)));
      g.appendChild(el('text', { x: W - 8, y: y + 4, 'text-anchor': 'end', class: 't-num' },
        '간격 ' + (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(3)));
      s.appendChild(g);
    });

    // 범례 — 두 계열이므로 항상 둡니다. 눈금과 겹치지 않게 아래에 둡니다.
    const ly = H - 12;
    s.appendChild(el('circle', { cx: x0 + 5, cy: ly - 4, r: 5, class: 'dot a' }));
    s.appendChild(el('text', { x: x0 + 16, y: ly, class: 't-sub' }, '학습 구간 (배운 자료)'));
    s.appendChild(el('circle', { cx: x0 + 155, cy: ly - 4, r: 5, class: 'dot b' }));
    s.appendChild(el('text', { x: x0 + 166, y: ly, class: 't-sub' }, '시험 구간 (처음 보는 자료)'));
    s.appendChild(el('text', { x: rx, y: TOP - 32, 'text-anchor': 'middle', class: 't-sub' }, '기준선'));

    return mount(host, s);
  };

  /* ------------------------------------------------------------------------
   *  3) 겹 격자 — 모델 × 폴드, 기준선을 넘었으면 채웁니다
   *  models: [{ name, cells:[{auc, n, from, to}] }]
   * ----------------------------------------------------------------------*/
  V.grid = function (host, models, opt) {
    opt = opt || {};
    const ref = opt.ref === undefined ? 0.5 : opt.ref;
    const nF = models[0] ? models[0].cells.length : 0;
    const LAB = 148, CELL = 74, GAPX = 6, TOP = 44, ROW = 40;
    const W = LAB + 20 + nF * (CELL + GAPX) + 96;
    const H = TOP + models.length * ROW + 34;

    const s = svg(W, H, Math.min(W, 660));
    s.setAttribute('aria-label', opt.aria || '겹별 성적 격자');

    for (let k = 0; k < nF; k++) {
      const x = LAB + 20 + k * (CELL + GAPX);
      s.appendChild(el('text', { x: x + CELL / 2, y: TOP - 16, 'text-anchor': 'middle', class: 't-sub' },
        (k + 1) + '겹'));
      const c = models[0].cells[k];
      if (c && c.from) s.appendChild(el('text', { x: x + CELL / 2, y: TOP - 3, 'text-anchor': 'middle', class: 't-mut' },
        String(c.from).slice(2, 7)));
    }

    models.forEach(function (m, i) {
      const y = TOP + i * ROW;
      s.appendChild(el('text', { x: LAB, y: y + 21, 'text-anchor': 'end', class: 't-lab' }, m.name));
      let won = 0;
      m.cells.forEach(function (c, k) {
        const x = LAB + 20 + k * (CELL + GAPX);
        const hit = isFinite(c.auc) && c.auc > ref;
        if (hit) won++;
        const g = el('g', { 'data-tip': '<b>' + m.name + '</b> · ' + (k + 1) + '겹<br>AUC ' + f(c.auc, 4)
          + '<br>' + (c.from || '') + ' ~ ' + (c.to || '') + ' · ' + (c.n || 0) + '일' });
        title(g, m.name + ' ' + (k + 1) + '겹 AUC ' + f(c.auc, 4));
        g.appendChild(el('rect', { x: x, y: y + 4, width: CELL, height: 28, rx: 3,
          class: 'cell' + (hit ? ' hit' : '') }));
        g.appendChild(el('text', { x: x + CELL / 2, y: y + 22, 'text-anchor': 'middle',
          class: hit ? 't-num hitn' : 't-num' }, f(c.auc, 3)));
        s.appendChild(g);
      });
      s.appendChild(el('text', { x: W - 8, y: y + 22, 'text-anchor': 'end', class: 't-sub' },
        won + '/' + nF));
    });

    const ly = H - 12;
    s.appendChild(el('rect', { x: LAB + 20, y: ly - 10, width: 12, height: 10, rx: 2, class: 'cell hit' }));
    s.appendChild(el('text', { x: LAB + 38, y: ly - 1, class: 't-sub' }, '기준선(' + f(ref, 2) + ') 초과'));
    s.appendChild(el('rect', { x: LAB + 150, y: ly - 10, width: 12, height: 10, rx: 2, class: 'cell' }));
    s.appendChild(el('text', { x: LAB + 168, y: ly - 1, class: 't-sub' }, '미달'));

    return mount(host, s);
  };

  /* ------------------------------------------------------------------------
   *  4) 누적 곡선 한 칸 — 모델 하나 + 회색 기준선 하나
   *     여러 모델을 한 그림에 겹치지 않습니다(색으로 구분할 것을 만들지 않음).
   * ----------------------------------------------------------------------*/
  V.spark = function (host, model, ref, opt) {
    opt = opt || {};
    const W = 300, H = 132, L = 6, R = 6, T = 8, B = 18;
    const n = model.length;
    if (!n) { host.innerHTML = '<div class="empty">자료 없음</div>'; return null; }

    let lo = Infinity, hi = -Infinity;
    [model, ref].forEach(function (a) {
      for (let i = 0; i < a.length; i++) { if (a[i] < lo) lo = a[i]; if (a[i] > hi) hi = a[i]; }
    });
    if (opt.lo !== undefined) lo = opt.lo;
    if (opt.hi !== undefined) hi = opt.hi;
    const span = (hi - lo) || 1;
    const X = function (i) { return L + i / (n - 1) * (W - L - R); };
    const Y = function (v) { return T + (1 - (v - lo) / span) * (H - T - B); };
    const path = function (a) {
      let d = '';
      for (let i = 0; i < a.length; i++) d += (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(a[i]).toFixed(1);
      return d;
    };

    const s = svg(W, H, 220);
    s.setAttribute('aria-label', opt.aria || '누적 수익 곡선');
    s.appendChild(el('line', { x1: L, y1: Y(1), x2: W - R, y2: Y(1), class: 'g-line' }));
    s.appendChild(el('path', { d: path(ref), class: 'ln ref' }));
    s.appendChild(el('path', { d: path(model), class: 'ln own' }));
    s.appendChild(el('text', { x: L, y: H - 5, class: 't-mut' }, opt.from || ''));
    s.appendChild(el('text', { x: W - R, y: H - 5, 'text-anchor': 'end', class: 't-mut' }, opt.to || ''));
    host.innerHTML = '';
    host.appendChild(s);
    return s;
  };

  V.fmt = { f: f, pc: pc };
  root.VIZ = V;
})(window.QL = window.QL || {});
