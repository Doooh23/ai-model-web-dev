/* ============================================================================
 *  trade.js — 모의투자
 *  (뼈대만 있습니다. 4단계 '화면' 작업에서 채웁니다.)
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, App = root.App;

  App.register('trade', {
    render: function (host) {
      host.appendChild(App.intro('잘 맞히는 모델이 곧 <b>돈을 버는 모델은 아니라는 것</b>을 직접 확인합니다.',
        '예측이 51%만 맞아도 큰 수익이 날 수 있고, 55%를 맞혀도 거래비용에 다 먹힐 수 있습니다.'));

      const p = App.panel('모의투자');
      p.body.appendChild(App.note(
        '<b>이 화면은 아직 뼈대입니다.</b> 아래 내용이 들어올 자리입니다.', 'warn'));
      const ul = U.el('ul');
      ul.style.cssText = 'margin:8px 0 0;padding-left:18px;color:var(--ink-2);font-size:12.5px;line-height:1.7';
      ul.innerHTML = '<li>모델 신호대로 매매했을 때의 자산곡선 비교</li>' +
        '<li>CAGR·샤프지수·최대낙폭·거래 횟수</li>' +
        '<li>거래비용(편도 0.1%)과 슬리피지를 모든 모델에 동일 적용</li>' +
        '<li>바이앤홀드와의 직접 비교</li>';
      p.body.appendChild(ul);
      host.appendChild(p);
    }
  });
})(window.QL = window.QL || {});
