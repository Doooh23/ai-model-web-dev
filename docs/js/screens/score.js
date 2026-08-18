/* ============================================================================
 *  score.js — 종합 점수표
 *  (뼈대만 있습니다. 4단계 '화면' 작업에서 채웁니다.)
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, App = root.App;

  App.register('score', {
    render: function (host) {
      host.appendChild(App.intro('네 개의 축으로 모델에 점수를 매기고, <b>가중치를 직접 바꿔 가며</b> 순위가 어떻게 흔들리는지 봅니다.',
        '점수표는 항상 "왜 그 지표?", "왜 그 가중치?", "우연 아냐?"로 공격받습니다. 이 화면은 그 셋에 답하려고 만들었습니다.'));

      const p = App.panel('종합 점수표');
      p.body.appendChild(App.note(
        '<b>이 화면은 아직 뼈대입니다.</b> 아래 내용이 들어올 자리입니다.', 'warn'));
      const ul = U.el('ul');
      ul.style.cssText = 'margin:8px 0 0;padding-left:18px;color:var(--ink-2);font-size:12.5px;line-height:1.7';
      ul.innerHTML = '<li>기준선 대비 점수 — 0점 = 기준선과 같음, 음수 = 기준선보다 못함</li>' +
        '<li>예측력 30% · 투자 성과 30% · 안정성 25% · 실용성 15% (슬라이더로 조절)</li>' +
        '<li>축별 레이더 차트 + 종합 순위표 + 원시 지표(AUC·샤프·MDD) 동시 노출</li>' +
        '<li>부트스트랩 신뢰구간, Diebold-Mariano 검정, 시도한 하이퍼파라미터 조합 수</li>' +
        '<li>최종 결론은 1등 모델이 아니라 <b>축별 승자</b>로</li>';
      p.body.appendChild(ul);
      host.appendChild(p);
    }
  });
})(window.QL = window.QL || {});
