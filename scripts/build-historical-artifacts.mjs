#!/usr/bin/env node
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const read=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const base=read('../reports/historical-backtest.json');
const hierarchy=read('../reports/historical-hierarchical-backtest.json');
const closing=base.stages.closing;
const approved=new Set(base.deployment.approved_sports||[]);
const operatingSports=[...approved].filter(sport=>closing.independent_test_2026.sports[sport]);
if(operatingSports.length>1)throw Error(`MULTI_SPORT_REPORT_NOT_SUPPORTED:${operatingSports.join(',')}`);
const operatingSport=operatingSports[0]||null;
const sportPolicy=operatingSport?closing.high_probability_policies[operatingSport]:null;
const policyConfig=base.selection_policy;
if(!policyConfig||!Array.isArray(policyConfig.tiers))throw Error('MISSING_SELECTION_POLICY_CONFIG');

const outcomeKeys=(market,k)=>market==='언오버'?['under','over']:k===3?['home','draw','away']:['home','away'];
const slug=value=>value==='일반'?'general':value==='핸디캡'?'handicap':'total';
const models=[];
for(const [key,parameters] of Object.entries(closing.model.groups)){
 const [sport,market,kText]=key.split('|'),k=Number(kText);
 if(!approved.has(sport))continue;
 const validation=closing.independent_test_2026.markets[key];
 if(!validation)continue;
 models.push({
  id:`${sport}-${slug(market)}-${k}`,sport,market,period:'full',outcomeKeys:outcomeKeys(market,k),
  engine:'power-calibration-v1',type:'M1',quoteStage:'closing',
  approvalBasis:'aggregate-sport-portfolio',
  alpha:parameters.alpha,bias:parameters.bias,temperature:parameters.temperature,
  ridge:parameters.ridge,trainingRows:parameters.training_rows,calibrationRows:parameters.calibration_rows,
  independentRows:validation.M1.n,independentEvents:validation.M1.events,
  metrics:{M0:validation.M0,M1:validation.M1,delta:validation.M0_minus_M1_log_loss,deltaInterval:validation.delta_interval}
 });
}

const compactSelection=selection=>selection?{
 events:selection.events,weeks:selection.weeks,hits:selection.hits,hitRate:selection.hit_rate,
 meanProbability:selection.mean_probability,meanOdds:selection.mean_odds,coverage:selection.coverage,
 eligibleEvents:selection.eligible_events,interval:selection.interval,
 calibrationResidual:selection.calibration_residual,
 calibrationResidualInterval:selection.calibration_residual_interval,
 baselineHitRate:selection.baseline_hit_rate,uplift:selection.uplift,
 upliftInterval:selection.uplift_interval,passes:selection.passes
}:null;
const tierPresentation={
 top:{label:'상위 10% · 최상위 신뢰',metricLabel:'상위 10% 이내 누적'},
 high:{label:'상위 10–20% · 고신뢰 관찰',metricLabel:'상위 20% 이내 누적'}
};
const displayTiers=(sportPolicy?.display_tiers||[]).map(tier=>({
 id:tier.id,label:tierPresentation[tier.id]?.label||tier.label,
 metricLabel:tierPresentation[tier.id]?.metricLabel||tier.label,
 quantile:tier.quantile,threshold:tier.threshold,
 selectedOn2025:Boolean(tier.selected_on_2025),historicallyReproduced:Boolean(tier.historically_reproduced),
 policy2025:compactSelection(tier.policy_2025),replay2026:compactSelection(tier.replay_2026)
}));
const policyEnabled=Boolean(
 operatingSport&&base.deployment.high_confidence_display_enabled&&
 (base.deployment.high_confidence_display_sports||[]).includes(operatingSport)&&displayTiers.length
);
const highProbabilityPolicy={
 approvedForDisplay:policyEnabled,independentValidated:false,
 validationKind:'retrospective-redesign-replay',publicationTier:'research',
 selectionBasis:'historical-result-labels',classificationUnit:'event-best-market-outcome',
 tieBreak:'highest probability, then lexicographically greatest market identity; first outcome index on probability ties',
 oddsFloor:null,policyVersion:policyEnabled?base.policy_version:null,sport:operatingSport,
 tiers:displayTiers,reason:policyEnabled?'RETROSPECTIVE_POLICY_REPLAY':'NO_C_SELECTED_CONFIDENCE_TIER'
};

const artifactBody={
 schemaVersion:2,evaluationId:base.evaluation_id,baseModelVersion:base.model_version,
 createdAt:base.created_at,dataVersion:base.data_version,
 evidenceTier:'historical-archive-chronological',quoteStage:'closing',
 split:{A:'2013–2023-12-24 학습',B:'2024-01-08~12-24 확률 보정',C:'2025-01-08~12-24 분류 경계 고정',D:'2026-01-08~ 후향 재현',embargo:'각 연도 경계 전후 7일 제외'},
 approvedSports:[...approved],models,highProbabilityPolicy,limitations:base.limitations
};
const artifactHash=createHash('sha256').update(JSON.stringify({
 evaluationId:artifactBody.evaluationId,dataVersion:artifactBody.dataVersion,
 evidenceTier:artifactBody.evidenceTier,quoteStage:artifactBody.quoteStage,
 split:artifactBody.split,models:artifactBody.models,highProbabilityPolicy:artifactBody.highProbabilityPolicy
})).digest('hex');
const sourceEvaluationId=artifactBody.evaluationId;
const deploymentEvaluationId=`historical-eval-${artifactHash}`;
const artifact={...artifactBody,sourceEvaluationId,evaluationId:deploymentEvaluationId,artifactHash};
writeFileSync(new URL('../src/historical-models.json',import.meta.url),JSON.stringify(artifact,null,2)+'\n');

