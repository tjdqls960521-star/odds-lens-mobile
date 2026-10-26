import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzePatternEvent} from '../public/odds-lens/pattern-board.mjs';
import {statisticalEvidence,statisticalRecommendations} from '../public/odds-lens/statistics-recommendations.mjs';
import {recommendationGrid,patternBoardView,patternReferenceView} from '../public/odds-lens/pattern-ui.mjs';
const event={id:'stats-event',startsAt:'2027-01-01T09:00:00Z',sport:'baseball',league:'KBO',home:'Alpha',away:'Beta',teamNamesVerified:true};
const market={id:'stats-market',market:'언오버',line:8.5,outcomes:[{key:'under',label:'언더',odds:1.7},{key:'over',label:'오버',odds:1.8}]};
const rows=results=>results.map((slot,i)=>({id:String(i),date:new Date(Date.UTC(2024,0,1+i)).toISOString().slice(0,10)+' 18:00',league:'KBO',home:'Alpha',away:'Beta',market:'언오버',line:8.5,closing:[1.7,null,1.8],result:['언더','무','오버'][slot]}));

test('statistics recommend the frequent outcome even when the active sequence points the other way',()=>{
 const archive=rows([...Array.from({length:12},()=>[2,2,2,0]).flat(),2,2,2]);
 const analysis=analyzePatternEvent(event,market,archive);
 assert.ok(analysis.scopes.sport.patterns.some(p=>p.active&&p.slot===0));
 assert.deepEqual(analysis.recommendations.map(r=>r.slot),[2]);
 assert.equal(analysis.recommendations[0].best.wins,39);assert.equal(analysis.recommendations[0].best.n,51);
 assert.equal(analysis.recommendations[0].scopeCount,3);
 const light=analyzePatternEvent(event,market,archive,{includeSequences:false});
 assert.deepEqual(light.recommendations,analysis.recommendations);assert.deepEqual(light.scopes.sport.patterns,[]);
 const changed={...analysis,scopes:Object.fromEntries(Object.entries(analysis.scopes).map(([key,value])=>[key,{...value,patterns:[],recent:[],transition:{}}]))};
 assert.deepEqual(statisticalRecommendations(changed),analysis.recommendations);
 const groups=[{event,markets:[{market,pattern:analysis}]}],cards=recommendationGrid(groups).html;
 assert.match(cards,/과거 적중률/);assert.match(cards,/39\/51건 적중/);assert.doesNotMatch(cards,/3회 연속|pick-pattern|지금 흐름/);
 assert.doesNotMatch(patternBoardView({groups,sourceCurrent:true}),/pattern-board-sequence-cell/);
 assert.match(patternReferenceView(event,market,analysis),/<details class="card reference-patterns"[^>]*>/);
});
test('statistical grades retain small samples as C and require stable larger samples for A/B',()=>{
 assert.equal(statisticalEvidence(rows([0,0,0]),[0,2])[0].grade,'C');
 assert.equal(statisticalEvidence(rows(Array(12).fill(0)),[0,2])[0].grade,'B');
 assert.equal(statisticalEvidence(rows(Array(40).fill(0)),[0,2])[0].grade,'A');
 assert.equal(statisticalEvidence(rows([...Array(28).fill(0),...Array(12).fill(2)]),[0,2])[0].grade,'C');
 assert.deepEqual(statisticalEvidence(rows([0,2,0,2]),[0,2]),[]);
});
test('exact statistical counts keep draws in denominator and do not borrow nearby odds or other lines',()=>{
 const three={...market,market:'일반',line:null,outcomes:[{key:'home',label:'홈 승',odds:1.7},{key:'draw',label:'무',odds:3.3},{key:'away',label:'원정 승',odds:4.2}]};
 const archive=rows([0,0,1,2,0]).map((r,i)=>({...r,market:'일반',line:null,closing:[1.7,3.3,4.2],result:['승','승','무','패','승'][i]}));
 const analysis=analyzePatternEvent(event,three,[...archive,{...archive[0],id:'near',date:'2024-02-01 18:00',closing:[1.71,3.4,4.3]}]);
 const recommendation=analysis.recommendations.find(r=>r.slot===0);assert.equal(recommendation.best.n,5);assert.equal(recommendation.best.wins,3);assert.equal(recommendation.best.rate,.6);
 const totals=analyzePatternEvent(event,market,[...rows([0,0,0]),...rows([2,2,2]).map(r=>({...r,line:9.5,id:'other'+r.id}))]);
 assert.equal(totals.recommendations[0].best.n,3);assert.equal(totals.recommendations[0].slot,0);
});
test('a single-price cohort supports only that result and opposing statistical scopes are explicit',()=>{
 const under=statisticalEvidence(rows([0,0,0]),[0,2]),over=statisticalEvidence(rows([2,2,2]),[0,2]);
 assert.deepEqual(statisticalRecommendations({scopes:{},singlePrice:{0:{sport:{statistics:over}}}}),[]);
 const recommended=statisticalRecommendations({scopes:{sport:{statistics:under},league:{statistics:over}},singlePrice:{}});
 assert.equal(recommended.length,2);assert.ok(recommended.every(r=>r.grade==='C'&&r.conflicting));
});
