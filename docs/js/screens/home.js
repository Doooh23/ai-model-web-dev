/* ============================================================================
 *  home.js — 시작하기
 *  처음 온 학생에게 "여기가 무엇을 하는 곳이고, 무엇부터 눌러야 하는지"를
 *  한 화면에서 알려 줍니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, App = root.App, DATA = root.DATA, REG = root.REG, PRED = root.PRED;

  const ORDER = [
    { id: 'models', n: 1, title: '모델 도감',
      what: '비교할 모델들이 각각 어떤 원리로 답을 내는지 먼저 읽습니다.',
      why: '이름만 알고 결과를 보면 숫자를 해석할 수 없습니다.' },
    { id: 'universe', n: 2, title: '종목 선정',
      what: '나스닥100에서 실험에 쓸 10~20개를 고르고, 왜 골랐는지 표로 남깁니다.',
      why: '종목을 잘못 고르면 그 뒤의 모든 비교가 흔들립니다.' },
    { id: 'lab', n: 3, title: '학습 실험실',
      what: '모델을 여러 개 골라 똑같은 조건으로 한꺼번에 학습시킵니다.',
      why: '조건이 하나라도 다르면 성적 차이가 모델 때문인지 알 수 없습니다.' },
    { id: 'trade', n: 4, title: '모의투자',
      what: '모델이 낸 신호대로 실제로 사고팔았다면 얼마가 됐을지 계산합니다.',
      why: '잘 맞히는 것과 돈을 버는 것은 다른 문제입니다.' },
    { id: 'regime', n: 5, title: '국면 분석',
      what: '상승장·하락장·고변동 구간을 나눠 모델별 성적을 따로 봅니다.',
      why: '"어떤 모델이 좋은가"의 답은 대개 "어떤 상황에서?"에 달려 있습니다.' },
    { id: 'score', n: 6, title: '종합 점수표',
      what: '네 개의 축으로 점수를 매기고, 가중치를 직접 바꿔 가며 순위를 봅니다.',
      why: '점수가 어떻게 만들어졌는지 모르면 그 순위를 믿을 수 없습니다.' },
    { id: 'learn', n: 7, title: '배우기',
      what: '여기서 쓴 개념들을 처음부터 차근차근 설명합니다.',
      why: '막히면 언제든 돌아올 곳.' }
  ];

  App.register('home', {
    render: function (host) {
      host.appendChild(App.intro(
        '여러 AI 모델에게 <b>똑같은 문제</b>를 내고, 어떤 모델이 어떤 상황에 적합한지 점수로 비교합니다.',
        '이 사이트는 "가장 좋은 모델"을 하나 뽑지 않습니다. 방향 예측에 강한 모델, 변동성 예측에 강한 모델, ' +
        '요동치는 구간에서 강한 모델이 각각 다르기 때문입니다. 결론은 항상 <b>축별 승자</b>로 냅니다.'
      ));

      /* --- 지금 데이터 상태 ------------------------------------------------ */
      const m = DATA.state.meta || {};
      const p1 = App.panel('데이터 현황', { sub: '매일 미국장 마감 뒤 자동으로 갱신됩니다' });
      const g = U.el('div', 'grid g4');
      g.appendChild(App.stat('마지막 갱신', (m.updated || '—').replace(' UTC', ''), 'UTC 기준'));
      g.appendChild(App.stat('종목 수', String(m.n_tickers || DATA.state.tickers.length), '나스닥100 + 벤치마크'));
      g.appendChild(App.stat('거래일 수', U.comma(m.n_days || DATA.state.dates.length),
        (m.first_date || '—') + ' ~ ' + (m.last_date || '—')));
      const sum = REG.summary();
      g.appendChild(App.stat('등록된 모델', sum.ready + ' / ' + sum.total,
        sum.pending ? (sum.pending + '개는 준비 중') : '전부 실행 가능'));
      p1.body.appendChild(g);

      const preLine = (PRED && PRED.state.loaded && PRED.state.ok)
        ? '사전 학습 결과 파일을 읽었습니다. LSTM·Transformer 같은 무거운 모델도 비교에 들어갑니다.'
        : '사전 학습 결과 파일(<code>data/predictions.json</code>)이 아직 없습니다. ' +
          '브라우저에서 직접 돌리는 모델만 비교할 수 있습니다.';
      p1.body.appendChild(App.note(preLine, (PRED && PRED.state.ok) ? 'ok' : 'warn'));
      host.appendChild(p1);

      /* --- 학습 순서 ------------------------------------------------------- */
      const p2 = App.panel('이 순서대로 보세요', { sub: '위에서부터 차례로 눌러 가면 됩니다' });
      const route = U.el('div', 'route');
      ORDER.forEach(function (s) {
        const row = U.el('div', 'card');
        row.appendChild(U.el('span', 'route-n', String(s.n)));

        const mid = U.el('div');
        mid.style.flex = '1';
        mid.appendChild(U.el('div', 'card-name', s.title));
        const why = U.el('div', 'card-why');
        why.innerHTML = s.what + ' <span class="tiny">— ' + U.escape(s.why) + '</span>';
        mid.appendChild(why);
        row.appendChild(mid);

        const btn = U.el('button', 'btn sm', '열기');
        btn.addEventListener('click', function () { App.go(s.id); });
        row.appendChild(btn);

        route.appendChild(row);
      });
      p2.body.appendChild(route);
      host.appendChild(p2);

      /* --- 먼저 알아 둘 것 -------------------------------------------------- */
      const p3 = App.panel('시작하기 전에 알아 둘 것');
      p3.body.appendChild(App.checklist([
        { ok: null, text: '데이터에 <b>생존 편향</b>이 있습니다 — ' +
          App.tipHTML('생존 편향', '지금까지 살아남은 종목만 담겨 있어서, 중간에 망해 지수에서 빠진 회사가 없습니다. 그래서 과거 성적이 실제보다 좋아 보입니다.') +
          '. 지금 나스닥100에 남아 있는 종목만 들어 있습니다.' },
        { ok: true, text: '모든 모델은 <b>같은 종목·같은 기간·같은 피처·같은 시드</b>로 비교합니다.' },
        { ok: true, text: '학습과 시험은 <b>항상 시간순</b>으로 나눕니다. 무작위 분할은 아예 제공하지 않습니다.' },
        { ok: true, text: '거래비용과 슬리피지를 모든 모델에 <b>똑같이</b> 물립니다.' },
        { ok: false, text: '이 사이트의 결과로 실제 투자를 하면 안 됩니다. 교육·연구용입니다.' }
      ]));
      host.appendChild(p3);
    }
  });
})(window.QL = window.QL || {});
