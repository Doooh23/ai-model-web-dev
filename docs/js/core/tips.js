/* ============================================================================
 *  tips.js — 용어에 자동으로 설명 달기
 *
 *  화면에 글이 그려지면 이 파일이 그 글을 훑어, glossary.js 에 있는 용어를
 *  찾아 점선 밑줄을 긋고 마우스를 올리면 뜻을 띄웁니다.
 *  **화면 코드는 아무것도 하지 않습니다.** 화면을 새로 만들어도 자동으로 붙습니다.
 *
 *  ─ 왜 브라우저 기본 title 을 안 쓰는가 ──────────────────────────────────────
 *  title 은 마우스를 올리고 1초쯤 지나야 뜨고, 생김새를 바꿀 수 없고, 휴대폰에서는
 *  아예 안 뜹니다. "모르는 단어를 바로 확인한다"는 목적에 맞지 않아 직접 만듭니다.
 *
 *  ─ 지켜야 할 것 ────────────────────────────────────────────────────────────
 *  ① 같은 용어는 한 화면에 **한 번만** 표시합니다. 온 화면이 점선이면 아무것도
 *     안 보이는 것과 같습니다.
 *  ② 이미 링크·코드·입력칸·차트인 곳은 건드리지 않습니다.
 *  ③ 글자만 바꾸고 구조는 건드리지 않습니다(텍스트 노드만 다룹니다).
 *  ④ 우리가 만든 변화를 우리가 다시 감지해 무한 반복하지 않도록,
 *     훑는 동안에는 감시를 잠시 끕니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U;

  const T = {};

  /* ------------------------------------------------------------------------
   *  용어 표 만들기 — 긴 것부터 찾습니다
   *
   *  '샤프'와 '샤프지수'가 둘 다 있으면 긴 쪽이 먼저 걸려야 합니다. 짧은 쪽이
   *  먼저 걸리면 '샤프지수'가 '샤프'+'지수'로 잘려 버립니다.
   * ----------------------------------------------------------------------*/
  let PAT = null, DEF = null;

  function build() {
    if (PAT) return;
    const G = root.GLOSS;
    DEF = {};
    const all = [];
    (G ? G.terms : []).forEach(function (t) {
      const keys = t[2] && t[2].length ? t[2] : [t[0]];
      keys.forEach(function (k) {
        DEF[k] = { name: t[0], why: t[1] };
        all.push(k);
      });
    });
    all.sort(function (a, b) { return b.length - a.length; });
    // 정규식에서 뜻을 갖는 글자들을 막아 둡니다(k-NN 의 '-', p값의 '값' 등).
    const esc = all.map(function (k) { return k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
    PAT = new RegExp('(' + esc.join('|') + ')', 'g');
  }

  /* ------------------------------------------------------------------------
   *  낱말 경계
   *
   *  한국어에는 띄어쓰기 기준의 경계가 없어서 \b 를 쓸 수 없습니다.
   *  '변동성'이 '변동성군집' 안에서 잡히면 안 되므로, 앞뒤에 한글·영문·숫자가
   *  붙어 있으면 건너뜁니다. (조사 '을/를/이/가/은/는/의/에' 등은 붙어도 되므로
   *  뒤쪽은 조사로 흔히 쓰이는 한 글자만 허용합니다.)
   * ----------------------------------------------------------------------*/
  const WORDY = /[0-9A-Za-z가-힣]/;
  const JOSA = '은는이가을를의에서와과로도만치나며라며야여합니다입니다';

  function okBefore(ch) { return !ch || !WORDY.test(ch); }
  function okAfter(s, i) {
    const ch = s.charAt(i);
    if (!ch || !WORDY.test(ch)) return true;
    // 뒤에 붙은 것이 조사 한두 글자면 같은 낱말로 봅니다.
    if (JOSA.indexOf(ch) >= 0) return true;
    return false;
  }

  /* ------------------------------------------------------------------------
   *  건드리면 안 되는 곳
   * ----------------------------------------------------------------------*/
  const SKIP_TAG = { A: 1, CODE: 1, PRE: 1, ABBR: 1, BUTTON: 1, SELECT: 1, OPTION: 1,
    TEXTAREA: 1, INPUT: 1, SCRIPT: 1, STYLE: 1, CANVAS: 1, TH: 1, SUMMARY: 1 };

  function skip(node) {
    for (let el = node.parentNode; el && el.nodeType === 1; el = el.parentNode) {
      if (SKIP_TAG[el.tagName]) return true;
      // 패널 제목과 범례는 건드리지 않습니다. 화면의 뼈대라서 밑줄이 그이면
      // 글이 아니라 장식처럼 보이고, 정작 본문의 밑줄이 묻힙니다.
      if (el.classList && (el.classList.contains('term') ||
        el.classList.contains('no-term') || el.classList.contains('md-toc') ||
        el.classList.contains('panel-title') || el.classList.contains('legend') ||
        el.classList.contains('intro-k'))) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------------
   *  훑기
   * ----------------------------------------------------------------------*/
  T.scan = function (host) {
    if (!host) return 0;
    build();
    if (!PAT) return 0;

    // 한 화면에 용어당 한 번. 화면 일부만 다시 그려질 때(예: 점수표의 가중치
    // 슬라이더는 결과 표만 갈아 끼웁니다) 재스캔이 일어나는데, 이미 밑줄이
    // 붙어 있는 용어를 미리 등록해 두지 않으면 같은 용어가 화면에 두 번
    // 세 번 밑줄로 쌓입니다.
    const seen = {};
    host.querySelectorAll('.term').forEach(function (el) {
      seen[el.getAttribute('data-term')] = 1;
    });
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, null);
    const jobs = [];
    let n;
    while ((n = walker.nextNode())) {
      const s = n.nodeValue;
      if (!s || s.length < 2 || !/\S/.test(s)) continue;
      if (skip(n)) continue;
      jobs.push(n);
    }

    let count = 0;
    for (let j = 0; j < jobs.length; j++) {
      const node = jobs[j];
      const s = node.nodeValue;
      PAT.lastIndex = 0;
      let m, out = null, last = 0;
      while ((m = PAT.exec(s))) {
        const k = m[1], i = m.index;
        if (seen[DEF[k].name]) continue;
        if (!okBefore(s.charAt(i - 1)) || !okAfter(s, i + k.length)) continue;

        out = out || document.createDocumentFragment();
        if (i > last) out.appendChild(document.createTextNode(s.slice(last, i)));
        const el = document.createElement('span');
        el.className = 'term';
        el.textContent = k;
        el.setAttribute('data-why', DEF[k].why);
        el.setAttribute('data-term', DEF[k].name);
        el.setAttribute('tabindex', '0');
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', DEF[k].name + ' 뜻 보기');
        out.appendChild(el);
        last = i + k.length;
        seen[DEF[k].name] = 1;
        count++;
      }
      if (out) {
        if (last < s.length) out.appendChild(document.createTextNode(s.slice(last)));
        node.parentNode.replaceChild(out, node);
      }
    }
    return count;
  };

  /* ------------------------------------------------------------------------
   *  말풍선 — 화면에 하나만 두고 옮겨 다닙니다
   * ----------------------------------------------------------------------*/
  let bubble = null, current = null, hideTimer = null;

  function ensure() {
    if (bubble) return bubble;
    bubble = document.createElement('div');
    bubble.className = 'termtip';
    bubble.setAttribute('role', 'tooltip');
    document.body.appendChild(bubble);
    return bubble;
  }

  function show(el) {
    clearTimeout(hideTimer);
    const b = ensure();
    if (current === el && b.classList.contains('on')) return;
    current = el;
    // 화면 코드가 직접 붙인 abbr.tip 도 같은 말풍선으로 보여 줍니다.
    // title 속성은 떼어 냅니다(안 그러면 브라우저 기본 툴팁이 겹쳐 뜹니다).
    let term = el.getAttribute('data-term'), why = el.getAttribute('data-why');
    if (!why) {
      why = el.getAttribute('title') || '';
      term = el.textContent;
      if (el.hasAttribute('title')) {
        el.setAttribute('data-why', why);
        el.setAttribute('data-term', term);
        el.removeAttribute('title');
      }
    }
    b.innerHTML = '<b>' + U.escape(term) + '</b>' + U.escape(why);
    b.classList.add('on');

    // 자리 잡기 — 기본은 아래쪽 가운데. 화면 밖으로 나가면 접어 넣습니다.
    b.style.left = '0px';
    b.style.top = '0px';
    const r = el.getBoundingClientRect();
    const w = b.offsetWidth, h = b.offsetHeight, pad = 10;
    let x = r.left + r.width / 2 - w / 2;
    x = Math.max(pad, Math.min(x, window.innerWidth - w - pad));
    let y = r.bottom + 8;
    if (y + h > window.innerHeight - pad) y = r.top - h - 8;   // 아래가 좁으면 위로
    if (y < pad) y = pad;
    b.style.left = Math.round(x) + 'px';
    b.style.top = Math.round(y) + 'px';
  }

  function hide() {
    current = null;
    if (bubble) bubble.classList.remove('on');
  }
  function hideSoon() { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 90); }

  function wire() {
    document.addEventListener('mouseover', function (e) {
      const el = e.target.closest ? e.target.closest('.term, abbr.tip') : null;
      if (el) show(el);
    });
    document.addEventListener('mouseout', function (e) {
      const el = e.target.closest ? e.target.closest('.term, abbr.tip') : null;
      if (el) hideSoon();
    });
    document.addEventListener('focusin', function (e) {
      const el = e.target.closest ? e.target.closest('.term, abbr.tip') : null;
      if (el) show(el);
    });
    document.addEventListener('focusout', hideSoon);
    // 휴대폰 — 손가락으로 눌렀을 때. 다른 곳을 누르면 닫힙니다.
    document.addEventListener('click', function (e) {
      const el = e.target.closest ? e.target.closest('.term, abbr.tip') : null;
      if (el) { e.preventDefault(); (current === el) ? hide() : show(el); }
      else hide();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
  }

  /* ------------------------------------------------------------------------
   *  자동 감시
   *
   *  화면마다 다시 그리는 방식이 제각각이라(어떤 화면은 App.go 없이 스스로
   *  다시 그립니다) 한 곳에서 붙잡으려면 DOM 을 지켜보는 편이 확실합니다.
   *  우리가 만든 변화까지 감지해 되풀이하지 않도록, 훑는 동안에는 끕니다.
   * ----------------------------------------------------------------------*/
  let obs = null, pending = null;

  function run() {
    const host = document.getElementById('screen');
    if (!host) return;
    if (obs) obs.disconnect();
    try { T.scan(host); } catch (e) { console.warn('용어 표시 실패', e); }
    if (obs) obs.observe(host, { childList: true, subtree: true });
  }

  T.start = function () {
    wire();
    const host = document.getElementById('screen');
    if (!host || !window.MutationObserver) { run(); return; }
    obs = new MutationObserver(function () {
      clearTimeout(pending);
      pending = setTimeout(run, 60);          // 연달아 바뀌면 한 번만
    });
    obs.observe(host, { childList: true, subtree: true });
    run();
  };

  root.TIP = T;
})(window.QL = window.QL || {});
