/* ============================================================================
 *  features.js — 피처(모델에게 주는 문제지)를 만드는 단 하나의 장소
 *
 *  ★ 이 파일이 왜 따로 있는가
 *    모델을 공정하게 비교하려면 모든 모델이 "똑같은 문제지"를 받아야 합니다.
 *    모델마다 자기가 쓸 피처를 알아서 만들면, 성적 차이가 모델 때문인지
 *    피처 때문인지 알 수 없게 됩니다. 그래서 피처 생성은 모델 바깥인
 *    여기 한 곳에서만 합니다. 모델은 완성된 숫자표를 받기만 합니다.
 *
 *  ★ 미래를 보지 않는다 (데이터 누출 방지)
 *    피처는 전부 t시점(그날 종가)까지의 정보만 씁니다.
 *    정답(라벨)은 t+1시점, 즉 "내일 올랐는가"입니다.
 *    이 규칙이 깨지면 정확도 70% 같은 가짜 성적이 나옵니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const DATA = root.DATA;
  const F = {};

  /* ------------------------------------------------------------------------
   *  1) 기본 지표 — 모두 i시점까지만 봅니다
   * ----------------------------------------------------------------------*/
  const IND = {};

  // i일의 가격. 휴장·결측이면 최대 5일까지 거슬러 올라가 마지막 값을 씁니다.
  IND.px = function (s, i) {
    if (i < 0) return NaN;
    for (let k = i; k >= Math.max(0, i - 5); k--) if (s[k] !== null && isFinite(s[k])) return s[k];
    return NaN;
  };

  // n일 수익률
  IND.mom = function (s, i, n) {
    const a = IND.px(s, i - n), b = IND.px(s, i);
    return (isFinite(a) && isFinite(b) && a > 0) ? b / a - 1 : NaN;
  };

  // n일 이동평균
  IND.ma = function (s, i, n) {
    let sum = 0, cnt = 0;
    for (let k = Math.max(0, i - n + 1); k <= i; k++) {
      if (s[k] !== null && isFinite(s[k])) { sum += s[k]; cnt++; }
    }
    return cnt >= n * 0.6 ? sum / cnt : NaN;
  };

  // 연율 변동성 (하루 등락폭이 얼마나 큰가)
  IND.vol = function (s, i, n) {
    const r = [];
    for (let k = Math.max(1, i - n + 1); k <= i; k++) {
      const a = s[k - 1], b = s[k];
      if (a !== null && b !== null && isFinite(a) && isFinite(b) && a > 0) r.push(b / a - 1);
    }
    if (r.length < n * 0.5) return NaN;
    const m = r.reduce(function (x, y) { return x + y; }, 0) / r.length;
    let v = 0;
    for (let k = 0; k < r.length; k++) v += (r[k] - m) * (r[k] - m);
    return Math.sqrt(v / (r.length - 1)) * Math.sqrt(252);
  };

  // RSI — 최근 n일 중 오른 폭이 차지하는 비율(0~100). 70 이상 과열, 30 이하 과매도.
  IND.rsi = function (s, i, n) {
    let up = 0, down = 0, cnt = 0;
    for (let k = Math.max(1, i - n + 1); k <= i; k++) {
      const a = s[k - 1], b = s[k];
      if (a === null || b === null || !isFinite(a) || !isFinite(b)) continue;
      const d = b - a;
      if (d > 0) up += d; else down -= d;
      cnt++;
    }
    if (cnt < n * 0.5 || up + down === 0) return NaN;
    return 100 * up / (up + down);
  };

  // 최근 n일 고점 대비 낙폭 (0이면 신고가, -0.2면 고점에서 20% 내려옴)
  IND.drawdown = function (s, i, n) {
    let peak = -Infinity;
    for (let k = Math.max(0, i - n + 1); k <= i; k++) {
      if (s[k] !== null && isFinite(s[k]) && s[k] > peak) peak = s[k];
    }
    const p = IND.px(s, i);
    return (isFinite(p) && peak > 0) ? p / peak - 1 : NaN;
  };

  // 거래량 급증도: 최근 5일 평균 ÷ 최근 60일 평균 − 1
  IND.volumeRatio = function (v, i) {
    if (!v) return NaN;
    let a = 0, ca = 0, b = 0, cb = 0;
    for (let k = Math.max(0, i - 4); k <= i; k++) if (v[k] !== null && isFinite(v[k])) { a += v[k]; ca++; }
    for (let k = Math.max(0, i - 59); k <= i; k++) if (v[k] !== null && isFinite(v[k])) { b += v[k]; cb++; }
    return (ca && cb && b > 0) ? (a / ca) / (b / cb) - 1 : NaN;
  };

  F.IND = IND;

  /* ------------------------------------------------------------------------
   *  2) 피처 목록
   *     name = 화면에 보일 이름, tip = 첫 등장 시 붙는 한 줄 설명
   *     fn(c) 의 c 는 { s: 종가배열, v: 거래량배열, i: 날짜위치, m: 시장 종가배열,
   *                     vix: VIX 배열 }
   * ----------------------------------------------------------------------*/
  const PRICE = [
    { key: 'ret1', name: '1일 수익률', tip: '어제 대비 오늘 몇 % 움직였는가',
      fn: function (c) { return IND.mom(c.s, c.i, 1); } },
    { key: 'ret5', name: '5일 수익률', tip: '최근 일주일 동안의 상승·하락 폭',
      fn: function (c) { return IND.mom(c.s, c.i, 5); } },
    { key: 'ret21', name: '21일 수익률', tip: '최근 한 달 동안의 상승·하락 폭',
      fn: function (c) { return IND.mom(c.s, c.i, 21); } },
    { key: 'ma5_vs_ma20', name: '단기 추세(5일÷20일)', tip: '5일 평균이 20일 평균보다 위면 최근 흐름이 좋다는 뜻',
      fn: function (c) {
        const a = IND.ma(c.s, c.i, 5), b = IND.ma(c.s, c.i, 20);
        return (isFinite(a) && isFinite(b) && b > 0) ? a / b - 1 : NaN; } },
    { key: 'ma50_vs_ma200', name: '장기 추세(50일÷200일)', tip: '길게 봐서 오름세인지 내림세인지',
      fn: function (c) {
        const a = IND.ma(c.s, c.i, 50), b = IND.ma(c.s, c.i, 200);
        return (isFinite(a) && isFinite(b) && b > 0) ? a / b - 1 : NaN; } },
    { key: 'rsi14', name: 'RSI(14일)', tip: '최근 14일 중 오른 폭의 비율. 70↑ 과열, 30↓ 과매도',
      fn: function (c) { return IND.rsi(c.s, c.i, 14); } },
    { key: 'vol20', name: '변동성(20일)', tip: '한 달 동안 하루 등락폭이 얼마나 컸는가(연율)',
      fn: function (c) { return IND.vol(c.s, c.i, 20); } },
    { key: 'vol60', name: '변동성(60일)', tip: '석 달 기준 등락폭',
      fn: function (c) { return IND.vol(c.s, c.i, 60); } },
    { key: 'vol_ratio', name: '변동성 확대(20일÷60일)', tip: '요즘 갑자기 더 출렁이기 시작했는가',
      fn: function (c) {
        const a = IND.vol(c.s, c.i, 20), b = IND.vol(c.s, c.i, 60);
        return (isFinite(a) && isFinite(b) && b > 0) ? a / b - 1 : NaN; } },
    { key: 'dd126', name: '고점 대비 낙폭(6개월)', tip: '최근 6개월 최고가에서 몇 % 내려와 있는가',
      fn: function (c) { return IND.drawdown(c.s, c.i, 126); } },
    { key: 'vratio', name: '거래량 급증', tip: '최근 5일 거래량이 평소(60일)보다 얼마나 많은가',
      fn: function (c) { return IND.volumeRatio(c.v, c.i); } },
    { key: 'mkt_ret5', name: '시장 5일 수익률', tip: '이 종목 말고 나스닥 전체가 최근 일주일 어땠는가',
      fn: function (c) { return c.m ? IND.mom(c.m, c.i, 5) : NaN; } },
    { key: 'mkt_vol20', name: '시장 변동성(20일)', tip: '시장 전체가 얼마나 불안한가',
      fn: function (c) { return c.m ? IND.vol(c.m, c.i, 20) : NaN; } }
  ];

  // 매크로 피처 — macro.json 이 아직 로드되지 않았으면 빠집니다.
  const MACRO = [
    { key: 'vix', name: 'VIX 수준', tip: '시장의 공포 지수. 20 아래면 평온, 30 위면 공황에 가깝습니다',
      fn: function (c) { return c.vix ? c.vix[c.i] : NaN; } },
    { key: 'vix_chg5', name: 'VIX 5일 변화', tip: '공포가 늘고 있는지 줄고 있는지',
      fn: function (c) {
        if (!c.vix) return NaN;
        const a = c.vix[c.i - 5], b = c.vix[c.i];
        return (isFinite(a) && isFinite(b) && a > 0) ? b / a - 1 : NaN; } }
  ];

  // 지표를 계산하려면 과거가 최소 이만큼 쌓여 있어야 합니다(200일 평균 때문).
  F.WARMUP = 210;

  F.hasMacro = function () {
    const mac = DATA.state.macro;
    return !!(mac && mac.series && mac.series.VIXCLS);
  };

  F.list = function () { return F.hasMacro() ? PRICE.concat(MACRO) : PRICE.slice(); };
  F.cols = function () { return F.list().map(function (f) { return f.key; }); };
  F.byKey = function (key) {
    const l = F.list();
    for (let i = 0; i < l.length; i++) if (l[i].key === key) return l[i];
    return null;
  };

  // 피처 구성이 바뀌면 이 값이 바뀌고, 캐시가 자동으로 무효화됩니다.
  F.version = function () { return F.hasMacro() ? 'f1' : 'f1-nomacro'; };

  /* ------------------------------------------------------------------------
   *  3) 시장·매크로 계열 준비
   * ----------------------------------------------------------------------*/
  F.marketSeries = function () {
    const c = DATA.state.close || {};
    return c['QQQ'] || c['^IXIC'] || c['^GSPC'] || null;
  };

  // macro.json 의 날짜와 주가 날짜가 다를 수 있어 날짜를 맞춰 옮겨 담습니다.
  let vixCache = null, vixCacheKey = '';
  F.vixSeries = function () {
    if (!F.hasMacro()) return null;
    const dates = DATA.state.dates;
    const key = dates.length + '|' + dates[0] + '|' + dates[dates.length - 1];
    if (vixCache && vixCacheKey === key) return vixCache;
    const mac = DATA.state.macro;
    const pos = {};
    for (let i = 0; i < mac.dates.length; i++) pos[mac.dates[i]] = i;
    const src = mac.series.VIXCLS.values;
    const out = new Array(dates.length);
    let last = NaN;
    for (let i = 0; i < dates.length; i++) {
      const j = pos[dates[i]];
      if (j !== undefined && src[j] !== null && isFinite(src[j])) last = src[j];
      out[i] = last;
    }
    vixCache = out; vixCacheKey = key;
    return out;
  };

  /* ------------------------------------------------------------------------
   *  4) 한 종목의 문제지 만들기
   *
   *    반환값
   *      cols    피처 이름들 (열 제목)
   *      X       피처 행렬 — X[k] 가 dates[k] 하루치
   *      y       정답 — 다음 날 올랐으면 1, 아니면 0
   *      ret     다음 날 실제 수익률 (모의투자에서 씁니다)
   *      dates   그 행의 기준 날짜 (t시점)
   *      idx     원본 데이터에서의 날짜 위치
   *
   *    마지막 날은 "다음 날"이 없으므로 문제지에 넣지 않습니다.
   * ----------------------------------------------------------------------*/
  F.build = function (ticker, opt) {
    opt = opt || {};
    const s = DATA.series(ticker);
    if (!s) throw new Error(ticker + ' 의 가격 데이터가 없습니다.');
    const v = DATA.state.volume[ticker] || null;
    const m = F.marketSeries();
    const vix = F.vixSeries();
    const list = F.list();
    const dates = DATA.state.dates;

    const from = Math.max(F.WARMUP, opt.from || 0);
    const to = Math.min(dates.length - 2, opt.to === undefined ? dates.length - 2 : opt.to);

    const X = [], y = [], ret = [], ds = [], idx = [];
    let dropped = 0;
    const c = { s: s, v: v, m: m, vix: vix, i: 0, t: ticker };

    for (let i = from; i <= to; i++) {
      const p0 = s[i], p1 = s[i + 1];
      if (p0 === null || p1 === null || !isFinite(p0) || !isFinite(p1) || p0 <= 0) { dropped++; continue; }
      c.i = i;
      const row = new Array(list.length);
      let ok = true;
      for (let j = 0; j < list.length; j++) {
        const val = list[j].fn(c);
        if (!isFinite(val)) { ok = false; break; }
        row[j] = val;
      }
      if (!ok) { dropped++; continue; }
      const r = p1 / p0 - 1;
      X.push(row);
      y.push(r > 0 ? 1 : 0);
      ret.push(r);
      ds.push(dates[i]);
      idx.push(i);
    }

    return {
      ticker: ticker,
      cols: list.map(function (f) { return f.key; }),
      featVer: F.version(),
      X: X, y: y, ret: ret, dates: ds, idx: idx,
      dropped: dropped,
      upRate: y.length ? y.reduce(function (a, b) { return a + b; }, 0) / y.length : NaN
    };
  };

  /* ------------------------------------------------------------------------
   *  5) 변동성 모델용 — 피처 대신 '수익률 시계열'을 받습니다
   *     (GARCH·EWMA 같은 모델은 과거 수익률만 보고 내일의 출렁임을 예측합니다)
   * ----------------------------------------------------------------------*/
  F.returnSeries = function (ticker) {
    const s = DATA.series(ticker);
    if (!s) throw new Error(ticker + ' 의 가격 데이터가 없습니다.');
    const dates = DATA.state.dates;
    const r = [], ds = [], idx = [];
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1], b = s[i];
      if (a === null || b === null || !isFinite(a) || !isFinite(b) || a <= 0) continue;
      r.push(b / a - 1); ds.push(dates[i]); idx.push(i);
    }
    return { ticker: ticker, ret: r, dates: ds, idx: idx };
  };

  root.FEAT = F;
})(window.QL = window.QL || {});
