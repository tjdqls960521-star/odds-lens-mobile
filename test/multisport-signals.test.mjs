import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from 'cheerio';
import {analyzeMarketSignal,oddsShares,buildDomesticSignals,marketSignalInterpretation,SIGNAL_SPORTS} from '../public/odds-lens/multisport-signals.mjs';
import {signalsView,signalCardView} from '../public/odds-lens/traffic-light-ui.mjs';

const now=new Date('2026-10-14T03:00:00Z');
function market({before=[2,2],after=[1.6,2.4],keys=['home','away'],labels=['홈 승','원정 승'],line=null,type='일반'}={}){
 const outcomes=after.map((odds,i)=>({key:keys[i],label:labels[i],odds}));
 return {id:'betman-260121-1',market:type,marketLabel:type,period:'full',line,outcomeKeys:keys,observedAt:now.toISOString(),saleStatus:'selling',outcomes,oddsHistory:{first:{market:type,period:'full',line,observedAt:'2026-10-13T03:00:00Z',outcomes:before.map((odds,i)=>({key:keys[i],label:labels[i],odds}))}}};
}
function feed(markets=[market()]){
 return {fetchedAt:now.toISOString(),events:Object.keys(SIGNAL_SPORTS).map(sport=>({id:sport,sport,home:sport+' 홈',away:'원정',league:'TEST',startsAt:'2026-10-14T10:00:00Z',markets:markets.map(m=>({...m,id:sport+'-'+m.id}))}))};
}
test('inverse odds are normalized independently at each observation, not called model probability',()=>{
 assert.deepEqual(oddsShares([{odds:1.8},{odds:1.8}]),[50,50]);
 assert.equal(oddsShares([{odds:0},{odds:2}]),null);
 const a=analyzeMarketSignal(market());assert.deepEqual(a.early,[50,50]);assert.ok(Math.abs(a.current[0]-60)<1e-10);
 assert.equal(a.changes[0],10);assert.equal(a.changes[1],-10);assert.equal(a.signal,'🟡 홈 승');assert.equal(a.supportTotal,1);
 assert.match(marketSignalInterpretation(a),/독립된 보조 근거 2개를 뜻하지 않습니다/);
});
test('proportional price/margin shifts alone do not create a direction signal',()=>{
 assert.equal(analyzeMarketSignal(market({before:[2,3],after:[1.8,2.7]})).color,'none');
});
test('all four sports and actual under/over labels share the same two-outcome rule',()=>{
 const m=market({keys:['under','over'],labels:['언더','오버'],type:'언오버',line:8.5});
 const result=buildDomesticSignals(feed([m]),{now});assert.equal(result.events.length,4);
 for(const e of result.events){assert.equal(e.analysis.signal,'🟡 언더');assert.equal(e.analysis.labels.length,2);assert.equal(e.line,8.5);}
 const $=load(signalCardView(result.events[0]));assert.equal($('.tl-probability-grid>div').length,2);assert.match($.text(),/1\/1/);assert.doesNotMatch($.text(),/무승부/);
});
test('three-outcome generalized markets evaluate the middle outcome and retain all simultaneous directions',()=>{
 const m=market({before:[3,3,3],after:[4,2,4],keys:['home','draw','away'],labels:['승','① 1점차 이내','패'],type:'승1패'});
 const a=analyzeMarketSignal(m);assert.equal(a.direction,1);assert.equal(a.color,'green');assert.equal(a.supports.length,2);assert.match(a.signal,/①/);
 const both=analyzeMarketSignal(market({before:[4,2,4],after:[3,3,3],keys:['home','draw','away'],labels:['승','⑤','패']}));
 assert.equal(both.qualified.length,2);assert.equal(both.color,'yellow');assert.match(marketSignalInterpretation(both),/증가 폭이 가장 큰 방향/);
});
test('same selection keys may be reordered without reversing the signal',()=>{
 const m=market();m.oddsHistory.first.outcomes.reverse();const a=analyzeMarketSignal(m);assert.deepEqual(a.early,[50,50]);assert.equal(a.signal,'🟡 홈 승');
});
test('line, period, selection composition, missing history and invalid times explicitly suspend analysis',()=>{
 for(const mutate of [m=>m.line=1.5,m=>m.period='first_half',m=>{m.outcomes[1].key='draw';m.outcomeKeys=['home','draw'];}]){
  const m=market();mutate(m);assert.equal(analyzeMarketSignal(m).reason,'conditions');
 }
 const m=market();delete m.oddsHistory;assert.equal(analyzeMarketSignal(m).reason,'no-baseline');
 const future=market();future.oddsHistory.first.observedAt='2026-10-15T00:00:00Z';assert.equal(analyzeMarketSignal(future).reason,'time');
 const partial=market();partial.outcomeKeys=['home','draw','away'];assert.equal(analyzeMarketSignal(partial).reason,'incomplete');
 const bad=market();bad.outcomes[0].odds=NaN;assert.equal(analyzeMarketSignal(bad).color,'missing');
});
test('pending odds are counted per sport without creating fictitious prices or signals',()=>{
 const f=feed([{...market(),outcomes:[]}]),p=buildDomesticSignals(f,{now});
 assert.equal(p.events.length,0);for(const c of Object.values(p.coverage)){assert.equal(c.waiting,1);assert.equal(c.signals,0);}
 const html=signalsView({source:'domestic',payload:p,sport:'volleyball'});assert.match(html,/배당 공개 대기 1시장/);assert.match(html,/표시할 공개 배당이 없습니다/);
});
test('the live board marks stale data, keeps market counts separate and filters sport / market / phase',()=>{
 const f=feed([market(),market({type:'언오버',line:8.5,keys:['under','over'],labels:['언더','오버']})]);
 f.events[0].startsAt='2026-10-14T01:00:00Z';f.fetchedAt='2026-10-13T20:00:00Z';
 const p=buildDomesticSignals(f,{now});assert.equal(p.stale,true);assert.ok(p.events.every(e=>e.stale));
 let $=load(signalsView({source:'domestic',payload:p,sport:'baseball',phase:'upcoming'}));assert.equal($('.tl-card').length,0);
 $=load(signalsView({source:'domestic',payload:p,sport:'basketball',market:'언오버',phase:'upcoming'}));assert.equal($('.tl-card').length,1);assert.match($('.tl-card').text(),/농구/);
 assert.match($.text(),/4경기 \/ 8시장/);assert.match($.text(),/이전 수집값/);assert.equal($('[data-signal-sport]').length,5);
});
test('KST boundary excludes yesterday and domestic text escapes provider team names',()=>{
 const f=feed();f.events[0].startsAt='2026-10-13T14:59:00Z';f.events[1].home='<img src=x onerror=alert(1)>';
 const p=buildDomesticSignals(f,{now});assert.equal(p.events.length,3);
 const $=load(signalsView({source:'domestic',payload:p}));assert.equal($('img').length,0);assert.match($.text(),/<img/);
});
test('malformed baseline timestamps and quote text cannot crash or inject into the card',()=>{
 const m=market();m.oddsHistory.first.observedAt='bad-time';m.oddsHistory.first.outcomes[0].odds='<img src=x>';
 const p=buildDomesticSignals(feed([m]),{now});
 const $=load(signalsView({source:'domestic',payload:p}));assert.equal($('img').length,0);assert.equal($('.tl-card').length,4);assert.match($.text(),/판정 보류/);
});
