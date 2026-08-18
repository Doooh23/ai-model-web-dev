# -*- coding: utf-8 -*-
"""
check_parity.py — 파이썬과 자바스크립트의 피처가 같은지 확인하는 도구

pipeline/features.py 와 docs/js/features.js 는 **같은 값**을 만들어야 합니다.
한쪽만 고치면 브라우저 모델과 사전 학습 모델의 비교가 조용히 무너집니다.
그래서 한쪽을 고칠 때마다 이 검사를 돌려 주세요.

사용법
    python -m pipeline.check_parity                 # docs/data/parity_check.json 생성
    python3 -m http.server 8000 --directory docs    # 그리고 사이트를 띄운 뒤
    # 브라우저 콘솔에서:  await QL.FEAT.checkParity()
    #   → { ok: true, nDiff: 0, ... } 이면 통과
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pipeline import features as F  # noqa: E402

OUT = os.path.join(F.ROOT, "docs", "data", "parity_check.json")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="피처 일치 검사용 표본 생성")
    ap.add_argument("--ticker", default="AAPL")
    ap.add_argument("--out", default=OUT)
    args = ap.parse_args(argv)

    market = F.load_market()
    ds = F.build(args.ticker, market)
    n = len(ds["X"])
    # 앞·중간·뒤에서 골고루 뽑습니다(한 군데만 맞아도 통과하면 안 되니까).
    idx = sorted({0, 1, n // 4, n // 2, (3 * n) // 4, n - 2, n - 1})

    payload = {
        "ticker": args.ticker,
        "cols": ds["cols"],
        "featVer": ds["featVer"],
        "n": n,
        "dropped": ds["dropped"],
        "splits": F.walk_forward(n),
        "rows": [{
            "date": ds["dates"][i],
            "y": int(ds["y"][i]),
            "ret": float(ds["ret"][i]),
            "x": [float(v) for v in ds["X"][i]],
        } for i in idx],
    }
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    print(f"저장: {os.path.relpath(args.out, F.ROOT)} "
          f"({n}행 × {len(ds['cols'])}피처, 표본 {len(idx)}행)")
    print("브라우저 콘솔에서 확인:  await QL.FEAT.checkParity()")
    return 0


if __name__ == "__main__":
    sys.exit(main())