const primary=operatingSport?closing.independent_test_2026.sports[operatingSport]:null;
const m2Comparison=operatingSport?hierarchy.comparisons?.['band_0.05']?.test_2026?.[operatingSport]:null;
const m2=m2Comparison?.right||null;
const independentValidationPassed=Boolean(operatingSport&&models.length&&sportPolicy?.model_validated);
const topTier=displayTiers[0]||null;
const report={
 schemaVersion:3,evaluation_id:deploymentEvaluationId,source_evaluation_id:sourceEvaluationId,
 status:independentValidationPassed?(policyEnabled?'model_validated_policy_retrospective':'model_validated_policy_held'):'model_validation_held',
 model_version:base.model_version,policy_version:highProbabilityPolicy.policyVersion,
 modelTrained:Boolean(closing.model),independentValidationPassed,policyIndependentValidationPassed:false,
 reason_codes:[...(policyEnabled?['POLICY_RETROSPECTIVE_ONLY']:['HIGH_POLICY_NOT_APPROVED']),...(m2Comparison&&m2Comparison.left_minus_right_log_loss<=0?['M2_NOT_BETTER']:[])],
 historicalAudit:{
  baselineRows:closing.audit.raw,retainedMarketRows:closing.audit.analysis_rows,
  crossSportQuarantinedRows:closing.audit.sport_league_mismatch,
  duplicateRowsRemoved:closing.audit.duplicate_rows_removed,
  quoteObservationTimestamps:false,resultKnownTimestamps:false,
  scope:`2013~2026 네 종목 과거 파일. 시간순 후향 검증; 운영 모델 승인 범위는 ${operatingSport||'없음'} 최종배당 단계`
 },
 trainingEventCount:null,trainingMarketCount:models.reduce((sum,model)=>sum+model.trainingRows,0),
 independentEventCount:primary?.M1?.events??null,
 metrics:{
  M0:primary?{logLoss:primary.M0.log_loss,brier:primary.M0.brier,eventCount:primary.M0.events,n:primary.M0.n}:null,
  M1:primary?{logLoss:primary.M1.log_loss,brier:primary.M1.brier,eventCount:primary.M1.events,n:primary.M1.n,calibration:primary.M1_calibration}:null,
  M2:m2?{logLoss:m2.log_loss,brier:m2.brier,eventCount:m2.events,n:m2.n,approved:false}:null
 },
 calibration:primary?.M1_calibration||[],
 selectedGroup:topTier?.replay2026?{
  tier:topTier.id,label:topTier.label,hitRate:topTier.replay2026.hitRate,
  coverage:topTier.replay2026.coverage,events:topTier.replay2026.events,
  markets:topTier.replay2026.events,settledEvents:topTier.replay2026.events,
  cancelledEvents:0,voidEvents:0,void:0,reason:'후향 시간순 재현'
 }:{hitRate:null,coverage:0,events:0,markets:0,settledEvents:0,cancelledEvents:0,voidEvents:0,void:0,reason:'C 선택 기준 미충족'},
 modelComparison:operatingSport?`${operatingSport} M1 채택 · M2 추가예측력 미확인`:'승인된 운영 모델 없음',
 operatingModel:operatingSport?'M1':null,
 comparison:{M1vsM0:primary?{mean:primary.M0_minus_M1_log_loss,interval:primary.delta_interval}:null,M2vsM1:m2Comparison?.delta_interval||null},
 scope:{sport:operatingSport,league:'전체',markets:models.map(model=>`${model.market}/${model.outcomeKeys.length}결과`),period:'full',quoteStage:'closing'},
 horizon:'과거 최종배당 열 기준 후향 검증. 현재 판매 중 배당은 최종배당 단계 대리값',
 brierConvention:'모든 결과의 제곱오차 합 (결과 수로 나누지 않음)',
 policy:{...highProbabilityPolicy,approved:policyEnabled,policyTiers:displayTiers},
 policyTiers:displayTiers,split:artifact.split,
 limitations:[
  '과거 파일에는 개별 배당 관측시각·결과 확인시각·원본 시간대가 없어 고정된 경기 전 시점 성능을 주장하지 않습니다.',
  '현재 판매 중 배당에 표시하는 값은 과거 최종배당 단계에서 검증한 보정식의 연구값입니다.',
  '고신뢰 기준은 2025 구간에서 경기별 최고 모델확률의 상위 10%·20% 경계로 고정했습니다. 2026 결과는 정책 설계 뒤 다시 본 후향 재현이며 새 독립 검증이 아닙니다.',
  '고신뢰는 적중 가능성 분류입니다. 평균 배당이 낮아 수익성이나 기대값 우위를 뜻하지 않습니다.',
  '팀·리그·배당구간 M2는 M1보다 개선되지 않아 비활성화했습니다.'
 ],
 created_at:base.created_at,data_version:base.data_version,
 evaluation_kind:'historical-archive-chronological-model-validation-with-retrospective-policy',artifactHash
};
writeFileSync(new URL('../src/validation-status.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({artifactHash,models:models.map(model=>model.id),evaluationId:deploymentEvaluationId,sourceEvaluationId,policyVersion:highProbabilityPolicy.policyVersion,tiers:displayTiers.map(tier=>({id:tier.id,threshold:tier.threshold}))},null,2));
