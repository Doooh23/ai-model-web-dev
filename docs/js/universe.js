/* ============================================================================
 *  universe.js — 실험에 쓸 종목 고르기
 *
 *  ★ 종목을 손으로 고르면 안 되는 이유
 *    "AAPL, MSFT, NVDA로 해 봤더니 잘 나왔어요"는 아무 의미가 없습니다.
 *    잘 나온 종목을 골랐기 때문일 수 있으니까요. 그래서 **기준을 먼저 정하고**
 *    그 기준이 종목을 고르게 합니다. 사람은 기준만 정하고 손을 뗍니다.
 *
 *  기준 네 가지
 *    ① 데이터 기간   전체 기간의 95% 이상 거래된 종목만 (최근 상장 제외)
 *    ② 결측치        상장 이후 빠진 날이 1% 미만
 *    ③ 유동성        평균 거래대금이 클수록 우선 (호가가 촘촘해 백테스트가 현실적)
 *    ④ 섹터 분산     한 섹터에서 최대 2개까지 — 반도체만 15개 고르면
 *                    "AI 모델 비교"가 아니라 "반도체 업황 맞히기"가 됩니다
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, DATA = root.DATA;
  const UNIV = {};

  UNIV.RULE = {
    minCoverage: 0.95,   // 전체 기간 중 값이 있는 날의 비율
    maxMissing: 0.01,    // 상장 이후 빠진 날의 비율
    perSector: 2,        // 한 섹터에서 최대 몇 개
    target: 15           // 최종 몇 개를 고를 것인가
  };

  /* ------------------------------------------------------------------------
   *  종목별 기초 통계
   * ----------------------------------------------------------------------*/
  let statCache = null, statKey = '';

  UNIV.stats = function () {
    const dates = DATA.state.dates;
    const key = dates.length + '|' + (dates[dates.length - 1] || '');
    if (statCache && statKey === key) return statCache;

    const out = [];
    DATA.state.tickers.forEach(function (t) {
      if (DATA.isBenchmark(t)) return;
      const s = DATA.series(t);
      if (!s) return;

      let firstIdx = -1, lastIdx = -1, have = 0;
      for (let i = 0; i < s.length; i++) {
        if (s[i] !== null && isFinite(s[i])) {
          if (firstIdx < 0) firstIdx = i;
          lastIdx = i;
          have++;
        }
      }
      if (firstIdx < 0) return;
      const span = lastIdx - firstIdx + 1;

      out.push({
        ticker: t,
        sector: DATA.sector(t),
        first: dates[firstIdx],
        days: have,
        coverage: have / dates.length,          // 전체 기간 대비
        missing: span > 0 ? 1 - have / span : 1, // 상장 이후 빠진 비율
        vol: DATA.vol(t, 252),
        dollarVol: DATA.avgDollarVolume(t, 60),
        ret1y: DATA.change(t, 252)
      });
    });

    statCache = out;
    statKey = key;
    return out;
  };

  /* ------------------------------------------------------------------------
   *  기준에 따라 자동 선정
   *  결과에는 **탈락한 종목의 사유까지** 담습니다. 왜 빠졌는지 확인할 수 없으면
   *  기준을 먼저 정했다는 말을 믿을 수 없기 때문입니다.
   * ----------------------------------------------------------------------*/
  UNIV.select = function (opt) {
    const R = Object.assign({}, UNIV.RULE, opt || {});
    const rows = UNIV.stats().map(function (r) { return Object.assign({}, r); });

    // ①② 통과 여부
    const pool = [];
    rows.forEach(function (r) {
      if (!(r.coverage >= R.minCoverage)) {
        r.status = 'out';
        r.reason = '데이터 기간 부족 — ' + U.pct(r.coverage, 0) + '만 존재 (' + r.first + ' 이후)';
        return;
      }
      if (!(r.missing <= R.maxMissing)) {
        r.status = 'out';
        r.reason = '결측치 많음 — ' + U.pct(r.missing, 1);
        return;
      }
      if (!isFinite(r.dollarVol) || r.dollarVol <= 0) {
        r.status = 'out';
        r.reason = '거래대금을 계산할 수 없음';
        return;
      }
      r.status = 'pool';
      pool.push(r);
    });

    // ③④ 섹터별로 거래대금 순 줄 세우기
    const bySector = {};
    pool.forEach(function (r) { (bySector[r.sector] = bySector[r.sector] || []).push(r); });
    Object.keys(bySector).forEach(function (k) {
      bySector[k].sort(function (a, b) { return b.dollarVol - a.dollarVol; });
      bySector[k].forEach(function (r, i) { r.sectorRank = i + 1; });
    });

    // 섹터를 '대표 종목의 거래대금' 순으로 놓고, 한 바퀴씩 돌며 뽑습니다.
    // 이렇게 하면 큰 섹터가 자리를 독차지하지 않으면서도 유동성 순서가 지켜집니다.
    const sectors = Object.keys(bySector).sort(function (a, b) {
      return bySector[b][0].dollarVol - bySector[a][0].dollarVol;
    });

    const picked = [];
    for (let round = 0; round < R.perSector && picked.length < R.target; round++) {
      for (let i = 0; i < sectors.length && picked.length < R.target; i++) {
        const cand = bySector[sectors[i]][round];
        if (!cand) continue;
        cand.status = 'in';
        cand.reason = sectors[i] + ' 섹터 ' + (round + 1) + '순위 (거래대금 기준)';
        picked.push(cand);
      }
    }
    pool.forEach(function (r) {
      if (r.status === 'pool') {
        r.status = 'out';
        r.reason = r.sector + ' 섹터 정원(' + R.perSector + '개) 초과 — 거래대금 ' + r.sectorRank + '위';
      }
    });

    rows.sort(function (a, b) {
      if (a.status !== b.status) return a.status === 'in' ? -1 : 1;
      return b.dollarVol - a.dollarVol;
    });

    return {
      rule: R,
      rows: rows,
      picked: picked.map(function (r) { return r.ticker; }),
      pickedRows: picked,
      nPool: pool.length,
      nAll: rows.length,
      sectors: sectors.length
    };
  };

  // 다른 화면에서 쓸 기본 선정 결과 (같은 데이터면 같은 결과)
  let cached = null, cachedKey = '';
  UNIV.selected = function () {
    const key = DATA.state.dates.length + '|' + DATA.state.dates[DATA.state.dates.length - 1];
    if (!cached || cachedKey !== key) {
      cached = UNIV.select();
      cachedKey = key;
    }
    return cached;
  };

  root.UNIV = UNIV;
})(window.QL = window.QL || {});
