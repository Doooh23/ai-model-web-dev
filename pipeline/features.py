# -*- coding: utf-8 -*-
"""
features.py — 피처 생성 (파이썬 판)

★ 이 파일은 docs/js/features.js 와 **완전히 같은 값을 만들어야 합니다.**

   브라우저에서 학습하는 모델과 파이썬에서 미리 학습하는 모델을 비교하려면
   둘이 똑같은 문제지를 받아야 합니다. 한쪽 피처가 조금이라도 다르면
   성적 차이가 모델 때문인지 피처 때문인지 알 수 없게 됩니다.

   그래서 계산식뿐 아니라 **결측 처리 규칙까지** JS 쪽과 한 줄씩 맞춰 두었습니다.
     · 가격이 없으면 최대 5일까지 거슬러 올라가 마지막 값을 씁니다
     · 이동평균은 필요한 날의 60% 이상이 있어야 계산합니다
     · 변동성은 50% 이상, RSI도 50% 이상
     · 하나라도 계산할 수 없으면 그날 행 전체를 버립니다
   JS 쪽을 고치면 이 파일도 반드시 같이 고쳐야 합니다.
"""

from __future__ import annotations

import json
import math
import os
from typing import Dict, List, Optional, Tuple

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "docs", "data")

WARMUP = 210            # features.js 의 F.WARMUP 과 같아야 합니다
TRADING_DAYS = 252

FEATURE_KEYS_PRICE = [
    "ret1", "ret5", "ret21", "ma5_vs_ma20", "ma50_vs_ma200", "rsi14",
    "vol20", "vol60", "vol_ratio", "dd126", "vratio", "mkt_ret5", "mkt_vol20",
]
FEATURE_KEYS_MACRO = ["vix", "vix_chg5"]


# ---------------------------------------------------------------------------
#  데이터 읽기
# ---------------------------------------------------------------------------
def load_market(data_dir: str = DATA_DIR) -> dict:
    with open(os.path.join(data_dir, "daily.json"), encoding="utf-8") as f:
        daily = json.load(f)
    macro = None
    mp = os.path.join(data_dir, "macro.json")
    if os.path.exists(mp):
        with open(mp, encoding="utf-8") as f:
            macro = json.load(f)
    return {"daily": daily, "macro": macro}


def _to_array(values: List[Optional[float]]) -> np.ndarray:
    """None 을 NaN 으로 바꿔 numpy 배열로."""
    return np.array([np.nan if v is None else float(v) for v in values], dtype=float)


def market_series(daily: dict) -> Optional[np.ndarray]:
    for t in ("QQQ", "^IXIC", "^GSPC"):
        if t in daily["close"]:
            return _to_array(daily["close"][t])
    return None


def vix_series(daily: dict, macro: Optional[dict]) -> Optional[np.ndarray]:
    """macro.json 의 VIX 를 주가 날짜에 맞춰 옮겨 담습니다(앞의 값으로 채움)."""
    if not macro or "series" not in macro or "VIXCLS" not in macro["series"]:
        return None
    pos = {d: i for i, d in enumerate(macro["dates"])}
    src = macro["series"]["VIXCLS"]["values"]
    out = np.full(len(daily["dates"]), np.nan)
    last = np.nan
    for i, d in enumerate(daily["dates"]):
        j = pos.get(d)
        if j is not None and src[j] is not None and np.isfinite(src[j]):
            last = float(src[j])
        out[i] = last
    return out


def feature_version(macro: Optional[dict]) -> str:
    ok = bool(macro and "series" in macro and "VIXCLS" in macro.get("series", {}))
    return "f1" if ok else "f1-nomacro"


# ---------------------------------------------------------------------------
#  기본 지표 — features.js 의 IND 과 1:1 대응
# ---------------------------------------------------------------------------
def px(s: np.ndarray, i: int) -> float:
    if i < 0:
        return np.nan
    for k in range(i, max(-1, i - 6), -1):
        if k >= 0 and np.isfinite(s[k]):
            return s[k]
    return np.nan


def mom(s: np.ndarray, i: int, n: int) -> float:
    a, b = px(s, i - n), px(s, i)
    return b / a - 1 if (np.isfinite(a) and np.isfinite(b) and a > 0) else np.nan


def ma(s: np.ndarray, i: int, n: int) -> float:
    lo = max(0, i - n + 1)
    win = s[lo:i + 1]
    ok = win[np.isfinite(win)]
    return float(ok.mean()) if len(ok) >= n * 0.6 else np.nan


def vol(s: np.ndarray, i: int, n: int) -> float:
    lo = max(1, i - n + 1)
    a, b = s[lo - 1:i], s[lo:i + 1]
    ok = np.isfinite(a) & np.isfinite(b) & (a > 0)
    r = b[ok] / a[ok] - 1
    if len(r) < n * 0.5:
        return np.nan
    return float(np.std(r, ddof=1) * math.sqrt(TRADING_DAYS))


def rsi(s: np.ndarray, i: int, n: int) -> float:
    lo = max(1, i - n + 1)
    a, b = s[lo - 1:i], s[lo:i + 1]
    ok = np.isfinite(a) & np.isfinite(b)
    d = b[ok] - a[ok]
    if len(d) < n * 0.5:
        return np.nan
    up, down = d[d > 0].sum(), -d[d < 0].sum()
    return float(100 * up / (up + down)) if (up + down) > 0 else np.nan


