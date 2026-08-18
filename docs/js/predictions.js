/* ============================================================================
 *  predictions.js — 파이썬에서 미리 학습한 모델의 '어댑터'
 *
 *  LSTM·GRU·Transformer·TCN·HMM 같은 무거운 모델은 브라우저에서 학습할 수 없습니다.
 *  그래서 pipeline/train_models.py 가 미리 학습해 예측값만 파일로 내려 두고,
 *  이 파일이 그 값을 읽어 **다른 모델과 똑같은 얼굴**로 화면에 넘깁니다.
 *
 *      fit()     → 실제로 학습하지 않고, 필요한 구간의 예측값이 있는지 확인만 합니다
 *      predict() → 날짜를 맞춰 저장된 값을 꺼내 줍니다
 *
 *  이렇게 해 두면 화면과 점수 계산 코드는 "이 모델이 지금 학습한 것인지 미리
 *  학습한 것인지" 전혀 신경 쓸 필요가 없습니다. 배지만 다르게 붙습니다.
 *
 *  ─ data/predictions.json 의 모양 ───────────────────────────────────────────
 *  {
 *    "generated": "2026-08-18 04:10 UTC",
 *    "seed": 42,
 *    "featVer": "f1",
 *    "config": { "folds": 5, "embargo": 5, "cost_bps": 10,
 *                "hparams_tried": { "lstm": 24, "gru": 18 } },
 *    "dates": ["2014-08-11", ...],          ← 모든 모델이 공유하는 날짜 축
 *    "models": {
 *      "lstm": {
 *        "task": "direction",
 *        "trained_until": "2026-08-11",
 *        "pred": { "AAPL": { "i0": 1200, "v": [0.51, 0.48, ...] } }
 *                                            ↑ dates[i0] 부터 v 가 하루씩 이어집니다
 *      }
 *    }
 *  }
 *  날짜를 종목마다 반복 저장하지 않으려고 시작 위치(i0)만 적습니다.
 * ==========================================================================*/
(function (root) {
  'use strict';
  const P = {};

  P.state = {
    loaded: false,      // 시도가 끝났는가
    ok: false,          // 쓸 수 있는 파일이 있는가
    data: null,
    error: null
  };

  const DIR = /[?&]dev=1/.test(location.search) ? 'data-dev/' : 'data/';

  /* ------------------------------------------------------------------------
   *  파일 읽기 — 없어도 사이트는 그대로 돌아갑니다(사전 학습 모델만 잠깁니다).
   * ----------------------------------------------------------------------*/
  P.load = function () {
    return fetch(DIR + 'predictions.json', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (j) {
        P.state.data = j;
        P.state.ok = true;
        P.state.loaded = true;
        P.wire();
        return j;
      })
      .catch(function (e) {
        P.state.error = e.message;
        P.state.loaded = true;
        P.state.ok = false;
        return null;
      });
  };

  P.entry = function (modelId) {
    const d = P.state.data;
    return (d && d.models && d.models[modelId]) || null;
  };

  P.info = function () {
    const d = P.state.data;
    if (!d) return null;
    return {
      generated: d.generated, seed: d.seed, featVer: d.featVer,
      config: d.config || {},
      models: Object.keys(d.models || {}),
      nDates: (d.dates || []).length
    };
  };

  // 이 모델이 이 종목의 예측값을 갖고 있는가
  P.has = function (modelId, ticker) {
    const e = P.entry(modelId);
    return !!(e && e.pred && e.pred[ticker]);
  };

  // 시도한 하이퍼파라미터 조합 수 (다중검정 자백용 — 점수표에 그대로 표시합니다)
  P.hparamsTried = function (modelId) {
    const d = P.state.data;
    const h = d && d.config && d.config.hparams_tried;
    return (h && h[modelId] !== undefined) ? h[modelId] : null;
  };

  /* ------------------------------------------------------------------------
   *  어댑터 본체 — 다른 모델과 똑같은 fit / predict 를 가집니다.
   * ----------------------------------------------------------------------*/
  P.model = function (modelId) {
    return function () {
      let lookup = null, ticker = null;

      // 날짜 → 값 사전을 만들어 둡니다(예측할 때마다 찾기 쉽게).
      function buildLookup(t) {
        const d = P.state.data;
        if (!d) throw new Error('사전 학습 결과 파일(predictions.json)이 없습니다. ' +
          'pipeline/train_models.py 를 한 번 돌리거나 GitHub Actions의 "모델 사전 학습" 워크플로를 실행하세요.');
        const e = P.entry(modelId);
        if (!e) throw new Error(modelId + ' 의 예측값이 파일에 없습니다.');
        const rec = e.pred && e.pred[t];
        if (!rec) throw new Error(modelId + ' 에 ' + t + ' 종목의 예측값이 없습니다. ' +
          '사전 학습 대상 종목은 파이프라인에서 정합니다.');
        const map = {};
        for (let k = 0; k < rec.v.length; k++) {
          const ds = d.dates[rec.i0 + k];
          if (ds !== undefined) map[ds] = rec.v[k];
        }
        return map;
      }

      return {
        // 학습하지 않습니다. 대신 "이 구간을 덮고 있는가"를 검사합니다.
        fit: function (train, ctx) {
          ticker = ctx.ticker;
          lookup = buildLookup(ticker);
          return this;
        },
        predict: function (test) {
          const n = test.dates.length, out = new Float64Array(n);
          let miss = 0;
          for (let i = 0; i < n; i++) {
            const v = lookup[test.dates[i]];
            if (v === undefined || v === null || !isFinite(v)) { out[i] = NaN; miss++; }
            else out[i] = v;
          }
          if (miss > n * 0.1) {
            throw new Error(modelId + ' 의 예측값이 이 구간의 ' +
              Math.round(miss / n * 100) + '% 비어 있습니다. 사전 학습을 다시 돌려야 합니다.');
          }
          // 드문드문 빈 값은 바로 앞 값으로 메웁니다.
          let last = NaN;
          for (let i = 0; i < n; i++) {
            if (isFinite(out[i])) last = out[i];
            else out[i] = isFinite(last) ? last : 0.5;
          }
          return out;
        },
        importance: function () { return null; },
        pretrained: true
      };
    };
  };

  /* ------------------------------------------------------------------------
   *  파일이 도착하면, 그 안에 든 모델들의 구현을 등록부에 끼워 넣습니다.
   *  (파일이 없으면 사전 학습 모델은 '아직 준비 안 됨' 상태로 남습니다)
   * ----------------------------------------------------------------------*/
  P.wire = function () {
    const REG = root.REG, d = P.state.data;
    if (!REG || !d || !d.models) return;
    Object.keys(d.models).forEach(function (id) {
      if (REG.has(id) && !REG.get(id).make) REG.impl(id, P.model(id));
    });
  };

  root.PRED = P;
})(window.QL = window.QL || {});
