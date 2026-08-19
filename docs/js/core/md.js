/* ============================================================================
 *  md.js — 아주 작은 마크다운 → HTML 변환기
 *
 *  왜 직접 만드는가: 이 사이트는 빌드 도구도 외부 라이브러리도 쓰지 않습니다.
 *  마크다운 라이브러리 하나를 들이면 그 원칙이 깨집니다. 그리고 우리가 그릴
 *  문서는 사용설명서 하나뿐이고, 그 문서에 무엇이 들어 있는지 우리가 압니다.
 *  그래서 **거기 쓰인 문법만** 지원합니다.
 *
 *  지원하는 것
 *    블록 — 제목(#~####) · 수평선 · 코드펜스(```) · 표 · 인용(>) ·
 *           글머리표(-) · 번호목록(1.) · 문단
 *    인라인 — **굵게** · `코드` · [링크](주소) · 자동 줄바꿈 없음
 *
 *  지원하지 않는 것(문서에 없으므로) — 중첩 목록, 이미지, 각주, 수식.
 *
 *  ─ 안전 ────────────────────────────────────────────────────────────────
 *  본문은 전부 이스케이프한 뒤 필요한 태그만 되돌립니다. 문서가 우리 저장소
 *  안에 있어 위험할 일은 없지만, 그래도 "마크다운을 그대로 innerHTML 에 넣는"
 *  습관은 만들지 않는 편이 낫습니다.
 *  예외는 <sub>...</sub> 하나입니다(문서 맨 끝 면책 문구에 씁니다).
 * ==========================================================================*/
