/* ============================================================================
 *  lab.js — 학습 실험실
 *
 *  이 화면 하나가 사이트의 심장입니다. 모델을 여러 개 골라 **완전히 같은
 *  조건으로** 한꺼번에 학습시키고, 성적을 나란히 놓습니다.
 *
 *  화면이 지켜야 할 것 하나: 조건을 숨기지 않는 것.
 *  성적표만 보여 주면 "그래서 어떻게 잰 건데?"라는 질문에 답할 수 없습니다.
 *  그래서 실험 조건 체크리스트를 결과보다 **위에** 고정해 두었습니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, C = root.C, M = root.M, App = root.App, DATA = root.DATA,
    REG = root.REG, EXP = root.EXP, FEAT = root.FEAT, SPLIT = root.SPLIT;

  const ALL_SEEDS = [42, 43, 44, 45, 46, 47, 48, 49, 50, 51];

  const S = {
    ticker: 'AAPL',
    picked: {
      direction: ['logistic', 'ridge', 'knn', 'forest', 'boosting', 'mlp'],
      volatility: ['garch', 'gjr', 'har']
    },
    cfg: { folds: 5, seeds: 5, costBps: 10, threshold: 0.5 },
    running: false,
    err: null,
    prog: null
  };

  /* ------------------------------------------------------------------------
   *  작은 서식 도우미
   * ----------------------------------------------------------------------*/
  // 평균 ± 표준편차. 시드를 여러 번 돌린 모델만 ± 가 붙습니다.
  function pm(a, d, mul) {
    if (!a || !isFinite(a.mean)) return '—';
    const m = (a.mean * (mul || 1)).toFixed(d);
    if (!a.sd || a.sd < 1e-9) return m;
    return m + ' <span class="tiny">±' + (a.sd * (mul || 1)).toFixed(d) + '</span>';
  }
  function pval(p) {
    if (!isFinite(p)) return '—';
    const cls = p < 0.05 ? 'up' : '';
    return '<span class="' + cls + '">' + p.toFixed(3) + '</span>';
  }
  function ms(x) { return x < 1000 ? Math.round(x) + 'ms' : (x / 1000).toFixed(1) + '초'; }

  function nameCell(r) {
    const w = U.el('span');
    w.appendChild(U.el('span', '', r.name + ' '));
    const def = REG.get(r.id);
    if (def.exec === 'pre') w.appendChild(App.badge('사전', 'badge-pre'));
    if (r.baseline) w.appendChild(App.badge('기준선', 'badge-base'));
    if (r.auto) w.appendChild(App.badge('자동 추가', 'badge-soon'));
    return w;
  }

  /* ------------------------------------------------------------------------
   *  실험 조건 — 결과보다 위에 둡니다
   * ----------------------------------------------------------------------*/
  function condPanel(host) {
    const p = App.panel('실험 조건', { sub: '모든 모델에 똑같이 적용됩니다' });

    const row = U.el('div', 'grid g4');

    // 종목
    const f1 = U.el('div', 'field');
    f1.appendChild(U.el('label', '', '종목'));
    const sel = U.el('select');
    // 종목 선정(2번 화면)에서 기준으로 뽑힌 종목이 맨 위에 옵니다.
    const chosen = root.UNIV ? root.UNIV.selected().picked : [];
    const rest = DATA.state.tickers.filter(function (t) {
      return !DATA.isBenchmark(t) && chosen.indexOf(t) < 0;
    });
    const addOpt = function (t, mark) {
      const o = U.el('option', '', t + ' · ' + DATA.sector(t) + (mark ? ' ★' : ''));
      o.value = t;
      if (t === S.ticker) o.selected = true;
      sel.appendChild(o);
    };
    chosen.forEach(function (t) { addOpt(t, true); });
    rest.forEach(function (t) { addOpt(t, false); });
    sel.addEventListener('change', function () { S.ticker = sel.value; S.run = null; draw(host); });
    f1.appendChild(sel);
    row.appendChild(f1);

    // 폴드 수
    const f2 = U.el('div', 'field');
    f2.appendChild(U.el('label', '', '시간순 분할 수'));
    const sel2 = U.el('select');
    [3, 5, 8].forEach(function (n) {
      const o = U.el('option', '', n + '겹');
      o.value = n;
      if (n === S.cfg.folds) o.selected = true;
      sel2.appendChild(o);
    });
    sel2.addEventListener('change', function () { S.cfg.folds = +sel2.value; draw(host); });
    f2.appendChild(sel2);
    row.appendChild(f2);

    // 시드 수
    const f3 = U.el('div', 'field');
    f3.appendChild(U.el('label', '', '시드 반복 횟수'));
    const sel3 = U.el('select');
    [1, 3, 5, 10].forEach(function (n) {
      const o = U.el('option', '', n + '회');
      o.value = n;
      if (n === S.cfg.seeds) o.selected = true;
      sel3.appendChild(o);
    });
    sel3.addEventListener('change', function () { S.cfg.seeds = +sel3.value; draw(host); });
    f3.appendChild(sel3);
    row.appendChild(f3);

    // 거래비용
    const f4 = U.el('div', 'field');
    f4.appendChild(U.el('label', '', '거래비용(편도)'));
    const sel4 = U.el('select');
    [0, 5, 10, 25].forEach(function (n) {
      const o = U.el('option', '', (n / 100).toFixed(2) + '%');
      o.value = n;
      if (n === S.cfg.costBps) o.selected = true;
      sel4.appendChild(o);
    });
    sel4.addEventListener('change', function () { S.cfg.costBps = +sel4.value; draw(host); });
    f4.appendChild(sel4);
    row.appendChild(f4);

    p.body.appendChild(row);

    // 공정성 체크리스트 — 이 화면의 핵심 장치
    const n = DATA.state.dates.length;
    p.body.appendChild(App.checklist([
      { ok: true, text: '<b>동일 종목 · 동일 기간 · 동일 피처 · 동일 시드</b> — ' +
        S.ticker + ' · ' + DATA.state.dates[0] + '~' + DATA.state.dates[n - 1] +
        ' · 피처 ' + FEAT.cols().length + '개(' + FEAT.version() + ')' },
      { ok: true, text: '<b>시간순 워크포워드만 사용</b> — ' + SPLIT.describe(S.cfg) +
        '. 무작위 분할은 이 사이트에 아예 없습니다.' },
      { ok: true, text: '<b>피처는 t시점까지, 정답은 t+1</b> — 미래 정보가 새면 모든 결과가 무의미해집니다.' },
      { ok: true, text: '<b>표준화 통계는 학습 구간에서만</b> 계산해 시험 구간에 적용합니다.' },
      { ok: true, text: '<b>거래비용·슬리피지 전 모델 동일</b> — 편도 ' +
        (S.cfg.costBps / 100).toFixed(2) + '%, 포지션이 바뀔 때마다 부과.' },
      { ok: null, text: '<b>생존 편향 있음</b> — 나스닥100 <b>현재</b> 구성종목만 들어 있습니다. ' +
        '중간에 지수에서 빠진 회사가 없어 과거 성적이 실제보다 좋아 보입니다.' }
    ]));
    return p;
  }

  /* ------------------------------------------------------------------------
   *  모델 고르기
   * ----------------------------------------------------------------------*/
  function pickPanel(host) {
    const p = App.panel('모델 고르기', { sub: '기준선은 고르지 않아도 자동으로 함께 돌아갑니다' });

    ['direction', 'volatility'].forEach(function (task) {
      const t = REG.TASKS[task];
      const head = U.el('div', 'small');
      head.style.cssText = 'font-weight:650;margin-bottom:6px';
      head.textContent = t.name + ' — ' + t.short;
      p.body.appendChild(head);

      const box = U.el('div');
      box.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';
      REG.list({ task: task, ready: true }).forEach(function (d) {
        if (d.baseline) return;                       // 기준선은 자동이라 고를 필요가 없습니다
        const on = S.picked[task].indexOf(d.id) >= 0;
        const c = U.el('button', 'chip' + (on ? ' on' : ''));
        c.innerHTML = U.escape(d.name) +
          (d.exec === 'pre' ? ' <span class="badge badge-pre">사전</span>' : '');
        c.addEventListener('click', function () {
          const i = S.picked[task].indexOf(d.id);
          if (i >= 0) S.picked[task].splice(i, 1); else S.picked[task].push(d.id);
          draw(host);
        });
        box.appendChild(c);
      });
      p.body.appendChild(box);
    });

    const total = S.picked.direction.length + S.picked.volatility.length;
    const info = U.el('div', 'small');
    const auto = EXP.withBaselines(S.picked.direction.concat(S.picked.volatility)).length - total;
    info.innerHTML = '고른 모델 <b>' + total + '개</b> + 기준선 ' + auto + '개 자동 추가' +
      (total ? '' : ' — 하나 이상 골라 주세요');
    p.body.appendChild(info);

    const btnRow = U.el('div');
    btnRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center';
    const runBtn = U.el('button', 'btn primary', S.running ? '학습 중…' : '같은 조건으로 일괄 학습');
    runBtn.disabled = S.running || !total;
    runBtn.addEventListener('click', function () { runAll(host); });
    btnRow.appendChild(runBtn);

    const allBtn = U.el('button', 'btn sm', '전체 선택');
    allBtn.addEventListener('click', function () {
      ['direction', 'volatility'].forEach(function (task) {
        S.picked[task] = REG.list({ task: task, ready: true })
          .filter(function (d) { return !d.baseline; })
          .map(function (d) { return d.id; });
      });
      draw(host);
    });
    btnRow.appendChild(allBtn);

    const clrBtn = U.el('button', 'btn sm', '모두 해제');
    clrBtn.addEventListener('click', function () {
      S.picked.direction = []; S.picked.volatility = []; draw(host);
    });
    btnRow.appendChild(clrBtn);
    p.body.appendChild(btnRow);

    if (S.running) {
      const wrap = U.el('div');
      const bar = U.el('div', 'progress');
      const inner = U.el('i');
      inner.style.width = '0%';
      bar.appendChild(inner);
      const lab = U.el('div', 'progress-label', '준비 중…');
      wrap.appendChild(bar);
      wrap.appendChild(lab);
      p.body.appendChild(wrap);
      S.prog = function (s) {
        inner.style.width = (s.total ? s.done / s.total * 100 : 0).toFixed(1) + '%';
        lab.textContent = s.done + ' / ' + s.total + ' · ' + s.label;
      };
    } else {
      S.prog = null;
    }

    if (S.err) p.body.appendChild(App.note('<b>실행 중 문제가 생겼습니다.</b><br>' + U.escape(S.err), 'bad'));
    return p;
  }

  /* ------------------------------------------------------------------------
   *  실행
   * ----------------------------------------------------------------------*/
  async function runAll(host) {
    S.running = true; S.err = null;
    draw(host);
    await U.yield_();
    try {
      const ids = S.picked.direction.concat(S.picked.volatility);
      await EXP.run(ids, {
        ticker: S.ticker,
        folds: S.cfg.folds,
        seeds: ALL_SEEDS.slice(0, S.cfg.seeds),
        costBps: S.cfg.costBps,
        threshold: S.cfg.threshold
      }, function (s) { if (S.prog) S.prog(s); });
    } catch (e) {
      S.err = e.message;
      console.error(e);
    }
    S.running = false;
    draw(host);
  }

  /* ------------------------------------------------------------------------
   *  결과 — 방향 예측
   * ----------------------------------------------------------------------*/
  function dirPanel(run) {
    const rows0 = run.results.filter(function (r) { return r.task === 'direction'; });
    if (!rows0.length) return null;
    rows0.sort(function (a, b) { return (b.agg.auc.mean || 0) - (a.agg.auc.mean || 0); });

    const p = App.panel('방향 예측 성적표', { sub: '내일 오를지 맞히는 문제 · ' + run.config.ticker });

    p.body.appendChild(App.note(
      'AUC는 <b>오를 날과 내릴 날을 구별하는 능력</b>입니다. 0.5면 실력이 없다는 뜻이고 ' +
      '1에 가까울수록 좋습니다. 정확도는 함께 보되 혼자 믿으면 안 됩니다 — 상승일이 ' +
      '조금 더 많아서 "무조건 오른다"만 찍어도 ' +
      U.pct(Math.max(run.dataset.upRate, 1 - run.dataset.upRate), 1) + '가 나옵니다.'));

    const rows = rows0.map(function (r) {
      const upRate = U.mean(r.folds.map(function (f) { return f.upRate; }));
      const aucs = r.folds.map(function (f) { return f.auc; }).filter(isFinite);
      const won = aucs.filter(function (a) { return a > 0.5; }).length;
      let nPos = 0, nAll = 0;
      r.folds.forEach(function (f) { nAll += f.n; nPos += Math.round(f.n * f.posRate); });
      const t = root.SCORE.aucTest(r.agg.auc.mean, nPos, nAll - nPos);
      const row = [
        nameCell(r),
        pm(r.agg.auc, 4),
        pm(r.agg.acc, 4),
        pm(r.agg.precision, 4),
        U.pct(upRate, 0),
        won + '/' + aucs.length,
        pval(t.p),
        ms(r.ms)
      ];
      if (r.baseline) row.__cls = 'muted';
      return row;
    });

    p.body.appendChild(App.table([
      { label: '모델', width: '26%' },
      { label: 'AUC ' + App.dir('up'), num: true },
      { label: '정확도 ' + App.dir('up'), num: true },
      { label: '상승 정밀도 ' + App.dir('up'), num: true },
      { label: '상승 예측 비율', num: true },
      { label: '폴드 승률 ' + App.dir('up'), num: true },
      { label: 'p값 ' + App.dir('down'), num: true },
      { label: '학습 시간 ' + App.dir('down'), num: true }
    ], rows, { scroll: true }));

    p.body.appendChild(App.formula(
      '<b>AUC</b> — 오른 날 하나와 내린 날 하나를 무작위로 뽑았을 때, 모델이 오른 날에 ' +
      '더 높은 확률을 준 비율입니다. 그래서 0.5가 "아무 실력 없음"입니다.<br>' +
      '<b>상승 정밀도</b> — 모델이 "오른다"고 한 날 중 실제로 오른 날의 비율.<br>' +
      '<b>p값</b> — 실력이 전혀 없는데 우연히 이 정도 AUC가 나올 확률(Hanley–McNeil). ' +
      '0.05보다 작아야 "우연이라 보기 어렵다"고 말할 수 있습니다. ' +
      '이 표에서 0.05 밑으로 내려가는 모델이 있는지 꼭 확인하세요.',
      '이 숫자들이 무슨 뜻인가'));

    // 경고 — 결과를 잘못 읽지 않도록
    const warns = [];
    rows0.forEach(function (r) {
      if (r.baseline) return;
      const upRate = U.mean(r.folds.map(function (f) { return f.upRate; }));
      const w = M.warnings({ upRate: upRate, auc: r.agg.auc.mean, acc: r.agg.acc.mean,
        baseline: Math.max(run.dataset.upRate, 1 - run.dataset.upRate) });
      w.forEach(function (x) { warns.push('<b>' + U.escape(r.name) + '</b> — ' + x); });
    });
    if (warns.length) {
      p.body.appendChild(App.note(warns.slice(0, 6).join('<br>') +
        (warns.length > 6 ? '<br><span class="tiny">… 외 ' + (warns.length - 6) + '건</span>' : ''), 'warn'));
    }

    // ROC 곡선
    const curves = [], legend = [];
    rows0.slice(0, 6).forEach(function (r, i) {
      if (!r.pred) return;
      curves.push({ points: M.rocCurve(r.pred.y, r.pred.proba), color: C.seriesColor(i) });
      legend.push({ name: r.name + ' (' + U.fmt(r.agg.auc.mean, 3) + ')', color: C.seriesColor(i) });
    });
    if (curves.length) {
      const box = U.el('div');
      box.style.cssText = 'margin-top:6px';
      const cv = U.el('canvas');
      cv.style.height = '320px';
      box.appendChild(cv);
      box.appendChild(C.legend(legend));
      box.appendChild(App.note('점선(대각선)이 <b>실력 없음</b>입니다. 선이 점선 위로 ' +
        '올라와 있을수록 좋습니다. 대부분의 모델이 점선에 딱 붙어 있다면 그것이 이 실험의 ' +
        '정직한 결과입니다 — 일간 방향 예측은 원래 이렇게 어렵습니다.'));
      p.body.appendChild(box);
      setTimeout(function () { C.roc(cv, curves); }, 0);
    }
    return p;
  }

  /* ------------------------------------------------------------------------
   *  결과 — 변동성 예측
   * ----------------------------------------------------------------------*/
  function volPanel(run) {
    const rows0 = run.results.filter(function (r) { return r.task === 'volatility'; });
    if (!rows0.length) return null;
    const ewma = rows0.filter(function (r) { return r.id === 'ewma'; })[0];
    const base = ewma ? ewma.agg.mse.mean : NaN;
    rows0.sort(function (a, b) { return (a.agg.mse.mean || 9e9) - (b.agg.mse.mean || 9e9); });

    const p = App.panel('변동성 예측 성적표', { sub: '내일 얼마나 출렁일지 맞히는 문제' });
    p.body.appendChild(App.note(
      '여기서는 방향을 묻지 않습니다. <b>움직임의 크기</b>만 맞히면 됩니다. ' +
      '방향과 달리 이건 꽤 잘 맞습니다 — 변동성은 뭉쳐서 오기 때문입니다. ' +
      '기준선은 금융회사들이 실제로 쓰는 <b>EWMA</b>이고, 그보다 오차(MSE)가 작으면 이긴 것입니다.'));

    const ewmaFold = ewma ? ewma.folds.map(function (f) { return f.mse; }) : null;
    const rows = rows0.map(function (r) {
      const rel = isFinite(base) && base > 0 ? (1 - r.agg.mse.mean / base) * 100 : NaN;
      let won = 0, tot = 0;
      if (ewmaFold) r.folds.forEach(function (f, k) {
        if (isFinite(f.mse) && isFinite(ewmaFold[k])) { tot++; if (f.mse < ewmaFold[k]) won++; }
      });
      const row = [
        nameCell(r),
        r.agg.mse.mean.toExponential(3),
        isFinite(rel) ? (rel >= 0 ? '+' : '') + rel.toFixed(1) + '%' : '—',
        U.fmt(r.agg.qlike.mean, 3),
        won + '/' + tot,
        ms(r.ms)
      ];
      if (r.baseline) row.__cls = 'muted';
      return row;
    });

    p.body.appendChild(App.table([
      { label: '모델', width: '30%' },
      { label: 'MSE ' + App.dir('down'), num: true },
      { label: 'EWMA 대비 ' + App.dir('up'), num: true },
      { label: 'QLIKE ' + App.dir('down'), num: true },
      { label: '폴드 승률 ' + App.dir('up'), num: true },
      { label: '학습 시간 ' + App.dir('down'), num: true }
    ], rows));

    p.body.appendChild(App.formula(
      '<b>MSE</b> — 예측한 분산과 실제로 일어난 제곱수익률의 차이를 제곱해 평균 낸 값.<br>' +
      '<b>QLIKE</b> — 변동성 평가에 더 알맞다고 알려진 다른 손실 함수입니다. ' +
      'MSE는 큰 값에 많이 끌려가는데 QLIKE는 덜 그렇습니다. 둘 다 낮을수록 좋고, ' +
      '두 지표의 순위가 다르면 그 차이는 견고하지 않다는 신호입니다.',
      'MSE와 QLIKE'));
    return p;
  }

  /* ------------------------------------------------------------------------
   *  폴드별 성적 전체 공개
   * ----------------------------------------------------------------------*/
  function foldPanel(run) {
    const dir = run.results.filter(function (r) { return r.task === 'direction'; });
    if (!dir.length) return null;
    const p = App.panel('폴드별 성적 전체', {
      sub: '평균만 보여 주면 어느 구간에서 벌었는지 숨길 수 있습니다'
    });

    const heads = [{ label: '모델', width: '24%' }];
    run.splits.forEach(function (sp, k) {
      const f = dir[0].folds[k];
      heads.push({ label: (k + 1) + '겹<br><span class="tiny">' + (f ? f.from.slice(2, 7) + '~' + f.to.slice(2, 7) : '') + '</span>', num: true });
    });
    heads.push({ label: '평균', num: true });

    const rows = dir.map(function (r) {
      const cells = [nameCell(r)];
      r.folds.forEach(function (f) {
        const good = isFinite(f.auc) && f.auc > 0.5;
        cells.push('<span class="' + (good ? 'up' : 'down') + '">' + U.fmt(f.auc, 3) + '</span>');
      });
      cells.push('<b>' + U.fmt(r.agg.auc.mean, 3) + '</b>');
      if (r.baseline) cells.__cls = 'muted';
      return cells;
    });

    p.body.appendChild(App.table(heads, rows, { scroll: true }));
    p.body.appendChild(App.note(
      '초록이 그 구간에서 기준선(0.5)을 이긴 것입니다. <b>다섯 칸이 들쭉날쭉하다면</b> ' +
      '평균이 아무리 좋아도 믿기 어렵습니다. 한 구간에서만 잘 맞은 모델은 대개 ' +
      '그 구간에 우연히 맞아떨어진 것입니다.'));
    return p;
  }

  /* ------------------------------------------------------------------------
   *  그리기
   * ----------------------------------------------------------------------*/
  let hostRef = null;
  function draw(host) {
    hostRef = host;
    host.innerHTML = '';
    host.appendChild(App.intro(
      '모델 여러 개를 <b>완전히 같은 조건으로</b> 학습시켜 예측력을 비교합니다.',
      '조건이 하나라도 다르면 성적 차이가 모델 실력 때문인지 조건 차이 때문인지 알 수 없습니다. ' +
      '그래서 조건을 결과보다 위에 붙박아 두었습니다. 먼저 읽고 결과를 보세요.'
    ));

    if (!App.needFullData(host)) return;

    host.appendChild(condPanel(host));
    host.appendChild(pickPanel(host));

    const run = EXP.last;
    if (run) {
      const dp = dirPanel(run);
      if (dp) host.appendChild(dp);
      const vp = volPanel(run);
      if (vp) host.appendChild(vp);
      const fp = foldPanel(run);
      if (fp) host.appendChild(fp);

      const go = App.panel('다음 단계');
      go.body.appendChild(App.note(
        '성적표만으로는 "그래서 어느 모델이 좋은가"에 답할 수 없습니다. ' +
        '잘 맞히는 모델이 돈을 버는 모델이 아니고, 한 기간만 잘한 모델일 수도 있습니다. ' +
        '<b>종합 점수표</b>에서 네 축으로 나눠 보세요.'));
      const b = U.el('button', 'btn primary', '종합 점수표로 →');
      b.addEventListener('click', function () { App.go('score'); });
      go.body.appendChild(b);
      host.appendChild(go);
    }
  }

  App.register('lab', {
    render: function (host) { draw(host); },
    onFullData: function () { if (hostRef) draw(hostRef); }
  });
})(window.QL = window.QL || {});
