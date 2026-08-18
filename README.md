# AI MODEL LAB — 나스닥 AI 모델 비교 실험실

여러 AI 모델로 나스닥 주가를 예측·모의투자해 보고, **어떤 모델이 어떤 상황에 적합한지
점수로 비교**하는 교육용 사이트입니다. 대상은 통계·머신러닝을 배운 적 없는 고등학교 3학년.

빌드 도구가 없습니다. `docs/` 를 GitHub Pages로 그대로 띄우면 끝입니다.
순수 자바스크립트(IIFE + `window.QL` 네임스페이스)와 `<script>` 나열로만 되어 있습니다.

> 이 저장소는 `fed-rate-stock-prediction`(퀀트 교육 사이트)의 코드를 재활용했습니다.
> 팩터·알파 수식 기능은 전부 걷어내고, **AI 모델 자체의 비교**로 목적을 바꿨습니다.

---

## 무엇이 다른가

이 사이트는 "가장 좋은 모델" 하나를 뽑지 않습니다. 대신 **축별 승자**를 냅니다.

- 방향 예측(내일 오를까?) — 이진 분류
- 변동성 예측(내일 얼마나 출렁일까?)
- 국면·이상 탐지(지금은 어떤 장세인가?)

그리고 축마다 **기준선(baseline)** 을 반드시 둡니다. 점수는 절대값이 아니라
**기준선 대비**로 매깁니다. 0점 = 기준선과 같음, 음수 = 기준선보다 못함.

---

## 폴더 구조

```
docs/                     ← GitHub Pages 로 배포되는 사이트 전체
  index.html              화면 뼈대와 스크립트 나열
  css/terminal.css        다크 터미널 테마
  data/*.json             나스닥100 일봉·매크로·섹터 (자동 갱신)
  js/core/util.js         시드 고정 난수, 숫자 서식, 통계, DOM 도우미
  js/core/metrics.js      AUC·ROC·혼동행렬, CAGR·샤프·최대낙폭, EWMA·GARCH
  js/core/charts.js       캔버스 차트 (line/bars/roc/hist/scatter)
  js/core/ml.js           브라우저에서 도는 머신러닝 (로지스틱·랜덤포레스트·부스팅·MLP)
  js/features.js          ★ 피처를 만드는 단 하나의 장소
  js/splits.js            ★ 시간순 워크포워드 분할 + 학습구간 기준 표준화
  js/registry.js          ★ 모델 등록부이자 공통 인터페이스
  js/predictions.js       파이썬 사전 학습 결과 어댑터
  js/data.js              데이터 로딩 (최근 2년 먼저 → 전체 기간 교체)
  js/app.js               라우터와 공통 UI 부품
  js/screens/*.js         화면 8개
pipeline/                 파이썬 데이터 수집·학습
  fetch_market.py         yfinance + FRED → docs/data/*.json
  universe.py             나스닥100 목록·섹터·FOMC 날짜
.github/workflows/
  update-market-data.yml  평일 매일 자동 데이터 갱신
```

---

## 설계에서 양보하지 않는 것

1. **모든 모델은 같은 인터페이스** — `fit(train, ctx)` / `predict(test, ctx)` 두 개뿐입니다.
   브라우저에서 지금 학습하는 모델도, 파이썬에서 미리 학습해 결과만 내려받는 모델도,
   "무조건 오른다"고 찍는 기준선도 전부 같은 얼굴입니다. (`js/registry.js`)
2. **피처는 모델 바깥 한 곳에서** — 모든 모델이 똑같은 문제지를 받아야 비교가 성립합니다.
   (`js/features.js`)
3. **시간순 워크포워드 분할만** — 무작위 셔플은 아예 제공하지 않습니다. 학습과 시험 사이에
   `purge 1일 + embargo 5일`을 비웁니다. (`js/splits.js`)
4. **표준화 통계는 학습 구간에서만** 계산해 시험 구간에 적용합니다. 이 일을 모델이 아니라
   바깥에서 해야 모든 모델의 조건이 같아집니다.
5. **시드 고정 + 다중 시드 반복** — 단일 실행 숫자는 신뢰하지 않습니다.

---

## 점수 기준

| 축 | 비중(기본값) | 기준선 |
|---|---|---|
| 예측력 | 30% | 동전 던지기 (AUC 0.5) |
| 투자 성과 | 30% | 바이앤홀드 |
| 안정성 | 25% | 폴드별 승률·연도별 성적 표준편차 |
| 실용성 | 15% | 학습 시간(로그) · 해석 가능성 |

비중은 화면의 슬라이더로 바꿀 수 있습니다. min-max 정규화는 쓰지 않습니다
(모델 하나만 추가돼도 전체 점수가 흔들려 "짜맞췄다"는 인상을 주기 때문).

---

## 로컬에서 보기

```bash
python3 -m http.server 8000 --directory docs
# → http://localhost:8000
```

데이터를 직접 받으려면:

```bash
pip install -r requirements.txt
python -m pipeline.fetch_market          # docs/data/*.json 생성
python -m pipeline.fetch_market --synthetic   # 인터넷 없이 형식만 같은 가짜 데이터
```

---

## 진행 상황

- [x] **1단계 골격** — 재활용 파일 정리, 라우터·화면 8개 뼈대, 공통 UI 부품
- [x] **2단계-A 공통 인터페이스** — `registry.js` / `features.js` / `splits.js` / `predictions.js`
- [ ] **2단계-B 모델 레이어** — 신규 경량 모델(k-NN·나이브베이즈·SVM·Ridge·앙상블·GJR·HAR·k-means·IsolationForest),
      `pipeline/train_models.py` 와 `docs/data/predictions.json`
- [ ] **3단계 평가 레이어** — `score.js` (기준선 대비 점수, 4축 가중합, 부트스트랩, DM 검정)
- [ ] **4단계 화면** — 종목 선정 → 학습 실험실 → 모의투자 → 국면 분석 → 종합 점수표 → 배우기
- [ ] **5단계 눈높이 다듬기** — 용어 툴팁, 비유, 수식 접기, 방향 표시 전면 적용

---

## 주의

- 데이터에 **생존 편향**이 있습니다. 지금 나스닥100에 남아 있는 종목만 들어 있어서,
  중간에 지수에서 빠진 회사가 없습니다. 과거 성적이 실제보다 좋아 보입니다.
- 수정주가(배당·분할 반영) 종가 기준이라 실제 체결가와 다릅니다.
- **교육·연구용입니다. 실제 투자 판단에 사용하지 마십시오.**
