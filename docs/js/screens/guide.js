/* ============================================================================
 *  guide.js — 사용설명서
 *
 *  설명서 본문은 저장소의 마크다운 파일(docs/사용설명서.md) 하나뿐입니다.
 *  이 화면은 그 파일을 그대로 읽어 화면에 그립니다. 같은 내용을 HTML 로 한 벌
 *  더 만들어 두면 둘이 갈라지기 때문입니다. GitHub 에서 읽든 사이트에서 읽든
 *  같은 글을 봅니다.
 *
 *  덧붙이는 것 두 가지
 *    · 왼쪽 목차 — 문서가 길어서 위치 감각이 필요합니다
 *    · 문서 안 링크(#...) 가로채기 — 그냥 두면 주소창 해시가 바뀌면서
 *      화면 전환용 해시(#guide)와 충돌합니다
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, App = root.App, MD = root.MD;

  const FILE = '사용설명서.md';

  const S = { html: null, headings: null, error: null, loading: false };

  /* ------------------------------------------------------------------------
   *  문서 읽기 — 한 번만 읽고 기억해 둡니다
   * ----------------------------------------------------------------------*/
  function load() {
    if (S.loading) return;
    S.loading = true;
    fetch(encodeURI(FILE), { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (txt) {
        const res = MD.render(txt);
        S.html = res.html;
        S.headings = res.headings;
        S.loading = false;
        if (hostRef && App.screen === 'guide') draw(hostRef);
      })
      .catch(function (e) {
        S.error = e.message;
        S.loading = false;
        if (hostRef && App.screen === 'guide') draw(hostRef);
      });
  }

  /* ------------------------------------------------------------------------
   *  목차 — ## 만 뽑습니다 (### 까지 넣으면 목차가 본문만큼 길어집니다)
   *
   *  항목이 14개나 되고 제목도 길어서, 그냥 늘어놓으면 글자벽이 됩니다.
   *  세 가지로 나눠 읽히게 합니다.
   *    ① 앞의 번호를 떼어 내 왼쪽 배지로 — 본문 메뉴(0~7)와 같은 생김새
   *    ② 제목의 부연(— 뒤, 괄호 안)은 한 톤 죽여 아랫줄로
   *    ③ 지금 읽고 있는 장을 표시 (아래 scrollspy)
   * ----------------------------------------------------------------------*/
  function split(text) {
    let num = '', main = text, tail = '';
    const m = main.match(/^(\d+)\.\s*/);
    if (m) { num = m[1]; main = main.slice(m[0].length); }
    // 부연은 '—' 뒤 또는 괄호 안. 둘 중 먼저 나오는 쪽에서 자릅니다.
    const i = main.indexOf('—');
    const j = main.indexOf('(');
    const cut = (i >= 0 && (j < 0 || i < j)) ? i : (j >= 0 ? j : -1);
    if (cut > 0) { tail = main.slice(cut).trim(); main = main.slice(0, cut).trim(); }
    return { num: num, main: main, tail: tail };
  }

  function tocEl(body) {
    const box = U.el('nav', 'md-toc');
    box.appendChild(U.el('div', 'md-toc-k', '목차'));

    const links = [];
    S.headings.filter(function (h) { return h.level === 2; }).forEach(function (h) {
      const p = split(h.text);
      const a = U.el('a', p.num ? '' : 'plain');
      a.href = '#' + h.id;
      a.setAttribute('data-id', h.id);

      const n = U.el('i', 'n', p.num || '·');
      a.appendChild(n);

      const t = U.el('span', 't');
      t.appendChild(U.el('b', '', p.main));
      if (p.tail) t.appendChild(U.el('em', '', p.tail));
      a.appendChild(t);

      a.addEventListener('click', function (ev) {
        ev.preventDefault();
        mark(h.id);
        jump(body, h.id);
      });
      box.appendChild(a);
      links.push(a);
    });

    /* --- 지금 읽는 장 표시 (scrollspy) --------------------------------- */
    function mark(id) {
      links.forEach(function (a) { a.classList.toggle('on', a.getAttribute('data-id') === id); });
    }

    let ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        if (!body.isConnected) { window.removeEventListener('scroll', onScroll); return; }
        const line = topGap() + 4;
        let cur = null;
        links.forEach(function (a) {
          const el = byId(body, a.getAttribute('data-id'));
          if (el && el.getBoundingClientRect().top <= line) cur = a.getAttribute('data-id');
        });
        // 맨 위에서는 첫 항목을 켭니다(아직 아무 제목도 지나지 않은 상태).
        if (!cur && links.length) cur = links[0].getAttribute('data-id');
        if (cur) mark(cur);
      });
    }
    // 화면을 떠나면 body 가 문서에서 빠지므로 위에서 스스로 정리합니다.
    window.addEventListener('scroll', onScroll, { passive: true });
    setTimeout(onScroll, 0);

    return box;
  }

  function byId(body, id) {
    return body.querySelector('[id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
  }

  function topGap() {
    return (parseInt(getComputedStyle(document.documentElement)
      .getPropertyValue('--top'), 10) || 54) + 16;
  }

  // 위쪽 얇은 막대에 제목이 가리지 않도록 그 높이만큼 띄워서 멈춥니다.
  // 높이는 CSS 의 --top 에 적혀 있으니 여기서 다시 정하지 않고 읽어 옵니다.
  function jump(body, id) {
    const t = byId(body, id);
    if (!t) return;
    const y = t.getBoundingClientRect().top + window.pageYOffset - topGap();
    window.scrollTo({ top: y, behavior: 'smooth' });
  }

  /* ------------------------------------------------------------------------
   *  그리기
   * ----------------------------------------------------------------------*/
  let hostRef = null;

  function draw(host) {
    hostRef = host;
    host.innerHTML = '';

    host.appendChild(App.intro(
      '이 사이트를 <b>처음부터 끝까지</b> 어떻게 쓰는지, 화면에 나오는 숫자를 어떻게 읽는지 알게 됩니다.',
      '주식·머신러닝·통계를 배운 적이 없어도 읽을 수 있게 썼습니다. 아는 내용이 나오면 건너뛰세요. ' +
      '막히면 언제든 이 화면으로 돌아오면 됩니다.'
    ));

    if (S.error) {
      const p = App.panel('설명서를 불러오지 못했습니다');
      p.body.appendChild(App.note(
        U.escape(S.error) + '<br><br>' +
        '<code>docs/' + U.escape(FILE) + '</code> 파일을 읽지 못했습니다. ' +
        '저장소에서는 아래 주소로 같은 글을 볼 수 있습니다.', 'bad'));
      const a = U.el('a', 'btn', 'GitHub 에서 보기 →');
      a.href = 'https://github.com/Doooh23/ai-model-web-dev/blob/main/docs/' + encodeURI(FILE);
      a.target = '_blank';
      a.rel = 'noopener';
      p.body.appendChild(a);
      host.appendChild(p);
      return;
    }

    if (S.html === null) {
      const p = App.panel('설명서를 불러오는 중');
      const w = U.el('div');
      w.innerHTML = '<span class="spinner"></span><span class="small" style="margin-left:9px">잠시만요…</span>';
      p.body.appendChild(w);
      host.appendChild(p);
      load();
      return;
    }

    const p = App.panel('사용설명서', { sub: '저장소의 마크다운 문서를 그대로 읽어 옵니다', cls: 'md-panel' });

    const grid = U.el('div', 'md-wrap');
    const body = U.el('article', 'md');
    body.innerHTML = S.html;

    // 문서 안 목차 링크를 가로챕니다. 그냥 두면 주소창 해시가 #guide 에서
    // #1-30초-요약 으로 바뀌어, 새로고침했을 때 화면을 못 찾습니다.
    body.addEventListener('click', function (ev) {
      const a = ev.target.closest ? ev.target.closest('a') : null;
      if (!a) return;
      const href = a.getAttribute('href') || '';
      if (href.charAt(0) !== '#') return;
      ev.preventDefault();
      jump(body, decodeURIComponent(href.slice(1)));
    });

    grid.appendChild(tocEl(body));
    grid.appendChild(body);
    p.body.appendChild(grid);
    host.appendChild(p);

    /* --- 다음 --------------------------------------------------------- */
    const p2 = App.panel('읽었으면');
    p2.body.appendChild(App.note(
      '설명서 3장 <b>처음 10분 코스</b>를 그대로 따라 하는 것이 가장 빠릅니다. ' +
      '모르는 용어가 나오면 <b>배우기</b> 화면의 용어 사전에서 바로 찾을 수 있습니다.'));
    const row = U.el('div');
    row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
    const b1 = U.el('button', 'btn primary', '학습 실험실로 →');
    b1.addEventListener('click', function () { App.go('lab'); });
    row.appendChild(b1);
    const b2 = U.el('button', 'btn', '배우기로 →');
    b2.addEventListener('click', function () { App.go('learn'); });
    row.appendChild(b2);
    const b3 = U.el('button', 'btn', '시작 화면으로');
    b3.addEventListener('click', function () { App.go('home'); });
    row.appendChild(b3);
    p2.body.appendChild(row);
    host.appendChild(p2);
  }

  App.register('guide', { render: function (host) { draw(host); } });
})(window.QL = window.QL || {});
