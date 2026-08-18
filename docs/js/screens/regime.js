/* ============================================================================
 *  regime.js — 국면 분석
 *  (뼈대만 있습니다. 4단계 '화면' 작업에서 채웁니다.)
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, App = root.App;

  App.register('regime', {
    render: function (host) {
      host.appendChild(App.intro('"어떤 모델이 좋은가"의 답이 <b>상황에 따라 달라진다</b>는 것을 봅니다.',
        '상승장에서 1등인 모델이 폭락장에서는 꼴찌인 경우가 흔합니다. 그래서 국면을 나눠 따로 채점합니다.'));

      const p = App.panel('국면 분석');
      p.body.appendChild(App.note(
        '<b>이 화면은 아직 뼈대입니다.</b> 아래 내용이 들어올 자리입니다.', 'warn'));
      const ul = U.el('ul');
      ul.style.cssText = 'margin:8px 0 0;padding-left:18px;color:var(--ink-2);font-size:12.5px;line-height:1.7';
      ul.innerHTML = '<li>HMM 또는 k-means로 상승장·하락장·고변동 국면 라벨 생성</li>' +
        '<li>국면 위에 모델별 성적을 겹쳐 표시</li>' +
        '<li>Isolation Forest로 급등락 이상치 표시</li>' +
        '<li>국면별 승자 표</li>';
      p.body.appendChild(ul);
      host.appendChild(p);
    }
  });
})(window.QL = window.QL || {});
