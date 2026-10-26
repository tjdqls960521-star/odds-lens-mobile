import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {load} from 'cheerio';
import {analyzeValueMarket,screenValuePicks,valueCohort,VALUE_POLICY} from '../public/odds-lens/value-picks.mjs';
import {valueCardView,valueBoardView} from '../public/odds-lens/value-picks-ui.mjs';
import {groupFeedEvents} from '../public/odds-lens/prediction-core.mjs';
import {analyzePatternEvent} from '../public/odds-lens/pattern-board.mjs';
import {screenPicks} from '../public/odds-lens/pick-policy.mjs';
const now=Date.parse('2026-10-13T15:33:23.161Z');
const event={id:'e',sport:'baseball',league:'KBO',home:'홈',away:'원정',startsAt:'2026-10-14T09:00:00Z'};
const market={id:'m',market:'일반',line:null,period:'full',available:true,saleStatus:'selling',observedAt:new Date(now).toISOString(),outcomes:[{key:'home',label:'홈 승',odds:1.5},{key:'away',label:'원정 승',odds:2.5}]};
const summary=counts=>({counts,n:counts.reduce((a,b)=>a+b,0),dateRange:{first:'2026-01-01',last:'2026-10-10'},statistics:[]});
const pattern=counts=>({scopes:{league:summary(counts),sport:summary(counts)},singlePrice:{}});
const opts={now,sourceCurrent:true};
const group=(m=market,p=pattern([50,0,50]))=>({event,markets:[{market:m,pattern:p}]});
test('underdog statistical value beats lowest odds, using raw break-even rather than no-vig reference',()=>{
 const report=screenValuePicks([group()],opts),p=report.candidates[0];
 assert.equal(p.slot,2);assert.equal(p.selection.odds,2.5);assert.equal(p.breakEven,.4);
 assert.ok(Math.abs(p.probability-(50+20*.375)/120)<1e-12);
 assert.ok(Math.abs(p.edge-(p.probability-.4))<1e-12);
 assert.ok(Math.abs(p.expectedReturn-(p.probability*2.5-1))<1e-12);
 // 70% descriptive frequency at 1.40 still need not represent value after shrinkage.
 const m={...market,outcomes:[{key:'home',odds:1.4},{key:'away',odds:2.6}]};
 const home=analyzeValueMarket(event,m,pattern([70,0,30]),opts)[0];assert.equal(home.isValue,false);
});
test('one fixed cohort produces a coherent two/three-way probability vector without overlap counting',()=>{
 const m={...market,outcomes:[{key:'home',odds:2.3},{key:'draw',odds:3.1},{key:'away',odds:2.8}]},p=pattern([20,30,50]);
 p.scopes.sport=summary([800,100,100]);
 const picks=analyzeValueMarket(event,m,p,opts);
 assert.ok(Math.abs(picks.reduce((n,p)=>n+p.probability,0)-1)<1e-12);assert.ok(picks.every(p=>p.evidence.n===100&&p.evidence.scope==='league'));
 assert.ok(picks[1].probability>0);assert.equal(picks.length,3);
});
test('single price cohort matches the selected outcome, never the larger draw/opposing cohort',()=>{
 const p={scopes:{},singlePrice:{0:{league:summary([15,0,15])},2:{league:summary([0,0,12])}}};
 const selection=[{slot:0,label:'홈 승',odds:1.5},{slot:2,label:'원정 승',odds:2.5}],chosen=valueCohort(p,selection,selection[0]);
 assert.equal(chosen.anchorSlot,0);assert.equal(chosen.summary.n,30);
 const picks=analyzeValueMarket(event,market,p,opts);assert.equal(picks[1].evidence.anchorSlot,2);assert.equal(picks[1].evidence.wins,12);assert.ok(Math.abs(picks[0].probability+picks[1].probability-1)<1e-12);
 const m={...market,outcomes:[{key:'home',odds:7.5},{key:'draw',odds:5},{key:'away',odds:1.18}]};
 const misleading={scopes:{},singlePrice:{0:{sport:summary([8,20,72])},1:{sport:summary([160,20,43])},2:{sport:summary([8,20,72])}}};
 const home=analyzeValueMarket(event,m,misleading,opts)[0];assert.equal(home.evidence.n,100);assert.equal(home.evidence.wins,8);assert.ok(home.probability<.15);
});
test('small perfect samples are shrunk and never promoted as value recommendations',()=>{
 const three=screenValuePicks([group(market,pattern([0,0,3]))],opts);
 assert.equal(three.candidates.length,0);assert.equal(three.ranked.length,1);assert.ok(three.ranked[0].probability<.5);
 const two=screenValuePicks([group(market,pattern([0,0,2]))],opts);assert.equal(two.ranked[0].probability,null);
});
test('closed and stale prices retain analysis but have no add action; announced-price absence is explicit',()=>{
 for(const m of [{...market,saleStatus:'closed',available:false},{...market,observedAt:new Date(now-600000).toISOString()}]){
  const report=screenValuePicks([group(m)],opts);assert.equal(report.ranked.length,1);assert.equal(report.candidates.length,1);assert.equal(report.candidates[0].availability.canAdd,false);
  const $=load(valueBoardView(report));assert.equal($('.value-card').length,1);assert.equal($('[data-add-pick]').length,0);assert.match($.text(),/마지막 확인 배당/);
 }
 const report=screenValuePicks([group({...market,pending:true,outcomes:[]})],opts),$=load(valueBoardView(report));
 assert.equal(report.waiting.length,1);assert.equal($('.value-waiting').length,1);assert.match($.text(),/배당 발표 대기/);assert.equal($('.value-stats').length,0);
});
test('no positive edge, pending-only, loading, error and filtered-empty all have actionable UI',()=>{
 const even={...market,outcomes:[{key:'home',label:'승',odds:1.8},{key:'away',label:'패',odds:1.8}]},report=screenValuePicks([group(even)],opts);
 assert.equal(report.candidates.length,0);
 let $=load(valueBoardView(report));assert.equal($('.value-card').length,1);assert.match($.text(),/전체 분석 결과/);
 for(const options of [{loading:true},{error:true}]){$=load(valueBoardView(report,options));assert.equal($('.value-card').length,1);assert.equal($('[data-add-pick]').length,0);}
 $=load(valueBoardView(screenValuePicks([],opts),{hasFilters:true}));assert.equal($('[data-reset-fixtures]').length,1);
});
test('invalid/started markets cannot invent probabilities; a valid closed quote survives another pending round',()=>{
 for(const m of [{...market,market:'언오버',line:null},{...market,outcomes:market.outcomes.map(o=>({...o,key:'same'}))}])assert.equal(analyzeValueMarket(event,m,pattern([50,0,50]),opts).length,0);
 assert.equal(screenValuePicks([{...group(),event:{...event,startsAt:new Date(now-1).toISOString()}}],opts).totalFixtures,0);
 const g={event,markets:[{market:{...market,saleStatus:'closed'},pattern:pattern([50,0,50])},{market:{...market,id:'pending-round',pending:true,outcomes:[]}}]};
 const report=screenValuePicks([g],opts);assert.equal(report.ranked.length,1);assert.equal(report.waiting.length,0);assert.equal(report.ranked[0].market.id,'m');
});
test('mobile card escapes text and preserves expected price/line and exact cohort action',()=>{
 const p=screenValuePicks([group()],opts).candidates[0];p.event={...p.event,home:'<img src=x onerror=bad>'};
 let $=load(valueCardView(p));assert.equal($('img').length,0);assert.equal($('.value-stats>div').length,3);assert.match($('.value-stats').text(),/통계 추정확률.*배당 기준 확률.*배당 대비 차이/);
 assert.equal($('[data-add-pick]').attr('data-expected-odds'),'2.5');assert.equal($('[data-add-pick]').attr('data-value-pick'),'true');assert.ok($('[data-add-pick]').attr('data-expected-condition'));
 assert.equal($('[data-show-evidence]').attr('data-slot'),'2');
 p.evidence={...p.evidence,basis:'single',anchorSlot:0,anchorLabel:'홈 승',anchorOdds:1.5};$=load(valueCardView(p));assert.equal($('[data-show-evidence]').attr('data-slot'),'0');assert.match($('[data-show-evidence]').text(),/홈 승 기준/);
});
test('an old closed round with a larger edge cannot replace the current sellable quote for the same condition',()=>{
 const old={...market,id:'old',round:'260121',saleStatus:'closed',available:false,outcomes:[{key:'home',label:'홈 승',odds:1.5},{key:'away',label:'원정 승',odds:3.5}]};
 const current={...market,id:'current',round:'260122'};
 const report=screenValuePicks([{event,markets:[{market:old,pattern:pattern([30,0,70])},{market:current,pattern:pattern([50,0,50])}]}],opts);
 assert.equal(report.all.length,2);assert.equal(report.ranked[0].market.id,'current');assert.equal(report.ranked[0].availability.canAdd,true);
});
test('October 14 midnight official snapshot reproduces empty old picker and visible new analysis',()=>{
 const snapshot=JSON.parse(readFileSync(new URL('./fixtures/value-midnight-20261014.json',import.meta.url)));
 const events=groupFeedEvents(snapshot.events),groups=events.map(event=>({event,markets:event.markets.map(market=>({market,pattern:pattern([50,0,50])}))}));
 assert.equal(screenPicks(groups,{now:Date.parse(snapshot.fetchedAt),sourceCurrent:true}).references.length,0);
 const report=screenValuePicks(groups,{now:Date.parse(snapshot.fetchedAt),sourceCurrent:true});
 assert.equal(report.totalFixtures,4);assert.equal(report.priced,2);assert.equal(report.waiting.length,2);assert.equal(report.selling,0);
 const $=load(valueBoardView(report,{tab:'all'}));assert.equal($('.value-card').length,2);assert.equal($('.value-waiting').length,2);
});
test('archive matching preserves the exact market/line and excludes same-day future labels',()=>{
 const m={...market,market:'언오버',line:8.5};
 const rows=Array.from({length:20},(_,i)=>({id:'r'+i,date:`2026-09-${String(i+1).padStart(2,'0')} 18:00`,league:'KBO',home:'홈',away:'원정',market:'언오버',line:i<10?8.5:9.5,closing:[1.5,null,2.5],result:i%2?'언더':'오버'}));
 rows.push({...rows[0],id:'future',date:'2026-10-14 10:00'});
 const p=analyzePatternEvent(event,m,rows,{includeSequences:false}),picks=analyzeValueMarket(event,m,p,opts);assert.equal(picks[0].evidence.n,10);
});
