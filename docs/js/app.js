/* ============================================================================
 *  app.js — 화면 뼈대 (메뉴, 상태바, 화면 전환, 공통 부품)
 *
 *  화면 파일들은 여기 있는 부품(panel/stat/table/tip/…)만 조립해서 만듭니다.
 *  그래야 화면마다 생김새가 달라지지 않고, 용어 설명 같은 규칙을 한 곳에서
 *  바꿀 수 있습니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, C = root.C, DATA = root.DATA;
  const $ = U.$, $$ = U.$$;

  const App = { screen: null, screens: {} };

  App.register = function (id, def) { App.screens[id] = def; };

  App.host = function () { return $('#screen'); };
  App.scrollTop = function () { window.scrollTo(0, 0); };

  App.go = function (id) {
    if (!App.screens[id]) return;
    App.screen = id;
    $$('.step').forEach(function (b) { b.classList.toggle('on', b.dataset.screen === id); });
    const host = App.host();
    host.innerHTML = '';
    App.stepHint(id);
    App.scrollTop();
    try {
      App.screens[id].render(host);
    } catch (e) {
      host.innerHTML = '<div class="panel"><div class="panel-body"><div class="note bad">' +
        '화면을 그리는 중 문제가 생겼습니다: ' + U.escape(e.message) + '</div></div></div>';
      console.error(e);
    }
    try { history.replaceState(null, '', '#' + id); } catch (e) {}
    setTimeout(function () { C.redrawAll(); }, 30);
  };

  /* ------------------------------------------------------------------------
   *  공통 부품
   * ----------------------------------------------------------------------*/
  App.panel = function (title, opts) {
    opts = opts || {};
    const p = U.el('div', 'panel' + (opts.cls ? ' ' + opts.cls : ''));
    const head = U.el('div', 'panel-head');
    const t = U.el('div', 'panel-title');
    t.innerHTML = title;
    head.appendChild(t);
    if (opts.sub) head.appendChild(U.el('div', 'panel-sub', opts.sub));
    const actions = U.el('div', 'panel-actions');
    head.appendChild(actions);
    p.appendChild(head);
    const body = U.el('div', 'panel-body' + (opts.tight ? ' tight' : ''));
    p.appendChild(body);
    p.head = head; p.body = body; p.actions = actions;
    return p;
  };

  App.stat = function (label, value, detail, cls) {
    const d = U.el('div', 'stat');
    d.appendChild(U.el('div', 'k', label));
    const v = U.el('div', 'v' + (cls ? ' ' + cls : ''), value);
    d.appendChild(v);
    if (detail !== undefined) d.appendChild(U.el('div', 'd', detail));
    return d;
  };

  App.table = function (headers, rows, opts) {
    opts = opts || {};
    const t = U.el('table', 't');
    const thead = U.el('thead'), tr = U.el('tr');
    headers.forEach(function (h) {
      const th = U.el('th', h.num ? 'num' : '');
      th.innerHTML = (h.label !== undefined ? h.label : h);
      if (h.width) th.style.width = h.width;
      tr.appendChild(th);
    });
    thead.appendChild(tr); t.appendChild(thead);
    const tb = U.el('tbody');
    rows.forEach(function (r) {
      const trr = U.el('tr');
      if (r.__cls) trr.className = r.__cls;
      if (r.__click) { trr.style.cursor = 'pointer'; trr.addEventListener('click', r.__click); }
      (r.cells || r).forEach(function (c, j) {
        const td = U.el('td', headers[j] && headers[j].num ? 'num' : '');
        if (c && c.nodeType) td.appendChild(c);
        else td.innerHTML = (c === null || c === undefined) ? '' : String(c);
        trr.appendChild(td);
      });
      tb.appendChild(trr);
    });
    t.appendChild(tb);
    if (opts.scroll) {
      const w = U.el('div', 'tbl-scroll');
      w.appendChild(t);
      return w;
    }
    return t;
  };

  // 등락률 표시 (색 + 부호)
  App.chg = function (x, digits) {
    const s = U.el('span', isFinite(x) ? (x > 0 ? 'up' : (x < 0 ? 'down' : 'flat')) : 'flat');
    s.textContent = isFinite(x) ? ((x > 0 ? '+' : '') + (x * 100).toFixed(digits === undefined ? 2 : digits) + '%') : '—';
    return s;
  };

  App.bar = function (frac, cls) {
    const b = U.el('div', 'bar' + (cls ? ' ' + cls : ''));
    const i = U.el('i');
    i.style.width = Math.max(0, Math.min(1, Math.abs(frac))) * 100 + '%';
    b.appendChild(i);
    return b;
  };

  /* ------------------------------------------------------------------------
   *  고3 눈높이 장치 — 다섯 가지를 부품으로 고정해 둡니다
   * ----------------------------------------------------------------------*/

  // ① 용어 툴팁: 전문 용어는 첫 등장 시 점선 밑줄 + 설명
  //    문자열 안에 넣을 때는 App.tipHTML 을 씁니다.
  App.tip = function (term, why) {
    const s = U.el('abbr', 'tip', term);
    s.title = why;
    return s;
  };
  App.tipHTML = function (term, why) {
    return '<abbr class="tip" title="' + U.escape(why) + '">' + U.escape(term) + '</abbr>';
  };

  // ② 수식 접기: 기본은 접혀 있고 "수식 보기"를 눌러야 펼쳐집니다
  App.formula = function (html, label) {
    const d = U.el('details', 'formula');
    const s = U.el('summary', '', label || '수식 보기');
    d.appendChild(s);
    const b = U.el('div', 'formula-body');
    b.innerHTML = html;
    d.appendChild(b);
    return d;
  };

  // ③ 화면 첫머리: "이 화면에서 알게 되는 것" 한 문장
  App.intro = function (oneLine, detail) {
    const d = U.el('div', 'intro');
    const h = U.el('div', 'intro-k', '이 화면에서 알게 되는 것');
    d.appendChild(h);
    const p = U.el('div', 'intro-v');
    p.innerHTML = oneLine;
    d.appendChild(p);
    if (detail) {
      const s = U.el('div', 'intro-d');
      s.innerHTML = detail;
      d.appendChild(s);
    }
    return d;
  };

  // ④ 방향 표시: 숫자 옆에 "높을수록 좋음/낮을수록 좋음"
  App.dir = function (good) {
    if (!good) return '';
    return good === 'up'
      ? '<span class="dir up" title="높을수록 좋습니다">↑</span>'
      : '<span class="dir down" title="낮을수록 좋습니다">↓</span>';
  };

  // ⑤ 실시간/사전 학습 배지
  App.badge = function (text, cls) {
    const b = U.el('span', 'badge' + (cls ? ' ' + cls : ''), text);
    return b;
  };
  App.modelBadge = function (def) {
    const REG = root.REG;
    const b = REG.badge(def);
    return App.badge(b.text, b.cls);
  };

  // 안내 상자
  App.note = function (html, kind) {
    const d = U.el('div', 'note' + (kind ? ' ' + kind : ''));
    d.innerHTML = html;
    return d;
  };

  // 체크리스트 — 공정성 전제를 화면에 고정 노출할 때 씁니다
  App.checklist = function (items) {
    const ul = U.el('ul', 'checklist');
    items.forEach(function (it) {
      const li = U.el('li', it.ok === false ? 'no' : (it.ok === null ? 'warn' : 'yes'));
      li.innerHTML = '<span class="ck">' + (it.ok === false ? '✗' : (it.ok === null ? '!' : '✓')) + '</span>' +
        '<span class="ct">' + it.text + '</span>';
      ul.appendChild(li);
    });
    return ul;
  };

  // 아직 만들지 않은 화면 자리 — 단계별로 채워 나갑니다.
  App.todo = function (host, what) {
    host.appendChild(App.note(
      '<b>이 화면은 아직 준비 중입니다.</b><br>' + what, 'warn'));
  };

  /* ------------------------------------------------------------------------
   *  커리큘럼 안내 (5단계에서 curriculum.js 를 붙이면 자동으로 나타납니다)
   * ----------------------------------------------------------------------*/
  App.stepHint = function (screenId) {
    const box0 = $('#stephint');
    if (!box0) return;
    box0.innerHTML = '';
    const CURR = root.CURR;
    if (!CURR || screenId === 'home') return;
    const step = CURR.next();
    if (!step || step.screen !== screenId) return;

    const idx = CURR.indexOf(step.id);
    const box = U.el('div', 'panel');
    box.style.borderColor = 'var(--amber-dim)';
    const head = U.el('div', 'panel-head');
    head.style.background = 'var(--amber-dim)';
    const t = U.el('div', 'panel-title');
    t.innerHTML = 'STEP ' + (idx + 1) + ' <span class="accent">' + U.escape(step.title) + '</span>';
    head.appendChild(t);
    const actions = U.el('div', 'panel-actions');
    const doneBtn = U.el('button', 'btn sm', '완료했어요');
    doneBtn.addEventListener('click', function () {
      CURR.setDone(step.id, true);
      App.go(screenId);
    });
    actions.appendChild(doneBtn);
    head.appendChild(actions);
    box.appendChild(head);
    const body = U.el('div', 'panel-body');
    body.innerHTML = '<div class="small"><b>해 볼 것</b> · ' + step.do + '</div>' +
      '<div class="tiny" style="margin-top:5px">확인 질문 — ' + U.escape(step.check) + '</div>';
    box.appendChild(body);
    box0.appendChild(box);
  };

  /* ------------------------------------------------------------------------
   *  상태바
   * ----------------------------------------------------------------------*/
  App.setStatus = function () {
    const m = DATA.state.meta || {};
    const PRED = root.PRED;

    // 머리글 오른쪽의 작은 알약들 — 지금 보고 있는 데이터가 무엇인지
    const meta = $('#mastmeta');
    if (meta) {
      meta.innerHTML = '';
      const pill = function (txt, cls) { meta.appendChild(U.el('span', 'pill' + (cls ? ' ' + cls : ''), txt)); };
      if (m.synthetic) pill('가상 데이터', 'warn');
      else pill('실데이터', 'live');
      pill('갱신 ' + String(m.updated || '—').slice(0, 10));
      pill('종목 ' + (m.n_tickers || DATA.state.tickers.length));
      pill(DATA.state.full ? '전체 기간' : '최근 구간만');
    }

    const bar = $('#statusbar');
    bar.innerHTML = '';
    const add = function (txt, cls) { bar.appendChild(U.el('span', cls || '', txt)); };
    const sep = function () { bar.appendChild(U.el('span', 'sep', '·')); };

    add('기간 ' + (DATA.state.dates[0] || '—') + ' ~ ' + (DATA.state.dates[DATA.state.dates.length - 1] || '—'));
    sep();
    add('출처 ' + (m.source || '—'));
    sep();
    if (PRED && PRED.state.loaded) {
      add(PRED.state.ok ? '사전 학습 결과 있음' : '사전 학습 결과 없음', PRED.state.ok ? 'up' : 'amber');
      sep();
    }
    add('생존 편향 있음 (현재 지수 구성 종목만)', 'amber');
    sep();
    add('교육·연구용 · 실제 투자 판단에 사용 금지');
  };

  /* ------------------------------------------------------------------------
   *  전체 데이터가 준비됐을 때만 실험을 돌릴 수 있게 막아 주는 도우미
   * ----------------------------------------------------------------------*/
  App.needFullData = function (host) {
    if (DATA.state.full) return true;
    host.appendChild(App.note(
      '<b>전체 기간 데이터를 아직 읽는 중입니다.</b><br>' +
      '워크포워드로 다섯 겹을 나누려면 최소 10년치가 필요합니다. ' +
      '몇 초 뒤에 이 화면을 다시 열어 주세요.', 'warn'));
    return false;
  };

  /* ------------------------------------------------------------------------
   *  시작
   * ----------------------------------------------------------------------*/
  App.boot = function () {
    $$('.step').forEach(function (b) {
      b.addEventListener('click', function () { App.go(b.dataset.screen); });
    });
    // 숫자키 단축키. 0 = 시작하기, 1~7 = 각 화면
    document.addEventListener('keydown', function (e) {
      if (e.target.matches('input, select, textarea')) return;
      const items = $$('.step');
      const n = parseInt(e.key, 10);
      if (!isNaN(n) && n >= 0 && n < items.length) App.go(items[n].dataset.screen);
    });

    const boot = $('#boot');
    DATA.loadFast().then(function () {
      boot.classList.add('hidden');
      App.setStatus();
      const first = (location.hash || '').replace('#', '') || 'home';
      App.go(App.screens[first] ? first : 'home');
      // 전체 기간·매크로·사전학습 결과는 뒤에서 조용히
      DATA.loadFull().then(function () {
        App.setStatus();
        if (App.screens[App.screen] && App.screens[App.screen].onFullData) {
          App.screens[App.screen].onFullData();
        }
      }).catch(function (e) { console.warn('전체 데이터 로드 실패', e); });
    }).catch(function (e) {
      boot.innerHTML = '<div class="note bad" style="max-width:640px">' +
        '<b>데이터를 불러오지 못했습니다.</b><br>' + U.escape(e.message) +
        '<br><br>아직 데이터 파일이 만들어지지 않았을 수 있습니다. ' +
        '저장소에서 <code>시장 데이터 자동 갱신</code> 워크플로를 한 번 실행하거나, ' +
        '로컬에서 <code>python -m pipeline.fetch_market</code> 를 돌리세요.</div>';
    });
  };

  root.App = App;
})(window.QL = window.QL || {});
