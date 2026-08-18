/* ============================================================================
 *  registry.js — 모델 등록부이자 '공통 인터페이스'
 *
 *  ★ 이 파일 하나가 이 사이트의 설계 핵심입니다.
 *    비교할 모델이 20개가 넘습니다. 화면이 모델마다 다른 방식으로 말을 걸어야
 *    한다면, 모델을 하나 추가할 때마다 모든 화면을 고쳐야 합니다.
 *    그래서 모든 모델에게 똑같은 두 개의 약속만 시킵니다.
 *
 *        model.fit(train, ctx)      과거 자료로 배운다
 *        model.predict(test, ctx)   그 다음 구간을 예측한다
 *
 *    브라우저에서 지금 학습하는 모델도, 파이썬에서 미리 학습해 결과만
 *    내려받는 모델(LSTM 등)도, 심지어 "무조건 오른다"고 찍는 기준선도
 *    전부 이 약속을 지킵니다. 화면은 셋을 구분하지 않고 똑같이 다룹니다.
 *
 *  ★ 주고받는 값의 모양
 *      train / test = {
 *        X      표준화된 피처 행렬 (평균 0, 표준편차 1 — splits.js가 학습구간 기준으로 계산)
 *        raw    표준화 전 원본 피처 행렬 (규칙 기반 기준선이 부호를 봐야 해서 필요)
 *        y      정답 (다음 날 올랐으면 1)
 *        ret    다음 날 실제 수익률 (모의투자용)
 *        dates  기준 날짜, idx 원본 위치
 *      }
 *      ctx = { cols: 피처 이름들, featVer, seed, ticker, task }
 *
 *      predict 의 반환값은 과제마다 다릅니다.
 *        direction  → 상승 확률 (0~1)
 *        volatility → 다음 날 변동성 예측치 σ (양수)
 *        regime     → 국면 번호 (0,1,2…)
 * ==========================================================================*/
