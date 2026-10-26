import {makeTarget,wilson95} from './live-core.mjs?v=20261005-3';

// An explicit statistical estimate for comparison with the offered price.
// No fitted/backtested hit-rate classifier and no lowest-price restriction.
export const VALUE_POLICY=Object.freeze({version:'statistical-value-1',priorWeight:20,minimumEstimate:3,minimumRecommend:12,maxQuoteAgeMs:120000});
const scopes={league:'같은 리그',sport:'같은 종목'};
const validMarket=m=>['일반','핸디캡','언오버','승1패'].includes(m?.market)&&(!m.period||m.period==='full')&&[2,3].includes(m.outcomes?.length)&&m.outcomes.every(o=>typeof o.key==='string'&&o.key&&Number.isFinite(o.odds)&&o.odds>1)&&new Set(m.outcomes.map(o=>o.key)).size===m.outcomes.length&&(!['핸디캡','언오버'].includes(m.market)||(m.line!==null&&m.line!==undefined&&m.line!==''&&Number.isFinite(Number(m.line))));
function validSummary(summary,slots){
 return summary?.n>0&&Array.isArray(summary.counts)&&slots.every(slot=>Number.isInteger(summary.counts[slot])&&summary.counts[slot]>=0)&&slots.reduce((n,slot)=>n+summary.counts[slot],0)===summary.n;
}
// Fix a cohort per selection. A single-price sample MUST match that selection;
// conditioning on draw odds cannot estimate a differently priced home win.
export function valueCohort(pattern,selections,selection){
 const slots=selections.map(s=>s.slot),options=[];
 for(const scope of ['league','sport']){
  options.push({scope,basis:'combo',anchorSlot:null,summary:pattern?.scopes?.[scope]});
  options.push({scope,basis:'single',anchorSlot:selection.slot,anchorLabel:selection.label,anchorOdds:selection.odds,summary:pattern?.singlePrice?.[selection.slot]?.[scope]});
 }
 const valid=options.filter(o=>validSummary(o.summary,slots));
 return valid.find(o=>o.summary.n>=VALUE_POLICY.minimumRecommend)||valid.sort((a,b)=>b.summary.n-a.summary.n)[0]||null;
}
export function valueAvailability(event,market,{now=Date.now(),sourceCurrent=true}={}){
 const observed=Date.parse(market?.observedAt),start=Date.parse(event?.startsAt);
 if(!Number.isFinite(start)||start<=now)return {code:'started',label:'시작·종료 · 분석 대상 아님',canAdd:false};
 if(market?.pending||!market?.outcomes?.length)return {code:'pending',label:'배당 발표 대기',canAdd:false};
 if(!validMarket(market))return {code:'invalid',label:'배당·기준점 확인 필요',canAdd:false};
 if(['suspended','cancelled'].includes(market.saleStatus))return {code:'suspended',label:'판매 중지 · 참고 분석',canAdd:false};
 if(!sourceCurrent||!Number.isFinite(observed)||now-observed>VALUE_POLICY.maxQuoteAgeMs||observed>now+30000)return {code:'stale',label:'갱신 필요 · 마지막 확인 배당',canAdd:false};
 if(market.saleStatus!=='selling'||market.available===false||(market.saleClosesAt&&Date.parse(market.saleClosesAt)<=now))return {code:'closed',label:'판매 종료 · 참고 분석',canAdd:false};
 return {code:'selling',label:'판매 중',canAdd:true};
}
function estimate(summary,slot,prior){return (summary.counts[slot]+VALUE_POLICY.priorWeight*prior)/(summary.n+VALUE_POLICY.priorWeight);}
export function analyzeValueMarket(event,market,pattern,options={}){
 const availability=valueAvailability(event,market,options);
 if(!validMarket(market)||market.pending||availability.code==='started')return [];
 const selections=makeTarget(event,market).selections,booksum=selections.reduce((sum,s)=>sum+1/s.odds,0);
 const estimates=selections.map(selection=>{
  const chosen=valueCohort(pattern,selections,selection),summary=chosen?.summary,n=summary?.n||0,prior=(1/selection.odds)/booksum;
  return {chosen,summary,n,raw:n>=VALUE_POLICY.minimumEstimate?estimate(summary,selection.slot,prior):prior};
 });
 // Independent conditional frequency estimates are projected onto the simplex.
 // This is a declared estimation rule, not a calibrated posterior probability.
 const normalization=estimates.reduce((sum,e)=>sum+e.raw,0),probabilities=estimates.map(e=>e.raw/normalization),complete=estimates.every(e=>e.n>=VALUE_POLICY.minimumEstimate);
 return selections.map((selection,index)=>{
  const {chosen,summary,n,raw}=estimates[index],slot=selection.slot,breakEven=1/selection.odds,marketReference=breakEven/booksum,wins=summary?.counts[slot]||0;
  const probability=n>=VALUE_POLICY.minimumEstimate?probabilities[index]:null;
  const edge=probability===null?null:probability-breakEven,expectedReturn=probability===null?null:probability*selection.odds-1;
  const interval=n?wilson95(wins,n):null,period=summary?.statistics?.find(s=>s.slot===slot),cautions=[];
  if(n<VALUE_POLICY.minimumRecommend)cautions.push(n?'소표본 · 추천 전 추가 확인':'일치 표본 없음');
  if(!complete)cautions.push('다른 선택지 표본 부족 · 시장 비중 보완');
  if(period?.train?.n&&period?.test?.n&&period.test.rate<period.train.rate-.15)cautions.push('뒤 기간 빈도 하락');
  const last=Date.parse(String(summary?.dateRange?.last||'').slice(0,10)+'T00:00:00+09:00');
  if(n&&Number.isFinite(last)&&(options.now??Date.now())-last>365*86400000)cautions.push('최근 1년 일치 표본 없음');
  // Supporting/contradicting summaries are explanatory only; never add their
  // overlapping counts or silently pick whichever has the most flattering rate.
  const checks=[];
  for(const scope of ['league','sport','homeTeam','awayTeam']){
   const other=pattern?.scopes?.[scope];
   if(!validSummary(other,selections.map(s=>s.slot))||other.n<12)continue;
   const otherProbability=estimate(other,slot,marketReference);
   checks.push({scope,n:other.n,probability:otherProbability,edge:otherProbability-breakEven});
  }
  if(edge>0&&checks.some(c=>c.edge<-.05))cautions.push('다른 통계 범위와 결론 차이');
  const isValue=edge!==null&&edge>1e-10&&n>=VALUE_POLICY.minimumRecommend&&complete;
  return {id:`${event.id}:${market.id}:${slot}`,event,market,selection,slot,availability,probability,probabilities,rawProbability:raw,normalization,breakEven,marketReference,edge,expectedReturn,isValue,
   strength:isValue?'estimated':n>=3?'comparison':'missing',
   evidence:{scope:chosen?.scope,scopeLabel:scopes[chosen?.scope]||'비교 표본',basis:chosen?.basis,anchorSlot:chosen?.anchorSlot,anchorLabel:chosen?.anchorLabel,anchorOdds:chosen?.anchorOdds,n,wins,rate:n?wins/n:null,interval,dateRange:summary?.dateRange||null,period},cautions,checks,policyVersion:VALUE_POLICY.version};
 });
}
const numberOrBottom=x=>Number.isFinite(x)?x:-Infinity;
export function compareValuePicks(a,b){
 return Number(b.isValue)-Number(a.isValue)||numberOrBottom(b.edge)-numberOrBottom(a.edge)||b.evidence.n-a.evidence.n||String(a.event.startsAt).localeCompare(String(b.event.startsAt))||a.id.localeCompare(b.id);
}
export function screenValuePicks(groups,options={}){
 const all=[],waiting=[],started=[],fixtures=new Map();
 for(const {event,markets} of groups){
  if(!Number.isFinite(Date.parse(event.startsAt))||Date.parse(event.startsAt)<=(options.now??Date.now())){started.push(event);continue;}
  // A new round may repeat the same physical market. Use the sellable/latest
  // complete quote for that condition, not an old round with a nicer edge.
  // Pending quotes cannot erase the last announced price.
  const latest=new Map();
  const quoteOrder=(a,b)=>Number(valueAvailability(event,b.market,options).canAdd)-Number(valueAvailability(event,a.market,options).canAdd)||
   (Date.parse(b.market.observedAt)||0)-(Date.parse(a.market.observedAt)||0)||(Number(b.market.round)||0)-(Number(a.market.round)||0)||String(a.market.id).localeCompare(String(b.market.id));
  for(const item of markets.filter(({market})=>validMarket(market)&&!market.pending).sort(quoteOrder)){
   const m=item.market,key=JSON.stringify([m.market,m.period||'full',m.line??null,m.outcomes.map(o=>o.key)]);
   if(!latest.has(key))latest.set(key,item);
  }
  const choices=[...latest.values()].flatMap(({market,pattern})=>analyzeValueMarket(event,market,pattern,options)).sort(compareValuePicks);
  if(choices.length){all.push(...choices);if(!fixtures.has(String(event.id))||compareValuePicks(choices[0],fixtures.get(String(event.id)))<0)fixtures.set(String(event.id),choices[0]);}
  else waiting.push({event,market:markets[0]?.market,reason:markets.some(({market})=>market.pending||!market.outcomes?.length)?'배당 발표 대기':'분석 가능한 배당·기준점 없음'});
 }
 const ranked=[...fixtures.values()].sort(compareValuePicks),candidates=ranked.filter(p=>p.isValue),watch=ranked.filter(p=>!p.isValue);
 const uniqueWaiting=[...new Map(waiting.filter(x=>!fixtures.has(String(x.event.id))).map(x=>[String(x.event.id),x])).values()];
 return {all,ranked,candidates,watch,waiting:uniqueWaiting,started,totalFixtures:ranked.length+uniqueWaiting.length,priced:ranked.length,estimated:ranked.filter(p=>p.probability!==null).length,
  selling:ranked.filter(p=>p.availability.canAdd).length,closed:ranked.filter(p=>p.availability.code==='closed').length,stale:ranked.filter(p=>p.availability.code==='stale').length,policyVersion:VALUE_POLICY.version};
}
