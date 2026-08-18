/* ============================================================================
 *  regime.js (화면) — 국면 분석
 *
 *  "어떤 모델이 좋은가"의 답은 거의 항상 "어떤 상황에서?"에 달려 있습니다.
 *  상승장에서 1등인 모델이 폭락장에서 꼴찌인 일이 흔합니다. 평균 하나로
 *  뭉뚱그리면 그 사실이 완전히 가려집니다.
 *
 *  그래서 시장을 먼저 상승 / 횡보 / 고변동으로 나누고, **같은 성적표를
 *  국면별로 다시 계산**합니다. 국면을 나누는 일에는 정답이 없으므로
 *  (아무도 "이 날은 상승장이었다"고 적어 두지 않았습니다) 맞고 틀리고를
 *  따지지 않고 오직 '나누는 자'로만 씁니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, C = root.C, M = root.M, App = root.App, EXP = root.EXP, REG = root.REG;

  const COLORS = ['#0e8a5f', '#8a8580', '#d3453b'];   // 상승 / 횡보 / 고변동
  const S = { running: false, err: null, prog: null };

  function nameCell(r) {
    const w = U.el('span');
    w.appendChild(U.el('span', '', r.name + ' '));
    if (r.baseline) w.appendChild(App.badge('기준선', 'badge-base'));
    return w;
  }

  /* ------------------------------------------------------------------------
   *  국면 라벨과 다른 모델의 성적을 날짜로 맞춥니다
   * ----------------------------------------------------------------------*/
  function analyze(run) {
    const km = run.results.filter(function (r) { return r.id === 'kmeans3'; })[0];
    const iso = run.results.filter(function (r) { return r.id === 'iforest'; })[0];
    if (!km || !km.daily) return null;

    const labels = km.daily.labels, dates = km.daily.dates, ret = km.daily.ret;
    const byDate = {};
    for (let i = 0; i < dates.length; i++) byDate[dates[i]] = labels[i];

    // 국면별 이름 — 학습 구간에서 실제 평균을 보고 붙인 이름을 그대로 씁니다.
    const info = km.info || [];
    const names = [0, 1, 2].map(function (g) {
      return (info[g] && info[g].name) ? info[g].name : (g + 1) + '번 국면';
    });

    // 시험 구간에서의 국면별 실제 모습
    const summary = [0, 1, 2].map(function (g) {
      const rr = [];
      for (let i = 0; i < labels.length; i++) if (labels[i] === g) rr.push(ret[i]);
      const up = rr.filter(function (x) { return x > 0; }).length;
      return {
        g: g, name: names[g], n: rr.length,
        share: labels.length ? rr.length / labels.length : 0,
        mean: rr.length ? U.mean(rr) : NaN,
        vol: rr.length > 2 ? U.std(rr, 1) * Math.sqrt(252) : NaN,
        upRate: rr.length ? up / rr.length : NaN,
        fit: info[g] || null
      };
    });

    // 모델별 · 국면별 성적
    const models = run.results.filter(function (r) { return r.task === 'direction' && r.pred; });
    const perModel = models.map(function (r) {
      const cells = [0, 1, 2].map(function (g) {
        const y = [], p = [], sr = [];
        for (let i = 0; i < r.daily.dates.length; i++) {
          if (byDate[r.daily.dates[i]] !== g) continue;
          y.push(r.pred.y[i]); p.push(r.pred.proba[i]); sr.push(r.daily.ret[i]);
        }
        return {
          n: y.length,
          auc: y.length > 20 ? M.auc(y, p) : NaN,
          annual: sr.length ? U.mean(sr) * 252 : NaN
        };
      });
      return { r: r, cells: cells };
    });

    // 이상치 상위
    let odd = [];
    if (iso && iso.daily) {
      const sc = iso.daily.labels;                 // 이상 점수(0~1)가 담겨 있습니다
      odd = sc.map(function (v, i) {
        return { date: iso.daily.dates[i], score: v, ret: iso.daily.ret[i],
          regime: byDate[iso.daily.dates[i]] };
      }).sort(function (a, b) { return b.score - a.score; }).slice(0, 12);
    }

    return { km: km, iso: iso, labels: labels, dates: dates, names: names,
      summary: summary, perModel: perModel, odd: odd };
  }

  /* ------------------------------------------------------------------------
   *  화면
   * ----------------------------------------------------------------------*/
  function resultPanels(host, run, A) {
    /* --- 국면 띠 -------------------------------------------------------- */
    const p1 = App.panel('시장을 셋으로 나누면', {
      sub: 'k-means가 수익률과 변동성 두 축만 보고 스스로 나눈 것입니다'
    });
    const cv = U.el('canvas');
    cv.style.height = '86px';
    p1.body.appendChild(cv);
    p1.body.appendChild(C.legend(A.summary.map(function (s, i) {
      return { name: s.name + ' (' + s.n + '일)', color: COLORS[i] };
    })));
    p1.body.appendChild(App.note(
      '빨간 띠(고변동)가 어느 시기에 몰려 있는지 보세요. 모델에게 아무도 코로나나 금리 인상을 ' +
      '알려 주지 않았는데도 <b>수익률과 변동성 두 숫자만으로</b> 그 시기를 찾아냅니다.'));
    p1.body.appendChild(App.note(
      '<b>그런데 띠가 하루 단위로 튀는 것도 보일 겁니다.</b> k-means는 날짜 순서를 전혀 모르기 ' +
      '때문입니다. 어제가 무슨 국면이었는지 모른 채 그날 하루의 숫자만 보고 판단합니다. ' +
      '실제 장세는 하루아침에 바뀌지 않으니 이건 분명한 약점입니다. ' +
      '"국면은 잘 안 바뀐다"는 성질까지 넣으려면 ' +
      App.tipHTML('HMM', '은닉 마르코프 모델. 상태와 상태 사이를 오가는 확률까지 함께 추정해서, 국면이 하루 단위로 튀지 않습니다.') +
      '이 필요하고, 그건 파이썬으로 미리 학습해야 합니다.', 'warn'));
    host.appendChild(p1);
    setTimeout(function () {
      C.ribbon(cv, { labels: A.labels, dates: A.dates, colors: COLORS });
    }, 0);

    /* --- 국면 요약 ------------------------------------------------------ */
    const p2 = App.panel('국면별 성격', { sub: '이름은 미리 정한 것이 아니라 실제 평균을 보고 붙였습니다' });
    const rows = A.summary.map(function (s, i) {
      const dot = '<span class="legend-dot" style="background:' + COLORS[i] + ';display:inline-block;margin-right:6px"></span>';
      return [
        dot + '<b>' + s.name + '</b>',
        U.comma(s.n) + '일',
        U.pct(s.share, 0),
        s.fit ? U.pct(s.fit.ret, 1) : '—',
        s.fit ? U.pct(s.fit.vol, 0) : '—',
        App.chg(s.mean, 3),
        U.pct(s.vol, 0),
        U.pct(s.upRate, 1)
      ];
    });
    p2.body.appendChild(App.table([
      { label: '국면', width: '20%' },
      { label: '시험 구간 일수', num: true },
      { label: '비중', num: true },
      { label: '학습 구간<br>평균 21일 수익률', num: true },
      { label: '학습 구간<br>평균 변동성', num: true },
      { label: '다음날 평균 수익률', num: true },
      { label: '실현 변동성(연율)', num: true },
      { label: '상승일 비율', num: true }
    ], rows));
    // 숫자를 직접 읽어 문장을 만듭니다(그래야 데이터가 바뀌어도 설명이 틀리지 않습니다).
    const hv = A.summary[2], calm = A.summary[1];
    const ratio = (isFinite(hv.vol) && isFinite(calm.vol) && calm.vol > 0) ? hv.vol / calm.vol : NaN;
    p2.body.appendChild(App.note(
      '<b>고변동 국면을 다른 국면과 견줘 보세요.</b> 하루 움직임이 ' +
      (isFinite(ratio) ? '<b>' + ratio.toFixed(1) + '배</b> 큽니다(연율 ' + U.pct(hv.vol, 0) +
        ' vs ' + U.pct(calm.vol, 0) + ').' : '훨씬 큽니다.') +
      ' 그런데 상승일 비율은 ' + U.pct(hv.upRate, 1) + '로 ' + U.pct(calm.upRate, 1) +
      '와 크게 다르지 않습니다. <b>방향은 여전히 알기 어려운데 틀렸을 때 잃는 돈만 커진다</b>는 뜻입니다. ' +
      '이 구간에서 모델 순위가 가장 크게 뒤집히는 이유입니다.'));
    host.appendChild(p2);

    /* --- 국면별 모델 성적 ----------------------------------------------- */
    if (A.perModel.length) {
      const p3 = App.panel('국면별 모델 성적 — 누가 어디서 강한가', {
        sub: '평균 하나로 뭉뚱그리면 완전히 가려지는 부분입니다'
      });

      const heads = [{ label: '모델', width: '18%' }];
      A.summary.forEach(function (s, i) {
        heads.push({ label: '<span style="color:' + COLORS[i] + '">●</span> ' + s.name + '<br><span class="tiny">AUC</span>', num: true });
      });
      A.summary.forEach(function (s, i) {
        heads.push({ label: '<span style="color:' + COLORS[i] + '">●</span> ' + s.name + '<br><span class="tiny">연율 수익</span>', num: true });
      });

      const body = A.perModel.map(function (m) {
        const cells = [nameCell(m.r)];
        m.cells.forEach(function (c) {
          cells.push(isFinite(c.auc)
            ? '<span class="' + (c.auc > 0.5 ? 'up' : 'down') + '">' + U.fmt(c.auc, 3) + '</span>'
            : '<span class="tiny">표본 부족</span>');
        });
        m.cells.forEach(function (c) {
          cells.push(isFinite(c.annual)
            ? '<span class="' + (c.annual > 0 ? 'up' : 'down') + '">' + U.signPct(c.annual, 1) + '</span>'
            : '—');
        });
        if (m.r.baseline) cells.__cls = 'muted';
        return cells;
      });
      p3.body.appendChild(App.table(heads, body, { scroll: true }));

      // 국면별 승자 자동 문장
      const winners = A.summary.map(function (s, g) {
        let best = null;
        A.perModel.forEach(function (m) {
          if (m.r.baseline) return;
          const c = m.cells[g];
          if (!isFinite(c.auc)) return;
          if (!best || c.auc > best.auc) best = { name: m.r.name, auc: c.auc };
        });
        return { name: s.name, best: best };
      });
      const lines = winners.filter(function (w) { return w.best; }).map(function (w) {
        return '<b>' + U.escape(w.name) + '</b>에서는 ' + U.escape(w.best.name) +
          ' (AUC ' + U.fmt(w.best.auc, 3) + (w.best.auc > 0.5 ? '' : ' — 그래도 0.5 미만') + ')';
      });
      if (lines.length) {
        p3.body.appendChild(App.note('<b>국면별 1위</b><br>' + lines.join('<br>') +
          '<br><br>세 국면의 1위가 서로 다르다면, "이 모델이 제일 좋다"는 말은 성립하지 않습니다. ' +
          '같다면 그 모델은 상황을 가리지 않는다는 뜻이니 더 믿을 만합니다.', 'ok'));
      }
      host.appendChild(p3);
    }

    /* --- 이상치 -------------------------------------------------------- */
    if (A.odd.length) {
      const p4 = App.panel('이상한 날 찾기 — Isolation Forest', {
        sub: '몇 번만 잘라도 혼자 떨어져 나오는 날'
      });
      p4.body.appendChild(App.note(
        '이 모델은 "정상이 무엇인가"를 배우지 않습니다. 그냥 아무 기준으로나 데이터를 계속 ' +
        '반으로 자르면서, <b>몇 번 만에 혼자 남는지</b>를 셉니다. 몇 번 안 잘라도 혼자 떨어지는 ' +
        '날이 이상한 날입니다. 점수가 0.6을 넘으면 눈여겨볼 만합니다.'));
      const rows2 = A.odd.map(function (o) {
        return [
          o.date,
          U.fmt(o.score, 3),
          App.chg(o.ret, 2),
          o.regime !== undefined && A.names[o.regime] ? A.names[o.regime] : '—'
        ];
      });
      p4.body.appendChild(App.table([
        { label: '날짜', width: '20%' },
        { label: '이상 점수 ' + App.dir('up'), num: true },
        { label: '그날 수익률', num: true },
        { label: '그날의 국면' }
      ], rows2));
      p4.body.appendChild(App.note(
        '<b>"이상"이 곧 "위험"이나 "기회"는 아닙니다.</b> 이 모델은 평소와 다르다는 것만 ' +
        '말해 줄 뿐, 그래서 사야 하는지 팔아야 하는지는 말해 주지 않습니다. 해석은 사람 몫입니다.', 'warn'));
      host.appendChild(p4);
    }

    /* --- 다음 --------------------------------------------------------- */
    const p5 = App.panel('다음 단계');
    p5.body.appendChild(App.note(
      '이제 네 축(예측력·투자 성과·안정성·실용성)으로 점수를 매길 차례입니다. ' +
      '국면별 성적 차이가 컸다면, 종합 점수표의 <b>안정성 축</b>이 그 흔들림을 잡아냅니다.'));
    const b = U.el('button', 'btn primary', '종합 점수표로 →');
    b.addEventListener('click', function () { App.go('score'); });
    p5.body.appendChild(b);
    host.appendChild(p5);
  }

  /* ------------------------------------------------------------------------
   *  국면 모델 실행 (기존 실험 결과에 얹습니다)
   * ----------------------------------------------------------------------*/
  async function runRegime(host) {
    S.running = true; S.err = null;
    draw(host);
    await U.yield_();
    try {
      const prev = EXP.last;
      // 앞서 돌린 모델을 함께 넘겨야 EXP.last 가 통째로 바뀌지 않습니다.
      // 이미 캐시에 있으므로 다시 계산하지는 않습니다.
      const ids = (prev ? prev.asked : ['logistic', 'ridge', 'knn', 'forest', 'boosting', 'mlp'])
        .concat(['kmeans3', 'iforest']);
      await EXP.run(ids, prev ? prev.config : {}, function (s) { if (S.prog) S.prog(s); });
    } catch (e) { S.err = e.message; console.error(e); }
    S.running = false;
    draw(host);
  }

  function startPanel(host, hasRun) {
    const p = App.panel(hasRun ? '국면을 나눠 봅시다' : '먼저 모델을 학습해야 합니다');
    p.body.appendChild(App.note(hasRun
      ? '앞서 돌린 실험 결과 위에 <b>국면 라벨</b>을 얹습니다. 모델은 다시 학습하지 않고 ' +
        'k-means와 Isolation Forest만 추가로 돌립니다. 몇 초면 끝납니다.'
      : '국면별 성적을 보려면 먼저 방향 예측 모델이 학습되어 있어야 합니다. ' +
        '아래 버튼을 누르면 기본 모델 6개와 국면 모델을 한 번에 돌립니다.'));

    const row = U.el('div');
    row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
    const b1 = U.el('button', 'btn primary', S.running ? '계산 중…' : '국면 나누기 실행');
    b1.disabled = S.running;
    b1.addEventListener('click', function () { runRegime(host); });
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

  let hostRef = null;
  function draw(host) {
    hostRef = host;
    host.innerHTML = '';
    host.appendChild(App.intro(
      '"어떤 모델이 좋은가"의 답이 <b>상황에 따라 달라진다</b>는 것을 봅니다.',
      '상승장에서 1등인 모델이 폭락장에서는 꼴찌인 경우가 흔합니다. 평균 하나로 뭉뚱그리면 ' +
      '그 사실이 완전히 가려집니다. 그래서 시장을 셋으로 나눈 뒤 성적표를 다시 계산합니다.'
    ));
    if (!App.needFullData(host)) return;

    const run = EXP.last;
    const A = run ? analyze(run) : null;
    if (!A) { host.appendChild(startPanel(host, !!run)); return; }
    resultPanels(host, run, A);
  }

  App.register('regime', {
    render: function (host) { draw(host); },
    onFullData: function () { if (hostRef) draw(hostRef); }
  });
})(window.QL = window.QL || {});
