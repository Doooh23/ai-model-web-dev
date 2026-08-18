/* ============================================================================
 *  lab.js — 학습 실험실
 *  (뼈대만 있습니다. 4단계 '화면' 작업에서 채웁니다.)
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, App = root.App;

  App.register('lab', {
    render: function (host) {
      host.appendChild(App.intro('모델 여러 개를 <b>완전히 같은 조건으로</b> 학습시켜 예측력을 비교합니다.',
        '조건이 하나라도 다르면 성적 차이가 모델 실력인지 조건 차이인지 알 수 없습니다. 그래서 조건을 화면에 체크리스트로 붙박아 둡니다.'));

      const p = App.panel('학습 실험실');
      p.body.appendChild(App.note(
        '<b>이 화면은 아직 뼈대입니다.</b> 아래 내용이 들어올 자리입니다.', 'warn'));
      const ul = U.el('ul');
      ul.style.cssText = 'margin:8px 0 0;padding-left:18px;color:var(--ink-2);font-size:12.5px;line-height:1.7';
      ul.innerHTML = '<li>모델 다중 선택 → 일괄 학습 (진행률 표시, 화면이 멈추지 않게 쪼개서 실행)</li>' +
        '<li>정확도·AUC·ROC 곡선 비교, 폴드별 성적 전체 공개</li>' +
        '<li>시드 5~10개 반복 실행 → 평균 ± 표준편차</li>' +
        '<li>공정성 체크리스트(동일 종목·기간·피처·시드, 시간순 분할)</li>';
      p.body.appendChild(ul);
      host.appendChild(p);
    }
  });
})(window.QL = window.QL || {});
