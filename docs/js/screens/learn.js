/* ============================================================================
 *  learn.js — 배우기
 *  (뼈대만 있습니다. 4단계 '화면' 작업에서 채웁니다.)
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, App = root.App;

  App.register('learn', {
    render: function (host) {
      host.appendChild(App.intro('여기서 쓴 개념을 <b>순서대로 처음부터</b> 배웁니다.',
        '모르는 용어가 나오면 언제든 이 화면으로 돌아오세요.'));

      const p = App.panel('배우기');
      p.body.appendChild(App.note(
        '<b>이 화면은 아직 뼈대입니다.</b> 아래 내용이 들어올 자리입니다.', 'warn'));
      const ul = U.el('ul');
      ul.style.cssText = 'margin:8px 0 0;padding-left:18px;color:var(--ink-2);font-size:12.5px;line-height:1.7';
      ul.innerHTML = '<li>쉽게 그대로 설명: 방향 예측, 정확도·수익률·최대낙폭, 워크포워드와 데이터 누출, 기준선 대비 점수</li>' +
        '<li>비유·그림으로: 신경망과 LSTM, GARCH(변동성은 뭉쳐서 온다), AUC, 샤프지수, HMM 국면</li>' +
        '<li>개념만: Diebold-Mariano 검정, 부트스트랩 신뢰구간, HAR-RV → 결과만 ✓/✗로</li>';
      p.body.appendChild(ul);
      host.appendChild(p);
    }
  });
})(window.QL = window.QL || {});
