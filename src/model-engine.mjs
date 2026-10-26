import {assertVector,assertAsOfInput,marketBaseline,isUtc,kstDate} from '../public/odds-lens/prediction-core.mjs';

export const ENGINE_VERSION='ridge-offset-v1';
export const DEFAULT_PROTOCOL=Object.freeze({version:'prospective-70-v1',target:.7,thresholds:[.7,.75,.8,.85,.9,.95],maxCalibrationError:.05,maxIntervalHalfWidth:.05,minBlocks:16,bootstrapReplicates:1000,seed:28092026,ridgeCandidates:[.01,.1,1],temperatures:[.5,.67,.8,1,1.25,1.5,2],horizonMinutes:60,horizonToleranceMinutes:15});
const sum=xs=>xs.reduce((a,b)=>a+b,0),mean=xs=>xs.length?sum(xs)/xs.length:null;
const softmax=xs=>{const max=Math.max(...xs),e=xs.map(x=>Math.exp(x-max)),s=sum(e);return e.map(x=>x/s);};
const logp=p=>Math.log(Math.max(1e-15,p));
const ll=(p,y)=>-logp(p[y]);
const unique=xs=>[...new Set(xs)];
const byTime=(a,b)=>Date.parse(a.asOf)-Date.parse(b.asOf)||a.eventId.localeCompare(b.eventId)||a.marketId.localeCompare(b.marketId);
export function wilson(wins,n){if(!n)return null;const z=1.959963984540054,p=wins/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;return {lower:Math.max(0,c-h),upper:Math.min(1,c+h)};}
function rng(seed){let s=seed>>>0;return ()=>{s=(1664525*s+1013904223)>>>0;return s/4294967296;};}
function week(row){const d=new Date(row.startAt||row.asOf);return Math.floor(d.getTime()/(7*86400000));}
export function blockInterval(rows,value,{bootstrapReplicates=1000,seed=28092026,minBlocks=8}={}){
 const groups=new Map();for(const row of rows){const k=week(row);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(value(row));}
 const blocks=[...groups.values()];if(blocks.length<minBlocks)return {lower:null,upper:null,blocks:blocks.length,method:'weekly-block-bootstrap',reason:'INSUFFICIENT_BLOCKS'};
 if(new Set(blocks.map(b=>mean(b).toFixed(12))).size<2)return {lower:null,upper:null,blocks:blocks.length,method:'weekly-block-bootstrap',reason:'INSUFFICIENT_OUTCOME_VARIATION'};
 const random=rng(seed),draws=[];for(let i=0;i<bootstrapReplicates;i++){let total=0,n=0;for(let j=0;j<blocks.length;j++){const block=blocks[Math.floor(random()*blocks.length)];total+=sum(block);n+=block.length;}draws.push(total/n);}
 draws.sort((a,b)=>a-b);return {lower:draws[Math.floor(draws.length*.025)],upper:draws[Math.min(draws.length-1,Math.floor(draws.length*.975))],blocks:blocks.length,method:'weekly-block-bootstrap'};
}
export function evaluate(rows,probabilities,{asOf,protocol=DEFAULT_PROTOCOL}={}){
 if(rows.length!==probabilities.length)throw Error('METRIC_LENGTH_MISMATCH');
 const scored=[],excluded={void:0,cancelled:0,unresolved:0,future:0};
 rows.forEach((row,i)=>{
  if(row.resultStatus!=='settled'){excluded[row.resultStatus in excluded?row.resultStatus:'unresolved']++;return;}
  if(!isUtc(row.resultKnownAt)||asOf&&Date.parse(row.resultKnownAt)>Date.parse(asOf)){excluded.future++;return;}
  const p=assertVector(probabilities[i],row.outcomeKeys.length);if(!Number.isInteger(row.y)||row.y<0||row.y>=p.length)throw Error('INVALID_RESULT_OUTCOME');
  scored.push({...row,p,logLoss:ll(p,row.y),brier:sum(p.map((v,k)=>(v-(k===row.y?1:0))**2))});
 });
 const calibration=Array.from({length:10},(_,bin)=>{
  const values=scored.flatMap(row=>row.p.flatMap((p,k)=>Math.min(9,Math.floor(p*10))===bin?[{...row,probability:p,hit:k===row.y?1:0}]:[]));
  const wins=sum(values.map(x=>x.hit)),interval=values.length?blockInterval(values,x=>x.hit,protocol):null;
  return {lower:bin/10,upper:(bin+1)/10,n:values.length,eventCount:unique(values.map(x=>x.eventId)).length,predicted:mean(values.map(x=>x.probability)),observed:mean(values.map(x=>x.hit)),interval};
 });
 return {n:scored.length,eventCount:unique(scored.map(x=>x.eventId)).length,excluded,logLoss:mean(scored.map(x=>x.logLoss)),brier:mean(scored.map(x=>x.brier)),brierConvention:'sum of squared errors across all outcomes; not divided by K',calibration};
}
function scopeMatches(row,scope){return ['sport','league','market','period','rulesetVersion','probabilityBasis'].every(k=>row[k]===scope[k])&&JSON.stringify(row.outcomeKeys)===JSON.stringify(scope.outcomeKeys);}
export function prepareDataset(rows,{scope,protocol=DEFAULT_PROTOCOL,evaluationAsOf}={}){
 const rejected={},eligible=[];const reject=r=>{rejected[r]=(rejected[r]||0)+1;};
 for(const original of rows){
  const row={...original};
  if(row.sourceId!=='betman-official-v1'||row.qualityFlags?.length||!['selling','closed'].includes(row.saleStatus)){reject('UNVERIFIED_OR_UNAVAILABLE_SOURCE');continue;}
  if(isUtc(row.asOf)&&isUtc(row.observedAt)&&Date.parse(row.asOf)-Date.parse(row.observedAt)>120000){reject('STALE_SOURCE');continue;}
  if(!scope||!scopeMatches(row,scope)){reject('OUT_OF_SCOPE');continue;}
  if(!row.eventId||!row.marketId||!row.snapshotId||!row.rawHash||!isUtc(row.startAt)||!row.homeId||!row.awayId){reject('MISSING_IDENTITY_OR_PROVENANCE');continue;}
  if(!row.rulesetVersion||!['unconditional','conditional_nonvoid'].includes(row.probabilityBasis)||!row.labelVerified){reject('UNVERIFIED_RULESET_OR_RESULT');continue;}
  try{assertAsOfInput(row,row.asOf);}catch(error){reject(error.message);continue;}
  const horizon=(Date.parse(row.startAt)-Date.parse(row.asOf))/60000;
  if(!(horizon>0)||Math.abs(horizon-protocol.horizonMinutes)>protocol.horizonToleranceMinutes){reject('OUT_OF_HORIZON');continue;}
  if(!isUtc(row.resultKnownAt)||!isUtc(evaluationAsOf)||Date.parse(row.resultKnownAt)>Date.parse(evaluationAsOf)||Date.parse(row.resultKnownAt)<Date.parse(row.resultStatus==='settled'?row.startAt:row.asOf)){reject('MISSING_OR_FUTURE_RESULT_TIMESTAMP');continue;}
  if(!['settled','void','cancelled'].includes(row.resultStatus)){reject('UNRESOLVED_RESULT');continue;}
  if(!['full','first_half'].includes(row.period)||['핸디캡','언오버','전반_핸디캡','전반_언오버'].includes(row.market)&&(typeof row.line!=='number'||!Number.isFinite(row.line))){reject('MISSING_MARKET_DEFINITION');continue;}
  const baseline=marketBaseline(row.outcomeKeys.map((key,i)=>({key,odds:row.odds?.[i]})),row.outcomeKeys);
  if(!baseline){reject('INCOMPLETE_MARKET');continue;}
  if(row.resultStatus==='settled'&&(!Number.isInteger(row.y)||row.y<0||row.y>=row.outcomeKeys.length)){reject('INVALID_RESULT_OUTCOME');continue;}
  eligible.push({...row,q:baseline.probabilities,horizon});
 }
 // Pick the nearest available snapshot to the pre-registered horizon, once
 // per actual event + market. Round/snapshot duplicates never become labels.
 eligible.sort((a,b)=>Math.abs(a.horizon-protocol.horizonMinutes)-Math.abs(b.horizon-protocol.horizonMinutes)||byTime(a,b));
 const selected=new Map();for(const row of eligible){const key=row.eventId+'|'+row.marketId;if(selected.has(key)){reject('DUPLICATE_EVENT_MARKET');continue;}selected.set(key,row);}
 return {rows:[...selected.values()].sort(byTime),rejected};
}
export function chronologicalSplit(rows,boundaries){
 const ends=['trainEnd','calibrationEnd','policyEnd','testEnd'].map(k=>boundaries[k]);
 if(ends.some(t=>!isUtc(t))||ends.some((t,i)=>i&&Date.parse(t)<=Date.parse(ends[i-1])))throw Error('INVALID_CHRONOLOGICAL_BOUNDARIES');
 const groups=new Map();for(const r of rows){if(!groups.has(r.eventId))groups.set(r.eventId,[]);groups.get(r.eventId).push(r);}
 const splits={A:[],B:[],C:[],D:[]},rejected=[];
 for(const [eventId,group] of groups){
  const stage=r=>ends.findIndex(t=>Date.parse(r.asOf)<Date.parse(t)),buckets=unique(group.map(stage));
  if(buckets.length!==1||buckets[0]<0){rejected.push({eventId,reason:'EVENT_CROSSES_SPLIT_BOUNDARY'});continue;}
  const i=buckets[0],end=Date.parse(ends[i]),begin=i?Date.parse(ends[i-1]):-Infinity;
  if(group.some(r=>Date.parse(r.resultKnownAt)>=end||Date.parse(r.asOf)<begin)){rejected.push({eventId,reason:'RESULT_NOT_KNOWN_AT_STAGE_CUTOFF'});continue;}
  splits[['A','B','C','D'][i]].push(...group);
 }
 for(const rows of Object.values(splits))rows.sort(byTime);
 return {splits,rejected,manifest:Object.fromEntries(Object.entries(splits).map(([stage,items])=>[stage,{eventIds:unique(items.map(r=>r.eventId)),marketCount:items.length,firstAsOf:items[0]?.asOf||null,lastAsOf:items.at(-1)?.asOf||null}]))};
}
function features(row,type){
 const q=row.q||marketBaseline(row.outcomeKeys.map((key,i)=>({key,odds:row.odds[i]})),row.outcomeKeys)?.probabilities;
 if(!q)throw Error('INCOMPLETE_MARKET');
 const values={bias:1};q.forEach((p,k)=>{values['logq'+k]=logp(p);values['q2'+k]=p*p;});
 if(type==='M2'){
  values['league:'+row.league]=1;values['home:'+row.homeId]=1;values['away:'+row.awayId]=1;
  values.line=row.line===null?0:Number(row.line)/10;
 }
 return values;
}
function matrix(rows,type,names){return rows.map(r=>{const f=features(r,type);return names.map(name=>f[name]||0);});}
export function fitModel(rows,{type='M1',ridge=.1,trainCutoff,iterations=450}={}){
 if(!rows.length||!isUtc(trainCutoff))throw Error('NO_TRAINING_ROWS');
 if(rows.some(r=>Date.parse(r.resultKnownAt)>=Date.parse(trainCutoff)||r.resultStatus!=='settled'))throw Error('FUTURE_TRAINING_LABEL');
 const names=unique(rows.flatMap(r=>Object.keys(features(r,type)))).sort(),x=matrix(rows,type,names),k=rows[0].outcomeKeys.length;
 const weights=Array.from({length:k-1},()=>names.map(()=>0));
 for(let step=0;step<iterations;step++){
  const gradients=weights.map(w=>w.map(()=>0));
  rows.forEach((row,i)=>{const logits=row.q.map(logp);weights.forEach((w,c)=>{logits[c]+=sum(w.map((v,j)=>v*x[i][j]));});const p=softmax(logits);for(let c=0;c<k-1;c++)for(let j=0;j<names.length;j++)gradients[c][j]+=(p[c]-(row.y===c?1:0))*x[i][j]/rows.length;});
  const learningRate=.12/Math.sqrt(1+step/50);
  for(let c=0;c<k-1;c++)for(let j=0;j<names.length;j++){const penalty=/^(home:|away:|league:)/.test(names[j])?ridge*2:ridge*.05;weights[c][j]-=learningRate*(gradients[c][j]+penalty*weights[c][j]);}
 }
 return {type,engine:ENGINE_VERSION,names,weights,ridge,temperature:1,trainCutoff,trainEventCount:unique(rows.map(r=>r.eventId)).length,trainMarketCount:rows.length,referenceOutcome:k-1,version:null};
}
export function predictModel(model,row){
 const q=row.q||marketBaseline(row.outcomeKeys.map((key,i)=>({key,odds:row.odds[i]})),row.outcomeKeys)?.probabilities;
 if(!q)throw Error('INCOMPLETE_MARKET');
 if(model.engine==='power-calibration-v1'){
  if(!(typeof model.alpha==='number'&&Number.isFinite(model.alpha)&&model.alpha>0)||!(typeof model.temperature==='number'&&Number.isFinite(model.temperature)&&model.temperature>0)||!Array.isArray(model.bias)||model.bias.length!==q.length||model.bias.some(value=>typeof value!=='number'||!Number.isFinite(value)))throw Error('INVALID_POWER_CALIBRATION_MODEL');
  const logits=q.map((probability,index)=>(model.alpha*logp(probability)+model.bias[index])/model.temperature);
  return assertVector(softmax(logits),q.length);
 }
 const f=features({...row,q},model.type),logits=q.map(logp);
 model.weights.forEach((weights,c)=>{logits[c]+=sum(weights.map((v,j)=>v*(f[model.names[j]]||0)));});
 return assertVector(softmax(logits.map(v=>v/model.temperature)),q.length);
}
export function calibrate(model,rows,protocol=DEFAULT_PROTOCOL){
 if(!rows.length)throw Error('NO_CALIBRATION_ROWS');
 let best=null;const trials=[];
 for(const temperature of protocol.temperatures){const candidate={...model,temperature},loss=mean(rows.map(r=>ll(predictModel(candidate,r),r.y)));trials.push({temperature,logLoss:loss});if(!best||loss<best.loss)best={temperature,loss};}
 return {...model,temperature:best.temperature,calibratorVersion:null,calibrationTrials:trials};
}
export function policySummary(rows,probabilities,threshold,protocol=DEFAULT_PROTOCOL){
 const eligible=rows.map((r,i)=>({...r,p:probabilities[i]})).filter(r=>r.saleStatus==='selling');
 // Same display policy as runtime: every qualifying event+market, one
 // outcome per market at thresholds >= .70. Resample whole weeks so every
 // correlated market of an actual event stays together.
 const selected=new Map();for(const row of eligible){const probability=Math.max(...row.p),slot=row.p.indexOf(probability);if(probability<threshold)continue;const key=row.eventId+'|'+row.marketId,old=selected.get(key);if(!old||probability>old.probability||probability===old.probability&&row.marketId<old.marketId)selected.set(key,{...row,probability,hit:slot===row.y?1:0});}
 const all=[...selected.values()],settled=all.filter(r=>r.resultStatus==='settled'),wins=sum(settled.map(r=>r.hit));
 const block=settled.length?blockInterval(settled,r=>r.hit,protocol):null;
 const interval=block?.lower!==null&&block?.lower!==undefined?block:null;
 const rate=mean(settled.map(r=>r.hit)),predicted=mean(settled.map(r=>r.probability));
 return {threshold,selectedEvents:unique(all.map(r=>r.eventId)).length,selectedMarkets:all.length,settledEvents:unique(settled.map(r=>r.eventId)).length,settledMarkets:settled.length,wins,losses:settled.length-wins,voidEvents:all.filter(r=>r.resultStatus==='void').length,cancelledEvents:all.filter(r=>r.resultStatus==='cancelled').length,eligibleEvents:unique(eligible.map(r=>r.eventId)).length,eligibleMarkets:eligible.length,coverage:unique(eligible.map(r=>r.eventId)).length?unique(all.map(r=>r.eventId)).length/unique(eligible.map(r=>r.eventId)).length:0,marketCoverage:eligible.length?all.length/eligible.length:0,hitRate:rate,predicted,calibrationError:rate===null?null:Math.abs(rate-predicted),interval,reason:interval?null:block?.reason||'INSUFFICIENT_VALIDATION',passes:!!interval&&interval.lower>=protocol.target&&(interval.upper-interval.lower)/2<=protocol.maxIntervalHalfWidth&&Math.abs(rate-predicted)<=protocol.maxCalibrationError};
}
export function choosePolicy(rows,probabilities,protocol=DEFAULT_PROTOCOL){
 const trials=protocol.thresholds.filter(t=>t>=protocol.target).map(t=>policySummary(rows,probabilities,t,protocol));
 const best=trials.filter(t=>t.passes).sort((a,b)=>b.coverage-a.coverage||a.threshold-b.threshold)[0];
 return {version:protocol.version,approved:false,threshold:best?.threshold??null,selection:best||null,trials,reason:best?null:'INSUFFICIENT_VALIDATION'};
}
export function promotionDecision({m1Approved,m2Improvement,m2CalibrationPass}){
 const improved=m2Improvement?.mean>0&&m2Improvement?.interval?.lower>0&&m2CalibrationPass;
 return {model:improved&&m1Approved?'M2':m1Approved?'M1':null,m2Promoted:!!(improved&&m1Approved),reason:improved&&m1Approved?'독립 시험 추가예측력 확인':'추가예측력 미확인'};
}
function delta(rows,left,right,protocol){const differences=rows.map((r,i)=>({...r,delta:ll(left[i],r.y)-ll(right[i],r.y)}));return {mean:mean(differences.map(r=>r.delta)),interval:blockInterval(differences,r=>r.delta,protocol)};}
function calibrationPass(metrics,protocol){const supported=metrics.calibration.filter(b=>b.n>=30);return supported.length>0&&supported.every(b=>Math.abs(b.predicted-b.observed)<=protocol.maxCalibrationError);}
export function trainPipeline(input,{scope,boundaries,evaluationAsOf,protocol:overrides={}}={}){
 const protocol={...DEFAULT_PROTOCOL,...overrides};
 if(protocol.thresholds.some(t=>t<protocol.target)||protocol.target<.7)throw Error('INVALID_POLICY_TARGET');
 const prepared=prepareDataset(input,{scope,protocol,evaluationAsOf});
 const split=chronologicalSplit(prepared.rows,boundaries);
 const report={schemaVersion:3,engineVersion:ENGINE_VERSION,createdAt:evaluationAsOf,scope,protocol,boundaries,dataAudit:{inputRows:input.length,eligibleRows:prepared.rows.length,rejected:prepared.rejected,splitRejected:split.rejected},splitManifest:split.manifest,metrics:null,comparison:null,models:null,policies:null,operatingModel:null,status:'held',reasonCodes:[]};
 if(!isUtc(evaluationAsOf)||Date.parse(evaluationAsOf)<Date.parse(boundaries.testEnd)){report.reasonCodes=['FINAL_TEST_NOT_FINISHED'];return report;}
 const {A,B,C,D}=split.splits;
 if([A,B,C,D].some(rows=>rows.filter(r=>r.resultStatus==='settled').length<20)){report.reasonCodes=['INSUFFICIENT_VALIDATION',...(!prepared.rows.length?['MISSING_HISTORY_TIMESTAMP']:[])];return report;}
 const train=A.filter(r=>r.resultStatus==='settled'),calibration=B.filter(r=>r.resultStatus==='settled'),test=D.filter(r=>r.resultStatus==='settled');
 const days=unique(train.map(r=>kstDate(r.asOf))).sort(),innerBoundary=days[Math.floor(days.length*.7)];
 const innerTrain=train.filter(r=>kstDate(r.asOf)<innerBoundary&&kstDate(r.resultKnownAt)<innerBoundary),innerTest=train.filter(r=>kstDate(r.asOf)>=innerBoundary);
 if(!innerTrain.length||!innerTest.length){report.reasonCodes=['INSUFFICIENT_INNER_TEMPORAL_SPLIT'];return report;}
 const models={},trials={};
 for(const type of ['M1','M2']){
  trials[type]=protocol.ridgeCandidates.map(ridge=>{const model=fitModel(innerTrain,{type,ridge,trainCutoff:innerTest[0].asOf});return {ridge,logLoss:mean(innerTest.map(r=>ll(predictModel(model,r),r.y)))};});
  const chosen=[...trials[type]].sort((a,b)=>a.logLoss-b.logLoss||b.ridge-a.ridge)[0];
  models[type]=calibrate(fitModel(train,{type,ridge:chosen.ridge,trainCutoff:boundaries.trainEnd}),calibration,protocol);
 }
 // Everything above and the C policies are frozen before D is evaluated.
 const policies=Object.fromEntries(['M1','M2'].map(type=>[type,choosePolicy(C,C.map(r=>predictModel(models[type],r)),protocol)]));
 const d={M0:test.map(r=>r.q),M1:test.map(r=>predictModel(models.M1,r)),M2:test.map(r=>predictModel(models.M2,r))};
 const metrics=Object.fromEntries(Object.entries(d).map(([type,p])=>[type,evaluate(test,p,{asOf:evaluationAsOf,protocol})]));
 const comparison={M1vsM0:delta(test,d.M0,d.M1,protocol),M2vsM1:delta(test,d.M1,d.M2,protocol)};
 const m1Approved=comparison.M1vsM0.mean>0&&comparison.M1vsM0.interval.lower>0&&calibrationPass(metrics.M1,protocol);
 const promotion=promotionDecision({m1Approved,m2Improvement:comparison.M2vsM1,m2CalibrationPass:calibrationPass(metrics.M2,protocol)});
 for(const type of ['M1','M2']){
  const policy=policies[type];
  policy.independent=policy.threshold===null?null:policySummary(D,D.map(r=>predictModel(models[type],r)),policy.threshold,protocol);
  policy.approved=!!policy.selection?.passes&&!!policy.independent?.passes&&(type==='M1'?m1Approved:promotion.m2Promoted);
 }
 return {...report,status:promotion.model?'validated':'held',reasonCodes:promotion.model?[]:['INSUFFICIENT_VALIDATION'],models,policies,metrics,comparison,modelSelection:{trials,innerBoundary,chosenBeforeFinalTest:true,...promotion},operatingModel:promotion.model,trainingCompleted:true,testCompleted:true,modelApproved:!!promotion.model,policyApproved:promotion.model?policies[promotion.model].approved:false,voidAndCancelled:{C:C.filter(r=>r.resultStatus!=='settled').length,D:D.filter(r=>r.resultStatus!=='settled').length}};
}

// Pre-register every window before the first final-test window. Earlier test
// periods may become later training data, but no event is scored twice in D.
export function walkForward(input,configuration){
 const windows=configuration.windows||[];
 if(!windows.length)throw Error('MISSING_WALK_FORWARD_WINDOWS');
 const seen=new Set(),folds=[];
 for(let i=0;i<windows.length;i++){
  const boundaries=windows[i];
  if(i&&Date.parse(boundaries.policyEnd)<Date.parse(windows[i-1].testEnd))throw Error('OVERLAPPING_FINAL_TEST_WINDOWS');
  const report=trainPipeline(input,{...configuration,boundaries});
  for(const eventId of report.splitManifest.D.eventIds){if(seen.has(eventId))throw Error('DUPLICATE_FINAL_TEST_EVENT');seen.add(eventId);}
  folds.push(report);
 }
 return {engineVersion:ENGINE_VERSION,kind:'walk-forward',folds,independentEventCount:seen.size,allFoldsApproved:folds.every(f=>f.modelApproved===true),status:folds.every(f=>f.modelApproved===true)?'validated':'held'};
}