def drawdown(s: np.ndarray, i: int, n: int) -> float:
    lo = max(0, i - n + 1)
    win = s[lo:i + 1]
    ok = win[np.isfinite(win)]
    if not len(ok):
        return np.nan
    peak = ok.max()
    p = px(s, i)
    return p / peak - 1 if (np.isfinite(p) and peak > 0) else np.nan


def volume_ratio(v: Optional[np.ndarray], i: int) -> float:
    if v is None:
        return np.nan
    a = v[max(0, i - 4):i + 1]
    b = v[max(0, i - 59):i + 1]
    a, b = a[np.isfinite(a)], b[np.isfinite(b)]
    if not len(a) or not len(b) or b.mean() <= 0:
        return np.nan
    return float(a.mean() / b.mean() - 1)


# ---------------------------------------------------------------------------
#  한 종목의 문제지 만들기 (features.js 의 F.build 과 같은 결과)
# ---------------------------------------------------------------------------
def build(ticker: str, market: dict) -> dict:
    daily, macro = market["daily"], market["macro"]
    dates = daily["dates"]
    if ticker not in daily["close"]:
        raise ValueError(f"{ticker} 의 가격 데이터가 없습니다.")

    s = _to_array(daily["close"][ticker])
    v = _to_array(daily["volume"][ticker]) if ticker in daily.get("volume", {}) else None
    m = market_series(daily)
    vix = vix_series(daily, macro)
    use_macro = vix is not None
    cols = FEATURE_KEYS_PRICE + (FEATURE_KEYS_MACRO if use_macro else [])

    X, y, ret, ds, idx = [], [], [], [], []
    dropped = 0

    for i in range(WARMUP, len(dates) - 1):
        p0, p1 = s[i], s[i + 1]
        if not (np.isfinite(p0) and np.isfinite(p1) and p0 > 0):
            dropped += 1
            continue

        ma5, ma20 = ma(s, i, 5), ma(s, i, 20)
        ma50, ma200 = ma(s, i, 50), ma(s, i, 200)
        v20, v60 = vol(s, i, 20), vol(s, i, 60)

        row = [
            mom(s, i, 1),
            mom(s, i, 5),
            mom(s, i, 21),
            ma5 / ma20 - 1 if (np.isfinite(ma5) and np.isfinite(ma20) and ma20 > 0) else np.nan,
            ma50 / ma200 - 1 if (np.isfinite(ma50) and np.isfinite(ma200) and ma200 > 0) else np.nan,
            rsi(s, i, 14),
            v20,
            v60,
            v20 / v60 - 1 if (np.isfinite(v20) and np.isfinite(v60) and v60 > 0) else np.nan,
            drawdown(s, i, 126),
            volume_ratio(v, i),
            mom(m, i, 5) if m is not None else np.nan,
            vol(m, i, 20) if m is not None else np.nan,
        ]
        if use_macro:
            a, b = vix[i - 5] if i >= 5 else np.nan, vix[i]
            row.append(b)
            row.append(b / a - 1 if (np.isfinite(a) and np.isfinite(b) and a > 0) else np.nan)

        if not all(np.isfinite(x) for x in row):
            dropped += 1
            continue

        r = p1 / p0 - 1
        X.append(row)
        y.append(1 if r > 0 else 0)
        ret.append(r)
        ds.append(dates[i])
        idx.append(i)

    return {
        "ticker": ticker,
        "cols": cols,
        "featVer": feature_version(macro),
        "X": np.array(X, dtype=float),
        "y": np.array(y, dtype=int),
        "ret": np.array(ret, dtype=float),
        "dates": ds,
        "idx": idx,
        "dropped": dropped,
    }


def return_series(ticker: str, market: dict) -> dict:
    """변동성 모델용 — 일별 수익률만."""
    daily = market["daily"]
    s = _to_array(daily["close"][ticker])
    dates = daily["dates"]
    r, ds = [], []
    for i in range(1, len(s)):
        a, b = s[i - 1], s[i]
        if np.isfinite(a) and np.isfinite(b) and a > 0:
            r.append(b / a - 1)
            ds.append(dates[i])
    return {"ret": np.array(r, dtype=float), "dates": ds}


# ---------------------------------------------------------------------------
#  시간순 분할 — splits.js 의 walkForward 와 같은 규칙
# ---------------------------------------------------------------------------
def walk_forward(n: int, folds: int = 5, min_train: float = 0.5,
                 embargo: int = 5) -> List[dict]:
    gap = 1 + max(0, embargo)          # purge 1일 + embargo
    start = int(n * min_train)
    block = (n - start) // folds
    out = []
    if block < 20:
        return out
    for k in range(folds):
        test_lo = start + k * block
        test_hi = n if k == folds - 1 else test_lo + block
        train_hi = test_lo - gap
        if train_hi < 100:
            continue
        out.append({"fold": k + 1, "train_lo": 0, "train_hi": train_hi,
                    "test_lo": test_lo, "test_hi": test_hi})
    return out


def standardize(train_X: np.ndarray, test_X: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    """학습 구간 통계로만 자를 만들어 두 구간에 적용 (splits.js 와 동일: 모집단 표준편차)."""
    mu = train_X.mean(axis=0)
    sd = train_X.std(axis=0)
    sd[sd == 0] = 1e-9
    return (train_X - mu) / sd, (test_X - mu) / sd
