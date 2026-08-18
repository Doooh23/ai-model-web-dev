/* ============================================================================
 *  universe.js (화면) — 종목 선정
 *
 *  이 화면이 하는 말은 하나입니다.
 *      "우리는 잘 나오는 종목을 고르지 않았습니다. 기준이 골랐습니다."
 *  그래서 선정된 종목보다 **탈락한 종목과 그 사유**를 보여 주는 쪽이 중요합니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, App = root.App, DATA = root.DATA, UNIV = root.UNIV;

  const S = { showAll: false };

  function money(x) {
    if (!isFinite(x)) return '—';
    if (x >= 1e9) return (x / 1e9).toFixed(1) + 'B';
    if (x >= 1e6) return (x / 1e6).toFixed(0) + 'M';
    return U.compact(x);
  }

  function draw(host) {
    host.innerHTML = '';
    host.appendChild(App.intro(
      '실험에 쓸 종목을 <b>어떤 근거로</b> 골랐는지 표로 확인합니다.',
      '"이 종목으로 해 봤더니 잘 나왔어요"는 아무것도 증명하지 않습니다. 잘 나온 종목을 ' +
      '골랐기 때문일 수 있으니까요. 그래서 기준을 먼저 정하고, 그 기준이 종목을 고르게 했습니다.'
    ));

    if (!DATA.state.ready) return;
    const sel = UNIV.selected();
    const R = sel.rule;

    /* --- 기준 ---------------------------------------------------------- */
    const p0 = App.panel('선정 기준', { sub: '사람은 기준만 정하고 손을 뗍니다' });
    p0.body.appendChild(App.checklist([
      { ok: true, text: '<b>① 데이터 기간</b> — 전체 기간의 ' + U.pct(R.minCoverage, 0) +
        ' 이상 거래된 종목만. 최근 상장 종목은 학습에 쓸 과거가 모자랍니다.' },
      { ok: true, text: '<b>② 결측치</b> — 상장 이후 값이 빠진 날이 ' + U.pct(R.maxMissing, 0) +
        ' 미만. 구멍이 많으면 지표 계산이 어긋납니다.' },
      { ok: true, text: '<b>③ 유동성</b> — 평균 ' +
        App.tipHTML('거래대금', '하루에 사고팔린 금액(가격 × 거래량). 클수록 사고팔 때 가격이 밀리지 않아 백테스트가 현실에 가깝습니다.') +
        '이 큰 순서. 거래가 적은 종목은 "샀다고 치자"는 가정 자체가 무너집니다.' },
      { ok: true, text: '<b>④ 섹터 분산</b> — 한 섹터에서 최대 ' + R.perSector + '개까지. ' +
        '반도체만 15개 고르면 AI 모델 비교가 아니라 반도체 업황 맞히기가 됩니다.' },
      { ok: null, text: '<b>생존 편향은 이 기준으로도 못 없앱니다</b> — 애초에 데이터에 ' +
        '망해서 지수에서 빠진 회사가 없기 때문입니다. 없앨 수 없으니 밝혀 둡니다.' }
    ]));
    host.appendChild(p0);

    /* --- 선정 결과 ------------------------------------------------------ */
    const p1 = App.panel('선정된 ' + sel.picked.length + '개 종목', {
      sub: sel.nAll + '개 중 ' + sel.nPool + '개가 ①②를 통과했고, 그중 섹터별로 골랐습니다'
    });

    const g = U.el('div', 'grid g4');
    const vols = sel.pickedRows.map(function (r) { return r.vol; }).filter(isFinite);
    const secs = {};
    sel.pickedRows.forEach(function (r) { secs[r.sector] = 1; });
    g.appendChild(App.stat('선정 종목', String(sel.picked.length), sel.nAll + '개 중에서'));
    g.appendChild(App.stat('섹터 수', String(Object.keys(secs).length), '한 섹터 최대 ' + R.perSector + '개'));
    g.appendChild(App.stat('변동성 범위',
      U.pct(Math.min.apply(null, vols), 0) + ' ~ ' + U.pct(Math.max.apply(null, vols), 0),
      '연율 · 낮은 종목과 높은 종목이 섞여야 좋습니다'));
    g.appendChild(App.stat('공통 데이터 기간', DATA.state.dates[0] || '—',
      String(DATA.state.dates.length) + '거래일 · ' + (DATA.state.full ? '전체' : '최근 구간만')));
    p1.body.appendChild(g);

    const rows = sel.pickedRows.map(function (r) {
      return [
        '<b>' + r.ticker + '</b>',
        r.sector,
        U.pct(r.vol, 1),
        money(r.dollarVol),
        U.pct(r.missing, 2),
        r.first,
        App.chg(r.ret1y, 1),
        '<span class="tiny">' + U.escape(r.reason) + '</span>'
      ];
    });
    p1.body.appendChild(App.table([
      { label: '종목', width: '8%' },
      { label: '섹터' },
      { label: '변동성(연율)', num: true },
      { label: '평균 거래대금 ' + App.dir('up'), num: true },
      { label: '결측 ' + App.dir('down'), num: true },
      { label: '데이터 시작' },
      { label: '1년 수익률', num: true },
      { label: '선정 사유', width: '24%' }
    ], rows, { scroll: true }));

    p1.body.appendChild(App.note(
      '변동성 열을 보세요. <b>낮은 종목과 높은 종목이 섞여 있는 것이 중요합니다.</b> ' +
      '변동성이 비슷한 종목만 모으면 "이 모델은 조용한 종목에서만 통한다" 같은 결론을 ' +
      '낼 수 없습니다. 국면 분석(5번 화면)이 하려는 일이 바로 그것입니다.'));
    host.appendChild(p1);

    /* --- 전체 표 (탈락 사유 포함) ---------------------------------------- */
    const p2 = App.panel('전체 ' + sel.nAll + '개 종목과 탈락 사유', {
      sub: '왜 빠졌는지 확인할 수 없으면 "기준이 골랐다"는 말을 믿을 수 없습니다'
    });
    const toggle = U.el('button', 'btn sm', S.showAll ? '요약만 보기' : '전체 목록 보기');
    toggle.addEventListener('click', function () { S.showAll = !S.showAll; draw(host); });
    p2.actions.appendChild(toggle);

    if (S.showAll) {
      const all = sel.rows.map(function (r) {
        const row = [
          r.status === 'in' ? '<span class="up">선정</span>' : '<span class="tiny">탈락</span>',
          '<b>' + r.ticker + '</b>',
          r.sector,
          U.pct(r.coverage, 0),
          U.pct(r.missing, 2),
          money(r.dollarVol),
          U.pct(r.vol, 1),
          '<span class="tiny">' + U.escape(r.reason) + '</span>'
        ];
        if (r.status !== 'in') row.__cls = 'muted';
        return row;
      });
      p2.body.appendChild(App.table([
        { label: '', width: '6%' },
        { label: '종목', width: '8%' },
        { label: '섹터' },
        { label: '데이터 기간', num: true },
        { label: '결측', num: true },
        { label: '거래대금', num: true },
        { label: '변동성', num: true },
        { label: '사유', width: '28%' }
      ], all, { scroll: true }));
    } else {
      const reasons = {};
      sel.rows.forEach(function (r) {
        if (r.status === 'in') return;
        const k = r.reason.split('—')[0].trim();
        (reasons[k] = reasons[k] || []).push(r.ticker);
      });
      const rr = Object.keys(reasons).map(function (k) {
        return [k, String(reasons[k].length),
          '<span class="tiny">' + reasons[k].slice(0, 12).join(', ') +
          (reasons[k].length > 12 ? ' 외 ' + (reasons[k].length - 12) + '개' : '') + '</span>'];
      });
      p2.body.appendChild(App.table([
        { label: '탈락 사유', width: '30%' }, { label: '종목 수', num: true }, { label: '해당 종목' }
      ], rr));
    }
    host.appendChild(p2);

    /* --- 다음 --------------------------------------------------------- */
    const p3 = App.panel('다음 단계');
    p3.body.appendChild(App.note(
      '학습 실험실의 종목 목록에서 <b>선정된 ' + sel.picked.length + '개가 맨 위에</b> 올라옵니다. ' +
      '한 종목에서 좋았던 모델이 다른 종목에서도 좋은지 꼭 확인하세요. ' +
      '종목 하나의 결과는 아직 아무것도 증명하지 않습니다.'));
    const b = U.el('button', 'btn primary', '학습 실험실로 →');
    b.addEventListener('click', function () { App.go('lab'); });
    p3.body.appendChild(b);
    host.appendChild(p3);
  }

  let hostRef = null;
  App.register('universe', {
    render: function (host) { hostRef = host; draw(host); },
    onFullData: function () { if (hostRef) draw(hostRef); }
  });
})(window.QL = window.QL || {});
