import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {load} from 'cheerio';
import {analyzePatternEvent} from '../public/odds-lens/pattern-board.mjs';
import {assessPick,screenPicks,PICK_POLICY,pickConditionKey} from '../public/odds-lens/pick-policy.mjs';
import {pickCardView,pickBoardView,pickLogicView,cartSelectionNote} from '../public/odds-lens/pick-ui.mjs';

const now=Date.parse('2026-10-13T14:00:00Z');
const event={id:'pick-event',sport:'baseball',league:'KBO',home:'Alpha',away:'Beta',teamNamesVerified:true,startsAt:'2026-10-14T09:00:00Z'};
const market={id:'pick-market',market:'일반',line:null,period:'full',available:true,saleStatus:'selling',observedAt:new Date(now).toISOString(),outcomes:[{key:'home',label:'홈 승',odds:1.4},{key:'away',label:'원정 승',odds:2.6}]};
const rows=slots=>slots.map((slot,i)=>({id:'history-'+i,date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10)+' 18:00',league:'KBO',home:'Alpha',away:'Beta',market:'일반',line:null,closing:[1.4,null,2.6],result:slot===0?'승':'패'}));
const consistent=Array.from({length:200},(_,i)=>i%10<7?0:2);
const analysis=slots=>analyzePatternEvent(event,market,rows(slots),{includeSequences:false});
const opts={now,sourceCurrent:true};
const group=(m=market,p=analysis(consistent),e=event)=>({event:e,markets:[{market:m,pattern:p}]});

