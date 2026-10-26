import {makeTarget,wilson95} from './live-core.mjs?v=20261005-3';

// An explicit historical screening rule, not a calibrated win probability.
// Cohort choice is fixed by specificity and sample size, NEVER by hit rate.
export const PICK_POLICY=Object.freeze({
 version:'hit-screen-1',maxQuoteAgeMs:120000,maxEvidenceAgeDays:365,
 minimumLower:.50,minimumEarlier:15,minimumLater:10,maximumPeriodDrop:.15,
 cohorts:[{scope:'league',basis:'combo',minimum:30},{scope:'league',basis:'single',minimum:60},{scope:'sport',basis:'combo',minimum:60},{scope:'sport',basis:'single',minimum:120}]
});
export const PICK_REASONS={
 source:'현재 배당 연결 확인 필요',started:'경기 시작·종료',closed:'판매 종료·중지',pending:'배당 발표 대기',quote:'배당 확인시각 지연',invalid:'배당·기준점 확인 필요',
 sample:'같은 조건의 표본 부족',period:'기간별 표본 부족',direction:'과거 우세 결과와 다름',stable:'후반 기간 성적 약화',lower:'보수적 근거 기준 미달',
 opposing:'충분한 반대 근거 존재',market:'현재 최저배당 방향과 다름',old:'최근 1년 내 일치 사례 없음'
};
const scopeTitle={league:'같은 리그',sport:'같은 종목',homeTeam:'같은 홈팀',awayTeam:'같은 원정팀'};
export const pickConditionKey=market=>JSON.stringify([market.market,market.period||'full',market.line??null,(market.outcomes||[]).map(o=>o.key).sort()]);
const cohort=(pattern,slot,spec)=>spec.basis==='combo'?pattern?.scopes?.[spec.scope]:pattern?.singlePrice?.[slot]?.[spec.scope];
const dayMs=value=>Date.parse(String(value||'').slice(0,10)+'T00:00:00+09:00');
const finiteQuote=market=>[2,3].includes(market?.outcomes?.length)&&market.outcomes.every(o=>typeof o.key==='string'&&o.key.length&&Number.isFinite(o.odds)&&o.odds>1)&&new Set(market.outcomes.map(o=>o.key)).size===market.outcomes.length;
function chooseCohort(pattern,slot){
 const options=PICK_POLICY.cohorts.map(spec=>({...spec,summary:cohort(pattern,slot,spec)}));
 return options.find(value=>(value.summary?.n||0)>=value.minimum)||options.sort((a,b)=>(b.summary?.n||0)/b.minimum-(a.summary?.n||0)/a.minimum)[0];
}
function blockingReason(event,market,{now,sourceCurrent}){
 if(!sourceCurrent)return 'source';
 if(!Number.isFinite(Date.parse(event?.startsAt))||Date.parse(event.startsAt)<=now)return 'started';
 if(market?.pending)return 'pending';
 if(market?.saleStatus!=='selling'||market?.available===false||Number.isFinite(Date.parse(market.saleClosesAt))&&Date.parse(market.saleClosesAt)<=now)return 'closed';
 const needsLine=['핸디캡','언오버'].includes(market.market);
 if(!['일반','핸디캡','언오버','승1패'].includes(market.market)||market.period&&market.period!=='full'||!finiteQuote(market)||needsLine&&(!Number.isFinite(Number(market.line))||market.line===null||market.line===''))return 'invalid';
 const observed=Date.parse(market.observedAt);
 if(!Number.isFinite(observed)||now-observed>PICK_POLICY.maxQuoteAgeMs||observed>now+30000)return 'quote';
 return null;
}
function opposingEvidence(pattern,slot){
 const found=[];
 for(const [scope,summary] of Object.entries(pattern?.scopes||{}))for(const evidence of summary.statistics||[]){
  if(evidence.slot!==slot&&evidence.n>=30&&evidence.test?.n>=10&&evidence.stable&&['A','B'].includes(evidence.grade))found.push({...evidence,scope,basis:'combo'});
 }
 for(const [otherSlot,scopes] of Object.entries(pattern?.singlePrice||{})){
  if(Number(otherSlot)===slot)continue;
  for(const [scope,summary] of Object.entries(scopes))for(const evidence of summary.statistics||[]){
   if(evidence.slot===Number(otherSlot)&&evidence.n>=30&&evidence.test?.n>=10&&evidence.stable&&['A','B'].includes(evidence.grade))found.push({...evidence,scope,basis:'single'});
  }
 }
 return found;
}
export function assessPick(event,market,pattern,slot,{now=Date.now(),sourceCurrent=true}={}){
 const selection=finiteQuote(market)?makeTarget(event,market).selections.find(value=>value.slot===Number(slot)):null;
 const block=blockingReason(event,market,{now,sourceCurrent});
 const chosen=chooseCohort(pattern,slot),summary=chosen?.summary,n=summary?.n||0,wins=summary?.counts?.[slot]||0;
 const interval=n?wilson95(wins,n):null,period=summary?.statistics?.find(item=>item.slot===Number(slot))||null;
 const inverse=finiteQuote(market)?market.outcomes.map(o=>1/o.odds):[],sum=inverse.reduce((a,b)=>a+b,0);
 const marketReference=selection&&sum?(1/selection.odds)/sum:null;
 const favourite=selection&&selection.odds===Math.min(...market.outcomes.map(o=>o.odds));
 const opposition=opposingEvidence(pattern,Number(slot)),reasons=[];
 if(block)reasons.push(block);
 if(n<(chosen?.minimum||30))reasons.push('sample');
 if(n&&(!period||period.train.n<PICK_POLICY.minimumEarlier||period.test.n<PICK_POLICY.minimumLater))reasons.push('period');
 if(n&&!period)reasons.push('direction');
 if(period&&(!period.stable||period.test.rate<period.train.rate-PICK_POLICY.maximumPeriodDrop))reasons.push('stable');
 if(!interval||interval.lower<PICK_POLICY.minimumLower)reasons.push('lower');
 if(!favourite)reasons.push('market');
 if(opposition.length)reasons.push('opposing');
 if(!Number.isFinite(dayMs(summary?.dateRange?.last))||now-dayMs(summary?.dateRange?.last)>PICK_POLICY.maxEvidenceAgeDays*86400000)reasons.push('old');
 const evidence={scope:chosen?.scope,basis:chosen?.basis,minimum:chosen?.minimum,n,wins,rate:n?wins/n:null,interval,train:period?.train||null,test:period?.test||null,splitDay:period?.splitDay||null,dateRange:summary?.dateRange||null};
 return {id:`${event.id}:${market.id}:${slot}`,policyVersion:PICK_POLICY.version,event,market,slot:Number(slot),selection,evidence,marketReference,favourite:Boolean(favourite),opposition,reasons:[...new Set(reasons)],status:block?'excluded':reasons.length?'watch':'candidate',scopeLabel:scopeTitle[evidence.scope],score:interval?.lower||0};
}
const order={candidate:0,watch:1,excluded:2};
export function comparePicks(a,b){
 return order[a.status]-order[b.status]||b.score-a.score||(b.evidence.test?.rate||0)-(a.evidence.test?.rate||0)||(b.marketReference||0)-(a.marketReference||0)||b.evidence.n-a.evidence.n||String(a.event.startsAt).localeCompare(String(b.event.startsAt))||a.id.localeCompare(b.id);
}
export function screenPicks(groups,options={}){
 const all=[];
 for(const {event,markets} of groups)for(const {market,pattern} of markets){
  const slots=market.outcomes?.length===2?[0,2]:market.outcomes?.length===3?[0,1,2]:[0];
  for(const slot of slots)all.push(assessPick(event,market,pattern,slot,options));
 }
 all.sort(comparePicks);
 const fixtures=new Map();
 for(const pick of all)if(!fixtures.has(String(pick.event.id)))fixtures.set(String(pick.event.id),pick);
 const unique=[...fixtures.values()],candidates=unique.filter(p=>p.status==='candidate'),watch=unique.filter(p=>p.status==='watch'),excluded=unique.filter(p=>p.status==='excluded');
 // The archive filter has not demonstrated superiority over this simple
 // benchmark. Keep the transparent price ordering as the default screen.
 const priceOrder=(a,b)=>a.selection.odds-b.selection.odds||String(a.event.startsAt).localeCompare(String(b.event.startsAt))||a.id.localeCompare(b.id);
 const referenceByFixture=new Map();
 for(const pick of all.filter(p=>p.status!=='excluded'&&p.selection).sort(priceOrder))if(!referenceByFixture.has(String(pick.event.id)))referenceByFixture.set(String(pick.event.id),pick);
 const references=[...referenceByFixture.values()].sort(priceOrder);
 const reasonCounts={};for(const pick of [...watch,...excluded])for(const code of pick.reasons)reasonCounts[code]=(reasonCounts[code]||0)+1;
 return {policyVersion:PICK_POLICY.version,all,references,candidates,watch,excluded,reasonCounts,totalFixtures:unique.length,suppressed:all.length-unique.length};
}
