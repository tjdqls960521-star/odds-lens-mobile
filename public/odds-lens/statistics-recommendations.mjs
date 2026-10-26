import {resultIndex,wilson95} from './live-core.mjs?v=20261005-3';

export const STATISTICS_POLICY={version:'exact-statistics-1',minimum:3,A:{n:30,earlier:15,later:10},B:{n:12,earlier:6,later:4}};
const gradeRank={A:3,B:2,C:1};
const scopeRank={homeTeam:3,awayTeam:3,league:2,sport:1};
const scopeFamily=scope=>scope==='homeTeam'||scope==='awayTeam'?'team':scope;
const dominant=(counts,slots,slot)=>slots.every(other=>other===slot||counts[slot]>counts[other]);

// Histograms only: neither the latest outcome nor sequence matches enter a
// statistical recommendation. Chronological periods describe stability only.
export function statisticalEvidence(settled,slots){
  const ordered=[...settled].sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const splitDay=String(ordered[Math.floor(ordered.length*.7)]?.date||'').slice(0,10);
  const counts=[0,0,0],earlier=[0,0,0],later=[0,0,0];
  for(const row of ordered){const slot=resultIndex(row);if(!slots.includes(slot))continue;counts[slot]++;(String(row.date).slice(0,10)<splitDay?earlier:later)[slot]++;}
  const n=counts.reduce((a,b)=>a+b,0),earlierN=earlier.reduce((a,b)=>a+b,0),laterN=later.reduce((a,b)=>a+b,0);
  if(n<STATISTICS_POLICY.minimum)return [];
  return slots.filter(slot=>dominant(counts,slots,slot)).map(slot=>{
    const wins=counts[slot],rate=wins/n,interval=wilson95(wins,n),train={n:earlierN,wins:earlier[slot],rate:earlierN?earlier[slot]/earlierN:null},test={n:laterN,wins:later[slot],rate:laterN?later[slot]/laterN:null};
    const stable=earlierN>0&&laterN>0&&dominant(earlier,slots,slot)&&dominant(later,slots,slot)&&test.rate>=train.rate-.15;
    let grade='C';
    if(n>=12&&earlierN>=6&&laterN>=4&&stable&&interval.lower>1/slots.length)grade='B';
    if(grade==='B'&&n>=30&&earlierN>=15&&laterN>=10&&wilson95(test.wins,test.n).lower>1/slots.length)grade='A';
    return {slot,n,wins,rate,counts,interval,train,test,grade,stable,splitDay,dateRange:{first:ordered[0]?.date,last:ordered.at(-1)?.date},policyVersion:STATISTICS_POLICY.version};
  });
}

export function statisticalRecommendations(analysis){
  const entries=[];
  const collect=(scopes,basis,priceSlot=null)=>{
    for(const [scope,summary] of Object.entries(scopes))for(const item of summary.statistics||[]){
      // A single-price comparison supports only that selected price/result.
      if(priceSlot!==null&&item.slot!==priceSlot)continue;
      entries.push({...item,scope,basis,priceSlot});
    }
  };
  collect(analysis.scopes,'combo');
  for(const [slot,scopes] of Object.entries(analysis.singlePrice||{}))collect(scopes,'single',Number(slot));
  const bySlot=new Map();
  for(const item of entries){if(!bySlot.has(item.slot))bySlot.set(item.slot,[]);bySlot.get(item.slot).push(item);}
  const candidates=[...bySlot].map(([slot,evidence])=>{
    evidence.sort((a,b)=>gradeRank[b.grade]-gradeRank[a.grade]||scopeRank[b.scope]-scopeRank[a.scope]||b.interval.lower-a.interval.lower||b.n-a.n||Number(b.basis==='combo')-Number(a.basis==='combo'));
    return {slot,evidence,best:evidence[0],scopeCount:new Set(evidence.map(e=>scopeFamily(e.scope))).size,highestScopeRank:Math.max(...evidence.map(e=>scopeRank[e.scope]))};
  });
  return candidates.map(candidate=>{
    const opposing=candidates.filter(other=>other.slot!==candidate.slot),conflicting=opposing.some(other=>gradeRank[other.best.grade]>=gradeRank[candidate.best.grade]);
    return {...candidate,grade:conflicting?'C':candidate.best.grade,conflicting,opposingGrades:opposing.map(other=>other.best.grade),basis:'exact-odds-statistics'};
  }).sort((a,b)=>b.scopeCount-a.scopeCount||gradeRank[b.grade]-gradeRank[a.grade]||b.highestScopeRank-a.highestScopeRank||b.best.interval.lower-a.best.interval.lower);
}
