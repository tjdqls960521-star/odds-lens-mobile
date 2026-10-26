import {assessPrediction,canonicalEventId,marketIdentity,selectHighProbability,reasonText} from '../public/odds-lens/prediction-core.mjs';
import {FEATURE_FLAGS,MODEL_REGISTRY,findApprovedModel} from './model-registry.mjs';
import {predictModel} from './model-engine.mjs';
import {hashValue,appendPredictions} from './ledger.mjs';

const publicEvent=e=>({...e,markets:undefined});
function inputRow(event,market){return {eventId:event.id,sport:event.sport,league:event.league,homeId:event.homeId,awayId:event.awayId,market:market.market,period:market.period,line:market.line,outcomeKeys:market.outcomeKeys,odds:market.outcomes.map(o=>o.odds)};}
export async function recordDecisions(env,feed,snapshots,previousFeed){
 const records=[],asOf=feed.fetchedAt;
 const prior=new Map((previousFeed?.events||[]).flatMap(e=>e.markets.map(m=>[m.id,m.prediction])));
 const newSnapshots=new Map((snapshots||[]).map(item=>[item.market.id,item.snapshot]));
 for(const event of feed.events)for(const market of event.markets){
  if(!market.snapshotId||Date.parse(event.startsAt)<=Date.parse(asOf))continue;
  const model=FEATURE_FLAGS.predictionDisplay?findApprovedModel(event,market,asOf):null;
  const policy=model?.policy||null;
  const partial=feed.partial===true;
  const old=prior.get(market.id),oldPartial=old?.decision_context?.partial??old?.reason_codes?.includes('PARTIAL_SOURCE')??false,sameArtifact=old&&old.snapshot_id===market.snapshotId&&(old.model_version??null)===(model?.version??null)&&(old.policy_version??null)===(policy?.version??null)&&(old.evaluation_id??null)===(model?.evaluationId??null)&&oldPartial===partial;
  if(sameArtifact){market.prediction=old;continue;}
  const observedAt=market.snapshotObservedAt||market.observedAt;
  const snapshot=newSnapshots.get(market.id)||{id:market.snapshotId,eventId:event.canonicalEventId||canonicalEventId(event),marketId:market.canonicalMarketId||marketIdentity(event.id,market),offerId:market.id,observedAt,availableAt:observedAt};
  let pModel=null;
  if(model)try{pModel=predictModel(model,inputRow(event,market));}catch{}
  const assessment=assessPrediction({event,market,sourceObservedAt:feed.fetchedAt,partial,asOf,model,policy,pModel});
  const predictionId=await hashValue([snapshot.id,model?.version||'held-v1',policy?.version||null,model?.evaluationId||null,partial]);
  const p={schemaVersion:3,prediction_id:predictionId,event_id:snapshot.eventId,market_id:snapshot.marketId,offer_id:snapshot.offerId,event:publicEvent(event),market:{...market,prediction:undefined},generated_at:asOf,source_observed_at:feed.fetchedAt,price_updated_at:null,prediction_as_of:asOf,snapshot_id:snapshot.id,snapshot_observed_at:snapshot.observedAt,snapshot_available_at:snapshot.availableAt,input_snapshot_hash:market.inputSnapshotHash,decision_context:{partial},train_cutoff:model?.trainCutoff||null,model_version:model?.version||null,calibrator_version:model?.calibratorVersion||null,policy_version:policy?.version||null,model_type:model?.type||null,intervals:null,policy,evaluation_id:model?.evaluationId||null,evidence:model?{tier:model.evidenceTier,quoteStage:model.evidenceStage,artifactHash:model.artifactHash,publicationTier:model.publicationTier,approvalBasis:model.approvalBasis}:null,samples:{trainingEvents:model?.trainEventCount??null,trainingMarkets:model?.trainMarketCount??null,calibrationMarkets:model?.calibrationMarketCount??null,independentEvents:model?.independentEventCount??null,independentMarkets:model?.independentMarketCount??null,rawSimilarCases:null},...assessment};
  records.push(p);market.prediction=p;
 }
 await appendPredictions(env,records);
 return records.length;
}
export function currentPredictions(record,{now=new Date().toISOString()}={}){
 const feed=record.feed,items=[];
 for(const event of feed.events||[])for(const market of event.markets||[]){
  const p=market.prediction,model=FEATURE_FLAGS.predictionDisplay&&p?.model_version?findApprovedModel(event,market,p.prediction_as_of,p):null;
  const normalized={...market,outcomeKeys:market.outcomeKeys||market.outcomes?.map(o=>o.key),availableAt:market.availableAt||market.observedAt};
  const assessment=assessPrediction({event,market:normalized,sourceObservedAt:feed.fetchedAt,sourceError:record.error,partial:feed.partial===true,asOf:now,model,policy:p?.policy,pModel:p?.p_model??null,storageReady:!!p&&!record.ledgerError});
  const item={...p,event_id:event.canonicalEventId||canonicalEventId(event),market_id:market.canonicalMarketId||marketIdentity(event.id,normalized),offer_id:market.id,event:publicEvent(event),market:{...normalized,prediction:undefined},generated_at:now,source_observed_at:feed.fetchedAt,price_updated_at:market.priceUpdatedAt||null,prediction_as_of:p?.prediction_as_of||null,model_version:p?.model_version||null,policy_version:p?.policy_version||null,probability_basis:normalized.probabilityBasis||null,...assessment};
  item.reasons=item.reason_codes.map(reasonText);items.push(item);
 }
 return {schemaVersion:3,generated_at:now,source_observed_at:feed.fetchedAt,price_updated_at:null,flags:FEATURE_FLAGS,storageStatus:record.ledgerError?'unavailable':record.ledgerVersion===3?'ready':'pending',storageError:record.ledgerError||null,predictions:items};
}
export function highProbabilityResponse(record,options={}){
 const current=currentPredictions(record),sport=options.sport||'all';
 const scopedModels=sport==='all'?MODEL_REGISTRY:MODEL_REGISTRY.filter(model=>model.scope.sport===sport);
 const modelAvailable=scopedModels.length>0;
 const policy=scopedModels.map(model=>model.policy).find(item=>item?.approved)||null;
 const policyAvailable=Boolean(policy);
 return {
  ...current,
  flags:{
   ...FEATURE_FLAGS,modelAvailable,policyAvailable,modelSport:sport,
   policyTiers:policy?.tiers||[],policyValidationKind:policy?.validationKind||null,
   policyIndependentValidated:Boolean(policy?.independentValidated),policyVersion:policy?.version||null
  },
  predictions:undefined,
  ...selectHighProbability(policyAvailable?current.predictions:[],options)
 };
}
