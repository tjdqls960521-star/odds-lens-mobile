import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKET_PRESETS, marketMetrics, movementRows, outcomeExposure, evaluatePriceDecision } from '../public/odds-lens/market-reading-core.mjs';
import { marketReadingView } from '../public/odds-lens/market-reading-ui.mjs';

test('market payout and no-vig probabilities are calculated separately',()=>{
  const metrics=marketMetrics([2.35,3.30,3.00]);
  assert.ok(Math.abs(metrics.theoreticalPayout-0.941712)<0.00001);
  assert.ok(Math.abs(metrics.overround-0.061896)<0.00001);
  assert.ok(Math.abs(metrics.probabilities.reduce((a,b)=>a+b,0)-1)<1e-12);
});

test('the article implied stakes recreate outcome liability without calling it market payout',()=>{
  const stakes=[42.7,30.8,26.1];
  const exposure=outcomeExposure([1.99,3.25,2.95],stakes);
  assert.ok(Math.abs(exposure[0].payout-0.84973)<0.0001);
  const handicap=outcomeExposure([3.80,3.95,1.58],[33.9,51.6,13.9]);
  assert.ok(Math.abs(handicap[1].payout-2.0382)<0.0001);
});

test('sample odds distinguish reference and current normalized probabilities',()=>{
  const moves=movementRows(MARKET_PRESETS['1X2'].reference,MARKET_PRESETS['1X2'].current);
  assert.equal(moves.length,3);
  assert.ok(moves[0].delta>0);
  assert.ok(moves[1].delta<0);
});

test('decision gate defaults to hold, passes negative conservative value, and only enables paper review on positive lower-bound EV',()=>{
  assert.equal(evaluatePriceDecision(2.00,'','').status,'hold');
  assert.equal(evaluatePriceDecision(2.00,0.54,0.49).status,'pass');
  const candidate=evaluatePriceDecision(2.00,0.56,0.52);
  assert.equal(candidate.status,'paper');
  assert.ok(Math.abs(candidate.conservativeEv-0.04)<1e-12);
});

test('decision page remains held without independent probability inputs and never presents paper edge as a live bet',()=>{
  const preset=MARKET_PRESETS['1X2'];
  const html=marketReadingView({preset:'1X2',reference:preset.reference,current:preset.current,shares:preset.shares,handle:100,outcome:0,estimate:'',lower:''});
  assert.match(html,/근거 부족 · 보류/);
  assert.match(html,/실전 추천 잠금/);
  assert.match(html,/입력한 확률은 검증된 모델 값으로 간주하지 않습니다/);
  assert.doesNotMatch(html,/NaN|undefined/);
});
