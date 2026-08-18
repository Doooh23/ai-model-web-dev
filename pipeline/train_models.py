# -*- coding: utf-8 -*-
"""
train_models.py — 브라우저에서 돌릴 수 없는 무거운 모델을 미리 학습합니다.

LSTM·GRU·TCN·Transformer 같은 딥러닝 모델은 학생 노트북 브라우저에서 학습할 수
없습니다. 그래서 여기서 미리 학습하고 **예측값만** docs/data/predictions.json 으로
내보냅니다. 사이트는 그 파일을 읽어 브라우저 모델과 똑같은 얼굴로 다룹니다.

★ 공정성을 지키는 방법
   브라우저 모델과 비교하려면 조건이 같아야 합니다. 그래서 이 스크립트는
     · pipeline/features.py 로 **같은 피처**를 만들고 (docs/js/features.js 와 동일)
     · **같은 시간순 분할**을 씁니다 (5겹, purge 1일 + embargo 5일)
     · 표준화도 **학습 구간 통계로만** 합니다
   하나라도 어긋나면 비교가 성립하지 않습니다.

만드는 모델
   방향 예측   lstm · gru · tcn · transformer        (torch 필요)
   변동성 예측  egarch (numpy) · lstm_vol (torch 필요)
   국면        hmm3 (numpy, Baum-Welch 직접 구현)

사용법
   python -m pipeline.train_models                      # 기본 종목, 전체 모델
   python -m pipeline.train_models --skip-deep          # torch 없이 EGARCH·HMM만
   python -m pipeline.train_models --tickers AAPL MSFT  # 종목 지정
   python -m pipeline.train_models --epochs 5 --folds 3 # 빠르게 확인만
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from datetime import datetime, timezone
from typing import Dict, List, Optional

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pipeline import features as F  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(ROOT, "docs", "data", "predictions.json")

# 사전 학습 대상 종목 (기본값). 딥러닝 학습이 오래 걸려 대표 종목만 돌립니다.
DEFAULT_TICKERS = ["AAPL", "MSFT", "NVDA", "GOOGL", "TSLA"]

SEQ_LEN = 30          # 딥러닝 모델이 한 번에 보는 과거 일수
VOL_SEQ = 22
# log(r²)의 평균은 log(σ²)보다 1.2704 작습니다 (docs/js/core/vol.js 와 같은 이유)
LOG_CHI2 = 1.2703628454614782
EPS = 1e-10


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


# ===========================================================================
#  1) 딥러닝 (torch) — 방향 예측
# ===========================================================================
def _torch():
    try:
        import torch
        return torch
    except ImportError:
        return None


def make_windows(Z: np.ndarray, lo: int, hi: int, seq: int):
    """Z[i-seq+1 : i+1] 창을 i in [lo, hi) 에 대해 만듭니다."""
    idx = [i for i in range(lo, hi) if i - seq + 1 >= 0]
    if not idx:
        return np.zeros((0, seq, Z.shape[1])), []
    win = np.stack([Z[i - seq + 1:i + 1] for i in idx])
    return win, idx


def build_net(kind: str, n_feat: int, torch):
    nn = torch.nn

    class Rnn(nn.Module):
        def __init__(self, cell):
            super().__init__()
            self.rnn = cell(n_feat, 32, batch_first=True)
            self.head = nn.Linear(32, 1)

        def forward(self, x):
            out, _ = self.rnn(x)
            return self.head(out[:, -1]).squeeze(-1)

    class Tcn(nn.Module):
        """인과적(causal) 1D 합성곱 — 미래를 보지 않도록 왼쪽에만 패딩합니다."""
        def __init__(self):
            super().__init__()
            ch = 32
            self.convs = nn.ModuleList([
                nn.Conv1d(n_feat if i == 0 else ch, ch, 3, dilation=d)
                for i, d in enumerate([1, 2, 4])
            ])
            self.pads = [2, 4, 8]
            self.head = nn.Linear(ch, 1)

        def forward(self, x):
            h = x.transpose(1, 2)
            for conv, pad in zip(self.convs, self.pads):
                h = torch.nn.functional.pad(h, (pad, 0))
                h = torch.relu(conv(h))
            return self.head(h[:, :, -1]).squeeze(-1)

    class Trf(nn.Module):
        def __init__(self):
            super().__init__()
            d = 32
            self.inp = nn.Linear(n_feat, d)
            self.pos = nn.Parameter(torch.zeros(1, SEQ_LEN, d))
            layer = nn.TransformerEncoderLayer(d_model=d, nhead=4, dim_feedforward=64,
                                               batch_first=True, dropout=0.1)
            self.enc = nn.TransformerEncoder(layer, num_layers=2)
            self.head = nn.Linear(d, 1)

        def forward(self, x):
            h = self.inp(x) + self.pos[:, :x.shape[1]]
            h = self.enc(h)
            return self.head(h.mean(dim=1)).squeeze(-1)

    class VolNet(nn.Module):
        def __init__(self):
            super().__init__()
            self.rnn = nn.LSTM(n_feat, 24, batch_first=True)
            self.head = nn.Linear(24, 1)

        def forward(self, x):
            out, _ = self.rnn(x)
            return self.head(out[:, -1]).squeeze(-1)

    if kind == "lstm":
        return Rnn(nn.LSTM)
    if kind == "gru":
        return Rnn(nn.GRU)
    if kind == "tcn":
        return Tcn()
    if kind == "transformer":
        return Trf()
    if kind == "lstm_vol":
        return VolNet()
    raise ValueError(kind)


def train_deep(kind: str, Xtr, ytr, Xte, seed: int, epochs: int, regression: bool, torch):
    torch.manual_seed(seed)
    np.random.seed(seed)
    net = build_net(kind, Xtr.shape[2], torch)
    opt = torch.optim.Adam(net.parameters(), lr=1e-3)

    xt = torch.tensor(Xtr, dtype=torch.float32)
    yt = torch.tensor(ytr, dtype=torch.float32)
    if regression:
        lossf = torch.nn.MSELoss()
    else:
        pos = float(ytr.sum())
        neg = float(len(ytr) - pos)
        w = torch.tensor(neg / max(pos, 1.0), dtype=torch.float32)
        lossf = torch.nn.BCEWithLogitsLoss(pos_weight=w)

    n = len(xt)
    batch = 128
    g = torch.Generator().manual_seed(seed)
    net.train()
    for _ in range(epochs):
        perm = torch.randperm(n, generator=g)
        for s in range(0, n, batch):
            b = perm[s:s + batch]
            opt.zero_grad()
            out = net(xt[b])
            loss = lossf(out, yt[b])
            loss.backward()
            torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0)
            opt.step()

    net.eval()
    with torch.no_grad():
        pred = net(torch.tensor(Xte, dtype=torch.float32)).numpy()
    return pred if regression else 1.0 / (1.0 + np.exp(-np.clip(pred, -35, 35)))


# ===========================================================================
#  2) EGARCH — numpy 만으로
#
#     log σ²ₜ = ω + β·log σ²ₜ₋₁ + α(|z| − √(2/π)) + γ·z      (z = e/σ, 어제 값)
#
#  GARCH와 달리 로그를 씌워 다루기 때문에 분산이 음수가 될 걱정이 없고,
#  γ 항이 "하락 충격이 더 세다"는 비대칭을 담습니다.
#  ω 는 장기 평균으로 묶고(ω = (1−β)·log 전체분산) α, γ, β 만 격자 탐색합니다.
# ===========================================================================
SQRT_2_PI = math.sqrt(2.0 / math.pi)


def _egarch_nll(e: np.ndarray, alpha: float, gamma: float, beta: float,
                log_uncond: float) -> float:
    omega = (1 - beta) * log_uncond
    lv = log_uncond
    total = 0.0
    prev_z = 0.0
    prev_abs = SQRT_2_PI
    for i in range(len(e)):
        if i > 0:
            lv = omega + beta * lv + alpha * (prev_abs - SQRT_2_PI) + gamma * prev_z
            if lv > 20 or lv < -50:
                return float("inf")
        v = math.exp(lv)
        total += lv + (e[i] * e[i]) / v
        sd = math.sqrt(v)
        prev_z = e[i] / sd
        prev_abs = abs(prev_z)
    return 0.5 * total


def fit_egarch(ret: np.ndarray) -> dict:
    mu = float(ret.mean())
    e = ret - mu
    uncond = float(e.var())
    log_uncond = math.log(max(uncond, 1e-12))

    best = None
    for alpha in np.arange(0.02, 0.301, 0.04):
        for gamma in np.arange(-0.30, 0.051, 0.07):
            for beta in np.arange(0.80, 0.991, 0.03):
                nll = _egarch_nll(e, alpha, gamma, beta, log_uncond)
                if best is None or nll < best[0]:
                    best = (nll, alpha, gamma, beta)
    _, a0, g0, b0 = best
    for alpha in np.arange(max(0.005, a0 - 0.04), a0 + 0.041, 0.01):
        for gamma in np.arange(g0 - 0.07, g0 + 0.071, 0.02):
            for beta in np.arange(max(0.6, b0 - 0.03), min(0.995, b0 + 0.031), 0.01):
                nll = _egarch_nll(e, alpha, gamma, beta, log_uncond)
                if nll < best[0]:
                    best = (nll, alpha, gamma, beta)

    nll, alpha, gamma, beta = best
    omega = (1 - beta) * log_uncond

    # 학습 구간 마지막 상태를 기억해 두었다가 시험 구간에서 이어 갑니다.
    lv = log_uncond
    prev_z, prev_abs = 0.0, SQRT_2_PI
    for i in range(len(e)):
        if i > 0:
            lv = omega + beta * lv + alpha * (prev_abs - SQRT_2_PI) + gamma * prev_z
        sd = math.sqrt(math.exp(lv))
        prev_z = e[i] / sd
        prev_abs = abs(prev_z)
    return {"mu": mu, "omega": omega, "alpha": alpha, "gamma": gamma, "beta": beta,
            "last_lv": lv, "last_z": prev_z, "last_abs": prev_abs, "nll": nll}


def egarch_forecast(par: dict, test_ret: np.ndarray) -> np.ndarray:
    lv = par["last_lv"]
    z, az = par["last_z"], par["last_abs"]
    out = np.empty(len(test_ret))
    for i, r in enumerate(test_ret):
        lv = par["omega"] + par["beta"] * lv + par["alpha"] * (az - SQRT_2_PI) + par["gamma"] * z
        lv = float(np.clip(lv, -50, 20))
        sd = math.sqrt(math.exp(lv))
        out[i] = sd
        e = r - par["mu"]
        z = e / sd
        az = abs(z)
    return out


# ===========================================================================
#  3) HMM (3상태 가우시안) — Baum-Welch 를 직접 구현
#
#  k-means 와 무엇이 다른가: k-means 는 날짜 순서를 전혀 모릅니다. HMM 은
#  "국면은 잘 바뀌지 않는다"는 성질을 전이확률로 함께 추정하기 때문에
#  라벨이 하루 단위로 튀지 않습니다.
#
#  시험 구간의 라벨은 **전방 필터링만** 씁니다. 앞뒤를 모두 보는 방식
#  (forward-backward)을 쓰면 그날의 라벨에 미래 정보가 섞이기 때문입니다.
# ===========================================================================
def _kmeans_init(Z: np.ndarray, k: int, seed: int, iters: int = 40):
    rng = np.random.default_rng(seed)
    C = [Z[rng.integers(len(Z))]]
    for _ in range(k - 1):
        d = np.min([((Z - c) ** 2).sum(axis=1) for c in C], axis=0)
        p = d / max(d.sum(), 1e-12)
        C.append(Z[rng.choice(len(Z), p=p)])
    C = np.array(C)
    for _ in range(iters):
        lab = np.argmin(((Z[:, None, :] - C[None, :, :]) ** 2).sum(axis=2), axis=1)
        for j in range(k):
            if (lab == j).any():
                C[j] = Z[lab == j].mean(axis=0)
    return C, lab


def _gauss_logpdf(Z: np.ndarray, mu: np.ndarray, var: np.ndarray) -> np.ndarray:
    """대각 공분산 가우시안의 로그 확률밀도. 결과 (T, K)."""
    d = Z.shape[1]
    out = np.empty((len(Z), len(mu)))
    for k in range(len(mu)):
        v = np.maximum(var[k], 1e-8)
        diff = Z - mu[k]
        out[:, k] = -0.5 * (np.log(2 * np.pi * v).sum() + ((diff ** 2) / v).sum(axis=1))
    return out


def fit_hmm(Z: np.ndarray, k: int = 3, seed: int = 42, iters: int = 60) -> dict:
    T = len(Z)
    C, lab = _kmeans_init(Z, k, seed)
    mu = C.copy()
    var = np.stack([Z[lab == j].var(axis=0) + 1e-6 if (lab == j).sum() > 1
                    else Z.var(axis=0) for j in range(k)])
    pi = np.full(k, 1.0 / k)
    A = np.full((k, k), 0.05 / (k - 1))
    np.fill_diagonal(A, 0.95)

    for _ in range(iters):
        logB = _gauss_logpdf(Z, mu, var)
        B = np.exp(logB - logB.max(axis=1, keepdims=True))

        alpha = np.zeros((T, k))
        scale = np.zeros(T)
        alpha[0] = pi * B[0]
        scale[0] = alpha[0].sum() + 1e-300
        alpha[0] /= scale[0]
        for t in range(1, T):
            alpha[t] = (alpha[t - 1] @ A) * B[t]
            scale[t] = alpha[t].sum() + 1e-300
            alpha[t] /= scale[t]

        beta = np.zeros((T, k))
        beta[-1] = 1.0
        for t in range(T - 2, -1, -1):
            beta[t] = (A @ (B[t + 1] * beta[t + 1])) / scale[t + 1]

        gamma = alpha * beta
        gamma /= gamma.sum(axis=1, keepdims=True) + 1e-300

        xi = np.zeros((k, k))
        for t in range(T - 1):
            m = (alpha[t][:, None] * A) * (B[t + 1] * beta[t + 1])[None, :]
            xi += m / (m.sum() + 1e-300)

        pi = gamma[0] / gamma[0].sum()
        A = xi / (xi.sum(axis=1, keepdims=True) + 1e-300)
        w = gamma.sum(axis=0) + 1e-300
        mu = (gamma.T @ Z) / w[:, None]
        for j in range(k):
            diff = Z - mu[j]
            var[j] = (gamma[:, j][:, None] * diff ** 2).sum(axis=0) / w[j] + 1e-8

    return {"pi": pi, "A": A, "mu": mu, "var": var}


def hmm_filter(par: dict, Z: np.ndarray) -> np.ndarray:
    """전방 필터링 — 그날까지의 정보만으로 가장 그럴듯한 상태."""
    logB = _gauss_logpdf(Z, par["mu"], par["var"])
    B = np.exp(logB - logB.max(axis=1, keepdims=True))
    k = len(par["pi"])
    a = par["pi"] * B[0]
    a /= a.sum() + 1e-300
    out = np.empty(len(Z), dtype=int)
    out[0] = int(np.argmax(a))
    for t in range(1, len(Z)):
        a = (a @ par["A"]) * B[t]
        a /= a.sum() + 1e-300
        out[t] = int(np.argmax(a))
    return out


def state_mapping(states: np.ndarray, ret21: np.ndarray, vol20: np.ndarray,
                  k: int = 3) -> dict:
    """상태 번호를 뜻이 있게 재배열 — docs/js/core/regime.js 와 같은 규칙.
       변동성이 가장 큰 무리 → 2번 · 나머지 중 수익률이 높은 쪽 → 0번 · 그 반대 → 1번
       (계산 순서로 붙은 번호는 아무 뜻이 없어서 그대로 두면 화면에서 해석할 수 없습니다)"""
    stat = []
    for j in range(k):
        m = states == j
        stat.append({"j": j, "n": int(m.sum()),
                     "ret": float(ret21[m].mean()) if m.any() else 0.0,
                     "vol": float(vol20[m].mean()) if m.any() else 0.0})
    order = sorted(stat, key=lambda s: -s["vol"])
    mapping = {order[0]["j"]: 2}
    rest = sorted(order[1:], key=lambda s: -s["ret"])
    mapping[rest[0]["j"]] = 0
    if len(rest) > 1:
        mapping[rest[1]["j"]] = 1
    return mapping


# ===========================================================================
#  4) 본체
# ===========================================================================
def dense_series(all_dates: List[str], pred_dates: List[str], values) -> dict:
    """공용 날짜 축 위의 [i0, i0+len) 구간 배열로 만듭니다(없는 날은 null)."""
    pos = {d: i for i, d in enumerate(all_dates)}
    idx = [pos[d] for d in pred_dates if d in pos]
    if not idx:
        return None
    i0, i1 = min(idx), max(idx)
    v: List[Optional[float]] = [None] * (i1 - i0 + 1)
    for d, val in zip(pred_dates, values):
        j = pos.get(d)
        if j is None or not np.isfinite(val):
            continue
        v[j - i0] = round(float(val), 5)
    return {"i0": i0, "v": v}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="무거운 모델 사전 학습 → predictions.json")
    ap.add_argument("--tickers", nargs="*", default=DEFAULT_TICKERS)
    ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--embargo", type=int, default=5)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--epochs", type=int, default=20)
    ap.add_argument("--skip-deep", action="store_true", help="torch 없이 EGARCH·HMM만")
    ap.add_argument("--out", default=OUT_PATH)
    args = ap.parse_args(argv)

    t0 = time.time()
    torch = None if args.skip_deep else _torch()
    if torch is None and not args.skip_deep:
        log("※ torch 가 없어 딥러닝 모델을 건너뜁니다. (pip install torch)")

    market = F.load_market()
    all_dates = market["daily"]["dates"]
    log(f"데이터 {len(all_dates)}일 · 종목 {len(market['daily']['tickers'])}개")

    deep_dir = ["lstm", "gru", "tcn", "transformer"] if torch else []
    models: Dict[str, dict] = {}

    def slot(mid: str, task: str) -> dict:
        if mid not in models:
            models[mid] = {"task": task, "trained_until": all_dates[-1], "pred": {}}
        return models[mid]

    for ticker in args.tickers:
        if ticker not in market["daily"]["close"]:
            log(f"건너뜀: {ticker} (데이터 없음)")
            continue
        log(f"─── {ticker} ───")
        ds = F.build(ticker, market)
        n = len(ds["X"])
        splits = F.walk_forward(n, folds=args.folds, embargo=args.embargo)
        if not splits:
            log(f"  표본 부족 ({n}행) — 건너뜁니다")
            continue
        log(f"  {n}행 × {len(ds['cols'])}피처 · {len(splits)}겹")

        # --- 방향 예측 (딥러닝) ------------------------------------------
        for kind in deep_dir:
            dates_out, vals_out = [], []
            ts = time.time()
            for sp in splits:
                mu = ds["X"][sp["train_lo"]:sp["train_hi"]].mean(axis=0)
                sd = ds["X"][sp["train_lo"]:sp["train_hi"]].std(axis=0)
                sd[sd == 0] = 1e-9
                Z = (ds["X"] - mu) / sd

                Xtr, itr = make_windows(Z, sp["train_lo"] + SEQ_LEN - 1, sp["train_hi"], SEQ_LEN)
                Xte, ite = make_windows(Z, sp["test_lo"], sp["test_hi"], SEQ_LEN)
                if len(Xtr) < 100 or not len(Xte):
                    continue
                ytr = ds["y"][itr].astype(float)
                proba = train_deep(kind, Xtr, ytr, Xte, args.seed + sp["fold"],
                                   args.epochs, False, torch)
                dates_out += [ds["dates"][i] for i in ite]
                vals_out += list(proba)
            rec = dense_series(all_dates, dates_out, vals_out)
            if rec:
                slot(kind, "direction")["pred"][ticker] = rec
            log(f"  {kind:<12} {len(vals_out):>5}일 예측 · {time.time() - ts:.1f}초")

        # --- 변동성 -------------------------------------------------------
        rs = F.return_series(ticker, market)
        rdates = rs["dates"]
        rpos = {d: i for i, d in enumerate(rdates)}

        eg_dates, eg_vals = [], []
        lv_dates, lv_vals = [], []
        ts = time.time()
        for sp in splits:
            train_end = ds["dates"][sp["train_hi"] - 1]
            test_from = ds["dates"][sp["test_lo"]]
            test_to = ds["dates"][sp["test_hi"] - 1]
            tr_i = [i for i, d in enumerate(rdates) if d <= train_end]
            te_i = [i for i, d in enumerate(rdates) if test_from <= d <= test_to]
            if len(tr_i) < 200 or not te_i:
                continue
            tr = rs["ret"][tr_i]
            te = rs["ret"][te_i]

            par = fit_egarch(tr)
            sig = egarch_forecast(par, te)
            eg_dates += [rdates[i] for i in te_i]
            eg_vals += list(sig)

            if torch:
                # LSTM-Vol — 어제까지의 로그 실현변동성 창으로 내일의 log RV 를 예측
                def rv_feats(series: np.ndarray) -> np.ndarray:
                    sq = series ** 2
                    d = np.log(sq + EPS)
                    w = np.log(np.convolve(sq, np.ones(5) / 5, mode="full")[:len(sq)] + EPS)
                    m = np.log(np.convolve(sq, np.ones(22) / 22, mode="full")[:len(sq)] + EPS)
                    return np.stack([d, w, m, np.abs(series)], axis=1)

                full = np.concatenate([tr, te])
                feats = rv_feats(full)
                fm, fs = feats[:len(tr)].mean(axis=0), feats[:len(tr)].std(axis=0)
                fs[fs == 0] = 1e-9
                Zf = (feats - fm) / fs
                target = np.log(full ** 2 + EPS)

                # 창이 i일에서 끝나면 목표는 i+1일입니다. 그래서 시험 구간 첫날을
                # 맞히려면 창이 학습 구간 마지막 날에서 끝나야 합니다.
                Xtr, itr = make_windows(Zf, VOL_SEQ, len(tr) - 1, VOL_SEQ)
                Xte, ite = make_windows(Zf, len(tr) - 1, len(full) - 1, VOL_SEQ)
                if len(Xtr) > 100 and len(Xte):
                    ytr = np.array([target[i + 1] for i in itr])
                    pred = train_deep("lstm_vol", Xtr, ytr, Xte, args.seed + sp["fold"],
                                      args.epochs, True, torch)
                    sigma = np.sqrt(np.maximum(np.exp(pred + LOG_CHI2), EPS))
                    for i, sg in zip(ite, sigma):
                        j = i + 1 - len(tr)          # 시험 구간에서의 위치
                        if 0 <= j < len(te_i):
                            lv_dates.append(rdates[te_i[j]])
                            lv_vals.append(float(sg))

        rec = dense_series(all_dates, eg_dates, eg_vals)
        if rec:
            slot("egarch", "volatility")["pred"][ticker] = rec
        log(f"  {'egarch':<12} {len(eg_vals):>5}일 예측 · {time.time() - ts:.1f}초")
        if lv_vals:
            rec = dense_series(all_dates, lv_dates, lv_vals)
            if rec:
                slot("lstm_vol", "volatility")["pred"][ticker] = rec
            log(f"  {'lstm_vol':<12} {len(lv_vals):>5}일 예측")

        # --- 국면 (HMM) ----------------------------------------------------
        ts = time.time()
        jr = ds["cols"].index("ret21")
        jv = ds["cols"].index("vol20")
        hm_dates, hm_vals = [], []
        for sp in splits:
            raw = ds["X"][:, [jr, jv]].copy()
            raw[:, 1] = np.log(np.maximum(raw[:, 1], 1e-6))     # 변동성은 로그 축으로
            tr = raw[sp["train_lo"]:sp["train_hi"]]
            mu, sd = tr.mean(axis=0), tr.std(axis=0)
            sd[sd == 0] = 1e-9
            Ztr = (tr - mu) / sd
            Zte = (raw[sp["test_lo"]:sp["test_hi"]] - mu) / sd

            par = fit_hmm(Ztr, 3, args.seed + sp["fold"])
            tr_states = hmm_filter(par, Ztr)
            mapping = state_mapping(tr_states,
                                    ds["X"][sp["train_lo"]:sp["train_hi"], jr],
                                    ds["X"][sp["train_lo"]:sp["train_hi"], jv])
            te_states = hmm_filter(par, Zte)
            hm_dates += ds["dates"][sp["test_lo"]:sp["test_hi"]]
            hm_vals += [mapping.get(int(s), 1) for s in te_states]
        rec = dense_series(all_dates, hm_dates, hm_vals)
        if rec:
            slot("hmm3", "regime")["pred"][ticker] = rec
        log(f"  {'hmm3':<12} {len(hm_vals):>5}일 라벨 · {time.time() - ts:.1f}초")

    if not models:
        log("만들어진 예측이 없습니다. 중단합니다.")
        return 1

    payload = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "seed": args.seed,
        "featVer": F.feature_version(market["macro"]),
        "config": {
            "folds": args.folds,
            "embargo": args.embargo,
            "seq_len": SEQ_LEN,
            "epochs": args.epochs,
            "tickers": args.tickers,
            # 설정을 바꿔 가며 고르지 않았습니다. 그래서 전부 1입니다.
            # (여러 번 시도해 좋은 것만 남기면 우연히 좋은 결과를 고를 확률이 올라갑니다)
            "hparams_tried": {m: 1 for m in models},
        },
        "dates": all_dates,
        "models": models,
    }

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    size = os.path.getsize(args.out) / 1024
    log(f"저장: {os.path.relpath(args.out, ROOT)} ({size:,.0f} KB) · "
        f"모델 {len(models)}개 · {time.time() - t0:.0f}초")
    for mid, m in models.items():
        log(f"   {mid:<12} {m['task']:<11} 종목 {len(m['pred'])}개")
    return 0


if __name__ == "__main__":
    sys.exit(main())
