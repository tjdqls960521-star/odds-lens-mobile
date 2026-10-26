export const MARKET_PRESETS = {
  '1X2': {
    title: '일반 승무패',
    outcomes: ['PSG 승', '무승부', '아스날 승'],
    reference: [2.15, 3.00, 2.75],
    current: [1.99, 3.25, 2.95],
    shares: [42.7, 30.8, 26.1],
    note: '게시글의 “적정배당”을 비교 기준으로 입력했습니다. 실제 오픈 배당이나 베팅 비중으로 확인된 값은 아닙니다.'
  },
  handicap: {
    title: '핸디캡 승무패',
    outcomes: ['PSG 마핸', '핸무', '반대 핸디캡'],
    reference: [4.30, 3.75, 1.55],
    current: [3.80, 3.95, 1.58],
    shares: [33.9, 51.6, 13.9],
    note: '게시글의 “적정배당”과 최종 배당을 비교합니다. 핸디캡 기준점은 원문 스크린샷만으로 확인되지 않았습니다.'
  }
};

export function marketMetrics(odds) {
  const valid = odds.map(Number).every(value => Number.isFinite(value) && value > 1);
  if (!valid) return null;
  const reciprocals = odds.map(value => 1 / Number(value));
  const bookSum = reciprocals.reduce((sum, value) => sum + value, 0);
  return {
    bookSum,
    overround: bookSum - 1,
    theoreticalPayout: 1 / bookSum,
    implied: reciprocals,
    probabilities: reciprocals.map(value => value / bookSum)
  };
}

export function outcomeExposure(odds, shares, handle = 100) {
  return odds.map((rawOdds, index) => {
    const odd = Number(rawOdds), share = Number(shares[index]);
    if (!(Number.isFinite(odd) && odd > 1 && Number.isFinite(share) && share >= 0)) return null;
    const payout = share / 100 * odd;
    return { share, payout, profit: Number(handle) * (1 - payout) };
  });
}

export function movementRows(referenceOdds, currentOdds) {
  const reference = marketMetrics(referenceOdds), current = marketMetrics(currentOdds);
  if (!reference || !current) return null;
  return current.probabilities.map((probability, index) => ({
    referenceProbability: reference.probabilities[index],
    currentProbability: probability,
    delta: probability - reference.probabilities[index],
    impliedDelta: current.implied[index] - reference.implied[index]
  }));
}

export function evaluatePriceDecision(odds, estimatedProbability, conservativeProbability) {
  const price=Number(odds), estimate=Number(estimatedProbability), lower=Number(conservativeProbability);
  if(!Number.isFinite(price)||price<=1)return {status:'hold',reason:'현재 배당을 확인할 수 없습니다.'};
  const breakEven=1/price;
  if(String(estimatedProbability??'').trim()===''||String(conservativeProbability??'').trim()===''||!Number.isFinite(estimate)||estimate<0||estimate>1||!Number.isFinite(lower)||lower<0||lower>1||lower>estimate)
    return {status:'hold',reason:'검증된 확률과 보수 하한을 입력해야 가격을 평가할 수 있습니다.',breakEven};
  const pointEv=estimate*price-1,conservativeEv=lower*price-1;
  if(conservativeEv<=0)return {status:'pass',reason:'보수 확률 하한이 손익분기 확률을 넘지 못합니다.',breakEven,pointEv,conservativeEv};
  return {status:'paper',reason:'보수 기준 가격 조건은 통과했습니다. 전략의 실전 수익성 검증 전이므로 모의 검토만 가능합니다.',breakEven,pointEv,conservativeEv};
}