test('fixed cohort selection never swaps to a higher hit-rate group once its minimum is met',()=>{
 const pattern=analysis(consistent),weak=analysis(Array.from({length:40},(_,i)=>i%2?0:2));
 pattern.scopes.league=weak.scopes.league;
 const pick=assessPick(event,market,pattern,0,opts);
 assert.equal(pick.evidence.scope,'league');assert.equal(pick.evidence.basis,'combo');assert.equal(pick.evidence.n,40);assert.equal(pick.evidence.rate,.5);
 assert.equal(pick.status,'watch');assert.ok(pick.reasons.includes('lower'));
});
test('3/3 remains review-only while a sufficiently large stable cohort passes the explicit gates',()=>{
 const small=assessPick(event,market,analysis([0,0,0]),0,opts),large=assessPick(event,market,analysis(consistent),0,opts);
 assert.equal(small.evidence.rate,1);assert.equal(small.status,'watch');assert.ok(small.reasons.includes('sample'));
 assert.equal(large.status,'candidate');assert.deepEqual(large.reasons,[]);assert.equal(large.evidence.n,200);
 assert.ok(large.score<large.evidence.rate);assert.ok(large.evidence.test.n>=10);
 assert.equal('winProbability' in large,false);assert.equal('predictedProbability' in large,false);
});
test('weakening later periods and a large supported opposing cohort prevent a statistical candidate',()=>{
 const fade=analysis([...Array(140).fill(0),...Array(60).fill(2)]);
 assert.ok(assessPick(event,market,fade,0,opts).reasons.includes('stable'));
 const pattern=analysis(consistent),against=analysis(Array(200).fill(2));
 pattern.scopes.awayTeam=against.scopes.awayTeam;
 const pick=assessPick(event,market,pattern,0,opts);assert.equal(pick.status,'watch');assert.ok(pick.reasons.includes('opposing'));
});
test('missing, stale, future-dated, closed and mismatched quotes cannot enter either current-price or evidence candidates',()=>{
 const pattern=analysis(consistent);
 const cases=[{...market,observedAt:new Date(now-120001).toISOString()},{...market,observedAt:'bad'},{...market,observedAt:new Date(now+31000).toISOString()},{...market,saleStatus:'closed'},{...market,available:false},{...market,pending:true},{...market,saleClosesAt:new Date(now-1).toISOString()},{...market,market:'핸디캡',line:null},{...market,period:'first_half'},{...market,outcomes:market.outcomes.map(o=>({...o,key:null}))}];
 for(const value of cases){const report=screenPicks([group(value,pattern)],opts);assert.equal(report.references.length,0);assert.equal(report.candidates.length,0);assert.equal(report.excluded.length,1);}
 assert.equal(screenPicks([group()],{...opts,sourceCurrent:false}).references.length,0);
 assert.equal(assessPick({...event,startsAt:new Date(now).toISOString()},market,pattern,0,opts).status,'excluded');
});
test('price priority is one lowest-odds outcome per fixture and cannot be displaced by a flattering historical rate',()=>{
 const home=analysis(consistent),cheap={...market,id:'cheap',outcomes:[{key:'home',label:'홈 승',odds:1.2},{key:'away',label:'원정 승',odds:3.5}]};
 const report=screenPicks([{event,markets:[{market,pattern:home},{market:cheap,pattern:null}]}],opts);
 assert.equal(report.references.length,1);assert.equal(report.references[0].market.id,'cheap');assert.equal(report.references[0].status,'watch');
 assert.equal(report.candidates.length,1);assert.equal(report.candidates[0].market.id,market.id);
 const second=group({...market,id:'other'},home,{...event,id:'other',startsAt:'2026-10-15T09:00:00Z'});
 assert.deepEqual(screenPicks([second,{event,markets:[{market:cheap,pattern:null}]}],opts).references.map(p=>p.event.id),['pick-event','other']);
});
test('reference tie-breaking and statistical order are deterministic, with no odds-movement or streak bonus',()=>{
 const p=analysis(consistent),a={...market,id:'a'},z={...market,id:'z',oddsHistory:{changeCount:30,first:{outcomes:[{key:'home',odds:2}]}}};
 const report=screenPicks([{event,markets:[{market:z,pattern:p},{market:a,pattern:p}]}],opts);
 assert.equal(report.references[0].market.id,'a');
 const original=assessPick(event,a,p,0,opts),moved=assessPick(event,z,p,0,opts);assert.equal(original.score,moved.score);assert.equal(original.status,moved.status);
 const reversed=screenPicks([{event,markets:[{market:a,pattern:p},{market:z,pattern:p}]}],opts);assert.equal(report.candidates[0].market.id,reversed.candidates[0].market.id);
});
test('the displayed market condition can be revalidated independently of unchanged prices',()=>{
 const total={...market,market:'언오버',line:8.5};
 assert.notEqual(pickConditionKey(total),pickConditionKey({...total,line:9.5}));
 assert.equal(pickConditionKey(total),pickConditionKey({...total,observedAt:'another time',outcomes:[...total.outcomes].reverse()}));
 const $=load(pickCardView(assessPick(event,market,analysis(consistent),0,opts),{reference:true}));
 assert.equal($('[data-add-pick]').attr('data-expected-condition'),pickConditionKey(market));
});
test('single-price fallback retains the selected side, exact line and denominator without merging overlapping cohorts',()=>{
 const pattern=analysis(consistent);pattern.scopes.league={n:0,counts:[0,0,0]};
 const chosen=assessPick(event,market,pattern,0,opts);assert.equal(chosen.evidence.basis,'single');assert.equal(chosen.evidence.scope,'league');assert.equal(chosen.evidence.n,200);
 const away=assessPick(event,market,pattern,2,opts);assert.equal(away.evidence.wins,60);assert.ok(away.reasons.includes('market'));
 const total={...market,market:'언오버',line:8.5},archive=rows(consistent).map(r=>({...r,market:'언오버',line:9.5}));
 const analysisOtherLine=analyzePatternEvent(event,total,archive,{includeSequences:false});assert.equal(assessPick(event,total,analysisOtherLine,0,opts).evidence.n,0);
});
test('old matching evidence is held and future or same-day outcomes never contribute',()=>{
 const archive=rows(consistent).map(r=>({...r,date:r.date.replace('2026','2023')}));
 const old=analyzePatternEvent(event,market,archive,{includeSequences:false});assert.ok(assessPick(event,market,old,0,opts).reasons.includes('old'));
 const future=[...rows([0,0,2]),{...rows([0])[0],id:'future',date:'2026-10-15 18:00'},{...rows([0])[0],id:'same',date:'2026-10-14 08:00'}];
 const p=analyzePatternEvent(event,market,future,{includeSequences:false});assert.equal(assessPick(event,market,p,0,opts).evidence.n,3);
});
test('mobile cards label every percentage as historical, expose their exact evidence and escape team content',()=>{
 const pick=assessPick({...event,home:'<img src=x onerror=bad>'},market,analysis(consistent),0,opts),$=load(pickCardView(pick,{reference:true}));
 assert.equal($('img').length,0);assert.match($('h2').text(),/<img/);assert.equal($('.pick-stats>div').length,3);
 assert.match($('.pick-stats').text(),/과거 적중.*뒤 기간 적중.*과거 통계 하한/s);
 assert.equal($('[data-show-evidence]').attr('data-evidence-scope'),pick.evidence.scope);assert.equal($('[data-show-evidence]').attr('data-evidence-basis'),pick.evidence.basis);
 assert.equal($('[data-add-pick]').attr('data-screened-pick'),'reference');assert.equal($('[data-add-pick]').attr('data-expected-odds'),'1.4');
 assert.match(pickLogicView(),/기본 순위를 대체하지 않습니다/);
});
test('reference prices render during analysis, no qualifying history produces an honest empty state, and combinations are examples only',()=>{
 const report=screenPicks([group(market,analysis([0,0,0]))],opts);
 let $=load(pickBoardView(report,{loading:true}));assert.equal($('.pick-card').length,1);assert.match($.text(),/과거 표본을 불러오는 중/);
 $=load(pickBoardView(report,{tab:'candidate'}));assert.equal($('.pick-card').length,0);assert.match($.text(),/모든 기준을 충족한 후보가 없습니다/);
 assert.match(cartSelectionNote(3),/34.3%/);assert.match(cartSelectionNote(3),/설명용 가정/);assert.equal(cartSelectionNote(0),'');
});
test('published replay retains negative evidence, fixed thresholds and coverage alongside the benchmark',()=>{
 const replay=JSON.parse(readFileSync('public/odds-lens/data/pick-policy-replay.json','utf8'));
 assert.equal(replay.policyVersion,PICK_POLICY.version);assert.equal(replay.trainingEnd,'2024-12-31');
 for(const item of Object.values(replay.sports)){
  assert.ok(item.selected.n<=item.baseline.n);assert.equal(item.coverage,item.selected.n/item.baseline.n);
  assert.equal(item.selected.rate,item.selected.n?item.selected.wins/item.selected.n:null);
 }
 assert.ok(replay.sports.baseball.selected.rate<replay.sports.baseball.baseline.rate);
});
