/* ============================================================================
 *  models.js — 모델 도감
 *
 *  비교에 들어가는 모델을 전부 카드로 늘어놓습니다. 카드 내용은 registry.js에
 *  적어 둔 것을 그대로 읽어 옵니다. 즉 모델을 하나 추가하면 이 화면은
 *  고치지 않아도 자동으로 늘어납니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, App = root.App, REG = root.REG;

  const S = { task: 'direction' };

  // 연산량·해석가능성을 점 다섯 개로 (숫자보다 눈에 빨리 들어옵니다)
  function dots(level, max) {
    const n = max || 5;
    const s = U.el('span', 'dots');
    let html = '';
    for (let i = 1; i <= n; i++) {
      html += (i <= level) ? '●' : '<span class="off">●</span>';
    }
    s.innerHTML = html;
    return s;
  }
  const INTERP = { '상': 3, '중': 2, '하': 1 };

  function card(d) {
    const c = U.el('div', 'card' + (d.make ? '' : ' soon'));

    const top = U.el('div', 'card-top');
    top.appendChild(U.el('span', 'card-name', d.name));
    top.appendChild(App.modelBadge(d));
    if (d.baseline) top.appendChild(App.badge('기준선', 'badge-base'));
    if (!d.make) top.appendChild(App.badge('준비 중', 'badge-soon'));
    const fam = U.el('span', 'card-fam');
    fam.style.marginLeft = 'auto';
    fam.textContent = d.family;
    top.appendChild(fam);
    c.appendChild(top);

    const why = U.el('div', 'card-why');
    why.textContent = d.analogy;
    c.appendChild(why);

    const pc = U.el('div', 'card-pc');
    const good = U.el('div');
    good.innerHTML = '<div class="h good">잘하는 것</div><ul>' +
      d.pros.map(function (x) { return '<li>' + U.escape(x) + '</li>'; }).join('') + '</ul>';
    const bad = U.el('div');
    bad.innerHTML = '<div class="h bad">못하는 것</div><ul>' +
      d.cons.map(function (x) { return '<li>' + U.escape(x) + '</li>'; }).join('') + '</ul>';
    pc.appendChild(good); pc.appendChild(bad);
    c.appendChild(pc);

    const m1 = U.el('div', 'card-meter');
    m1.appendChild(U.el('span', '', '연산량'));
    m1.appendChild(dots(d.cost));
    m1.appendChild(U.el('span', '', '· 해석 가능성'));
    m1.appendChild(dots(INTERP[d.interpret] || 2, 3));
    c.appendChild(m1);

    return c;
  }

  function draw(host) {
    host.innerHTML = '';

    host.appendChild(App.intro(
      '비교에 들어가는 모델들이 <b>각각 어떤 원리로 답을 내는지</b>, 그리고 왜 이 모델들을 골랐는지 알게 됩니다.',
      '모델 이름을 외울 필요는 없습니다. "이 모델은 무엇에 비유되는가" 한 줄씩만 기억하면 ' +
      '나중에 성적표를 볼 때 결과가 납득이 갑니다.'
    ));

    /* --- 과제 고르기 ------------------------------------------------------ */
    const nav = App.panel('무엇을 예측하는 문제인가', { tight: true });
    const segWrap = U.el('div');
    segWrap.style.padding = '10px 12px';
    const seg = U.el('div', 'seg');
    ['direction', 'volatility', 'regime'].forEach(function (k) {
      const t = REG.TASKS[k];
      const b = U.el('button', S.task === k ? 'on' : '', t.name + ' — ' + t.short);
      b.addEventListener('click', function () { S.task = k; draw(host); });
      seg.appendChild(b);
    });
    segWrap.appendChild(seg);
    const t = REG.TASKS[S.task];
    const about = U.el('div', 'small');
    about.style.marginTop = '9px';
    about.innerHTML = t.about + ' <span class="tiny">· 모델이 내놓는 값: ' + U.escape(t.output) +
      ' · 채점 지표: ' + U.escape(t.metric) + '</span>';
    segWrap.appendChild(about);
    nav.body.appendChild(segWrap);
    host.appendChild(nav);

    const list = REG.list({ task: S.task });
    const live = list.filter(function (d) { return d.exec === 'live' && !d.baseline; });
    const pre = list.filter(function (d) { return d.exec === 'pre'; });
    const base = list.filter(function (d) { return d.baseline; });

    /* --- 카드 ------------------------------------------------------------- */
    function section(title, sub, arr) {
      if (!arr.length) return;
      const p = App.panel(title, { sub: sub });
      const g = U.el('div', 'cards');
      arr.forEach(function (d) { g.appendChild(card(d)); });
      p.body.appendChild(g);
      host.appendChild(p);
    }

    section('실시간 학습 모델 <span class="badge badge-live">실시간 학습</span>',
      '학습 실험실에서 버튼을 누르면 지금 이 자리에서 학습합니다', live);
    section('사전 학습 모델 <span class="badge badge-pre">사전 학습</span>',
      '브라우저에서 돌리기엔 무거워서, 파이썬으로 미리 학습해 예측값만 가져옵니다', pre);
    section('기준선 <span class="badge badge-base">기준선</span>',
      '점수의 0점을 정하는 상대들입니다. 이들을 못 이기면 그 모델은 쓸모가 없습니다', base);

    /* --- 선정 기준 점수표 ------------------------------------------------- */
    const p2 = App.panel('왜 이 모델들을 골랐나 — 선정 기준표',
      { sub: '성능은 선정 기준이 아닙니다. 성능은 실험해서 알아내는 것이니까요' });

    p2.body.appendChild(App.note(
      '모델을 고른 기준은 세 가지입니다. ' +
      '<b>①계열이 겹치지 않을 것</b> — 비슷한 모델만 모으면 비교가 아니라 반복입니다. ' +
      '<b>②감당 가능한 연산량</b> — 학생 노트북 브라우저에서 몇 초 안에 끝나야 직접 돌려 볼 수 있습니다. ' +
      '무거운 것은 파이썬으로 보냈습니다. ' +
      '<b>③기준선 포함</b> — 잘하는 모델만 모아 놓으면 "잘한다"는 말의 뜻이 사라집니다.'));

    const rows = list.map(function (d) {
      const nameCell = U.el('span');
      nameCell.textContent = d.name;
      return [
        nameCell,
        d.family,
        d.exec === 'pre' ? '사전 학습' : '실시간',
        d.baseline ? '기준선' : '비교 대상',
        dots(d.cost),
        d.interpret,
        d.make ? '✓' : '준비 중'
      ];
    });
    p2.body.appendChild(App.table([
      { label: '모델', width: '20%' },
      { label: '계열' },
      { label: '실행 위치' },
      { label: '역할' },
      { label: '연산량 ' + App.dir('down') },
      { label: '해석 가능성 ' + App.dir('up') },
      { label: '지금 실행' }
    ], rows, { scroll: true }));

    p2.body.appendChild(App.formula(
      '연산량은 브라우저에서 3000일 × 15개 피처를 학습할 때의 대략적인 부담을 1~5로 매긴 값입니다.<br>' +
      '해석 가능성 <b>상</b> = 계수나 규칙을 그대로 읽을 수 있음 (로지스틱·k-NN·규칙)<br>' +
      '해석 가능성 <b>중</b> = 어느 피처가 중요했는지까지는 알 수 있음 (트리 계열)<br>' +
      '해석 가능성 <b>하</b> = 사실상 블랙박스 (신경망·커널)<br>' +
      '이 두 값은 종합 점수표의 <b>실용성 축(15%)</b>에 그대로 들어갑니다.',
      '이 표의 숫자는 어떻게 매겼나'));
    host.appendChild(p2);
  }

  App.register('models', {
    render: function (host) { draw(host); },
    onFullData: function () { }
  });
})(window.QL = window.QL || {});