(function (root) {
  'use strict';
  const MD = {};

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ------------------------------------------------------------------------
   *  제목 → id
   *
   *  GitHub 과 같은 규칙으로 만듭니다. 문서 안의 목차 링크(#1-30초-요약)가
   *  GitHub 에서도 이 사이트에서도 똑같이 동작해야 하기 때문입니다.
   *    소문자로 → 글자·숫자·공백·하이픈만 남기고 → 공백을 하이픈으로
   *  (— 같은 문장부호가 사라지면서 공백 두 칸이 하이픈 두 개가 되는 것까지
   *   GitHub 과 같습니다.)
   * ----------------------------------------------------------------------*/
  MD.slug = function (text) {
    return text.toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s/g, '-');
  };

  /* ------------------------------------------------------------------------
   *  인라인
   * ----------------------------------------------------------------------*/
  function inline(s) {
    // ① 코드부터 빼 둡니다. 코드 안의 ** 나 [ ] 가 서식으로 해석되면 안 됩니다.
    //    자리표시자는 본문에 절대 나올 수 없는 글자이어야 합니다.
    //    U+E000 은 사용자 영역 문자라 문서 본문에 나올 일이 없습니다.
    const code = [];
    s = s.replace(/`([^`]+)`/g, function (m, c) {
      code.push(c);
      return '\uE000' + (code.length - 1) + '\uE000';
    });

    s = esc(s);

    // ② 굵게 → 기울임 순서. **를 먼저 처리해야 *가 안쪽을 먹지 않습니다.
    s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

    // ③ 링크. 문서 안 목차 링크(#...)와 바깥 링크를 다르게 답니다.
    //    만들어 둔 <a> 를 잠시 빼 둡니다. 다음 단계의 '맨 URL 자동 링크'가
    //    href 안의 주소를 또 링크로 감싸는 사고를 막기 위해서입니다.
    // href 는 속성 안에 들어가므로 따옴표를 반드시 막습니다. 문서는 우리
    // 저장소 것이지만, "속성에 넣는 값은 항상 속성용으로 이스케이프한다"는
    // 규칙에 예외를 만들기 시작하면 언젠가 뚫립니다.
    const attr = function (v) { return v.replace(/"/g, '%22').replace(/'/g, '%27'); };
    const links = [];
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, t, href) {
      let html;
      if (href.charAt(0) === '#') html = '<a href="' + attr(href) + '">' + t + '</a>';
      else if (/^https?:\/\//.test(href)) {
        html = '<a href="' + attr(href) + '" target="_blank" rel="noopener">' + t + '</a>';
      } else html = t;                           // 상대 경로 링크는 글자만 남깁니다
      links.push(html);
      return '\uE001' + (links.length - 1) + '\uE001';
    });

    // ③-2 그냥 적어 둔 주소도 눌리게 합니다(마크다운 뷰어들이 하는 것과 같게).
    //     문장 끝 마침표·괄호는 주소에서 떼어 냅니다.
    s = s.replace(/https?:\/\/[^\s<)]+/g, function (url) {
      const tail = url.match(/[.,)]+$/);
      const clean = tail ? url.slice(0, -tail[0].length) : url;
      return '<a href="' + attr(clean) + '" target="_blank" rel="noopener">' + clean + '</a>' +
        (tail ? tail[0] : '');
    });

    s = s.replace(/\uE001(\d+)\uE001/g, function (m, i) { return links[+i]; });

    // ④ 글쓴이가 일부러 넣은 태그 몇 개만 되살립니다.
    //    <br> — 표 한 칸 안에서 줄을 나눌 때 (마크다운 표에는 줄바꿈이 없습니다)
    //    <sub> — 문서 맨 끝 면책 문구
    s = s.replace(/&lt;br\s*\/?&gt;/g, '<br>');
    s = s.replace(/&lt;(\/?sub)&gt;/g, '<$1>');

    // ⑤ 빼 뒀던 코드 되돌리기
    s = s.replace(/\uE000(\d+)\uE000/g, function (m, i) {
      return '<code>' + esc(code[+i]) + '</code>';
    });
    return s;
  }

  /* ------------------------------------------------------------------------
   *  표 — | a | b | / |---|---| / | 1 | 2 |
   * ----------------------------------------------------------------------*/
  function cells(line) {
    let s = line.trim();
    if (s.charAt(0) === '|') s = s.slice(1);
    if (s.charAt(s.length - 1) === '|') s = s.slice(0, -1);
    return s.split('|').map(function (c) { return c.trim(); });
  }
  function isDivider(line) {
    return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
  }

  /* ------------------------------------------------------------------------
   *  본체
   * ----------------------------------------------------------------------*/
  MD.render = function (src) {
    const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    const heads = [];                      // 목차용 (레벨, 제목, id)
    let i = 0;

    function flushList(tag, items) {
      out.push('<' + tag + '>' + items.map(function (t) {
        return '<li>' + inline(t) + '</li>';
      }).join('') + '</' + tag + '>');
    }

    while (i < lines.length) {
      const line = lines[i];

      // 빈 줄
      if (!line.trim()) { i++; continue; }

      // 코드 펜스
      if (/^\s*```/.test(line)) {
        const buf = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;                                                  // 닫는 펜스
        out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>');
        continue;
      }

      // 수평선
      if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

      // 제목
      const h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) {
        const lv = h[1].length;
        const raw = h[2].trim();
        const id = MD.slug(raw);
        heads.push({ level: lv, text: raw.replace(/[*`]/g, ''), id: id });
        out.push('<h' + lv + ' id="' + id + '">' + inline(raw) + '</h' + lv + '>');
        i++;
        continue;
      }

      // 표 — 다음 줄이 구분선일 때만 표로 봅니다
      if (line.indexOf('|') >= 0 && i + 1 < lines.length && isDivider(lines[i + 1])) {
        const head = cells(line);
        i += 2;
        const body = [];
        while (i < lines.length && lines[i].indexOf('|') >= 0 && lines[i].trim()) {
          body.push(cells(lines[i]));
          i++;
        }
        let t = '<div class="md-tbl"><table class="t"><thead><tr>';
        head.forEach(function (c) { t += '<th>' + inline(c) + '</th>'; });
        t += '</tr></thead><tbody>';
        body.forEach(function (r) {
          t += '<tr>';
          for (let k = 0; k < head.length; k++) t += '<td>' + inline(r[k] || '') + '</td>';
          t += '</tr>';
        });
        out.push(t + '</tbody></table></div>');
        continue;
      }

      // 인용
      if (/^\s*>/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          buf.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        // 인용 안에도 제목·목록이 올 수 있어 통째로 다시 돌립니다.
        out.push('<blockquote>' + MD.render(buf.join('\n')).html + '</blockquote>');
        continue;
      }

      // 글머리표
      if (/^\s*[-*]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
          i++;
        }
        flushList('ul', items);
        continue;
      }

      // 번호 목록
      if (/^\s*\d+\.\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
          i++;
        }
        flushList('ol', items);
        continue;
      }

      // 문단 — 빈 줄이나 다른 블록이 시작될 때까지
      const para = [];
      while (i < lines.length && lines[i].trim() &&
             !/^\s*(#{1,4}\s|>|[-*]\s|\d+\.\s|```|---+\s*$)/.test(lines[i]) &&
             !(lines[i].indexOf('|') >= 0 && i + 1 < lines.length && isDivider(lines[i + 1]))) {
        para.push(lines[i]);
        i++;
      }
      if (para.length) out.push('<p>' + inline(para.join(' ')) + '</p>');
      else i++;                                    // 어떤 규칙에도 안 걸리면 넘깁니다
    }

    return { html: out.join('\n'), headings: heads };
  };

  root.MD = MD;
})(window.QL = window.QL || {});
