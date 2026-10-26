import historical from './historical-models.json' with {type:'json'};

// The probability model passed a frozen chronological holdout. The separate
// confidence classifier is explicitly a retrospective research display until
// a new prospective period exists.
export const RULESETS=[];
export const MODEL_REGISTRY=Object.freeze(historical.models.map(entry=>Object.freeze({
 approved:true,publicationTier:'research',evidenceTier:historical.evidenceTier,evidenceStage:entry.quoteStage,artifactHash:historical.artifactHash,
 approvalBasis:entry.approvalBasis||'aggregate-sport-portfolio',
 version:`${historical.baseModelVersion}:${entry.id}`,evaluationId:historical.evaluationId,approvedAt:historical.createdAt,trainCutoff:'2024-01-01T00:00:00Z',
 calibratorVersion:`${historical.baseModelVersion}:temperature:${entry.id}`,engine:entry.engine,type:entry.type,alpha:entry.alpha,bias:entry.bias,temperature:entry.temperature,
 trainMarketCount:entry.trainingRows,trainEventCount:null,calibrationMarketCount:entry.calibrationRows,independentMarketCount:entry.independentRows,independentEventCount:entry.independentEvents,metrics:entry.metrics,
 scope:{sport:entry.sport,league:'*',market:entry.market,period:entry.period,outcomeKeys:entry.outcomeKeys,rulesetVersion:'*',probabilityBasis:'*'},
 protocol:{kind:'historical-archive-chronological',quoteStage:entry.quoteStage,split:historical.split},
 policy:{
  version:historical.highProbabilityPolicy.sport===entry.sport?historical.highProbabilityPolicy.policyVersion:null,
  approved:Boolean(historical.highProbabilityPolicy.approvedForDisplay&&historical.highProbabilityPolicy.sport===entry.sport),
  independentValidated:Boolean(historical.highProbabilityPolicy.independentValidated),
  validationKind:historical.highProbabilityPolicy.validationKind,
  publicationTier:historical.highProbabilityPolicy.publicationTier,
  selectionBasis:historical.highProbabilityPolicy.selectionBasis,
  classificationUnit:historical.highProbabilityPolicy.classificationUnit,
  tieBreak:historical.highProbabilityPolicy.tieBreak,
  oddsFloor:null,tiers:historical.highProbabilityPolicy.tiers,reason:historical.highProbabilityPolicy.reason
 }
})));
export const FEATURE_FLAGS=Object.freeze({historicalLookup:true,predictionDisplay:MODEL_REGISTRY.length>0,patternAdjustment:false,highProbability:Boolean(historical.highProbabilityPolicy.approvedForDisplay),oddsMovement:false,multiMarket:false,advancedModels:false});
export function resolveRuleset(event,market,asOf){
 return RULESETS.find(r=>r.verified===true&&r.sourceUrl&&r.sourceHash&&Date.parse(r.verifiedAt)<=Date.parse(asOf)&&r.sport===event.sport&&r.market===market.market&&r.period===market.period&&(r.officialMarketType==='*'||r.officialMarketType===market.officialMarketType)&&JSON.stringify(r.outcomeKeys)===JSON.stringify(market.outcomeKeys)&&['unconditional','conditional_nonvoid'].includes(r.probabilityBasis))||null;
}
export function modelApplies(m,event,market,asOf,identity=null){
 const scope=m.scope,horizon=(Date.parse(event.startsAt)-Date.parse(asOf))/60000;
 if(!m.approved||!m.version||!m.evaluationId||!scope||!m.protocol||!Number.isFinite(horizon))return false;
 if(identity&&(m.version!==identity.model_version||(m.policy?.version??null)!==(identity.policy_version??null)||m.evaluationId!==identity.evaluation_id))return false;
 if(!(Date.parse(m.approvedAt)<=Date.parse(asOf))||!(Date.parse(m.trainCutoff)<Date.parse(asOf)))return false;
 if(JSON.stringify(scope.outcomeKeys)!==JSON.stringify(market.outcomeKeys))return false;
 if(scope.sport!==event.sport||scope.market!==market.market||scope.period!==market.period)return false;
 if(scope.league!=='*'&&scope.league!==event.league)return false;
 if(['핸디캡','언오버'].includes(market.market)&&(typeof market.line!=='number'||!Number.isFinite(market.line)))return false;
 if(scope.rulesetVersion&&scope.rulesetVersion!=='*'&&scope.rulesetVersion!==market.rulesetVersion)return false;
 if(scope.probabilityBasis&&scope.probabilityBasis!=='*'&&scope.probabilityBasis!==market.probabilityBasis)return false;
 if(m.protocol.kind!=='historical-archive-chronological'&&Math.abs(horizon-m.protocol.horizonMinutes)>m.protocol.horizonToleranceMinutes)return false;
 return true;
}
export function findApprovedModel(event,market,asOf,identity=null){
 return MODEL_REGISTRY.find(m=>modelApplies(m,event,market,asOf,identity))||null;
}
