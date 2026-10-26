// Probability contracts shared by the Worker, batch pipeline and browser.
// Historical hit-rate helpers intentionally do not enter this module.
export const CONTRACT_VERSION='odds-lens-v3';
export const MAX_SOURCE_AGE_MS=120000;
export const REASONS={
 INSUFFICIENT_VALIDATION:'독립 시험과 선정 정책 검증이 부족합니다.',
 UNSUPPORTED_RULESET:'이 시장의 공식 정산 규칙 버전이 아직 확인되지 않았습니다.',
 UNSUPPORTED_PROBABILITY_BASIS:'무효·환불을 포함한 확률의 의미가 확정되지 않았습니다.',
 MODEL_INFERENCE_FAILED:'모델 계산을 완료하지 못했습니다.', INCOMPLETE_MARKET:'같은 관측본의 전체 결과 배당이 필요합니다.',
 STALE_SOURCE:'최근 공식 조회를 확인하지 못했습니다. 이전 관측값입니다.',
 MISSING_HISTORY_TIMESTAMP:'과거 파일에 배당 관측·결과 확인 시각이 없어 실전 검증에 사용할 수 없습니다.',
 MARKET_SUSPENDED:'공식 발매 중지 항목입니다.', SALE_CLOSED:'발매 종료 · 관찰용입니다.',
 EVENT_STARTED:'이미 시작한 경기입니다.', UNKNOWN_TEAM:'팀 식별자가 확인되지 않았습니다.',
 MODEL_NOT_APPROVED:'이 조건에 승인된 모델이 없습니다.', STORAGE_UNAVAILABLE:'원장 저장을 확인하지 못해 새 예측을 보류합니다.',
 FUTURE_INPUT:'예측 시각 뒤의 정보가 포함되어 차단했습니다.', PARTIAL_SOURCE:'일부 회차 수집이 누락되었습니다.',
 UNKNOWN_EVENT_IDENTITY:'경기 시각 또는 식별 정보 변경을 확인해야 합니다.',
 ARCHIVE_STAGE_PROXY:'현재 배당을 과거 최종배당 단계에서 검증한 보정식에 넣은 연구값입니다.',
 POLICY_RETROSPECTIVE_ONLY:'고신뢰 분류는 2025 기준 고정 후 2026에서 후향 재현한 연구 분류이며 새 독립 표본 검증 전입니다.',
 HIGH_POLICY_NOT_APPROVED:'시간순 모델 검증은 통과했지만 고확률 선정 정책은 승인되지 않았습니다.',
 HIGH_POLICY_NO_SELECTIONS:'이전 고정 기준으로 보류된 과거 기록입니다. 현재 고신뢰 분류에는 사용하지 않습니다.',
 M2_NOT_BETTER:'팀·리그·배당구간 패턴 모델은 배당 보정 모델보다 좋아지지 않아 사용하지 않습니다.'
};
export const reasonText=code=>REASONS[code]||code;
export const isUtc=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value));
export function numberOrNull(value){if(value===null||value===undefined||String(value).trim()==='')return null;const n=Number(value);return Number.isFinite(n)?n:null;}
export function assertVector(vector,size=vector?.length){
 if(!Array.isArray(vector)||![2,3].includes(size)||vector.length!==size||vector.some(p=>typeof p!=='number'||!Number.isFinite(p)||p<0||p>1)||Math.abs(vector.reduce((s,p)=>s+p,0)-1)>1e-8)throw Error('INVALID_PROBABILITY_VECTOR');
 return vector;
}
export function marketBaseline(outcomes,expectedKeys){
 if(!Array.isArray(outcomes)||!Array.isArray(expectedKeys)||![2,3].includes(expectedKeys.length)||outcomes.length!==expectedKeys.length||new Set(expectedKeys).size!==expectedKeys.length)return null;
 if(outcomes.some((o,i)=>o.key!==expectedKeys[i]||typeof o.odds!=='number'||!Number.isFinite(o.odds)||o.odds<=1))return null;
 const booksum=outcomes.reduce((sum,o)=>sum+1/o.odds,0);
 return {probabilities:assertVector(outcomes.map(o=>(1/o.odds)/booksum)),booksum,method:'proportional-v1'};
}
const key=values=>values.map(v=>encodeURIComponent(String(v??'unknown'))).join(':');
export function canonicalEventId(event){
 if(!isUtc(event.startsAt))throw Error('INVALID_START_AT');
 return 'event:'+key([event.sport,event.leagueCode||event.league,event.homeId||event.home,event.awayId||event.away,new Date(event.startsAt).toISOString(),event.doubleheaderNo??'unspecified']);
}
export function marketIdentity(eventId,market){
 return 'market:'+key([eventId,market.market,market.period||'unknown',numberOrNull(market.line),JSON.stringify(market.outcomeKeys||market.outcomes?.map(o=>o.key)||[]),market.rulesetVersion||'unverified',market.officialMarketType||'']);
}
export const compareEvents=(a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt)||String(a.canonicalEventId||a.id).localeCompare(String(b.canonicalEventId||b.id));
export const kstDate=value=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date(value));
export const formatKst=value=>isUtc(value)?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value))+' KST':'시각 미확인';
export function groupFeedEvents(events){
 const grouped=new Map();
 for(const e of events||[]){
  const id=e.canonicalEventId||canonicalEventId(e),prior=grouped.get(id);
  if(!prior)grouped.set(id,{...e,id,canonicalEventId:id,sourceEventIds:[e.id],markets:[...e.markets]});
  else{prior.sourceEventIds.push(e.id);for(const m of e.markets)if(!prior.markets.some(x=>x.id===m.id))prior.markets.push(m);if(e.available){prior.available=true;prior.status='발매 중';}}
 }
 return [...grouped.values()].sort(compareEvents);
}
export function assertAsOfInput(input,asOf){
 if(!isUtc(asOf)||!isUtc(input.availableAt)||!isUtc(input.observedAt)||Date.parse(input.observedAt)>Date.parse(input.availableAt)||Date.parse(input.availableAt)>Date.parse(asOf))throw Error('FUTURE_INPUT');
 if(input.priceUpdatedAt&&(!isUtc(input.priceUpdatedAt)||Date.parse(input.priceUpdatedAt)>Date.parse(asOf)))throw Error('FUTURE_INPUT');
 for(const time of input.featureResultKnownAt||[])if(!isUtc(time)||Date.parse(time)>Date.parse(asOf))throw Error('FUTURE_RESULT_FEATURE');
}
export function assessPrediction({event,market,sourceObservedAt,sourceError=null,partial=false,asOf=new Date().toISOString(),model=null,policy=null,pModel=null,storageReady=true}){
 const reasons=[],now=Date.parse(asOf),baseline=marketBaseline(market.outcomes,market.outcomeKeys),archiveModel=model?.evidenceTier==='historical-archive-chronological';
 if(!baseline||market.saleStatus==='pending'||!['selling','closed','started','suspended','cancelled'].includes(market.saleStatus))reasons.push('INCOMPLETE_MARKET');
 if(!isUtc(sourceObservedAt)||now-Date.parse(sourceObservedAt)>MAX_SOURCE_AGE_MS||sourceError)reasons.push('STALE_SOURCE');
 if(partial)reasons.push('PARTIAL_SOURCE');
 if(!isUtc(event.startsAt)||Date.parse(event.startsAt)<=now)reasons.push('EVENT_STARTED');
 if(market.saleStatus==='suspended'||market.saleStatus==='cancelled')reasons.push('MARKET_SUSPENDED');
 if(market.saleStatus==='closed'||(market.saleClosesAt&&Date.parse(market.saleClosesAt)<=now))reasons.push('SALE_CLOSED');
 if(!event.homeId||!event.awayId)reasons.push('UNKNOWN_TEAM');
 if(market.identityUncertain)reasons.push('UNKNOWN_EVENT_IDENTITY');
 if(!market.rulesetVersion)reasons.push('UNSUPPORTED_RULESET');
 if(!['unconditional','conditional_nonvoid'].includes(market.probabilityBasis))reasons.push('UNSUPPORTED_PROBABILITY_BASIS');
 if(!model?.approved)reasons.push('MODEL_NOT_APPROVED');
 if(!policy?.approved)reasons.push(archiveModel?'HIGH_POLICY_NOT_APPROVED':'INSUFFICIENT_VALIDATION');
 if(archiveModel)reasons.push('ARCHIVE_STAGE_PROXY');
 if(policy?.validationKind==='retrospective-redesign-replay')reasons.push('POLICY_RETROSPECTIVE_ONLY');
 if(policy?.reason==='NO_SELECTIONS_AT_70_AND_1_40')reasons.push('HIGH_POLICY_NO_SELECTIONS');
 if(!model)reasons.push('MISSING_HISTORY_TIMESTAMP');
 if(!storageReady)reasons.push('STORAGE_UNAVAILABLE');
 if(model?.approved&&pModel===null)reasons.push('MODEL_INFERENCE_FAILED');
 try{assertAsOfInput({availableAt:market.availableAt||market.observedAt,observedAt:market.observedAt,priceUpdatedAt:market.priceUpdatedAt},asOf);}catch{reasons.push('FUTURE_INPUT');}
 const archiveResearchPolicy=Boolean(archiveModel&&policy?.approved&&policy?.selectionBasis==='historical-result-labels');
 const displayAdvisories=['SALE_CLOSED','INSUFFICIENT_VALIDATION','HIGH_POLICY_NOT_APPROVED','ARCHIVE_STAGE_PROXY','POLICY_RETROSPECTIVE_ONLY','HIGH_POLICY_NO_SELECTIONS',...(archiveModel?['UNSUPPORTED_RULESET','UNSUPPORTED_PROBABILITY_BASIS']:[])];
 const displayBlockers=reasons.filter(r=>!displayAdvisories.includes(r));
 const p=displayBlockers.length||pModel===null?null:assertVector(pModel,baseline?.probabilities.length);
 // The archive classifier is a research display based on historical result
 // labels. Unverified live settlement metadata stays visible as an advisory;
 // it is never described as an independently validated production policy.
 const researchAdvisories=archiveResearchPolicy?['ARCHIVE_STAGE_PROXY','POLICY_RETROSPECTIVE_ONLY','UNSUPPORTED_RULESET','UNSUPPORTED_PROBABILITY_BASIS']:['ARCHIVE_STAGE_PROXY'];
 const selectionBlockers=reasons.filter(r=>!researchAdvisories.includes(r));
 const eligible=!!p&&!!policy?.approved&&selectionBlockers.length===0;
 const observationEligible=!!p&&!!policy?.approved&&selectionBlockers.every(r=>r==='SALE_CLOSED');
 return {p_market:baseline?.probabilities??null,p_model:p,booksum:baseline?.booksum??null,probability_basis:market.probabilityBasis||null,eligibility:eligible?'eligible':observationEligible?'observation':'held',reason_codes:[...new Set(reasons)],data_status:reasons.includes('STALE_SOURCE')?'stale':baseline?'complete':'incomplete'};
}
export function confidenceTier(policy,probability){
 if(!policy?.approved||!Array.isArray(policy.tiers)||!Number.isFinite(probability))return null;
 return [...policy.tiers].filter(tier=>Number.isFinite(Number(tier.threshold))).sort((a,b)=>Number(b.threshold)-Number(a.threshold)).find(tier=>probability>=Number(tier.threshold))||null;
}
function argmaxFirst(values){
 let index=0;
 for(let i=1;i<values.length;i++)if(values[i]>values[index])index=i;
 return index;
}
function eventMarketRank(p){
 const line=p.market.market==='일반'?'None':String(p.market.line??'None');
 return `${p.market.market}|${line}`;
}
export function selectHighProbability(predictions,{includeClosed=false,now=Date.now(),date='all',league='all',market='all',sport='all'}={}){
 const latestMarket=new Map();
 for(const p of predictions||[]){
  if(!p.p_model||!p.policy?.approved||!['eligible','observation'].includes(p.eligibility)||Date.parse(p.event.startsAt)<=now||now-Date.parse(p.source_observed_at)>MAX_SOURCE_AGE_MS)continue;
  if(date!=='all'&&kstDate(p.event.startsAt)!==date||league!=='all'&&p.event.league!==league||sport!=='all'&&p.event.sport!==sport)continue;
  const prior=latestMarket.get(p.market_id);
  if(!prior||Date.parse(p.source_observed_at)>Date.parse(prior.source_observed_at)||Date.parse(p.source_observed_at)===Date.parse(prior.source_observed_at)&&String(p.offer_id||'')>String(prior.offer_id||''))latestMarket.set(p.market_id,p);
 }
 const eventBest=new Map();
 for(const p of latestMarket.values()){
  const index=argmaxFirst(p.p_model),probability=Number(p.p_model[index]);
  const tier=confidenceTier(p.policy,probability);
  if(!tier)continue;
  const candidate={...p,picks:[{outcome:p.market.outcomes[index],outcomeIndex:index,probability,p_market:p.p_market?.[index]??null,tier:{id:tier.id,label:tier.label,threshold:Number(tier.threshold)}}]};
  const rank=eventMarketRank(p),prior=eventBest.get(p.event_id);
  if(!prior||probability>prior.probability||probability===prior.probability&&rank>prior.rank)eventBest.set(p.event_id,{probability,rank,candidate});
 }
 const events=[];
 for(const {candidate} of eventBest.values()){
  if(!includeClosed&&candidate.eligibility==='observation')continue;
  // Market filtering happens after the event-best choice. Narrowing the UI
  // cannot create a different candidate that the frozen policy did not pick.
  if(market!=='all'&&candidate.market.market!==market)continue;
  events.push({...candidate.event,id:candidate.event_id,markets:[candidate],confidenceTier:candidate.picks[0].tier});
 }
 events.sort(compareEvents);
 return {events,eventCount:events.length,marketCount:events.length};
}
export function settlement(raw,outcomeKeys,market=null){
 const text=String(raw||'').trim();
 if(['취소','경기취소','취소경기'].includes(text))return {status:'cancelled',outcome:null};
 if(['적특','적중특례','무효','환불'].includes(text))return {status:'void',outcome:null};
 const outcome=market==='승1패'&&['1','①'].includes(text)?'draw':({승:'home',핸디승:'home',무:'draw',핸디무:'draw',패:'away',핸디패:'away',언더:'under',오버:'over'})[text];
 if(!outcome)return {status:'unresolved',outcome:null};
 if(!outcomeKeys?.includes(outcome))return {status:'unsupported',outcome:null};
 return {status:'settled',outcome};
}
