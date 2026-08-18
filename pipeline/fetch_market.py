# -*- coding: utf-8 -*-
"""
fetch_market.py — 실제 시장 데이터를 받아 웹사이트가 읽을 파일로 만듭니다.

이 스크립트는 GitHub Actions가 매일(미국장 마감 후) 자동으로 돌립니다.
결과 파일은 저장소에 그대로 커밋되고, 웹사이트는 그 파일을 읽습니다.
그래서 **학생은 API 키가 하나도 필요 없습니다.**

만드는 파일 (docs/data/)
    meta.json         언제 받았는지, 종목이 몇 개인지, 경고 문구
    daily.json        나스닥100 일봉 (종가·거래량) — 사이트의 기본 데이터
    daily_recent.json 최근 2년치만 (처음 화면을 빠르게 띄우려고)
    macro.json        금리·VIX 등 매크로 지표
    universe.json     종목 이름·섹터·FOMC 날짜

용량을 줄이는 방법
    - 가격은 소수점 2자리, 거래량은 천 주 단위 정수
    - 열(column) 방향으로 저장 (날짜 배열 1개 + 종목별 배열)
    - 없는 값은 null

사용법
    python -m pipeline.fetch_market                 # 전체 받기
    python -m pipeline.fetch_market --skip-macro    # 일봉만
    python -m pipeline.fetch_market --synthetic     # 인터넷 없이 형식만 같은 가짜 파일 생성
                                                    # (화면 개발용. 파일에 'synthetic': true 로 표시됩니다)
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pipeline.universe import (BENCHMARKS, FOMC_DATES, MACRO,  # noqa: E402
                               NASDAQ100, all_tickers)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# 실데이터는 docs/data/ 로, 가상 데이터는 docs/data-dev/ 로 갑니다.
# 배포되는 사이트에는 절대 가상 데이터가 섞이지 않게 폴더 자체를 분리했습니다.
OUT_DIR = os.path.join(ROOT, "docs", "data")
DAILY_YEARS = 12
RECENT_YEARS = 2


# ---------------------------------------------------------------------------
#  도우미
# ---------------------------------------------------------------------------
def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def r2(v):
    """가격: 소수점 2자리. 값이 없으면 null."""
    return None if v is None or not np.isfinite(v) else round(float(v), 2)


def kvol(v):
    """거래량: 천 주 단위 정수(용량 절약)."""
    return None if v is None or not np.isfinite(v) else int(round(float(v) / 1000.0))


def write_json(name: str, payload) -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    log(f"저장: {os.path.relpath(path, ROOT)} ({os.path.getsize(path) / 1024:,.0f} KB)")


# ---------------------------------------------------------------------------
#  FRED 매크로 (API 키 불필요)
# ---------------------------------------------------------------------------
def fetch_fred(series_id: str, start: str) -> dict:
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}&cosd={start}"
    with urllib.request.urlopen(url, timeout=90) as resp:
        text = resp.read().decode("utf-8", "replace")
    out = {}
    for line in io.StringIO(text).readlines()[1:]:
        parts = line.strip().split(",")
        if len(parts) < 2:
            continue
        try:
            out[parts[0]] = float(parts[1])
        except ValueError:
            continue          # 결측은 '.' 로 옵니다
    return out


# ---------------------------------------------------------------------------
#  주가 (yfinance)
# ---------------------------------------------------------------------------
def fetch_daily(tickers: list, years: int):
    import pandas as pd
    import yfinance as yf

    start = (datetime.now(timezone.utc).date().replace(year=datetime.now(timezone.utc).year - years))
    log(f"일봉 내려받는 중… {len(tickers)}개 종목, {start} 이후")
    raw = yf.download(tickers, start=str(start), auto_adjust=True, progress=False,
                      group_by="column", threads=True)
    if raw is None or len(raw) == 0:
        raise SystemExit("[오류] 주가를 받지 못했습니다.")

    close = raw["Close"] if "Close" in raw else raw
    volume = raw["Volume"] if "Volume" in raw else close * np.nan
    if not isinstance(close, pd.DataFrame):
        close = close.to_frame(tickers[0])
        volume = volume.to_frame(tickers[0])

    # 관측치가 너무 적은 종목 제외
    keep = [c for c in close.columns if close[c].notna().sum() >= 200]
    dropped = sorted(set(close.columns) - set(keep))
    if dropped:
        log(f"자료가 부족해 제외: {', '.join(map(str, dropped))}")
    close, volume = close[keep], volume.reindex(columns=keep)

    dates = [str(d)[:10] for d in close.index]
    return dates, keep, close, volume


def build_daily_payload(dates, tickers, close, volume, synthetic=False):
    return {
        "synthetic": synthetic,
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "dates": dates,
        "tickers": list(tickers),
        # 종목별 배열 (열 방향). 길이는 dates와 같습니다.
        "close": {t: [r2(v) for v in close[t].to_numpy()] for t in tickers},
        "volume": {t: [kvol(v) for v in volume[t].to_numpy()] for t in tickers},
    }


# ---------------------------------------------------------------------------
#  가짜(합성) 데이터 — 인터넷이 없는 환경에서 화면을 개발할 때만 씁니다
# ---------------------------------------------------------------------------
def synthetic_payloads(n_days: int = 2600):
    log("가상 데이터 생성 중 (실제 시장 아님)")
    rng = np.random.default_rng(20260807)
    tickers = sorted(NASDAQ100) + sorted(BENCHMARKS)
    dates = [str(d)[:10] for d in np.busday_offset(
        np.datetime64("2016-01-04"), np.arange(n_days), roll="forward").astype("datetime64[D]")]

    n = len(tickers)
    beta = np.clip(rng.normal(1.0, 0.3, n), 0.3, 2.0)
    vol = np.clip(rng.normal(0.018, 0.006, n), 0.008, 0.05)
    px = 40 * np.exp(rng.normal(0.9, 0.7, n))
    close = np.zeros((n_days, n))
    volume = np.zeros((n_days, n))
    mkt_vol, shock = 0.011, 0.0
    for t in range(n_days):
        mkt_vol = np.sqrt(2.4e-6 + 0.08 * shock ** 2 + 0.90 * mkt_vol ** 2)
        shock = rng.normal(0, mkt_vol)
        mkt = 0.0004 + shock
        ret = beta * mkt + rng.normal(0, vol, n)
        px = px * (1 + ret)
        close[t] = px
        volume[t] = np.exp(rng.normal(14.5, 0.7, n)) * (1 + 3 * np.abs(ret))

    class _Col:
        def __init__(self, arr, cols):
            self.arr, self.cols = arr, cols
        def __getitem__(self, k):
            class _S:
                def __init__(self, v): self.v = v
                def to_numpy(self): return self.v
            return _S(self.arr[:, self.cols.index(k)])

    return dates, tickers, _Col(close, tickers), _Col(volume, tickers)


# ---------------------------------------------------------------------------
#  본체
# ---------------------------------------------------------------------------
def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="나스닥 실데이터 수집 (웹사이트용)")
    ap.add_argument("--synthetic", action="store_true", help="인터넷 없이 형식만 같은 가짜 데이터 생성")
    ap.add_argument("--skip-macro", action="store_true")
    ap.add_argument("--years", type=int, default=DAILY_YEARS)
    args = ap.parse_args(argv)

    global OUT_DIR
    if args.synthetic:
        OUT_DIR = os.path.join(ROOT, "docs", "data-dev")
        log("※ 가상 모드입니다. docs/data-dev/ 에만 저장하며 저장소에는 커밋되지 않습니다.")
    os.makedirs(OUT_DIR, exist_ok=True)
    warnings = [
        "현재 지수에 남아 있는 종목만 담겨 있어 생존 편향이 있습니다. 과거 성과가 실제보다 좋게 보일 수 있습니다.",
        "수정주가(배당·분할 반영) 종가 기준입니다. 실제 체결가와는 다릅니다.",
        "교육·연구용입니다. 실제 투자 판단에 사용하지 마십시오.",
    ]

    if args.synthetic:
        dates, tickers, close, volume = synthetic_payloads()
        warnings.insert(0, "★ 지금 보고 있는 것은 가상 데이터입니다. 실제 시장 데이터가 아닙니다.")
    else:
        dates, tickers, close, volume = fetch_daily(all_tickers(), args.years)

    daily = build_daily_payload(dates, tickers, close, volume, synthetic=args.synthetic)
    write_json("daily.json", daily)

    # 최근 2년만 담은 가벼운 파일 (첫 화면을 빠르게 띄우는 용도)
    cut = max(0, len(dates) - RECENT_YEARS * 252)
    write_json("daily_recent.json", {
        "synthetic": args.synthetic,
        "updated": daily["updated"],
        "dates": dates[cut:],
        "tickers": daily["tickers"],
        "close": {t: v[cut:] for t, v in daily["close"].items()},
        "volume": {t: v[cut:] for t, v in daily["volume"].items()},
    })

    if not args.skip_macro:
        if args.synthetic:
            rng = np.random.default_rng(7)
            series = {}
            for sid, name in MACRO.items():
                base = {"DGS2": 3.5, "DGS10": 4.2, "T10Y2Y": 0.6, "VIXCLS": 17.0,
                        "BAMLH0A0HYM2": 3.4, "DFF": 4.0}.get(sid, 1.0)
                walk = base + np.cumsum(rng.normal(0, 0.02, len(dates)))
                series[sid] = {"name": name, "values": [round(float(v), 3) for v in walk]}
            write_json("macro.json", {"synthetic": True, "dates": dates, "series": series})
        else:
            start = dates[0]
            series = {}
            for sid, name in MACRO.items():
                try:
                    raw = fetch_fred(sid, start)
                    aligned, last = [], None
                    for d in dates:
                        if d in raw:
                            last = raw[d]
                        aligned.append(None if last is None else round(last, 3))
                    series[sid] = {"name": name, "values": aligned}
                    log(f"매크로 확보: {sid} ({name})")
                except Exception as e:
                    log(f"매크로 실패: {sid} — {e}")
            write_json("macro.json", {"synthetic": False, "dates": dates, "series": series})

    write_json("universe.json", {
        "sectors": {t: NASDAQ100.get(t, "벤치마크") for t in daily["tickers"]},
        "benchmarks": BENCHMARKS,
        "fomc": FOMC_DATES,
    })

    write_json("meta.json", {
        "updated": daily["updated"],
        "synthetic": args.synthetic,
        "n_tickers": len(daily["tickers"]),
        "n_days": len(dates),
        "first_date": dates[0],
        "last_date": dates[-1],
        "source": "가상 생성기" if args.synthetic else "yfinance (수정주가) + FRED",
        "warnings": warnings,
    })

    log(f"완료. {len(daily['tickers'])}개 종목 · {dates[0]} ~ {dates[-1]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