(function (root) {
  'use strict';
  const U = root.U, M = root.M, ML = root.ML;
  const REG = {};

  /* ------------------------------------------------------------------------
   *  과제 세 갈래
   * ----------------------------------------------------------------------*/
  REG.TASKS = {
    direction: {
      id: 'direction', name: '방향 예측', short: '내일 오를까?',
      output: '상승 확률 0~1',
      metric: 'AUC · 정확도',
      baseline: 'coin',           // 예측력 점수의 기준선
      about: '내일 주가가 오를지 내릴지를 맞히는 문제입니다. 정답이 둘 중 하나라 ' +
        '아무렇게나 찍어도 50%는 맞습니다. 그래서 "50%보다 얼마나 나은가"로 봅니다.'
    },
    volatility: {
      id: 'volatility', name: '변동성 예측', short: '내일 얼마나 출렁일까?',
      output: '내일의 변동성 σ',
      metric: 'MSE · QLIKE',
      baseline: 'ewma',           // 업계 표준 기준선
      about: '오를지 내릴지가 아니라 "얼마나 크게 움직일지"를 맞히는 문제입니다. ' +
        '방향은 못 맞혀도 출렁임은 꽤 맞힐 수 있습니다. 변동성은 뭉쳐서 오기 때문입니다.'
    },
    regime: {
      id: 'regime', name: '국면·이상 탐지', short: '지금은 어떤 장세인가?',
      output: '국면 번호',
      metric: '국면별 성적 비교',
      baseline: null,
      about: '시장을 상승장·하락장·고변동 구간으로 나눕니다. 정답이 없는 문제라 ' +
        '맞고 틀리고를 따지지 않고, 다른 모델들의 성적을 나눠 보는 자로 씁니다.'
    }
  };

  /* ------------------------------------------------------------------------
   *  등록부
   * ----------------------------------------------------------------------*/
  const byId = {};
  const order = [];

  REG.add = function (def) {
    if (byId[def.id]) throw new Error('모델 id가 중복됩니다: ' + def.id);
    const d = Object.assign({
      task: 'direction',
      exec: 'live',            // live = 브라우저 실시간 학습 · pre = 파이썬 사전 학습
      baseline: false,         // 기준선인가 (점수의 0점 기준이 되는 쪽)
      family: '기타',
      cost: 2,                 // 연산량 1(가벼움)~5(무거움)
      interpret: '중',         // 해석 가능성 상/중/하
      analogy: '',             // 고3 눈높이 비유 — 모델 도감에 그대로 나갑니다
      pros: [], cons: [],
      params: {},              // 기본 하이퍼파라미터
      make: null               // null 이면 아직 구현 전 (도감에는 나오되 실행 목록에서는 빠짐)
    }, def);
    byId[d.id] = d;
    order.push(d.id);
    return d;
  };

  // 구현을 나중에 끼워 넣습니다 (파일 순서에 얽매이지 않게).
  REG.impl = function (id, make) {
    if (!byId[id]) throw new Error('등록되지 않은 모델: ' + id);
    byId[id].make = make;
  };

  REG.get = function (id) { return byId[id] || null; };
  REG.name = function (id) { return byId[id] ? byId[id].name : id; };
  REG.has = function (id) { return !!byId[id]; };

  // 목록 조회 — REG.list({ task:'direction', exec:'live', ready:true })
  REG.list = function (f) {
    f = f || {};
    return order.map(function (id) { return byId[id]; }).filter(function (d) {
      if (f.task && d.task !== f.task) return false;
      if (f.exec && d.exec !== f.exec) return false;
      if (f.ready && !d.make) return false;
      if (f.baseline !== undefined && !!d.baseline !== f.baseline) return false;
      return true;
    });
  };

  // 실제로 모델 객체를 만듭니다.
  REG.create = function (id, params) {
    const d = byId[id];
    if (!d) throw new Error('알 수 없는 모델: ' + id);
    if (!d.make) throw new Error(d.name + ' 은(는) 아직 구현되지 않았습니다.');
    return d.make(Object.assign({}, d.params, params || {}));
  };

  // 배지 문구 — 화면 여러 곳에서 같은 표현을 쓰기 위해 여기 둡니다.
  REG.badge = function (d) {
    if (d.exec === 'pre') return { text: '사전 학습', cls: 'badge-pre' };
    return { text: '실시간 학습', cls: 'badge-live' };
  };

  /* ========================================================================
   *  어댑터 — 기존 ml.js 모델을 공통 인터페이스로 감쌉니다
   *
   *  주의: 표준화는 splits.js가 이미 끝냈습니다(train.X). ml.js 안에도 자체
   *  표준화가 남아 있지만, 이미 평균0·표준편차1인 값을 한 번 더 표준화하는
   *  것이라 결과가 바뀌지 않습니다. 2단계에서 ml.js 쪽 중복을 걷어냅니다.
   * ======================================================================*/
  function liveClassifier(mlId) {
    return function (params) {
      let m = null;
      return {
        fit: function (train, ctx) {
          m = ML.create(mlId, Object.assign({ seed: ctx.seed, featureCols: ctx.cols }, params));
          m.fit(train.X, train.y);
          return this;
        },
        predict: function (test) { return m.predictProba(test.X); },
        importance: function () { return (m && m.importance) ? m.importance() : null; }
      };
    };
  }

  // 규칙 기반 기준선 — 학습하지 않고, 원본 피처(raw)의 부호만 봅니다.
  function ruleModel(fn) {
    return function (params) {
      const p = params || {};
      let col = -1, rnd = null;
      return {
        fit: function (train, ctx) {
          col = p.col ? ctx.cols.indexOf(p.col) : -1;
          rnd = U.rng(ctx.seed || 42);
          return this;
        },
        predict: function (test) {
          const n = test.raw.length, out = new Float64Array(n);
          for (let i = 0; i < n; i++) out[i] = fn(test.raw[i], col, rnd);
          return out;
        },
        importance: function () { return null; }
      };
    };
  }

  /* ========================================================================
   *  A. 방향 예측
   * ======================================================================*/
  REG.add({
    id: 'logistic', name: '로지스틱 회귀', task: 'direction', family: '선형',
    cost: 1, interpret: '상',
    analogy: '피처마다 점수 가중치를 하나씩 매겨 더한 뒤, 합이 크면 "오른다"고 답합니다. ' +
      '내신 반영비율 계산과 같은 구조라 왜 그렇게 답했는지 그대로 읽을 수 있습니다.',
    pros: ['빠르고 결과가 흔들리지 않음', '어느 피처가 얼마나 기여했는지 바로 보임'],
    cons: ['직선으로만 자를 수 있어 복잡한 패턴은 놓침'],
    make: liveClassifier('logistic')
  });

  REG.add({
    id: 'knn', name: 'k-최근접 이웃', task: 'direction', family: '거리 기반',
    cost: 3, interpret: '상',
    analogy: '오늘과 가장 비슷했던 과거 25일을 찾아, 그날들 중 오른 날이 몇 %였는지를 그대로 답합니다. ' +
      '"작년 이맘때랑 비슷한데?"라는 감각을 그대로 계산으로 옮긴 것입니다.',
    pros: ['원리가 가장 직관적', '학습이랄 게 거의 없음'],
    cons: ['피처가 많아지면 "비슷하다"는 말이 흐려짐', '예측할 때마다 과거 전체를 뒤져 느림']
  });

  REG.add({
    id: 'gnb', name: '나이브베이즈', task: 'direction', family: '확률',
    cost: 1, interpret: '상',
    analogy: '오른 날들과 내린 날들의 피처 분포를 따로 그려 두고, 오늘 값이 어느 쪽 분포에 ' +
      '더 잘 어울리는지 확률로 비교합니다.',
    pros: ['아주 빠름', '표본이 적어도 잘 버팀'],
    cons: ['피처끼리 서로 무관하다고 가정하는데, 주가 피처는 실제로 얽혀 있음']
  });

  REG.add({
    id: 'ridge', name: 'Ridge 회귀', task: 'direction', family: '선형',
    cost: 1, interpret: '상',
    analogy: '오를지 내릴지가 아니라 "몇 % 오를지"를 먼저 예측하고, 그 값이 양수면 상승으로 봅니다. ' +
      '가중치가 한쪽으로 쏠리지 않게 벌점을 줍니다.',
    pros: ['과적합에 강함', '피처가 서로 비슷해도 안정적'],
    cons: ['쓸모없는 피처를 0으로 만들지는 못함']
  });

  REG.add({
    id: 'elastic', name: 'ElasticNet', task: 'direction', family: '선형',
    cost: 1, interpret: '상',
    analogy: 'Ridge에 "필요 없는 피처는 아예 0으로 꺼라"는 규칙(Lasso)을 섞은 것입니다.',
    pros: ['쓸모없는 피처를 스스로 끔', '어떤 피처가 살아남았는지가 곧 설명'],
    cons: ['벌점 세기를 잘못 잡으면 다 꺼 버림']
  });

  REG.add({
    id: 'svm', name: 'SVM (RBF 커널)', task: 'direction', family: '커널',
    cost: 4, interpret: '하',
    analogy: '두 무리를 가르는 선을 긋되, 경계에 가장 가까운 점들과의 간격이 최대가 되게 긋습니다. ' +
      'RBF 커널은 그 선을 자유롭게 휘게 해 줍니다.',
    pros: ['경계가 복잡해도 잘 나눔', '마진을 최대로 잡아 과적합에 비교적 강함'],
    cons: ['브라우저에서는 커널을 무작위 특징 128개로 근사합니다(정통 방식은 너무 느림)',
      '왜 그렇게 답했는지 설명이 어려움']
  });

  REG.add({
    id: 'forest', name: '랜덤포레스트', task: 'direction', family: '트리 앙상블',
    cost: 3, interpret: '중',
    analogy: '조금씩 다른 자료만 본 결정나무 60그루를 만들고 다수결을 시킵니다. ' +
      '한 명이 헛다리를 짚어도 나머지가 눌러 줍니다.',
    pros: ['과적합에 강하고 손이 덜 감', '피처 중요도를 볼 수 있음'],
    cons: ['나무 60그루라 판단 과정을 사람이 따라가긴 어려움'],
    make: liveClassifier('forest')
  });

  REG.add({
    id: 'boosting', name: '그래디언트부스팅', task: 'direction', family: '트리 앙상블',
    cost: 4, interpret: '중',
    analogy: '앞 나무가 틀린 문제만 다음 나무가 집중해서 다시 풉니다. 오답노트를 계속 쌓는 방식입니다. ' +
      '캐글 대회에서 표 형태 데이터의 1등을 오래 지켜 온 계열입니다.',
    pros: ['표 형태 데이터에서 대개 가장 강함'],
    cons: ['설정값이 많고, 잘못 두면 과적합이 빠르게 옴'],
    make: liveClassifier('boosting')
  });

  REG.add({
    id: 'mlp', name: '신경망 (MLP)', task: 'direction', family: '신경망',
    cost: 4, interpret: '하',
    analogy: '피처를 받아 은닉층에서 여러 방식으로 섞은 뒤 답을 냅니다. ' +
      '섞는 방법 자체를 데이터에서 배우기 때문에 사람이 미리 정해 주지 않아도 됩니다.',
    pros: ['복잡한 상호작용을 스스로 찾아냄'],
    cons: ['왜 그렇게 답했는지 설명이 거의 불가능', '시드에 따라 결과가 흔들림'],
    make: liveClassifier('mlp')
  });

  REG.add({
    id: 'ensemble', name: '앙상블 (소프트 보팅)', task: 'direction', family: '앙상블',
    cost: 5, interpret: '중',
    analogy: '여러 모델이 낸 확률을 그냥 평균 냅니다. 서로 다른 실수를 하는 모델들이라면 ' +
      '실수끼리 상쇄되어 평균이 개별 모델보다 나아집니다. "왜 여러 모델을 쓰는가"의 답입니다.',
    pros: ['대체로 개별 모델보다 안정적', '한 모델이 무너지는 구간을 다른 모델이 메움'],
    cons: ['들어간 모델을 전부 학습해야 해서 가장 느림', '평균이라 설명이 흐려짐']
  });

  // --- 파이썬 사전 학습 (딥러닝) -------------------------------------------
  REG.add({
    id: 'lstm', name: 'LSTM', task: 'direction', exec: 'pre', family: '순환 신경망',
    cost: 5, interpret: '하',
    analogy: '앞의 60일을 순서대로 읽으면서 "기억할 것"과 "잊을 것"을 스스로 골라 갑니다. ' +
      '다른 모델은 오늘 하루치 숫자만 보지만, LSTM은 흐름 자체를 봅니다.',
    pros: ['시간 순서 정보를 직접 활용'],
    cons: ['브라우저에서 못 돌릴 만큼 무거움', '데이터가 적으면 과적합이 심함']
  });

  REG.add({
    id: 'gru', name: 'GRU', task: 'direction', exec: 'pre', family: '순환 신경망',
    cost: 5, interpret: '하',
    analogy: 'LSTM에서 문을 두 개로 줄여 더 가볍게 만든 것입니다. 성능은 비슷한데 더 빠릅니다.',
    pros: ['LSTM보다 가볍고 학습이 빠름'],
    cons: ['LSTM과 마찬가지로 설명이 어려움']
  });

  REG.add({
    id: 'tcn', name: '1D-CNN / TCN', task: 'direction', exec: 'pre', family: '합성곱 신경망',
    cost: 5, interpret: '하',
    analogy: '사진에서 모서리를 찾는 방식 그대로, 주가 그래프에서 "이런 모양"을 찾아내는 필터를 학습합니다.',
    pros: ['병렬 계산이 되어 순환 신경망보다 빠름', '짧은 패턴을 잘 잡음'],
    cons: ['아주 긴 기억은 순환 신경망보다 약함']
  });

  REG.add({
    id: 'transformer', name: '소형 Transformer', task: 'direction', exec: 'pre', family: '어텐션',
    cost: 5, interpret: '하',
    analogy: '지난 60일 중 오늘과 관련 있는 날에만 집중(어텐션)해서 봅니다. ChatGPT와 같은 계열입니다.',
    pros: ['멀리 떨어진 날과의 관계도 잡아냄'],
    cons: ['데이터가 훨씬 많이 필요함', '주가 데이터 규모에선 과한 경우가 많음']
  });

  // --- 기준선 --------------------------------------------------------------
  REG.add({
    id: 'rw', name: '랜덤워크 (오늘과 같다)', task: 'direction', baseline: true, family: '기준선',
    cost: 1, interpret: '상',
    analogy: '"오늘 올랐으니 내일도 오르겠지." 아무 학습도 하지 않습니다. ' +
      '학계에서 주가 예측의 가장 오래된 기준선입니다.',
    pros: ['공짜'], cons: ['예측이라 부를 수 없음'],
    params: { col: 'ret1' },
    make: ruleModel(function (row, col) { return col >= 0 ? (row[col] > 0 ? 0.75 : 0.25) : 0.5; })
  });

  REG.add({
    id: 'arima', name: 'ARIMA(1,1,0)', task: 'direction', baseline: true, family: '기준선 · 통계',
    cost: 1, interpret: '상',
    analogy: '어제 수익률로 오늘 수익률을 설명하는 가장 단순한 시계열 모형입니다. ' +
      'AI 없이 통계학만으로 어디까지 되는지 보여 주는 자입니다.',
    pros: ['통계학의 표준 기준선', '계수 하나라 해석이 명확'],
    cons: ['하루 전 정보만 봄']
  });

  REG.add({
    id: 'momentum', name: '모멘텀 규칙', task: 'direction', baseline: true, family: '기준선 · 규칙',
    cost: 1, interpret: '상',
    analogy: '5일 평균이 20일 평균보다 위면 "오른다"고 답합니다. 차트에서 가장 흔히 쓰는 규칙입니다.',
    pros: ['설명이 한 줄로 끝남', '추세장에서 의외로 강함'],
    cons: ['방향이 자주 바뀌는 구간에서 계속 틀림'],
    params: { col: 'ma5_vs_ma20' },
    make: ruleModel(function (row, col) { return col >= 0 ? (row[col] > 0 ? 0.75 : 0.25) : 0.5; })
  });

  REG.add({
    id: 'alwaysup', name: '항상 상승', task: 'direction', baseline: true, family: '기준선',
    cost: 1, interpret: '상',
    analogy: '무조건 "오른다"고만 답합니다. 주식은 오른 날이 조금 더 많아서, 이것만으로도 ' +
      '정확도 52%쯤 나옵니다. 어떤 모델이 이걸 못 이기면 그 모델은 쓸모가 없습니다.',
    pros: ['정확도라는 지표의 함정을 드러냄'],
    cons: ['예측이 아님 — AUC는 계산조차 되지 않습니다'],
    make: ruleModel(function () { return 1; })
  });

  REG.add({
    id: 'coin', name: '동전 던지기', task: 'direction', baseline: true, family: '기준선',
    cost: 1, interpret: '상',
    analogy: '난수로 찍습니다. 시드를 고정해 두어 몇 번을 돌려도 같은 결과가 나옵니다. ' +
      '예측력 점수의 0점이 바로 이 모델입니다.',
    pros: ['0점의 정의'], cons: ['—'],
    make: ruleModel(function (row, col, rnd) { return rnd(); })
  });

  REG.add({
    id: 'buyhold', name: '바이앤홀드', task: 'direction', baseline: true, family: '기준선 · 수익성',
    cost: 1, interpret: '상',
    analogy: '첫날 사서 끝까지 들고 있습니다. 신호로 보면 "항상 상승"과 똑같지만, ' +
      '쓰이는 곳이 다릅니다 — 이쪽은 수익성 점수의 0점 기준입니다. ' +
      '"AI를 돌려서 그냥 사서 묻어 두는 것보다 나았는가"를 재는 자.',
    pros: ['거래비용이 거의 0', '실제로 이기기 매우 어려운 상대'],
    cons: ['하락장을 그대로 다 맞음'],
    make: ruleModel(function () { return 1; })
  });

  /* ========================================================================
   *  B. 변동성 예측
   *    입력이 피처가 아니라 '수익률 시계열'입니다. fit 은 학습 구간의 수익률로
   *    모수를 정하고, predict 는 시험 구간을 하루씩 굴리며 내일의 σ를 냅니다.
   *    ★ 내일을 예측할 때 오늘 수익률까지만 씁니다(내일 값을 쓰면 누출).
   * ======================================================================*/

  // EWMA — 업계 표준 기준선 (RiskMetrics λ=0.94)
  function ewmaModel(params) {
    const lam = (params && params.lambda) || 0.94;
    let v0 = 1e-4, last = 0;
    return {
      fit: function (train) {
        const r = train.ret;
        let v = Math.pow(U.std(r), 2) || 1e-4;
        for (let i = 0; i < r.length; i++) v = lam * v + (1 - lam) * r[i] * r[i];
        v0 = v;
        last = r.length ? r[r.length - 1] : 0;
        return this;
      },
      predict: function (test) {
        const r = test.ret, n = r.length, out = new Float64Array(n);
        let v = v0, prev = last;
        for (let i = 0; i < n; i++) {
          v = lam * v + (1 - lam) * prev * prev;   // 어제까지의 정보로 오늘의 σ를 만듭니다
          out[i] = Math.sqrt(v);
          prev = r[i];
        }
        return out;
      }
    };
  }

  // GARCH(1,1) — metrics.js 의 격자탐색 추정을 그대로 씁니다.
  function garchModel() {
    let par = null, v0 = 1e-4, last = 0;
    return {
      fit: function (train) {
        const r = train.ret;
        par = M.garch(r);
        v0 = Math.pow(par.sigma[par.sigma.length - 1], 2);
        last = r.length ? r[r.length - 1] - par.mu : 0;
        return this;
      },
      predict: function (test) {
        const r = test.ret, n = r.length, out = new Float64Array(n);
        let v = v0, e = last;
        for (let i = 0; i < n; i++) {
          v = par.omega + par.alpha * e * e + par.beta * v;
          out[i] = Math.sqrt(v);
          e = r[i] - par.mu;
        }
        return out;
      },
      params: function () { return par; }
    };
  }

  REG.add({
    id: 'ewma', name: 'EWMA', task: 'volatility', baseline: true, family: '기준선 · 통계',
    cost: 1, interpret: '상',
    analogy: '최근 날에 큰 무게, 먼 날에 작은 무게를 주어 평균을 냅니다. ' +
      '"어제 많이 출렁였으면 오늘도 출렁일 것"이라는 한 줄짜리 규칙이고, ' +
      '금융회사들이 실제로 위험 관리에 쓰는 표준입니다. 변동성 점수의 0점 기준.',
    pros: ['공식이 한 줄', '실무 표준이라 반박이 어려움'],
    cons: ['하락 충격과 상승 충격을 똑같이 취급함'],
    params: { lambda: 0.94 },
    make: ewmaModel
  });

  REG.add({
    id: 'garch', name: 'GARCH(1,1)', task: 'volatility', family: '통계',
    cost: 3, interpret: '중',
    analogy: '변동성은 뭉쳐서 옵니다 — 크게 흔들린 날 다음은 또 크게 흔들립니다. ' +
      'GARCH는 그 뭉침을 "어제의 충격"과 "어제의 변동성" 두 항으로 나눠 씁니다. ' +
      '이 공로로 노벨경제학상이 나왔습니다.',
    pros: ['변동성 뭉침을 정면으로 모형화', '장기 평균으로 되돌아가는 성질까지 표현'],
    cons: ['하락·상승 충격을 대칭으로 봄', '추정에 계산이 필요'],
    make: garchModel
  });

  REG.add({
    id: 'gjr', name: 'GJR-GARCH', task: 'volatility', family: '통계',
    cost: 3, interpret: '중',
    analogy: 'GARCH에 "떨어진 날의 충격은 더 세게 친다"는 항을 하나 더합니다. ' +
      '실제로 시장은 오를 때보다 떨어질 때 훨씬 크게 출렁입니다(레버리지 효과).',
    pros: ['하락 충격의 비대칭을 잡아냄', 'GARCH보다 대개 성적이 좋음'],
    cons: ['추정할 모수가 하나 더 늘어남']
  });

  REG.add({
    id: 'egarch', name: 'EGARCH', task: 'volatility', exec: 'pre', family: '통계',
    cost: 3, interpret: '중',
    analogy: '변동성을 로그로 다뤄 음수가 될 걱정을 없애고, 비대칭도 함께 담습니다.',
    pros: ['모수에 제약이 거의 없어 유연함'],
    cons: ['추정이 불안정해 파이썬에서 정밀하게 맞춥니다']
  });

  REG.add({
    id: 'har', name: 'HAR-RV', task: 'volatility', family: '통계',
    cost: 1, interpret: '상',
    analogy: '어제 · 지난주 · 지난달의 변동성 세 개를 그냥 더해 회귀합니다. 식이 세 줄인데 ' +
      '복잡한 모델을 자주 이깁니다. 시장에 하루 단위, 주 단위, 월 단위로 보는 투자자가 ' +
      '섞여 있다는 발상에서 나왔습니다.',
    pros: ['놀랄 만큼 단순한데 강함', '실현변동성 예측의 학계 표준 벤치마크'],
    cons: ['갑작스러운 충격에는 늦게 반응']
  });

  REG.add({
    id: 'rf_vol', name: 'RF-Vol', task: 'volatility', family: '트리 앙상블',
    cost: 3, interpret: '중',
    analogy: '랜덤포레스트로 "내일의 출렁임 크기"라는 숫자를 직접 예측합니다. ' +
      'AI 계열이 통계 모형을 이길 수 있는지 보는 대항마입니다.',
    pros: ['피처를 자유롭게 넣을 수 있음'],
    cons: ['변동성의 뭉침 구조를 직접 모형화하지 않음']
  });

  REG.add({
    id: 'lstm_vol', name: 'LSTM-Vol', task: 'volatility', exec: 'pre', family: '순환 신경망',
    cost: 5, interpret: '하',
    analogy: '변동성 시계열 자체를 LSTM에 통째로 물려 예측합니다.',
    pros: ['비선형 패턴까지 잡을 여지'],
    cons: ['GARCH 계열을 못 이기는 경우가 흔합니다 — 그 결과도 정직하게 보여 줍니다']
  });

  /* ========================================================================
   *  C. 국면·이상 탐지
   * ======================================================================*/
  REG.add({
    id: 'hmm3', name: 'HMM (3국면)', task: 'regime', exec: 'pre', family: '확률 · 상태',
    cost: 3, interpret: '중',
    analogy: '시장이 겉으로는 가격만 보여 주지만 속에는 "지금 어떤 장세인가"라는 숨은 상태가 ' +
      '있다고 보고, 그 상태와 상태 사이를 오가는 확률까지 함께 추정합니다. ' +
      '이 사이트에서 국면 라벨의 기본값입니다.',
    pros: ['국면이 잘 바뀌지 않는다는 성질을 반영', '전환 확률까지 나옴'],
    cons: ['국면 개수를 사람이 정해 줘야 함']
  });

  REG.add({
    id: 'kmeans3', name: 'k-means (3국면)', task: 'regime', family: '군집',
    cost: 2, interpret: '상',
    analogy: '수익률과 변동성 두 축의 평면에 날짜들을 뿌리고, 가까운 것끼리 세 무리로 묶습니다. ' +
      '브라우저에서 직접 돌려 HMM과 비교해 볼 수 있습니다.',
    pros: ['원리가 단순하고 직접 돌려 볼 수 있음'],
    cons: ['날짜 순서를 전혀 고려하지 않아 국면이 하루 단위로 튐']
  });

  REG.add({
    id: 'iforest', name: 'Isolation Forest', task: 'regime', family: '이상 탐지',
    cost: 2, interpret: '중',
    analogy: '아무 기준으로나 데이터를 계속 반으로 자를 때, 몇 번 만에 혼자 남는지를 셉니다. ' +
      '몇 번 안 잘라도 혼자 떨어져 나오는 날이 곧 이상한 날(급등락)입니다.',
    pros: ['정답 라벨 없이도 이상한 날을 찾아냄'],
    cons: ['"이상"이 곧 "위험"은 아님 — 해석은 사람 몫']
  });

  /* ------------------------------------------------------------------------
   *  난수를 쓰는 모델 표시
   *
   *  시드를 바꾸면 결과가 달라지는 모델들입니다. 이런 모델은 한 번 돌린 숫자를
   *  믿으면 안 되고 시드를 여러 개 돌려 평균 ± 표준편차로 봐야 합니다.
   *  반대로 여기 없는 모델은 몇 번을 돌려도 같은 값이 나오므로(결정적) 시드
   *  반복이 낭비입니다. 실행 엔진이 이 표시를 보고 알아서 건너뜁니다.
   * ----------------------------------------------------------------------*/
  ['forest', 'boosting', 'mlp', 'svm', 'ensemble', 'coin', 'rf_vol', 'kmeans3', 'iforest']
    .forEach(function (id) { if (byId[id]) byId[id].stochastic = true; });

  /* ------------------------------------------------------------------------
   *  요약 — 화면 상단이나 콘솔에서 진행 상황을 확인할 때
   * ----------------------------------------------------------------------*/
  REG.summary = function () {
    const all = REG.list();
    const ready = all.filter(function (d) { return !!d.make; });
    return { total: all.length, ready: ready.length, pending: all.length - ready.length };
  };

  root.REG = REG;
})(window.QL = window.QL || {});
