/* ============================================================================
 *  trade.js — 모의투자
 *
 *  이 화면이 하려는 말은 딱 하나입니다.
 *      **잘 맞히는 모델과 돈을 버는 모델은 다른 모델이다.**
 *
 *  학습 실험실에서 AUC 1등이었던 모델이 여기서 꼴찌가 되는 일이 흔합니다.
 *  이유는 셋입니다 — 맞힌 날의 크기가 작거나, 틀린 날의 크기가 크거나,
 *  하루하루 갈아타느라 거래비용에 다 먹히거나.
 *
 *  매매 규칙은 아주 단순합니다(복잡하면 결과의 원인을 알 수 없습니다).
 *      상승 확률 ≥ 기준값 → 산다(포지션 1) · 그 미만 → 현금(포지션 0)
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, C = root.C, M = root.M, App = root.App, REG = root.REG, EXP = root.EXP;

  const CAPITAL = 10000000;                 // 1,000만원으로 시작한다고 가정
  const COSTS = [0, 5, 10, 25, 50];         // 민감도 표에 쓸 편도 비용(bp)

  const S = { running: false, err: null, prog: null };

  function nameCell(r) {
    const w = U.el('span');
    w.appendChild(U.el('span', '', r.name + ' '));
    const def = REG.get(r.id);
    if (def && def.exec === 'pre') w.appendChild(App.badge('사전', 'badge-pre'));
    if (r.baseline) w.appendChild(App.badge('기준선', 'badge-base'));
    return w;
  }

  function cumOf(ret) {
    const out = new Array(ret.length);
    let c = 1;
    for (let i = 0; i < ret.length; i++) { c *= (1 + ret[i]); out[i] = c; }
    return out;
  }

  /* ------------------------------------------------------------------------
   *  결과 화면
   * ----------------------------------------------------------------------*/
  function resultPanels(host, run) {
    const dir = run.results.filter(function (r) { return r.task === 'direction' && r.daily; });
    if (!dir.length) {
      host.appendChild(App.note('방향 예측 모델을 하나 이상 골라 학습해야 모의투자를 할 수 있습니다.', 'warn'));
      return;
    }
    const bh = dir[0].daily.bh;
    const dates = dir[0].daily.dates;
    const bhPerf = M.perf(bh);

    dir.sort(function (a, b) { return (b.agg.sharpe.mean || -9) - (a.agg.sharpe.mean || -9); });

    /* --- 자산곡선 ------------------------------------------------------ */
    const p1 = App.panel('자산곡선', {
      sub: CAPITAL.toLocaleString('ko-KR') + '원으로 시작해 ' + run.config.ticker + '을 매매했다면'
    });
    // 기준선은 아래 회색 점선 하나로 충분합니다(같은 선을 두 번 그리면 헷갈립니다).
    const series = [];
    dir.filter(function (r) { return !r.baseline; }).slice(0, 5).forEach(function (r, i) {
      series.push({ name: r.name, values: cumOf(r.daily.ret).map(function (v) { return v * CAPITAL; }),
        color: C.seriesColor(i) });
    });
    series.push({ name: '바이앤홀드(그냥 사서 들고 있기)',
      values: cumOf(bh).map(function (v) { return v * CAPITAL; }),
      color: C.mutedColor(), dash: [5, 4], width: 2 });

    const cv = U.el('canvas');
    cv.style.height = '360px';
    p1.body.appendChild(cv);
    p1.body.appendChild(C.legend(series.map(function (s) {
      return { name: s.name, color: s.color, dash: s.dash };
    })));
    p1.body.appendChild(App.note(
      '회색 점선이 <b>아무것도 안 하고 그냥 들고 있었을 때</b>입니다. ' +
      '이 선을 넘지 못하면 그 모델은 존재할 이유가 없습니다 — 아무 일도 안 하는 쪽이 ' +
      '수수료도 안 들고 마음도 편하니까요.'));
    p1.body.appendChild(App.note(
      '<b>다섯 겹의 시험 구간을 이어 붙인 곡선입니다.</b> 각 구간은 그 앞의 과거로만 학습한 ' +
      '모델이 만든 것이라, 실제로 그때그때 굴렸다면 이랬을 것이라는 뜻에 가깝습니다.'));
    host.appendChild(p1);
    setTimeout(function () {
      C.line(cv, { labels: dates, series: series, yFmt: function (v) { return U.compact(v); } });
    }, 0);

    /* --- 성과 표 ------------------------------------------------------- */
    const p2 = App.panel('성과 비교', { sub: '거래비용 편도 ' + (run.config.costBps / 100).toFixed(2) + '% 적용 후' });
    const rows = dir.map(function (r) {
      const a = r.agg;
      const trades = Math.round(a.turnover.mean * a.n.mean);
      const row = [
        nameCell(r),
        U.won(CAPITAL * (1 + a.total.mean)),
        App.chg(a.total.mean, 1),
        U.pct(a.cagr.mean, 2),
        U.fmt(a.sharpe.mean, 2),
        U.pct(a.mdd.mean, 1),
        U.pct(a.exposure.mean, 0),
        U.comma(trades) + '회',
        U.fmt(r.agg.auc.mean, 3)
      ];
      if (r.baseline) row.__cls = 'muted';
      return row;
    });
    p2.body.appendChild(App.table([
      { label: '모델', width: '20%' },
      { label: '최종 자산 ' + App.dir('up'), num: true },
      { label: '총수익률 ' + App.dir('up'), num: true },
      { label: 'CAGR ' + App.dir('up'), num: true },
      { label: '샤프 ' + App.dir('up'), num: true },
      { label: 'MDD ' + App.dir('up'), num: true },
      { label: '투자 비중', num: true },
      { label: '매매 횟수 ' + App.dir('down'), num: true },
      { label: 'AUC ' + App.dir('up'), num: true }
    ], rows, { scroll: true }));

    p2.body.appendChild(App.formula(
      '<b>CAGR</b> — 연평균 복리 수익률. 총수익률을 기간으로 나눈 것이 아니라, ' +
      '"매년 몇 %씩 불어난 셈인가"입니다.<br>' +
      '<b>샤프지수</b> — 수익을 변동성으로 나눈 값. 같은 10%를 벌어도 마음 졸이며 번 10%와 ' +
      '편안하게 번 10%는 다르다는 뜻입니다. 1을 넘으면 훌륭합니다.<br>' +
      '<b>MDD(최대낙폭)</b> — 고점에서 얼마나 깊게 떨어졌는가. −40%면 자산이 한때 반토막 ' +
      '가까이 났다는 뜻입니다. 이걸 견딜 수 있는지가 실제로는 수익률보다 중요합니다.<br>' +
      '<b>투자 비중</b> — 전체 날 중 실제로 주식을 들고 있던 날의 비율. 100%면 늘 들고 있었다는 뜻.',
      '이 지표들이 무슨 뜻인가'));

    // AUC 순위와 샤프 순위가 다르다는 것을 직접 보여 줍니다.
    const byAuc = dir.slice().sort(function (a, b) { return b.agg.auc.mean - a.agg.auc.mean; });
    const bySharpe = dir.slice().sort(function (a, b) { return b.agg.sharpe.mean - a.agg.sharpe.mean; });
    if (byAuc.length > 1 && byAuc[0].id !== bySharpe[0].id) {
      p2.body.appendChild(App.note(
        '<b>보세요.</b> 가장 잘 맞힌 모델은 <b>' + U.escape(byAuc[0].name) + '</b>(AUC ' +
        U.fmt(byAuc[0].agg.auc.mean, 3) + ')인데, 돈을 가장 잘 번 모델은 <b>' +
        U.escape(bySharpe[0].name) + '</b>(샤프 ' + U.fmt(bySharpe[0].agg.sharpe.mean, 2) + ')입니다. ' +
        '둘은 다른 모델입니다. 이것이 이 화면의 핵심입니다.', 'ok'));
    }
    host.appendChild(p2);

    /* --- 거래비용 민감도 ------------------------------------------------ */
    const p3 = App.panel('거래비용을 바꾸면', {
      sub: '백테스트에서 살아남은 전략의 절반은 여기서 죽습니다'
    });
    p3.body.appendChild(App.note(
      '모델을 다시 학습하지 않습니다. 이미 나온 예측 확률에 <b>비용만 다시 물려</b> ' +
      '계산한 것입니다. 자주 갈아타는 모델일수록 오른쪽으로 갈수록 빠르게 무너집니다.'));

    const chead = [{ label: '모델', width: '20%' }];
    COSTS.forEach(function (c) {
      chead.push({ label: '편도 ' + (c / 100).toFixed(2) + '%', num: true });
    });
    chead.push({ label: '매매 횟수', num: true });

    const crows = dir.map(function (r) {
      const cells = [nameCell(r)];
      COSTS.forEach(function (cost) {
        const bt = EXP.backtest(r.pred.proba, r.daily.bh, run.config.threshold, cost);
        const perf = M.perf(bt.ret);
        const beat = perf.cagr > bhPerf.cagr;
        cells.push('<span class="' + (perf.cagr > 0 ? (beat ? 'up' : '') : 'down') + '">' +
          U.pct(perf.cagr, 1) + '</span>');
      });
      cells.push(U.comma(Math.round(r.agg.turnover.mean * r.agg.n.mean)) + '회');
      if (r.baseline) cells.__cls = 'muted';
      return cells;
    });
    p3.body.appendChild(App.table(chead, crows, { scroll: true }));
    p3.body.appendChild(App.note(
      '초록색은 그 비용에서도 바이앤홀드를 이겼다는 뜻입니다. ' +
      '현실의 개인 투자자 비용은 <b>편도 0.1~0.25%</b> 정도입니다(수수료 + 세금 + 슬리피지). ' +
      '그 칸에서 초록이 없다면, 이 전략들은 현실에서 돈을 벌지 못합니다.', 'warn'));
    host.appendChild(p3);

    /* --- 다음 --------------------------------------------------------- */
    const p4 = App.panel('다음 단계');
    p4.body.appendChild(App.note(
      '평균 성과만으로는 <b>언제</b> 벌고 <b>언제</b> 잃었는지 알 수 없습니다. ' +
      '국면 분석에서 상승장·횡보장·고변동 구간으로 나눠 보면, 모델마다 잘하는 상황이 ' +
      '따로 있다는 것이 드러납니다.'));
    const b = U.el('button', 'btn primary', '국면 분석으로 →');
    b.addEventListener('click', function () { App.go('regime'); });
    p4.body.appendChild(b);
    host.appendChild(p4);
  }

  /* ------------------------------------------------------------------------
   *  아직 실험을 안 돌렸을 때
   * ----------------------------------------------------------------------*/
  function emptyPanel(host) {
    const p = App.panel('먼저 모델을 학습해야 합니다');
    p.body.appendChild(App.note(
      '모의투자는 학습된 모델이 낸 신호를 그대로 따라 매매한 결과입니다. ' +
      '<b>학습 실험실</b>에서 모델을 골라 돌리고 오시거나, 아래 버튼으로 기본 설정으로 지금 돌릴 수 있습니다.'));
    const row = U.el('div');
    row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
    const b1 = U.el('button', 'btn primary', S.running ? '학습 중…' : '기본 설정으로 지금 돌리기');
    b1.disabled = S.running;
    b1.addEventListener('click', async function () {
      S.running = true; S.err = null; draw(host);
      await U.yield_();
      try {
        await EXP.run(['logistic', 'ridge', 'knn', 'forest', 'boosting', 'mlp'], {},
          function (s) { if (S.prog) S.prog(s); });
      } catch (e) { S.err = e.message; console.error(e); }
      S.running = false; draw(host);
    });
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

  /* ------------------------------------------------------------------------
   *  그리기
   * ----------------------------------------------------------------------*/
  let hostRef = null;
  function draw(host) {
    hostRef = host;
    host.innerHTML = '';
    host.appendChild(App.intro(
      '잘 맞히는 모델이 곧 <b>돈을 버는 모델은 아니라는 것</b>을 직접 확인합니다.',
      '예측이 51%만 맞아도 큰 수익이 날 수 있고, 55%를 맞혀도 거래비용에 다 먹힐 수 있습니다. ' +
      '규칙은 단순합니다 — 오른다고 하면 사고, 아니면 현금으로 쉽니다.'
    ));
    if (!App.needFullData(host)) return;

    const run = EXP.last;
    if (!run) { host.appendChild(emptyPanel(host)); return; }
    resultPanels(host, run);
  }

  App.register('trade', {
    render: function (host) { draw(host); },
    onFullData: function () { if (hostRef) draw(hostRef); }
  });
})(window.QL = window.QL || {});
