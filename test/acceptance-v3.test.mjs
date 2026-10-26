import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {marketBaseline,assertVector,assessPrediction,assertAsOfInput,canonicalEventId,marketIdentity,groupFeedEvents,selectHighProbability,confidenceTier,settlement,formatKst} from '../public/odds-lens/prediction-core.mjs';
import {parseFeed} from '../src/betman-feed.mjs';
import {preserveCollection,appendPredictions,appendResultRevisions,evidence,ledgerSummary,hashValue} from '../src/ledger.mjs';
import {recordDecisions,currentPredictions} from '../src/prediction-service.mjs';
import {prepareDataset,chronologicalSplit,fitModel,predictModel,calibrate,evaluate,promotionDecision,choosePolicy,DEFAULT_PROTOCOL,trainPipeline} from '../src/model-engine.mjs';
import {MODEL_REGISTRY,FEATURE_FLAGS,findApprovedModel} from '../src/model-registry.mjs';
import {makeTarget,matchHistorical,selectedStats} from '../public/odds-lens/live-core.mjs';
import {highProbabilityView,predictionPanel,evidenceView} from '../public/odds-lens/prediction-ui.mjs';

// Test-only fabricated inputs, never imported by the public app or reports.
const now='2026-09-28T00:00:00.000Z';
const event={id:'test-event',sport:'soccer',league:'TEST',leagueCode:'TEST',homeId:'H',awayId:'A',home:'테스트 홈',away:'테스트 원정',startsAt:'2026-09-28T01:00:00.000Z',available:true};
const market={id:'test-offer',market:'일반',period:'full',line:null,outcomeKeys:['home','draw','away'],outcomes:[{key:'home',label:'홈 승',odds:1.4},{key:'draw',label:'무',odds:4},{key:'away',label:'원정 승',odds:6}],observedAt:now,availableAt:now,priceUpdatedAt:null,saleStatus:'selling',saleClosesAt:'2026-09-28T00:59:00.000Z',status:'발매 중',rulesetVersion:'test-only',probabilityBasis:'conditional_nonvoid',available:true};
const assessment=patch=>assessPrediction({event,market,sourceObservedAt:now,asOf:now,...patch});
const config={scope:{sport:'soccer',league:'TEST',market:'일반',period:'full',rulesetVersion:'test-only',probabilityBasis:'conditional_nonvoid',outcomeKeys:['home','draw','away']},boundaries:{trainEnd:'2020-05-01T00:00:00Z',calibrationEnd:'2020-08-01T00:00:00Z',policyEnd:'2020-11-01T00:00:00Z',testEnd:'2021-02-01T00:00:00Z'},evaluationAsOf:'2021-02-02T00:00:00Z'};
function trainingRow(i=0){const asOf=new Date(Date.UTC(2020,0,1+i,10)).toISOString(),startAt=new Date(Date.parse(asOf)+3600000).toISOString();return {...config.scope,sourceId:'betman-official-v1',saleStatus:'selling',eventId:'e'+i,marketId:'m'+i,snapshotId:'s'+i,rawHash:'test-only',homeId:'h'+i%4,awayId:'a'+i%5,asOf,observedAt:asOf,availableAt:asOf,startAt,odds:[2,3,4],resultKnownAt:new Date(Date.parse(startAt)+10800000).toISOString(),resultStatus:'settled',labelVerified:true,y:i%5===0?2:0,line:null};}
function database(){const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync('drizzle/'+file,'utf8'));
 const prepare=(sql,args=[])=>({bind:(...values)=>prepare(sql,values),all:async()=>({results:sqlite.prepare(sql).all(...args)}),first:async()=>sqlite.prepare(sql).get(...args)||null,run:async()=>({meta:sqlite.prepare(sql).run(...args)})});return {sqlite,DB:{prepare,batch:async statements=>Promise.all(statements.map(s=>s.run()))}};}

