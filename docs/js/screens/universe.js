/* ============================================================================
 *  universe.js — 종목 선정
 *  (뼈대만 있습니다. 4단계 '화면' 작업에서 채웁니다.)
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, App = root.App;

  App.register('universe', {
    render: function (host) {
      host.appendChild(App.intro('실험에 쓸 종목을 <b>어떤 근거로</b> 골랐는지 표로 확인합니다.',
        '종목을 마음대로 고르면 "잘 나오는 종목만 골랐다"는 의심을 피할 수 없습니다. 기준을 먼저 정하고 그 기준으로 자동으로 뽑습니다.'));

      const p = App.panel('종목 선정');
      p.body.appendChild(App.note(
        '<b>이 화면은 아직 뼈대입니다.</b> 아래 내용이 들어올 자리입니다.', 'warn'));
      const ul = U.el('ul');
      ul.style.cssText = 'margin:8px 0 0;padding-left:18px;color:var(--ink-2);font-size:12.5px;line-height:1.7';
      ul.innerHTML = '<li>나스닥100 전 종목의 변동성·평균 거래대금·결측치 비율·데이터 시작일 표</li>' +
        '<li>섹터가 한쪽으로 쏠리지 않게 분산해서 10~20개를 자동 선정</li>' +
        '<li>선정/탈락 사유를 종목마다 한 줄로 표시</li>' +
        '<li>생존 편향 경고 고정 노출</li>';
      p.body.appendChild(ul);
      host.appendChild(p);
    }
  });
})(window.QL = window.QL || {});
