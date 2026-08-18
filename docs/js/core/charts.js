/* ============================================================================
 *  charts.js — 그래프 그리기 (외부 라이브러리 없이 캔버스로 직접)
 *   - 선 그래프(여러 계열 + 십자선 툴팁)
 *   - 막대 그래프
 *   - ROC 곡선
 *   - 히스토그램
 *  색·눈금선 색은 CSS 변수에서 읽어 오므로 밝은 화면/어두운 화면 모두 맞습니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U;
  const C = {};

  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  C.seriesColor = function (i) { return cssVar('--series-' + ((i % 8) + 1), '#2a78d6'); };
  // 캔버스는 CSS 변수(var(--x))를 이해하지 못하므로 실제 색 값으로 바꿔서 넘겨야 합니다.
  C.mutedColor = function () { return cssVar('--text-muted', '#898781'); };

  function theme() {
    return {
      surface: cssVar('--surface-1', '#fcfcfb'),
      grid: cssVar('--gridline', '#e1e0d9'),
      axis: cssVar('--axisline', '#c3c2b7'),
      muted: cssVar('--text-muted', '#898781'),
      text: cssVar('--text-primary', '#0b0b0b'),
      sec: cssVar('--text-secondary', '#52514e')
    };
  }

  function setup(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(240, rect.width), h = Math.max(120, rect.height || canvas.clientHeight || 240);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.font = '12px system-ui, -apple-system, "Segoe UI", sans-serif';
    return { ctx: ctx, w: w, h: h };
  }

  function niceTicks(min, max, count) {
    if (!isFinite(min) || !isFinite(max)) return [0];
    if (min === max) { min -= 1; max += 1; }
    const span = max - min;
    const raw = span / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(v);
    return out;
  }

  // 툴팁(하나만 만들어 재사용)
  let tipEl = null;
  function tooltip() {
    if (!tipEl) {
      tipEl = U.el('div', 'chart-tip');
      tipEl.style.display = 'none';
      document.body.appendChild(tipEl);
    }
    return tipEl;
  }
  function showTip(html, x, y) {
    const t = tooltip();
    t.innerHTML = html;
    t.style.display = 'block';
    const r = t.getBoundingClientRect();
    let left = x + 14, top = y - r.height - 10;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (top < 8) top = y + 16;
    t.style.left = left + 'px';
    t.style.top = top + 'px';
  }
  function hideTip() { if (tipEl) tipEl.style.display = 'none'; }
  C.hideTip = hideTip;

  /* ==========================================================================
   *  선 그래프
   *  opt = {
   *    labels: [문자열],                       // x축 이름표 (날짜 등)
   *    series: [{name, values, color, width, dash, area}],
   *    yFmt: 함수, yLabel: 문자열, legend: true,
   *    marks: [{index, color, label}],         // 세로 표시선
   *    log: false
   *  }
   * ========================================================================*/
  C.line = function (canvas, opt) {
    const draw = function () {
      const s = setup(canvas), ctx = s.ctx, th = theme();
      const series = opt.series.filter(function (x) { return x && x.values && x.values.length; });
      if (!series.length) return;
      const n = series[0].values.length;
      const padL = opt.padL || 58, padR = 14, padT = 12, padB = 30;
      const W = s.w - padL - padR, H = s.h - padT - padB;

      let min = Infinity, max = -Infinity;
      series.forEach(function (se) {
        for (let i = 0; i < se.values.length; i++) {
          const v = se.values[i];
          if (isFinite(v)) { if (v < min) min = v; if (v > max) max = v; }
        }
      });
      if (opt.yMin !== undefined) min = Math.min(min, opt.yMin);
      if (opt.yMax !== undefined) max = Math.max(max, opt.yMax);
      if (!isFinite(min) || !isFinite(max)) return;
      const pad = (max - min) * 0.06 || Math.abs(max) * 0.06 || 1;
      min -= pad; max += pad;

      const X = function (i) { return padL + (n <= 1 ? W / 2 : (i / (n - 1)) * W); };
      const Y = function (v) { return padT + H - ((v - min) / (max - min)) * H; };

      // 눈금선 (가로만, 얇게)
      const ticks = niceTicks(min, max, 5);
      ctx.strokeStyle = th.grid; ctx.lineWidth = 1; ctx.fillStyle = th.muted;
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ticks.forEach(function (t) {
        const y = Math.round(Y(t)) + 0.5;
        if (y < padT || y > padT + H) return;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + W, y); ctx.stroke();
        ctx.fillText(opt.yFmt ? opt.yFmt(t) : U.fmt(t, 2), padL - 8, y);
      });

      // 기준선(0 또는 지정값) 강조
      if (opt.zeroLine !== undefined && opt.zeroLine >= min && opt.zeroLine <= max) {
        ctx.strokeStyle = th.axis; ctx.lineWidth = 1;
        const y = Math.round(Y(opt.zeroLine)) + 0.5;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + W, y); ctx.stroke();
      }

      // 세로 표시선 (예: 학습/시험 구분선)
      (opt.marks || []).forEach(function (mk) {
        const x = Math.round(X(mk.index)) + 0.5;
        ctx.save();
        ctx.strokeStyle = mk.color || th.axis;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + H); ctx.stroke();
        if (mk.label) {
          ctx.fillStyle = th.sec; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
          ctx.fillText(mk.label, Math.min(x + 5, padL + W - 90), padT + 2);
        }
        ctx.restore();
      });

      // x축 이름표
      if (opt.labels && opt.labels.length) {
        ctx.fillStyle = th.muted; ctx.textBaseline = 'top'; ctx.textAlign = 'center';
        const cnt = Math.max(2, Math.min(6, Math.floor(W / 90)));
        for (let k = 0; k < cnt; k++) {
          const i = Math.round(k * (n - 1) / (cnt - 1));
          let x = X(i);
          x = U.clamp(x, padL + 20, padL + W - 20);
          ctx.fillText(opt.labels[i], x, padT + H + 8);
        }
      }

      // 각 계열
      series.forEach(function (se, si) {
        const color = se.color || C.seriesColor(si);
        if (se.area) {
          ctx.beginPath();
          let started = false;
          for (let i = 0; i < n; i++) {
            const v = se.values[i];
            if (!isFinite(v)) continue;
            if (!started) { ctx.moveTo(X(i), Y(v)); started = true; } else ctx.lineTo(X(i), Y(v));
          }
          ctx.lineTo(X(n - 1), padT + H); ctx.lineTo(X(0), padT + H); ctx.closePath();
          ctx.globalAlpha = 0.10; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1;
        }
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = se.width || 2;
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        if (se.dash) ctx.setLineDash(se.dash); else ctx.setLineDash([]);
        let pen = false;
        for (let i = 0; i < n; i++) {
          const v = se.values[i];
          if (!isFinite(v)) { pen = false; continue; }
          if (!pen) { ctx.moveTo(X(i), Y(v)); pen = true; } else ctx.lineTo(X(i), Y(v));
        }
        ctx.stroke();
        ctx.setLineDash([]);
      });

      canvas.__chart = { X: X, Y: Y, n: n, padL: padL, padT: padT, W: W, H: H, series: series, min: min, max: max };
    };

    draw();
    canvas.__redraw = draw;
    if (!canvas.__bound) {
      canvas.__bound = true;
      canvas.addEventListener('mousemove', function (ev) {
        const c = canvas.__chart;
        if (!c || !canvas.__opt) return;
        const rect = canvas.getBoundingClientRect();
        const mx = ev.clientX - rect.left;
        let i = Math.round((mx - c.padL) / (c.W || 1) * (c.n - 1));
        i = U.clamp(i, 0, c.n - 1);
        const o = canvas.__opt;
        let html = '<div class="tip-h">' + ((o.labels && o.labels[i]) || ('#' + i)) + '</div>';
        c.series.forEach(function (se, si) {
          const v = se.values[i];
          if (!isFinite(v)) return;
          html += '<div class="tip-r"><span class="dot" style="background:' + (se.color || C.seriesColor(si)) + '"></span>' +
            '<span class="tip-n">' + se.name + '</span><span class="tip-v">' +
            (o.tipFmt ? o.tipFmt(v, se, i) : (o.yFmt ? o.yFmt(v) : U.fmt(v, 3))) + '</span></div>';
        });
        showTip(html, ev.clientX, ev.clientY);
        // 십자선
        draw();
        const ctx = canvas.getContext('2d');
        const th = theme();
        ctx.save();
        ctx.strokeStyle = th.axis; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.round(c.X(i)) + 0.5, c.padT);
        ctx.lineTo(Math.round(c.X(i)) + 0.5, c.padT + c.H);
        ctx.stroke();
        c.series.forEach(function (se, si) {
          const v = se.values[i];
          if (!isFinite(v)) return;
          ctx.beginPath();
          ctx.arc(c.X(i), c.Y(v), 4.5, 0, Math.PI * 2);
          ctx.fillStyle = se.color || C.seriesColor(si);
          ctx.fill();
          ctx.lineWidth = 2; ctx.strokeStyle = th.surface; ctx.stroke();
        });
        ctx.restore();
      });
      canvas.addEventListener('mouseleave', function () { hideTip(); if (canvas.__redraw) canvas.__redraw(); });
    }
    canvas.__opt = opt;
    C.observe(canvas);
  };

  /* ==========================================================================
   *  막대 그래프 (가로 막대: 이름이 길어도 읽기 좋게)
   *  items = [{label, value, color, note}]
   * ========================================================================*/
  C.bars = function (canvas, opt) {
    const draw = function () {
      const s = setup(canvas), ctx = s.ctx, th = theme();
      const items = opt.items || [];
      if (!items.length) return;
      const padL = opt.padL || 130, padR = 62, padT = 8, padB = 8;
      const W = s.w - padL - padR, H = s.h - padT - padB;
      const band = H / items.length;
      const thick = Math.min(24, band * 0.62);

      let lo = 0, hi = 0;
      items.forEach(function (it) { if (it.value < lo) lo = it.value; if (it.value > hi) hi = it.value; });
      if (opt.xMin !== undefined) lo = Math.min(lo, opt.xMin);
      if (opt.xMax !== undefined) hi = Math.max(hi, opt.xMax);
      if (hi === lo) hi = lo + 1;
      const zero = opt.baseValue !== undefined ? opt.baseValue : (lo < 0 ? 0 : lo);
      const X = function (v) { return padL + ((v - lo) / (hi - lo)) * W; };

      // 기준선
      ctx.strokeStyle = th.axis; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(X(zero)) + 0.5, padT);
      ctx.lineTo(Math.round(X(zero)) + 0.5, padT + H);
      ctx.stroke();

      items.forEach(function (it, i) {
        const cy = padT + band * i + band / 2;
        const x0 = X(zero), x1 = X(it.value);
        const left = Math.min(x0, x1), width = Math.max(1, Math.abs(x1 - x0));
        const color = it.color || C.seriesColor(0);
        const r = Math.min(4, width / 2, thick / 2);
        ctx.fillStyle = color;
        ctx.beginPath();
        // 데이터 끝만 둥글게, 기준선 쪽은 각지게
        if (x1 >= x0) {
          ctx.moveTo(left, cy - thick / 2);
          ctx.lineTo(left + width - r, cy - thick / 2);
          ctx.quadraticCurveTo(left + width, cy - thick / 2, left + width, cy - thick / 2 + r);
          ctx.lineTo(left + width, cy + thick / 2 - r);
          ctx.quadraticCurveTo(left + width, cy + thick / 2, left + width - r, cy + thick / 2);
          ctx.lineTo(left, cy + thick / 2);
        } else {
          ctx.moveTo(left + width, cy - thick / 2);
          ctx.lineTo(left + r, cy - thick / 2);
          ctx.quadraticCurveTo(left, cy - thick / 2, left, cy - thick / 2 + r);
          ctx.lineTo(left, cy + thick / 2 - r);
          ctx.quadraticCurveTo(left, cy + thick / 2, left + r, cy + thick / 2);
          ctx.lineTo(left + width, cy + thick / 2);
        }
        ctx.closePath(); ctx.fill();

        ctx.fillStyle = th.sec; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText(it.label, padL - 10, cy);
        ctx.fillStyle = th.text; ctx.textAlign = 'left';
        const vtxt = opt.vFmt ? opt.vFmt(it.value) : U.fmt(it.value, 3);
        ctx.fillText(vtxt, Math.max(x0, x1) + 8, cy);
      });
    };
    draw();
    canvas.__redraw = draw;
    C.observe(canvas);
  };

  /* ==========================================================================
   *  ROC 곡선 — 대각선(실력 없음)과 비교해서 봅니다
   * ========================================================================*/
  C.roc = function (canvas, curves) {
    const draw = function () {
      const s = setup(canvas), ctx = s.ctx, th = theme();
      const pad = 40, W = s.w - pad - 14, H = s.h - pad - 26;
      const X = function (v) { return pad + v * W; };
      const Y = function (v) { return 26 + H - v * H; };

      ctx.strokeStyle = th.grid; ctx.lineWidth = 1; ctx.fillStyle = th.muted;
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      [0, 0.25, 0.5, 0.75, 1].forEach(function (t) {
        const y = Math.round(Y(t)) + 0.5;
        ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(pad + W, y); ctx.stroke();
        ctx.fillText(t.toFixed(2), pad - 8, y);
      });
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      [0, 0.5, 1].forEach(function (t) { ctx.fillText(t.toFixed(1), X(t), 26 + H + 6); });

      // 대각선 = 실력 없음(AUC 0.5)
      ctx.save();
      ctx.strokeStyle = th.axis; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(1), Y(1)); ctx.stroke();
      ctx.restore();

      curves.forEach(function (c, i) {
        ctx.beginPath();
        ctx.strokeStyle = c.color || C.seriesColor(i);
        ctx.lineWidth = 2; ctx.lineJoin = 'round';
        c.points.forEach(function (p, k) { if (k === 0) ctx.moveTo(X(p.x), Y(p.y)); else ctx.lineTo(X(p.x), Y(p.y)); });
        ctx.stroke();
      });
      ctx.fillStyle = th.muted; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('가로: 틀리게 상승이라 한 비율   세로: 맞게 상승이라 한 비율', pad, 4);
    };
    draw();
    canvas.__redraw = draw;
    C.observe(canvas);
  };

  /* ==========================================================================
   *  히스토그램 (두 집단 비교용)
   * ========================================================================*/
  C.hist = function (canvas, groups, opt) {
    opt = opt || {};
    const draw = function () {
      const s = setup(canvas), ctx = s.ctx, th = theme();
      const all = [];
      groups.forEach(function (g) { for (let i = 0; i < g.values.length; i++) if (isFinite(g.values[i])) all.push(g.values[i]); });
      if (!all.length) return;
      const lo = U.quantile(all, 0.005), hi = U.quantile(all, 0.995);
      const bins = opt.bins || 34;
      const padL = 46, padR = 12, padT = 10, padB = 28;
      const W = s.w - padL - padR, H = s.h - padT - padB;
      const counts = groups.map(function (g) {
        const c = new Float64Array(bins);
        let tot = 0;
        for (let i = 0; i < g.values.length; i++) {
          const v = g.values[i];
          if (!isFinite(v)) continue;
          let b = Math.floor((v - lo) / (hi - lo) * bins);
          b = U.clamp(b, 0, bins - 1); c[b]++; tot++;
        }
        if (tot) for (let b = 0; b < bins; b++) c[b] /= tot;   // 비율로 (표본 수가 달라도 비교 가능)
        return c;
      });
      let mx = 0;
      counts.forEach(function (c) { for (let b = 0; b < bins; b++) if (c[b] > mx) mx = c[b]; });
      const bw = W / bins;

      ctx.strokeStyle = th.grid; ctx.lineWidth = 1; ctx.fillStyle = th.muted;
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      niceTicks(0, mx, 4).forEach(function (t) {
        const y = Math.round(padT + H - (t / mx) * H) + 0.5;
        if (y < padT) return;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + W, y); ctx.stroke();
        ctx.fillText(U.pct(t, 0), padL - 6, y);
      });

      counts.forEach(function (c, gi) {
        ctx.fillStyle = groups[gi].color || C.seriesColor(gi);
        ctx.globalAlpha = gi === 0 ? 0.75 : 0.5;
        for (let b = 0; b < bins; b++) {
          const h = (c[b] / mx) * H;
          if (h <= 0) continue;
          ctx.fillRect(padL + b * bw + 1, padT + H - h, Math.max(1, bw - 2), h);
        }
      });
      ctx.globalAlpha = 1;
      ctx.fillStyle = th.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      [0, 0.5, 1].forEach(function (f) {
        ctx.fillText(opt.xFmt ? opt.xFmt(lo + (hi - lo) * f) : U.fmt(lo + (hi - lo) * f, 2), padL + W * f, padT + H + 6);
      });
    };
    draw();
    canvas.__redraw = draw;
    C.observe(canvas);
  };

  /* ==========================================================================
   *  산점도 — 두 값의 관계를 볼 때 (예: 성명서 톤 vs 익일 수익률)
   *  points = [{x, y, label}]
   * ========================================================================*/
  C.scatter = function (canvas, opt) {
    const draw = function () {
      const s = setup(canvas), ctx = s.ctx, th = theme();
      const pts = opt.points || [];
      if (!pts.length) return;
      const padL = 56, padR = 16, padT = 12, padB = 34;
      const W = s.w - padL - padR, H = s.h - padT - padB;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      pts.forEach(function (p) {
        if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
        if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
      });
      const px = (x1 - x0) * 0.08 || 0.01, py = (y1 - y0) * 0.08 || 0.01;
      x0 -= px; x1 += px; y0 -= py; y1 += py;
      const X = function (v) { return padL + ((v - x0) / (x1 - x0)) * W; };
      const Y = function (v) { return padT + H - ((v - y0) / (y1 - y0)) * H; };

      ctx.strokeStyle = th.grid; ctx.lineWidth = 1; ctx.fillStyle = th.muted;
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      niceTicks(y0, y1, 5).forEach(function (t) {
        const y = Math.round(Y(t)) + 0.5;
        if (y < padT || y > padT + H) return;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + W, y); ctx.stroke();
        ctx.fillText(opt.yFmt ? opt.yFmt(t) : U.fmt(t, 2), padL - 8, y);
      });
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      niceTicks(x0, x1, 5).forEach(function (t) {
        const x = X(t);
        if (x < padL || x > padL + W) return;
        ctx.fillText(opt.xFmt ? opt.xFmt(t) : U.fmt(t, 2), x, padT + H + 8);
      });

      // 0 기준선 (있을 때만)
      ctx.strokeStyle = th.axis;
      if (0 > y0 && 0 < y1) { const y = Math.round(Y(0)) + 0.5; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + W, y); ctx.stroke(); }
      if (0 > x0 && 0 < x1) { const x = Math.round(X(0)) + 0.5; ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + H); ctx.stroke(); }

      // 추세선 (최소제곱)
      if (opt.trend !== false && pts.length > 3) {
        let sx = 0, sy = 0, sxy = 0, sxx = 0;
        pts.forEach(function (p) { sx += p.x; sy += p.y; sxy += p.x * p.y; sxx += p.x * p.x; });
        const nP = pts.length;
        const den = nP * sxx - sx * sx;
        if (Math.abs(den) > 1e-12) {
          const b = (nP * sxy - sx * sy) / den, a = (sy - b * sx) / nP;
          ctx.save();
          ctx.strokeStyle = th.muted; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
          ctx.beginPath(); ctx.moveTo(X(x0), Y(a + b * x0)); ctx.lineTo(X(x1), Y(a + b * x1)); ctx.stroke();
          ctx.restore();
        }
      }

      pts.forEach(function (p) {
        ctx.beginPath();
        ctx.arc(X(p.x), Y(p.y), 4.5, 0, Math.PI * 2);
        ctx.fillStyle = p.color || C.seriesColor(0);
        ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = th.surface; ctx.stroke();
      });
    };
    draw();
    canvas.__redraw = draw;
    C.observe(canvas);
  };

  /* --------------------------------------------------------------------------
   *  창 크기가 바뀌면 다시 그리기
   * ------------------------------------------------------------------------*/
  const observed = new Set();
  C.observe = function (canvas) {
    if (observed.has(canvas)) return;
    observed.add(canvas);
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(function () { if (canvas.__redraw && canvas.offsetParent !== null) canvas.__redraw(); });
      ro.observe(canvas);
    }
  };
  C.redrawAll = function () {
    observed.forEach(function (c) { if (c.__redraw && c.offsetParent !== null) c.__redraw(); });
  };
  window.addEventListener('resize', function () { C.redrawAll(); });

  /* ==========================================================================
   *  레이더(거미줄) 차트 — 축이 여러 개인 점수를 한눈에
   *
   *  이 사이트에서는 네 축(예측력·투자 성과·안정성·실용성) 점수를 그립니다.
   *  ★ 가운데가 0이 아니라 **한가운데 원이 0점(기준선)**입니다. 그 원보다
   *    안쪽으로 들어가면 기준선보다 못하다는 뜻입니다. 이걸 표시하지 않으면
   *    "작으니까 조금 나쁜가 보다" 정도로 잘못 읽습니다.
   *
   *  opt = {
   *    axes:   [{label}],                 // 축 이름
   *    series: [{name, values, color}],   // values 는 axes 와 같은 길이
   *    min: -100, max: 100, zero: 0
   *  }
   * ========================================================================*/
  C.radar = function (canvas, opt) {
    const draw = function () {
      const s = setup(canvas), ctx = s.ctx, th = theme();
      const axes = opt.axes || [], series = opt.series || [];
      const n = axes.length;
      if (n < 3) return;

      const min = opt.min === undefined ? -100 : opt.min;
      const max = opt.max === undefined ? 100 : opt.max;
      const zero = opt.zero === undefined ? 0 : opt.zero;
      const cx = s.w / 2, cy = s.h / 2 + 4;
      const R = Math.max(30, Math.min(s.w / 2 - 74, s.h / 2 - 30));
      const rad = function (v) {
        const t = (Math.max(min, Math.min(max, v)) - min) / (max - min);
        return t * R;
      };
      const angle = function (i) { return -Math.PI / 2 + i * 2 * Math.PI / n; };
      const px = function (i, r) { return cx + Math.cos(angle(i)) * r; };
      const py = function (i, r) { return cy + Math.sin(angle(i)) * r; };

      // 배경 그물
      const rings = opt.rings || [min, (min + zero) / 2, zero, (zero + max) / 2, max];
      rings.forEach(function (v) {
        const r = rad(v), isZero = Math.abs(v - zero) < 1e-9;
        ctx.beginPath();
        for (let i = 0; i <= n; i++) {
          const a = i % n;
          const x = px(a, r), y = py(a, r);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = isZero ? th.axis : th.grid;
        ctx.lineWidth = isZero ? 1.5 : 1;
        if (isZero) ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      });

      // 축 선과 이름
      ctx.font = '11px system-ui, -apple-system, sans-serif';
      for (let i = 0; i < n; i++) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(px(i, R), py(i, R));
        ctx.strokeStyle = th.grid;
        ctx.lineWidth = 1;
        ctx.stroke();

        const lx = px(i, R + 16), ly = py(i, R + 16);
        ctx.fillStyle = th.sec;
        ctx.textBaseline = 'middle';
        const c = Math.cos(angle(i));
        ctx.textAlign = c > 0.25 ? 'left' : (c < -0.25 ? 'right' : 'center');
        ctx.fillText(axes[i].label, lx, ly);
      }

      // 0점 표시
      ctx.fillStyle = th.muted;
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('0 = 기준선', cx, cy - rad(zero) - 4);

      // 각 모델의 다각형
      series.forEach(function (se, si) {
        const color = se.color || C.seriesColor(si);
        ctx.beginPath();
        for (let i = 0; i <= n; i++) {
          const a = i % n;
          const v = isFinite(se.values[a]) ? se.values[a] : zero;
          const x = px(a, rad(v)), y = py(a, rad(v));
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.globalAlpha = 0.13;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();

        for (let i = 0; i < n; i++) {
          const v = isFinite(se.values[i]) ? se.values[i] : zero;
          ctx.beginPath();
          ctx.arc(px(i, rad(v)), py(i, rad(v)), 2.6, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
        }
      });
    };
    draw();
    canvas.__redraw = draw;
    C.observe(canvas);
  };

  // 범례 만들기 (색만으로 구분하지 않도록 항상 이름을 함께 보여줍니다)
  C.legend = function (items) {
    const box = U.el('div', 'legend');
    items.forEach(function (it, i) {
      const w = U.el('span', 'legend-item');
      const d = U.el('span', 'legend-dot');
      d.style.background = it.color || C.seriesColor(i);
      if (it.dash) d.classList.add('dashed');
      w.appendChild(d);
      w.appendChild(U.el('span', '', it.name));
      box.appendChild(w);
    });
    return box;
  };

  root.C = C;
})(window.QL = window.QL || {});