test('AC01: M0 probability vectors for two/three outcomes sum to one; invalid vectors are rejected',()=>{
 assertVector(marketBaseline(market.outcomes,market.outcomeKeys).probabilities);
 assertVector(marketBaseline([{key:'under',odds:1.7},{key:'over',odds:2.1}],['under','over']).probabilities);
 for(const v of [[-.1,1.1],[.2,.2],[1,NaN],[1,0,undefined]])assert.throws(()=>assertVector(v));
 assert.equal(marketBaseline(market.outcomes.slice(0,2),market.outcomeKeys),null);
});
test('AC02: 3/3, 4/4, 5/5 archive successes confer neither model probability nor high-probability eligibility',()=>{
 for(const n of [3,4,5]){const p=assessment({historicalRate:1,historicalSamples:n});assert.equal(p.p_model,null);assert.equal(p.eligibility,'held');}
});
test('AC03: rounds/snapshots do not inflate actual events or cross chronological partitions',()=>{
 const a={...event,markets:[market]},b={...event,id:'other-round',markets:[{...market,id:'other-offer'}]};
 assert.equal(groupFeedEvents([a,b]).length,1);assert.equal(groupFeedEvents([a,b])[0].markets.length,2);
 assert.equal(groupFeedEvents([a,{...b,startsAt:'2026-09-28T04:00:00Z'}]).length,2);
 const rows=[...Array.from({length:360},(_,i)=>trainingRow(i)),trainingRow(10),{...trainingRow(10),snapshotId:'later'}];
 const prepared=prepareDataset(rows,{...config});assert.equal(prepared.rows.length,360);assert.equal(prepared.rejected.DUPLICATE_EVENT_MARKET,2);
 const {splits}=chronologicalSplit(prepared.rows,config.boundaries),ids=Object.values(splits).flat().map(r=>r.eventId);assert.equal(ids.length,new Set(ids).size);
});
test('AC04: future prices, feature results, and labels past train cutoff are blocked separately',()=>{
 assert.throws(()=>assertAsOfInput({availableAt:'2026-09-28T00:01:00Z',observedAt:now},now),/FUTURE_INPUT/);
 assert.throws(()=>assertAsOfInput({availableAt:now,observedAt:now,featureResultKnownAt:['2026-09-29T00:00:00Z']},now),/FUTURE_RESULT_FEATURE/);
 const row=prepareDataset([trainingRow()],config).rows[0];assert.ok(row); // outcome after its own forecast is normal
 assert.throws(()=>fitModel([row],{trainCutoff:row.asOf}),/FUTURE_TRAINING_LABEL/);
});
test('AC05: signed lines, periods, outcome sets and draw/void/cancellation remain distinct',()=>{
 const variants=[{...market,market:'핸디캡',line:2.5},{...market,market:'핸디캡',line:-2.5},{...market,market:'언오버',line:7.5},{...market,market:'언오버',line:8.5},{...market,period:'first_half'},{...market,outcomeKeys:['home','away']},market];
 assert.equal(new Set(variants.map(m=>marketIdentity('event',m))).size,variants.length);
 assert.deepEqual(settlement('핸디무',market.outcomeKeys),{status:'settled',outcome:'draw'});
 assert.equal(settlement('적특',['under','over']).status,'void');assert.equal(settlement('취소',market.outcomeKeys).status,'cancelled');assert.equal(settlement('-',market.outcomeKeys).status,'unresolved');
 const target=makeTarget(event,market),rows=['승','무','패'].map((result,i)=>({id:String(i),market:'일반',closing:[1.4,4,6],result}));assert.equal(selectedStats(rows,target,0).rate,1/3);
 const lineTarget=makeTarget(event,{...market,market:'언오버',line:7.5,outcomes:[{key:'under',odds:1.7},{key:'over',odds:1.8}]});
 const cases=[{id:'line',date:'2026-09-20',market:'언오버',openingLine:7.5,line:8.5,opening:[1.7,null,1.8],closing:[1.7,null,1.8]}];
 assert.equal(matchHistorical(cases,lineTarget,{stage:'opening'}).length,1);assert.equal(matchHistorical(cases,lineTarget,{stage:'closing'}).length,0);
});
test('AC06: absolute sort order and displayed KST are identical across device timezones',()=>{
 const code=`import {compareEvents,formatKst} from './public/odds-lens/prediction-core.mjs';console.log(JSON.stringify([{id:'b',startsAt:'2026-09-28T16:00:00Z'},{id:'a',startsAt:'2026-09-28T15:00:00Z'}].sort(compareEvents).map(x=>[x.id,formatKst(x.startsAt)])))`;
 const outputs=['UTC','America/Los_Angeles','Asia/Seoul'].map(TZ=>spawnSync(process.execPath,['--input-type=module','-e',code],{env:{...process.env,TZ},encoding:'utf8'}).stdout);
 assert.equal(new Set(outputs).size,1);assert.match(outputs[0],/KST/);
});
test('AC07: stale, partial, missing outcomes and suspended offers fail closed with explicit reasons',()=>{
 for(const [patch,code] of [[{sourceObservedAt:'2026-09-27T23:00:00Z'},'STALE_SOURCE'],[{partial:true},'PARTIAL_SOURCE'],[{market:{...market,outcomes:market.outcomes.slice(0,2)}},'INCOMPLETE_MARKET'],[{market:{...market,saleStatus:'suspended'}},'MARKET_SUSPENDED']]){const p=assessment(patch);assert.equal(p.p_model,null);assert.ok(p.reason_codes.includes(code));}
});
test('AC08: no qualified selection displays a real empty state without a lower fallback threshold',()=>{
 const result=selectHighProbability([]);assert.equal(result.eventCount,0);const html=highProbabilityView({...result,flags:{predictionDisplay:false,modelAvailable:false,modelSport:'soccer'}});assert.match(html,/현재 기준을 통과한 경기가 없습니다/);assert.doesNotMatch(html,/73\.6/);
 const baseball=highProbabilityView({...result,flags:{predictionDisplay:false,modelAvailable:false,modelSport:'baseball'}});assert.match(baseball,/야구는 시간순 독립시험을 통과한 모델이 없어/);assert.doesNotMatch(baseball,/수익·기대값 추천|2026 결과는 후향 재현/);
 const policy=choosePolicy([trainingRow(),trainingRow(1),trainingRow(2)],[[.9,.05,.05],[.9,.05,.05],[.9,.05,.05]]);assert.equal(policy.approved,false);assert.equal(policy.threshold,null);
});
test('AC09: the frozen classifier keeps one strongest market/outcome per event without an odds floor',()=>{
 const policy={approved:true,tiers:[{id:'top',label:'최상위',threshold:.8},{id:'high',label:'고신뢰',threshold:.7}]};
 const base={event_id:'event',market_id:'general',offer_id:'general-offer',event,market,p_model:[.77,.13,.1],p_market:[.8,.1,.1],source_observed_at:now,policy,eligibility:'eligible'};
 const handicap={...base,market_id:'handicap',offer_id:'handicap-offer',market:{...market,id:'handicap-offer',market:'핸디캡',line:-1.5},p_model:[.82,.1,.08]};
 const r=selectHighProbability([base,handicap],{now:Date.parse(now)});assert.equal(r.eventCount,1);assert.equal(r.marketCount,1);assert.equal(r.events[0].markets[0].picks[0].probability,.82);assert.equal(r.events[0].markets[0].picks[0].tier.id,'top');
 assert.equal(selectHighProbability([base,handicap],{now:Date.parse(now),market:'일반'}).eventCount,0); // filtering cannot manufacture the weaker candidate
 const closed={...base,eligibility:'observation'};assert.equal(selectHighProbability([closed],{now:Date.parse(now)}).eventCount,0);assert.equal(selectHighProbability([closed],{now:Date.parse(now),includeClosed:true}).eventCount,1);
 const belowPolicyOdds={...base,market_id:'below-policy-odds',market:{...market,outcomes:market.outcomes.map((outcome,index)=>index?outcome:{...outcome,odds:1.3})},p_model:[.8,.1,.1]};
 assert.equal(selectHighProbability([belowPolicyOdds],{now:Date.parse(now)}).eventCount,1);
 assert.equal(confidenceTier(policy,.8).id,'top');assert.equal(confidenceTier(policy,.7).id,'high');assert.equal(confidenceTier(policy,.699999),null);
});
test('confidence classifier uses first outcome on a tie and a deterministic market tie break',()=>{
 const policy={approved:true,tiers:[{id:'high',label:'고신뢰',threshold:.5}]};
 const base={event_id:'event',market_id:'general',offer_id:'general',event,market,p_model:[.5,.5,0],p_market:[.5,.4,.1],source_observed_at:now,policy,eligibility:'eligible'};
 const total={...base,market_id:'total',offer_id:'total',market:{...market,id:'total',market:'언더오버',line:2.5,outcomeKeys:['under','over'],outcomes:[{key:'under',label:'언더',odds:1.01},{key:'over',label:'오버',odds:99}]},p_model:[.5,.5],p_market:[.5,.5]};
 const picked=selectHighProbability([base,total],{now:Date.parse(now)}).events[0].markets[0];
 assert.equal(picked.market.market,'일반');assert.equal(picked.picks[0].outcomeIndex,0);assert.equal(picked.picks[0].outcome.key,'home');
});
test('classifier discards an older duplicate offer before choosing the event-best market',()=>{
 const policy={approved:true,tiers:[{id:'high',label:'고신뢰',threshold:.7}]};
 const common={event_id:'event',event,source_observed_at:now,policy,eligibility:'eligible',p_market:[.7,.2,.1]};
 const old={...common,market_id:'same-canonical-market',offer_id:'round-1',market,p_model:[.95,.03,.02],source_observed_at:'2026-09-27T23:59:00.000Z'};
 const latest={...old,offer_id:'round-2',p_model:[.75,.15,.1],source_observed_at:now};
 const total={...common,market_id:'total-canonical-market',offer_id:'total',market:{...market,id:'total',market:'언더오버',line:2.5,outcomeKeys:['under','over'],outcomes:[{key:'under',label:'언더',odds:1.5},{key:'over',label:'오버',odds:2.5}]},p_model:[.8,.2],p_market:[.6,.4]};
 const picked=selectHighProbability([old,latest,total],{now:Date.parse(now)}).events[0].markets[0];
 assert.equal(picked.offer_id,'total');assert.equal(picked.picks[0].probability,.8);
});
test('AC10: source, forecast and result revisions survive losses, voids, cancellation, and model versions',async()=>{
 const {DB,sqlite}=database(),objects=new Map(),env={DB,ODDS_STORE:{put:async(k,v)=>objects.set(k,v)}};
 const e={...event,id:canonicalEventId(event),canonicalEventId:canonicalEventId(event),markets:[{...market,round:'260111',year:'2026',gameNumber:1}]};e.markets[0].canonicalMarketId=marketIdentity(e.id,e.markets[0]);
 const feed={sourceId:'betman-official-v1',fetchedAt:now,rounds:['260111'],events:[e]};
 const saved=await preserveCollection(env,feed,{testOnly:true});await recordDecisions(env,feed,saved.snapshots,null);
 const original=e.markets[0].prediction;assertVector(original.p_model,3);
 const approved={...original,prediction_id:await hashValue('test-model-v1'),model_version:'test-only-v1',p_model:[.7,.2,.1],eligibility:'eligible'};
 await appendPredictions(env,[approved]);assert.throws(()=>sqlite.prepare('UPDATE predictions SET data=?').run('{}'),/immutable/i);
 const restored=await evidence(env,original.prediction_id);assert.deepEqual(restored.prediction.p_model,original.p_model);assert.equal(restored.snapshot.rawHash,saved.rawHash);
 const summary=await ledgerSummary(env);assert.equal(summary.counts.predictions,2);assert.equal(summary.counts.snapshots,1);
 const rows=[{...trainingRow(),y:2},{...trainingRow(1),resultStatus:'void'},{...trainingRow(2),resultStatus:'cancelled'}];
 const a=evaluate(rows,rows.map(()=>[.7,.2,.1]),{asOf:config.evaluationAsOf}),b=evaluate(rows,rows.map(()=>[.7,.2,.1]),{asOf:config.evaluationAsOf});assert.deepEqual(a,b);assert.equal(a.n,1);assert.ok(a.logLoss>2);assert.equal(a.excluded.void,1);assert.equal(a.excluded.cancelled,1);
 const invalid={...approved,prediction_id:'bad',p_model:[1.1,-.1,0]};await assert.rejects(appendPredictions(env,[invalid]),/INVALID_PROBABILITY_VECTOR/);
 sqlite.close();
});
test('AC11: M2 without positive independent improvement keeps the approved M1',()=>{
 for(const mean of [-.05,0,.01]){const p=promotionDecision({m1Approved:true,m2Improvement:{mean,interval:{lower:-.02}},m2CalibrationPass:true});assert.equal(p.model,'M1');assert.equal(p.reason,'추가예측력 미확인');}
 assert.equal(promotionDecision({m1Approved:false,m2Improvement:{mean:.1,interval:{lower:.05}},m2CalibrationPass:true}).model,null);
});
test('engine: regularized M1/M2 fit and joint calibration return coherent vectors; insufficient actual history stays held',()=>{
 const rows=prepareDataset(Array.from({length:90},(_,i)=>trainingRow(i)),config).rows;
 for(const type of ['M1','M2']){const model=fitModel(rows.slice(0,50),{type,trainCutoff:rows[50].asOf,iterations:80});const calibrated=calibrate(model,rows.slice(50,70));const p=predictModel(calibrated,rows[80]);assertVector(p,3);assert.equal(model.weights.length,2);}
 const held=trainPipeline([],config);assert.equal(held.status,'held');assert.equal(held.models,null);assert.equal(held.metrics,null);
});
test('official two-round soccer board merges actual fixtures and preserves every league',()=>{
 const p=JSON.parse(readFileSync('test/fixtures/betman-public.json')),q=structuredClone(p);q.currentLottery.gmTs=260112;
 const f=parseFeed([p,q],new Date('2026-09-21T00:00:00Z')),single=parseFeed([p],new Date('2026-09-21T00:00:00Z'));
 assert.equal(f.events.length,single.events.length);assert.equal(f.events.reduce((s,e)=>s+e.markets.length,0),2*single.events.reduce((s,e)=>s+e.markets.length,0));
 const app=readFileSync('public/odds-lens/app-v2.js','utf8');assert.doesNotMatch(app,/PRIORITY_SOCCER_LEAGUES|isPrioritySoccerEvent/);
});
test('result revisions never cross sports and a corrected result reverting to its earlier value still appends',async()=>{
 const {DB,sqlite}=database(),env={DB,ODDS_STORE:{put:async()=>{}}};
 const e={...event,id:canonicalEventId(event),markets:[{...market,id:'betman-260111-1',round:'260111',year:'2026',gameNumber:1}]};e.markets[0].canonicalMarketId=marketIdentity(e.id,e.markets[0]);
 await preserveCollection(env,{fetchedAt:now,sourceId:'betman-official-v1',rounds:['260111'],events:[e]},{testOnly:true});
 const row={id:'2026-111-1',market:'일반',home:event.home,away:event.away,line:null,result:'승'};
 await appendResultRevisions(env,'baseball',[row],'2026-09-28T03:00:00Z','raw1');
 assert.equal(JSON.parse(sqlite.prepare('SELECT data FROM result_revisions').get().data).marketId,null);
 for(const [i,result] of ['승','패','승'].entries())await appendResultRevisions(env,'soccer',[{...row,result}],`2026-09-28T0${i+3}:00:00Z`,'raw'+i);
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM result_revisions WHERE source_key LIKE ?').get('soccer:%').n,3);
 await appendResultRevisions(env,'soccer',[row],'2026-09-28T06:00:00Z','raw4');
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM result_revisions WHERE source_key LIKE ?').get('soccer:%').n,3);
 sqlite.close();
});
test('archived forecasts retain their saved probability; live storage failure hides it',()=>{
 const p={prediction_id:'x',event,market,p_model:[.87,.08,.05],model_version:'test-only',source_observed_at:now,prediction_as_of:now,reason_codes:[]};
 assert.match(evidenceView({prediction:p,snapshot:{rawHash:'x'},resultRevisions:[]}),/87\.0%/);
 assert.doesNotMatch(predictionPanel(event,{...market,prediction:p},{sourceObservedAt:new Date().toISOString(),storageReady:false}),/87\.0%/);
});
test('server-side current prediction revalidation hides a stored candidate when the ledger failed',()=>{
 const model=findApprovedModel(event,market,now),pModel=predictModel(model,{sport:event.sport,league:event.league,market:market.market,period:market.period,line:market.line,outcomeKeys:market.outcomeKeys,odds:market.outcomes.map(o=>o.odds)});
 const evaluated=assessment({model,policy:model.policy,pModel});
 const prediction={...evaluated,prediction_id:'x',prediction_as_of:now,model_version:model.version,policy_version:model.policy.version,evaluation_id:model.evaluationId,p_model:pModel,policy:model.policy};
 const current=currentPredictions({feed:{fetchedAt:now,partial:false,events:[{...event,markets:[{...market,prediction}]}]},error:null,ledgerError:'test failure'},{now});
 assert.equal(current.predictions[0].p_model,null);assert.equal(current.predictions[0].eligibility,'held');assert.ok(current.predictions[0].reason_codes.includes('STORAGE_UNAVAILABLE'));
});
test('pending offers and failed model inference have explicit hold reasons even with approved artifacts',()=>{
 const approved={model:{approved:true},policy:{approved:true},pModel:[.8,.1,.1]};
 assert.equal(assessment({...approved,market:{...market,saleStatus:'pending'}}).eligibility,'held');
 assert.ok(assessment({...approved,pModel:null}).reason_codes.includes('MODEL_INFERENCE_FAILED'));
});
test('pre-start cancellations remain in evaluation input; an unfinished final test never approves a model',()=>{
 const row={...trainingRow(),resultStatus:'cancelled',y:null,resultKnownAt:new Date(Date.parse(trainingRow().asOf)+1800000).toISOString()};
 assert.equal(prepareDataset([row],config).rows.length,1);
 const report=trainPipeline([], {...config,evaluationAsOf:'2020-12-01T00:00:00Z'});assert.ok(report.reasonCodes.includes('FINAL_TEST_NOT_FINISHED'));
});
test('historical power calibration produces a coherent vector and rejects malformed artifacts',()=>{
 const row={outcomeKeys:['home','draw','away'],odds:[2,4,4]};
 const p=predictModel({engine:'power-calibration-v1',alpha:2,bias:[0,0,0],temperature:1,type:'M1'},row);
 assertVector(p,3);assert.ok(Math.abs(p[0]-2/3)<1e-12);assert.ok(Math.abs(p[1]-1/6)<1e-12);assert.ok(Math.abs(p[2]-1/6)<1e-12);
 assert.throws(()=>predictModel({engine:'power-calibration-v1',alpha:2,bias:[0,0],temperature:1,type:'M1'},row),/INVALID_POWER_CALIBRATION_MODEL/);
 assert.throws(()=>predictModel({engine:'power-calibration-v1',alpha:2,bias:[0,0,0],temperature:0,type:'M1'},row),/INVALID_POWER_CALIBRATION_MODEL/);
});
test('chronologically validated soccer M1 and its retrospective confidence classifier apply across full-time markets',()=>{
 assert.equal(FEATURE_FLAGS.predictionDisplay,true);assert.equal(FEATURE_FLAGS.highProbability,true);
 assert.ok(MODEL_REGISTRY.length>=4);assert.ok(MODEL_REGISTRY.every(model=>model.scope.sport==='soccer'&&model.type==='M1'&&model.policy.approved===true&&model.policy.independentValidated===false&&model.policy.validationKind==='retrospective-redesign-replay'));
 const at='2026-09-28T00:00:00Z',fixture={...event,league:'임의리그',startsAt:'2026-09-29T00:00:00Z'};
 const variants=[
  market,
  {...market,market:'핸디캡',line:-1.5,outcomeKeys:['home','draw','away']},
  {...market,market:'핸디캡',line:2.25,outcomeKeys:['home','away']},
  {...market,market:'언오버',line:3.5,outcomeKeys:['under','over']}
 ];
 for(const item of variants)assert.ok(findApprovedModel(fixture,item,at));
 assert.ok(findApprovedModel({...fixture,startsAt:'2026-09-28T00:30:00Z'},market,at));
 assert.equal(findApprovedModel({...fixture,sport:'baseball'},market,at),null);
 assert.equal(findApprovedModel(fixture,{...market,period:'first_half'},at),null);
 assert.equal(findApprovedModel(fixture,{...market,outcomeKeys:['away','draw','home']},at),null);
});
test('historical M1 stays independently validated while confidence picks are explicitly retrospective research',()=>{
 const model=findApprovedModel(event,market,now),pModel=predictModel(model,inputFor(market));
 function inputFor(item){return {sport:event.sport,league:event.league,market:item.market,period:item.period,line:item.line,outcomeKeys:item.outcomeKeys,odds:item.outcomes.map(o=>o.odds)};}
 const result=assessment({model,policy:model.policy,pModel});
 assertVector(result.p_model,3);assert.equal(result.eligibility,'eligible');
 assert.ok(result.reason_codes.includes('ARCHIVE_STAGE_PROXY'));assert.ok(result.reason_codes.includes('POLICY_RETROSPECTIVE_ONLY'));assert.ok(!result.reason_codes.includes('HIGH_POLICY_NOT_APPROVED'));assert.ok(!result.reason_codes.includes('INSUFFICIENT_VALIDATION'));
 const prediction={...result,prediction_as_of:now,model_version:model.version,policy_version:model.policy.version,evidence:{tier:model.evidenceTier,quoteStage:model.evidenceStage},samples:{trainingMarkets:model.trainMarketCount,independentEvents:model.independentEventCount}};
 const html=predictionPanel(event,{...market,prediction},{sourceObservedAt:now,storageReady:true,historical:true});
 assert.match(html,/시간순 모델 예측/);assert.match(html,/과거 최종배당 단계/);
 const classified=selectHighProbability([{...prediction,event_id:'e',market_id:'m',offer_id:'o',event,market,source_observed_at:now}],{now:Date.parse(now)});assert.ok([0,1].includes(classified.eventCount));
 const empty=highProbabilityView({events:[],eventCount:0,marketCount:0,flags:{...FEATURE_FLAGS,modelAvailable:true,policyAvailable:true,modelSport:'soccer',policyTiers:model.policy.tiers}});assert.match(empty,/현재 공식 배당/);assert.match(empty,/후향 시간순 재현/);assert.doesNotMatch(empty,/2025년과 2026년에 0건/);
 const otherSport=highProbabilityView({events:[],eventCount:0,marketCount:0,flags:{...FEATURE_FLAGS,modelAvailable:false,modelSport:'baseball'}});assert.match(otherSport,/야구는 시간순 독립시험을 통과한 모델이 없어/);assert.doesNotMatch(otherSport,/2025년과 2026년에 0건/);
});
test('archive research selection preserves unverified settlement warnings without hiding the probability tier',()=>{
 const model={approved:true,evidenceTier:'historical-archive-chronological'},policy={approved:true,selectionBasis:'historical-result-labels',validationKind:'retrospective-redesign-replay',tiers:[{id:'high',threshold:.7}]};
 const verified=assessment({model,policy,pModel:[.8,.1,.1]});assert.equal(verified.eligibility,'eligible');assert.ok(verified.reason_codes.includes('ARCHIVE_STAGE_PROXY'));
 const unverified=assessPrediction({event,market:{...market,rulesetVersion:null,probabilityBasis:null},sourceObservedAt:now,asOf:now,model,policy,pModel:[.8,.1,.1]});assert.equal(unverified.eligibility,'eligible');assertVector(unverified.p_model,3);assert.ok(unverified.reason_codes.includes('UNSUPPORTED_RULESET'));assert.ok(unverified.reason_codes.includes('UNSUPPORTED_PROBABILITY_BASIS'));assert.ok(unverified.reason_codes.includes('POLICY_RETROSPECTIVE_ONLY'));
 const formal={...policy,selectionBasis:'verified-settlement'};
 assert.equal(assessPrediction({event,market:{...market,rulesetVersion:null,probabilityBasis:null},sourceObservedAt:now,asOf:now,model,policy:formal,pModel:[.8,.1,.1]}).eligibility,'held');
});
test('generated confidence artifact freezes C thresholds, reports D only as replay, and has no odds floor',()=>{
 const artifact=JSON.parse(readFileSync('src/historical-models.json','utf8'));
 const report=JSON.parse(readFileSync('src/validation-status.json','utf8'));
 const policy=artifact.highProbabilityPolicy;
 assert.equal(policy.approvedForDisplay,true);assert.equal(policy.independentValidated,false);assert.equal(policy.validationKind,'retrospective-redesign-replay');assert.equal(policy.oddsFloor,null);assert.equal(policy.tiers.length,2);
 assert.deepEqual(policy.tiers.map(tier=>tier.id),['top','high']);
 assert.match(policy.tiers[0].metricLabel,/상위 10% 이내 누적/);assert.match(policy.tiers[1].label,/10–20%/);assert.match(policy.tiers[1].metricLabel,/상위 20% 이내 누적/);
 for(const tier of policy.tiers){assert.equal(tier.selectedOn2025,true);assert.equal(tier.historicallyReproduced,true);assert.ok(tier.policy2025.passes);assert.ok(tier.replay2026.passes);assert.ok(tier.threshold>0&&tier.threshold<1);assert.ok(tier.replay2026.events>=100);}
 assert.equal(report.independentValidationPassed,true);assert.equal(report.policyIndependentValidationPassed,false);assert.ok(report.reason_codes.includes('POLICY_RETROSPECTIVE_ONLY'));assert.doesNotMatch(JSON.stringify(policy),/minOdds|1\.40/);
});
test('an unchanged quote is recomputed once when the deployed model identity changes',async()=>{
 const {DB,sqlite}=database(),objects=new Map(),env={DB,ODDS_STORE:{put:async(k,v)=>objects.set(k,v)}};
 const e={...event,id:canonicalEventId(event),canonicalEventId:canonicalEventId(event),markets:[{...market,round:'260111',year:'2026',gameNumber:1}]};e.markets[0].canonicalMarketId=marketIdentity(e.id,e.markets[0]);
 const feed={sourceId:'betman-official-v1',fetchedAt:now,rounds:['260111'],events:[e]};
 const first=await preserveCollection(env,feed,{testOnly:'first'},null),m=e.markets[0],s=first.snapshots[0].snapshot;
 const held=assessPrediction({event:e,market:m,sourceObservedAt:now,asOf:now});
 const old={schemaVersion:3,prediction_id:await hashValue(['old-model',s.id]),event_id:s.eventId,market_id:s.marketId,offer_id:s.offerId,event:{...e,markets:undefined},market:{...m,prediction:undefined},generated_at:now,source_observed_at:now,price_updated_at:null,prediction_as_of:now,snapshot_id:s.id,snapshot_observed_at:s.observedAt,snapshot_available_at:s.availableAt,input_snapshot_hash:m.inputSnapshotHash,train_cutoff:null,model_version:'old-model',calibrator_version:null,policy_version:null,model_type:null,intervals:null,policy:null,evaluation_id:'old-evaluation',samples:{},...held};
 await appendPredictions(env,[old]);m.prediction=old;
 const later='2026-09-28T00:00:30.000Z',next=structuredClone(feed);next.fetchedAt=later;for(const item of next.events[0].markets){item.observedAt=later;item.availableAt=later;}
 const unchanged=await preserveCollection(env,next,{testOnly:'second'},feed);assert.equal(unchanged.snapshots.length,0);
 assert.equal(await recordDecisions(env,next,unchanged.snapshots,feed),1);
 const records=sqlite.prepare('SELECT data FROM predictions ORDER BY as_of,id').all().map(row=>JSON.parse(row.data));assert.equal(records.length,2);assert.equal(new Set(records.map(p=>p.snapshot_id)).size,1);assert.equal(new Set(records.map(p=>p.model_version)).size,2);assert.equal(new Set(records.map(p=>p.prediction_id)).size,2);
 assert.equal(await recordDecisions(env,next,[],next),0);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM predictions').get().n,2);
 sqlite.close();
});
test('an unchanged quote is recomputed when a partial feed recovers',async()=>{
 const {DB,sqlite}=database(),env={DB,ODDS_STORE:{put:async()=>{}}};
 const e={...event,id:canonicalEventId(event),canonicalEventId:canonicalEventId(event),markets:[{...market,round:'260111',year:'2026',gameNumber:1}]};e.markets[0].canonicalMarketId=marketIdentity(e.id,e.markets[0]);
 const partialFeed={sourceId:'betman-official-v1',fetchedAt:now,rounds:['260111'],partial:true,events:[e]};
 const first=await preserveCollection(env,partialFeed,{testOnly:'partial'},null);assert.equal(await recordDecisions(env,partialFeed,first.snapshots,null),1);
 const partialPrediction=e.markets[0].prediction;assert.deepEqual(partialPrediction.decision_context,{partial:true});assert.equal(partialPrediction.p_model,null);assert.ok(partialPrediction.reason_codes.includes('PARTIAL_SOURCE'));
 const recoveredAt='2026-09-28T00:00:30.000Z',recovered=structuredClone(partialFeed);recovered.fetchedAt=recoveredAt;recovered.partial=false;for(const item of recovered.events[0].markets){item.observedAt=recoveredAt;item.availableAt=recoveredAt;}
 const unchanged=await preserveCollection(env,recovered,{testOnly:'recovered'},partialFeed);assert.equal(unchanged.snapshots.length,0);assert.equal(await recordDecisions(env,recovered,unchanged.snapshots,partialFeed),1);
 const recoveredPrediction=recovered.events[0].markets[0].prediction;assert.deepEqual(recoveredPrediction.decision_context,{partial:false});assertVector(recoveredPrediction.p_model,3);assert.notEqual(recoveredPrediction.prediction_id,partialPrediction.prediction_id);
 const records=sqlite.prepare('SELECT data FROM predictions ORDER BY as_of,id').all().map(row=>JSON.parse(row.data));assert.equal(records.length,2);assert.equal(new Set(records.map(p=>p.snapshot_id)).size,1);assert.deepEqual(records.map(p=>p.decision_context.partial),[true,false]);
 assert.equal(await recordDecisions(env,recovered,[],recovered),0);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM predictions').get().n,2);
 sqlite.close();
});
