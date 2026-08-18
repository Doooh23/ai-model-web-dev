/* ============================================================================
 *  score.js (화면) — 종합 점수표
 *
 *  점수표는 늘 세 곳에서 공격받습니다. "왜 그 지표?" "왜 그 가중치?" "우연 아냐?"
 *  이 화면은 그 셋에 각각 답하는 구역을 하나씩 갖고 있습니다.
 *
 *    ① 공정성 전제를 맨 위에 고정 노출
 *    ② 점수는 전부 기준선 대비 (0점 = 기준선)
 *    ③ 가중치 슬라이더를 열어 둠 — "왜 30%냐"는 "직접 바꿔 보세요"로
 *    ④ 통계 검정 결과를 원시 지표와 함께 노출
 *
 *  그리고 결론은 "1등 모델"이 아니라 **축별 승자**로 냅니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, C = root.C, App = root.App, REG = root.REG,
    EXP = root.EXP, SCORE = root.SCORE;

  const S = { weights: null, running: false, err: null };

  function weights() {
    if (!S.weights) S.weights = Object.assign({}, SCORE.DEFAULT_WEIGHTS);
    return S.weights;
  }

  function fmtScore(v) {
    if (v === null || !isFinite(v)) return '<span class="tiny">해당 없음</span>';
    const cls = v > 0.5 ? 'up' : (v < -0.5 ? 'down' : 'flat');
    return '<span class="' + cls + '">' + (v > 0 ? '+' : '') + v.toFixed(1) + '</span>';
  }

  function nameCell(r) {
    const w = U.el('span');
    w.appendChild(U.el('span', '', r.name + ' '));
    const def = REG.get(r.id);
    if (def && def.exec === 'pre') w.appendChild(App.badge('사전', 'badge-pre'));
    if (r.baseline) w.appendChild(App.badge('기준선', 'badge-base'));
    return w;
  }

  /* ------------------------------------------------------------------------
   *  ① 공정성 전제
   * ----------------------------------------------------------------------*/
  function fairPanel(run) {
    const p = App.panel('이 점수표를 믿어도 되는 이유', {
      sub: '숫자보다 먼저 읽어야 하는 부분입니다'
    });
    const d = run.describe;
    p.body.appendChild(App.checklist([
      { ok: true, text: '<b>같은 종목 · 같은 기간 · 같은 피처 · 같은 시드</b> — ' +
        d.ticker + ' · ' + run.dataset.from + '~' + run.dataset.to +
        ' · 피처 ' + run.dataset.cols.length + '개 · ' + d.seeds },
      { ok: true, text: '<b>' + d.split + '</b>' },
      { ok: run.leak.pass, text: '<b>데이터 누출 자동 점검</b> — ' +
        (run.leak.pass ? '학습·시험 구간이 겹치지 않고 날짜 순서도 정상입니다.'
          : '문제가 발견되었습니다: ' + run.leak.issues.join(' ')) },
      { ok: true, text: '<b>' + d.cost + '</b> — 모든 모델에 똑같이 부과. ' + d.threshold },
      { ok: true, text: '<b>기준선을 항상 함께 돌립니다</b> — 바이앤홀드 · 동전 던지기 · EWMA. ' +
        '이들이 각자의 축에서 0점을 받는지 표에서 직접 확인할 수 있습니다.' },
      { ok: null, text: '<b>생존 편향 있음</b> — 나스닥100 현재 구성종목만 사용. ' +
        '망해서 지수에서 빠진 회사가 빠져 있어 과거 성적이 부풀려집니다.' }
    ]));
    return p;
  }

  /* ------------------------------------------------------------------------
   *  ③ 가중치 슬라이더
   * ----------------------------------------------------------------------*/
  function weightPanel(onChange) {
    const p = App.panel('가중치 — 직접 바꿔 보세요', {
      sub: '"왜 예측력이 30%냐"는 물음의 답은 "직접 바꿔 보세요"입니다'
    });

    p.body.appendChild(App.note(
      '아래 값을 움직이면 순위가 <b>즉시</b> 다시 계산됩니다. 슬라이더를 극단으로 밀어 봤을 때 ' +
      '1등이 계속 바뀐다면, 그 순위는 원래 그만큼 불안정한 것입니다. 그 사실 자체가 결과입니다.'));

    const box = U.el('div', 'weights');
    SCORE.AXES.forEach(function (a) {
      const row = U.el('div', 'wrow');
      const lab = U.el('label');
      lab.innerHTML = App.tipHTML(a.name, a.what + ' · ' + a.how);
      row.appendChild(lab);
      const r = U.el('input');
      r.type = 'range'; r.min = '0'; r.max = '60'; r.step = '5';
      r.value = weights()[a.id];
      const out = U.el('output', '', weights()[a.id] + '%');
      r.addEventListener('input', function () {
        weights()[a.id] = +r.value;
        out.textContent = r.value + '%';
        onChange();
      });
      row.appendChild(r);
      row.appendChild(out);
      box.appendChild(row);
    });
    p.body.appendChild(box);

    const btn = U.el('button', 'btn sm', '기본값으로 되돌리기 (30/30/25/15)');
    btn.addEventListener('click', function () {
      S.weights = Object.assign({}, SCORE.DEFAULT_WEIGHTS);
      onChange(true);
    });
    p.body.appendChild(btn);

    const help = U.el('div', 'small');
    help.innerHTML = SCORE.AXES.map(function (a) {
      return '<b>' + a.name + '</b> — ' + a.what + '. 0점 = ' + a.zero + '. ' + a.why;
    }).join('<br>');
    p.body.appendChild(help);
    return p;
  }

  /* ------------------------------------------------------------------------
   *  ② 과제별 순위표 + 레이더
   * ----------------------------------------------------------------------*/
  function groupPanel(table, task) {
    const rows = table.groups[task];
    if (!rows || !rows.length) return null;
    const isDir = task === 'direction';
    const p = App.panel('종합 순위 — ' + SCORE.TASK_NAME[task], {
      sub: isDir ? '내일 오를지 맞히는 문제' : '내일 얼마나 출렁일지 맞히는 문제'
    });

    // --- 레이더 ---------------------------------------------------------
    const pick = rows.filter(function (r) { return !r.baseline; }).slice(0, 4);
    const base = rows.filter(function (r) { return r.baseline; })[0];
    if (base) pick.push(base);
    // ※ isFinite(null) 은 true 입니다. 해당 없는 축(변동성 모델의 '투자 성과')을
    //   걸러내려면 null 을 따로 확인해야 합니다. 이걸 빼먹으면 레이더에 있지도 않은
    //   축이 0점으로 그려져 "기준선과 같다"는 거짓말을 하게 됩니다.
    const has = function (r, id) { return r.axes[id] !== null && isFinite(r.axes[id]); };
    const axes = SCORE.AXES.filter(function (a) {
      return pick.some(function (r) { return has(r, a.id); });
    });
    if (axes.length >= 3 && pick.length) {
      const grid = U.el('div', 'grid g-1-2');
      const cvBox = U.el('div');
      const cv = U.el('canvas');
      cv.style.height = '300px';
      cvBox.appendChild(cv);
      const series = pick.map(function (r, i) {
        return { name: r.name, color: C.seriesColor(i),
          values: axes.map(function (a) { return has(r, a.id) ? r.axes[a.id] : 0; }) };
      });
      cvBox.appendChild(C.legend(series.map(function (s) { return { name: s.name, color: s.color }; })));
      grid.appendChild(cvBox);

      const side = U.el('div');
      side.appendChild(App.note(
        '가운데 점선 원이 <b>0점 = 기준선</b>입니다. 그 안쪽으로 들어간 축은 ' +
        '기준선보다 못하다는 뜻입니다.<br><br>' +
        '어느 모델도 모든 축에서 크지 않다는 것이 보일 겁니다. ' +
        '<b>잘 맞히면 느리고, 빠르면 못 맞히고, 잘 맞혀도 비용을 물면 남지 않습니다.</b> ' +
        '이 그림이 이 사이트가 하려는 말의 전부입니다.'));
      grid.appendChild(side);
      p.body.appendChild(grid);
      setTimeout(function () {
        C.radar(cv, { axes: axes.map(function (a) { return { label: a.name }; }), series: series,
          min: -100, max: 100, zero: 0 });
      }, 0);
    }

    // --- 표 -------------------------------------------------------------
    const heads = [
      { label: '#', num: true },
      { label: '모델', width: '20%' },
      { label: '총점 ' + App.dir('up'), num: true }
    ];
    SCORE.AXES.forEach(function (a) {
      if (!isDir && a.id === 'profit') return;
      heads.push({ label: a.name, num: true });
    });
    if (isDir) {
      heads.push({ label: 'AUC ' + App.dir('up'), num: true });
      heads.push({ label: '샤프 ' + App.dir('up'), num: true });
      heads.push({ label: 'CAGR ' + App.dir('up'), num: true });
      heads.push({ label: 'MDD ' + App.dir('up'), num: true });
      heads.push({ label: '회전율 ' + App.dir('down'), num: true });
    } else {
      heads.push({ label: 'MSE ' + App.dir('down'), num: true });
      heads.push({ label: 'QLIKE ' + App.dir('down'), num: true });
    }
    heads.push({ label: '폴드 승률 ' + App.dir('up'), num: true });

    const body = rows.map(function (r) {
      const cells = [
        r.baseline ? '—' : String(r.rank),
        nameCell(r),
        '<b>' + (isFinite(r.total) ? (r.total > 0 ? '+' : '') + r.total.toFixed(1) : '—') + '</b>'
      ];
      SCORE.AXES.forEach(function (a) {
        if (!isDir && a.id === 'profit') return;
        cells.push(fmtScore(r.axes[a.id]));
      });
      if (isDir) {
        cells.push(U.fmt(r.agg.auc.mean, 4));
        cells.push(U.fmt(r.agg.sharpe.mean, 2));
        cells.push(U.pct(r.agg.cagr.mean, 1));
        cells.push(U.pct(r.agg.mdd.mean, 1));
        cells.push(U.fmt(r.agg.turnover.mean, 2));
      } else {
        cells.push(r.agg.mse.mean.toExponential(2));
        cells.push(U.fmt(r.agg.qlike.mean, 2));
      }
      cells.push(r.stats.foldWin.won + '/' + r.stats.foldWin.total);
      if (r.baseline) cells.__cls = 'muted';
      return cells;
    });

    p.body.appendChild(App.table(heads, body, { scroll: true }));
    p.body.appendChild(App.note(
      '<b>점수만 보지 말고 오른쪽 원시 지표를 함께 보세요.</b> 점수는 원시 지표를 ' +
      '정해진 공식으로 바꾼 것일 뿐입니다. 공식이 마음에 들지 않으면 원시 지표를 보고 ' +
      '직접 판단하면 됩니다. 그러라고 나란히 놓았습니다.'));
    return p;
  }

  /* ------------------------------------------------------------------------
   *  ④ 통계 검정
   * ----------------------------------------------------------------------*/
  function statsPanel(table) {
    const p = App.panel('우연이 아니라는 증거가 있는가', {
      sub: '점수가 높아도 이 구역이 전부 ✗ 라면 자랑할 수 없습니다'
    });

    p.body.appendChild(App.note(
      '좋은 성적이 나왔을 때 물어야 할 마지막 질문은 "운이 좋았던 것 아닌가"입니다. ' +
      '아래는 그것을 확인하는 세 가지 장치입니다. 수식은 몰라도 되고 <b>✓ / ✗ 만 보면 됩니다.</b>'));

    const dir = table.groups.direction || [];
    if (dir.length) {
      const rows = dir.map(function (r) {
        const a = r.stats.auc || {};
        const e = r.stats.excess;
        const ok1 = a.significant;
        const ok2 = e && !e.crossesZero && e.annual > 0;
        const isBH = r.id === 'buyhold';
        return [
          nameCell(r),
          isFinite(a.p) ? a.p.toFixed(3) : '—',
          '<span class="' + (ok1 ? 'up' : 'down') + '">' + (ok1 ? '✓ 넘음' : '✗ 못 넘음') + '</span>',
          e ? U.signPct(e.annual, 1) : '—',
          e ? '[' + U.signPct(e.lo, 1) + ', ' + U.signPct(e.hi, 1) + ']' : '—',
          isBH ? '<span class="tiny">기준선 자신</span>'
            : '<span class="' + (ok2 ? 'up' : 'down') + '">' +
              (e ? (e.crossesZero ? '✗ 유의차 없음' : (e.annual > 0 ? '✓ 유의하게 나음' : '✗ 유의하게 못함')) : '—') + '</span>',
          r.stats.hparams === null ? '<span class="tiny">미기록</span>' : String(r.stats.hparams)
        ];
      });
      const h = U.el('div', 'small');
      h.style.cssText = 'font-weight:650;margin-bottom:4px';
      h.textContent = '방향 예측';
      p.body.appendChild(h);
      p.body.appendChild(App.table([
        { label: '모델', width: '20%' },
        { label: 'p값(AUC) ' + App.dir('down'), num: true },
        { label: '우연을 넘었는가', num: true },
        { label: '초과수익(연율)', num: true },
        { label: '95% 신뢰구간', num: true },
        { label: '바이앤홀드보다 나은가', num: true },
        { label: '하이퍼파라미터<br>시도 수', num: true }
      ], rows, { scroll: true }));
    }

    const vol = table.groups.volatility || [];
    if (vol.length) {
      const rows = vol.map(function (r) {
        const dm = r.stats.dmVsBaseline;
        const better = dm && dm.significant && dm.winner === 'A';
        return [
          nameCell(r),
          dm ? U.fmt(dm.stat, 2) : '—',
          dm ? dm.p.toFixed(3) : '—',
          dm ? '<span class="' + (better ? 'up' : 'down') + '">' +
            (dm.significant ? (better ? '✓ 유의하게 나음' : '✗ 유의하게 못함') : '✗ 차이 없음') + '</span>'
            : '<span class="tiny">기준선</span>',
          r.stats.hparams === null ? '<span class="tiny">미기록</span>' : String(r.stats.hparams)
        ];
      });
      const h = U.el('div', 'small');
      h.style.cssText = 'font-weight:650;margin:12px 0 4px';
      h.textContent = '변동성 예측 — EWMA와 직접 비교 (Diebold-Mariano)';
      p.body.appendChild(h);
      p.body.appendChild(App.table([
        { label: '모델', width: '24%' },
        { label: 'DM 통계량', num: true },
        { label: 'p값', num: true },
        { label: 'EWMA보다 나은가', num: true },
        { label: '하이퍼파라미터<br>시도 수', num: true }
      ], rows));
    }

    p.body.appendChild(App.formula(
      '<b>p값(AUC)</b> — 실력이 전혀 없는데 우연히 이만큼의 AUC가 나올 확률입니다. ' +
      'Hanley–McNeil 표준오차로 계산합니다. 0.05보다 작아야 "우연이라 보기 어렵다"고 말합니다.<br><br>' +
      '<b>신뢰구간</b> — 같은 실험을 여러 번 다시 했다면 결과가 어디쯤에 놓였을지의 범위입니다. ' +
      '수익률은 하루하루가 서로 얽혀 있어서 20일씩 덩어리째 다시 뽑는 방식(이동 블록 부트스트랩, ' +
      '2000회)을 씁니다. 구간이 0을 걸치면 "0일 수도 있다" → 유의차 없음.<br><br>' +
      '<b>Diebold-Mariano</b> — 두 모델이 하루하루 틀린 정도를 나란히 빼서, 그 차이의 평균이 ' +
      '0과 다르다고 볼 수 있는지 봅니다. 이웃 날짜끼리의 상관까지 반영합니다(Newey-West).<br><br>' +
      '<b>하이퍼파라미터 시도 수</b> — 설정을 여러 번 바꿔 가며 시도하면 그중 우연히 잘 나온 것 ' +
      '하나를 고를 확률이 올라갑니다(다중검정). 이 사이트의 브라우저 모델은 설정을 전혀 ' +
      '건드리지 않아 전부 1입니다. 숨기지 않고 밝히는 편이 신뢰도를 올립니다.',
      '이 검정들이 무엇을 하는가 — 수식은 몰라도 됩니다'));
    return p;
  }

  /* ------------------------------------------------------------------------
   *  결론 — 축별 승자
   * ----------------------------------------------------------------------*/
  function verdictPanel(table) {
    const wn = SCORE.winners(table);
    const p = App.panel('결론', { sub: '"1등 모델"은 뽑지 않습니다' });

    const v = U.el('div', 'intro');
    v.style.margin = '0';
    v.appendChild(U.el('div', 'intro-k', '축별 승자'));
    const t = U.el('div', 'intro-v');
    t.textContent = SCORE.verdict(table);
    v.appendChild(t);
    p.body.appendChild(v);

    Object.keys(wn).forEach(function (task) {
      const g = wn[task];
      const rows = g.axes.map(function (a) {
        return [a.axisName, a.winner.name,
          '<b>' + (a.winner.score > 0 ? '+' : '') + a.winner.score.toFixed(1) + '</b>',
          a.winner.score > 0 ? '<span class="up">기준선보다 나음</span>'
            : '<span class="down">기준선보다 못함 — 승자라 부르기 어려움</span>'];
      });
      const h = U.el('div', 'small');
      h.style.cssText = 'font-weight:650;margin:10px 0 4px';
      h.textContent = g.taskName + (g.overall ? ' · 총점 1위 ' + g.overall.name : '');
      p.body.appendChild(h);
      p.body.appendChild(App.table([
        { label: '축', width: '18%' }, { label: '승자' }, { label: '점수', num: true }, { label: '해석' }
      ], rows));
    });

    p.body.appendChild(App.note(
      '<b>왜 1등을 뽑지 않는가.</b> "이 모델이 제일 좋다"는 한 줄은 거의 항상 틀립니다. ' +
      '방향을 잘 맞히는 모델과 출렁임을 잘 맞히는 모델이 다르고, 잘 맞히는 모델과 ' +
      '돈을 버는 모델도 다릅니다. 축을 나눠 말해야 틀리지 않습니다.', 'ok'));

    p.body.appendChild(App.note(
      '<b>그리고 이 결과는 종목 하나(' + table.config.ticker + ')의 결과입니다.</b> ' +
      '다른 종목에서 순위가 그대로 유지되는지 확인하지 않으면 아직 아무것도 증명하지 않은 것입니다. ' +
      '학습 실험실에서 종목을 바꿔 다시 돌려 보세요.', 'warn'));
    return p;
  }

  /* ------------------------------------------------------------------------
   *  실행 안내 (아직 실험을 안 돌렸을 때)
   * ----------------------------------------------------------------------*/
  function emptyPanel(host) {
    const p = App.panel('먼저 실험을 돌려야 합니다');
    p.body.appendChild(App.note(
      '점수는 실험 결과에서 계산됩니다. <b>학습 실험실</b>에서 모델을 골라 돌리고 오시거나, ' +
      '아래 버튼으로 기본 설정(AAPL · 대표 모델 9개 · 5겹 · 시드 5개)으로 지금 돌릴 수 있습니다. ' +
      '한 번에 30초쯤 걸립니다.'));

    const row = U.el('div');
    row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center';
    const b1 = U.el('button', 'btn primary', S.running ? '학습 중…' : '기본 설정으로 지금 돌리기');
    b1.disabled = S.running;
    b1.addEventListener('click', function () { runDefault(host); });
    row.appendChild(b1);
    const b2 = U.el('button', 'btn', '학습 실험실로 →');
    b2.addEventListener('click', function () { App.go('lab'); });
    row.appendChild(b2);
    p.body.appendChild(row);

    if (S.running) {
      const bar = U.el('div', 'progress');
      const inner = U.el('i');
      bar.appendChild(inner);
      const lab = U.el('div', 'progress-label', '준비 중…');
      p.body.appendChild(bar);
      p.body.appendChild(lab);
      S.prog = function (s) {
        inner.style.width = (s.total ? s.done / s.total * 100 : 0).toFixed(1) + '%';
        lab.textContent = s.done + ' / ' + s.total + ' · ' + s.label;
      };
    }
    if (S.err) p.body.appendChild(App.note(U.escape(S.err), 'bad'));
    return p;
  }

  async function runDefault(host) {
    S.running = true; S.err = null;
    draw(host);
    await U.yield_();
    try {
      await EXP.run(['logistic', 'ridge', 'knn', 'forest', 'boosting', 'mlp',
        'garch', 'gjr', 'har'], {}, function (s) { if (S.prog) S.prog(s); });
    } catch (e) { S.err = e.message; console.error(e); }
    S.running = false;
    draw(host);
  }

  /* ------------------------------------------------------------------------
   *  그리기
   * ----------------------------------------------------------------------*/
  let hostRef = null;
  function draw(host) {
    hostRef = host;
    host.innerHTML = '';
    host.appendChild(App.intro(
      '네 개의 축으로 모델에 점수를 매기고, <b>가중치를 직접 바꿔 가며</b> 순위가 어떻게 흔들리는지 봅니다.',
      '점수표는 "왜 그 지표?", "왜 그 가중치?", "우연 아냐?" 세 가지로 공격받습니다. ' +
      '이 화면은 그 셋에 답하는 구역을 하나씩 갖고 있습니다.'
    ));

    if (!App.needFullData(host)) return;

    const run = EXP.last;
    if (!run) { host.appendChild(emptyPanel(host)); return; }

    host.appendChild(fairPanel(run));

    const resultsBox = U.el('div');
    const render = function () {
      resultsBox.innerHTML = '';
      const table = SCORE.build(run, weights());
      ['direction', 'volatility'].forEach(function (task) {
        const g = groupPanel(table, task);
        if (g) resultsBox.appendChild(g);
      });
      resultsBox.appendChild(statsPanel(table));
      resultsBox.appendChild(verdictPanel(table));
    };

    host.appendChild(weightPanel(function (reset) {
      if (reset) { draw(host); return; }
      render();
    }));
    host.appendChild(resultsBox);
    render();
  }

  App.register('score', {
    render: function (host) { draw(host); },
    onFullData: function () { if (hostRef) draw(hostRef); }
  });
})(window.QL = window.QL || {});
