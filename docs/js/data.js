/* ============================================================================
 *  data.js — 시장 데이터 불러오기
 *
 *  데이터는 GitHub Actions가 매일 미국장 마감 후 받아서 저장소에 넣어 둡니다.
 *  그래서 이 사이트는 API 키도, 서버도 필요 없이 파일만 읽으면 됩니다.
 *
 *    data/daily_recent.json  최근 2년 (먼저 읽어 화면을 빨리 띄움)
 *    data/daily.json         전체 기간 (뒤에서 조용히 읽어 교체)
 *    data/macro.json         금리·VIX 등
 *    data/universe.json      섹터, FOMC 날짜
 *    data/meta.json          갱신 시각·주의 문구
 *    data/predictions.json   파이썬에서 미리 학습한 모델의 예측값 (없어도 됨)
 * ==========================================================================*/
(function (root) {
  'use strict';
  const D = {};

  D.state = {
    meta: null, universe: null, macro: null,
    dates: [], tickers: [], close: {}, volume: {},
    full: false,            // 전체 기간까지 읽었는지
    ready: false
  };

  // 기본은 실데이터(data/). 주소에 ?dev=1 을 붙이면 개발용 가상 데이터(data-dev/)를 봅니다.
  const DIR = /[?&]dev=1/.test(location.search) ? 'data-dev/' : 'data/';
  D.dev = DIR !== 'data/';
  function url(name) { return DIR + name; }

  function getJSON(name) {
    return fetch(url(name), { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(name + ' 을(를) 불러오지 못했습니다 (HTTP ' + r.status + ')');
      return r.json();
    });
  }

  function absorb(d) {
    D.state.dates = d.dates;
    D.state.tickers = d.tickers;
    D.state.close = d.close;
    D.state.volume = d.volume || {};
    D.state.synthetic = !!d.synthetic;
    D.state.updated = d.updated;
  }

  // 처음 화면용: 가벼운 파일부터
  D.loadFast = function () {
    return Promise.all([getJSON('meta.json'), getJSON('universe.json'), getJSON('daily_recent.json')])
      .then(function (res) {
        D.state.meta = res[0];
        D.state.universe = res[1];
        absorb(res[2]);
        D.state.ready = true;
        return D.state;
      });
  };

  // 뒤에서 조용히: 전체 기간 + 매크로 + 사전 학습 예측값
  // ★ 학습 실험은 전체 기간이 다 온 뒤에 돌리는 것이 맞습니다. 최근 2년만으로는
  //   워크포워드 다섯 겹을 나누기에 표본이 모자랍니다.
  D.loadFull = function () {
    return Promise.all([
      getJSON('daily.json'),
      getJSON('macro.json').catch(function () { return null; }),
      root.PRED ? root.PRED.load() : Promise.resolve(null)
    ]).then(function (res) {
      absorb(res[0]);
      D.state.macro = res[1];
      D.state.full = true;
      return D.state;
    });
  };

  /* ------------------------------------------------------------------------
   *  조회 도우미
   * ----------------------------------------------------------------------*/
  D.series = function (ticker) { return D.state.close[ticker] || null; };
  D.sector = function (ticker) {
    return (D.state.universe && D.state.universe.sectors && D.state.universe.sectors[ticker]) || '기타';
  };
  D.isBenchmark = function (ticker) {
    return !!(D.state.universe && D.state.universe.benchmarks && D.state.universe.benchmarks[ticker]);
  };
  D.lastIndex = function () { return D.state.dates.length - 1; };

  // 마지막 유효 가격과 그 위치
  D.lastPrice = function (ticker) {
    const s = D.series(ticker);
    if (!s) return null;
    for (let i = s.length - 1; i >= 0; i--) if (s[i] !== null && isFinite(s[i])) return { price: s[i], i: i };
    return null;
  };

  // n일 전 대비 등락률
  D.change = function (ticker, n) {
    const s = D.series(ticker);
    if (!s) return NaN;
    const last = D.lastPrice(ticker);
    if (!last) return NaN;
    const j = last.i - (n || 1);
    if (j < 0 || s[j] === null || !isFinite(s[j]) || s[j] <= 0) return NaN;
    return last.price / s[j] - 1;
  };

  // 최근 n일 수익률 배열 (결측은 건너뜀)
  D.returns = function (ticker, n) {
    const s = D.series(ticker);
    if (!s) return [];
    const out = [];
    const start = Math.max(1, s.length - (n || s.length));
    for (let i = start; i < s.length; i++) {
      const a = s[i - 1], b = s[i];
      if (a === null || b === null || !isFinite(a) || !isFinite(b) || a <= 0) continue;
      out.push(b / a - 1);
    }
    return out;
  };

  // 연율화 변동성
  D.vol = function (ticker, n) {
    const r = D.returns(ticker, n || 60);
    if (r.length < 10) return NaN;
    const m = r.reduce(function (a, b) { return a + b; }, 0) / r.length;
    let v = 0;
    for (let i = 0; i < r.length; i++) v += (r[i] - m) * (r[i] - m);
    return Math.sqrt(v / (r.length - 1)) * Math.sqrt(252);
  };

  // 결측치 비율 (종목 선정 화면에서 근거로 씁니다)
  D.missingRate = function (ticker) {
    const s = D.series(ticker);
    if (!s || !s.length) return NaN;
    let miss = 0;
    for (let i = 0; i < s.length; i++) if (s[i] === null || !isFinite(s[i])) miss++;
    return miss / s.length;
  };

  // 평균 거래대금 (가격 × 거래량, 천 주 단위 저장이라 ×1000)
  D.avgDollarVolume = function (ticker, n) {
    const s = D.series(ticker), v = D.state.volume[ticker];
    if (!s || !v) return NaN;
    const days = n || 60;
    let sum = 0, cnt = 0;
    for (let i = Math.max(0, s.length - days); i < s.length; i++) {
      if (s[i] === null || v[i] === null || !isFinite(s[i]) || !isFinite(v[i])) continue;
      sum += s[i] * v[i] * 1000; cnt++;
    }
    return cnt ? sum / cnt : NaN;
  };

  // 거래 가능한 종목만 (벤치마크 제외, 그 시점에 가격이 있는 것)
  D.tradables = function (i) {
    const idx = (i === undefined) ? D.lastIndex() : i;
    return D.state.tickers.filter(function (t) {
      if (D.isBenchmark(t)) return false;
      const s = D.state.close[t];
      return s && s[idx] !== null && isFinite(s[idx]);
    });
  };

  // 날짜 문자열 → 인덱스
  D.indexOfDate = function (ds) { return D.state.dates.indexOf(ds); };

  root.DATA = D;
})(window.QL = window.QL || {});
