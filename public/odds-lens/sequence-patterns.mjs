import {resultIndex,wilson95} from './live-core.mjs?v=20261005-3';

export const GRADE_POLICY={version:'exact-sequence-1',A:{n:30,train:15,test:10},B:{n:12,train:6,test:4},C:{n:3}};
const rank={A:3,B:2,C:1};
const day=row=>String(row.date||'').slice(0,10);
const usable=(row,slots)=>slots.includes(resultIndex(row))&&(!row.resultStatus||row.resultStatus==='settled');
function availableBefore(left,right){
  // The archive has kickoff times but generally lacks result-known times.
  // Never treat an overlapping/same-day result as already known.
  return left.resultKnownAt?Date.parse(left.resultKnownAt)<Date.parse(String(right.date).replace(' ','T')+'+09:00'):day(left)<day(right);
}

export function sequencePatterns(rows,slots=[0,1,2]){
  const ordered=[...rows].sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.id).localeCompare(String(b.id)));
  const counts=[0,0,0];
  for(const row of ordered)if(usable(row,slots))counts[resultIndex(row)]++;
  const known=counts.reduce((a,b)=>a+b,0),splitDay=day(ordered[Math.floor(ordered.length*.7)]||{});
  const trainBase=[0,0,0],testBase=[0,0,0],buckets=new Map();
  for(const row of ordered)if(usable(row,slots))(day(row)<splitDay?trainBase:testBase)[resultIndex(row)]++;
  for(let end=1;end<ordered.length;end++){
    if(!usable(ordered[end],slots))continue;
    for(let length=1;length<=3&&length<=end;length++){
      const window=ordered.slice(end-length,end+1);
      if(window.some(row=>!usable(row,slots))||window.some((row,i)=>i&&!availableBefore(window[i-1],row)))continue;
      const prefix=window.slice(0,-1).map(resultIndex),key=prefix.join(',');
      if(!buckets.has(key))buckets.set(key,{prefix,examples:[],lastEnd:-1});
      const bucket=buckets.get(key);
      // Repeated overlapping windows are not separate evidence samples.
      if(end-length<=bucket.lastEnd)continue;
      bucket.lastEnd=end;
      bucket.examples.push({date:ordered[end].date,slot:resultIndex(ordered[end]),home:ordered[end].home,away:ordered[end].away,id:ordered[end].id});
    }
  }
  const patterns=[];
  for(const [key,bucket] of buckets){
    const examples=bucket.examples,n=examples.length;
    if(n<3)continue;
    const train=examples.filter(row=>day(row)<splitDay),test=examples.filter(row=>day(row)>=splitDay);
    const tally=items=>items.reduce((a,row)=>(a[row.slot]++,a),[0,0,0]);
    const trainCounts=tally(train),testCounts=tally(test),allCounts=tally(examples);
    // Fix the proposed result using the earlier period only. The later period
    // can demote it; it cannot choose a different, better-looking result.
    const discovery=train.length>=3?trainCounts:allCounts,max=Math.max(...discovery);
    const winners=slots.filter(slot=>discovery[slot]===max);
    if(winners.length!==1)continue;
    const slot=winners[0],wins=allCounts[slot],rate=wins/n,base=known?counts[slot]/known:0;
    if(rate<=base)continue;
    const trainN=train.length,testN=test.length,trainRate=trainN?trainCounts[slot]/trainN:null,testRate=testN?testCounts[slot]/testN:null;
    const testBaseN=testBase.reduce((a,b)=>a+b,0),testBaseline=testBaseN?testBase[slot]/testBaseN:null;
    const interval=wilson95(wins,n),testLower=testN?wilson95(testCounts[slot],testN).lower:null;
    const repeatedLater=testN>0&&testCounts[slot]===Math.max(...testCounts)&&testRate>testBaseline&&testRate>=trainRate-.15;
    const laterFailed=trainN>=3&&testN>=4&&!repeatedLater;
    let grade='C';
    if(trainN>=6&&testN>=4&&n>=12&&trainRate>base&&repeatedLater&&interval.lower>base)grade='B';
    if(grade==='B'&&trainN>=15&&testN>=10&&n>=30&&testLower>testBaseline)grade='A';
    const tail=ordered.slice(-bucket.prefix.length);
    const active=tail.length===bucket.prefix.length&&tail.every((row,i)=>usable(row,slots)&&resultIndex(row)===bucket.prefix[i]&&(!i||availableBefore(tail[i-1],row)));
    const neverRepeats=bucket.prefix.length===1&&!ordered.some((row,i)=>i>0&&resultIndex(row)===bucket.prefix[0]&&resultIndex(ordered[i-1])===bucket.prefix[0]);
    patterns.push({id:key,prefix:bucket.prefix,slot,n,wins,counts:allCounts,rate,baseline:base,lift:rate-base,grade,active,neverRepeats,laterFailed,
      train:{n:trainN,wins:trainCounts[slot],rate:trainRate},test:{n:testN,wins:testCounts[slot],rate:testRate,baseline:testBaseline},
      splitDay,interval,examples:examples.slice(-6),policyVersion:GRADE_POLICY.version});
  }
  return patterns.sort((a,b)=>Number(b.active)-Number(a.active)||rank[b.grade]-rank[a.grade]||b.test.n-a.test.n||b.n-a.n||b.lift-a.lift);
}

export function patternText(pattern,labels){
  const names=pattern.prefix.map(slot=>labels[slot]);
  const repeated=names.every(name=>name===names[0]);
  const condition=repeated?`${names[0]} ${names.length}회${names.length>1?' 연속':''}`:names.join(' → ');
  if(pattern.neverRepeats)return `이 기록에서는 ${names[0]}가 2회 연속 나오지 않음 · 다음 ${labels[pattern.slot]} ${pattern.wins}/${pattern.n}회`;
  return `${condition} 뒤 ${labels[pattern.slot]} ${pattern.wins}/${pattern.n}회`;
}

export function activeRecommendations(pattern){
  const entries=[];
  const collect=(scopes,basis,priceSlot=null)=>{
    for(const [scope,summary] of Object.entries(scopes))for(const item of summary.patterns||[])if(item.active&&!item.laterFailed)entries.push({...item,scope,basis,priceSlot});
  };
  collect(pattern.scopes,'combo');
  for(const [slot,scopes] of Object.entries(pattern.singlePrice||{}))collect(scopes,'single',Number(slot));
  const bySlot=new Map();
  for(const item of entries){if(!bySlot.has(item.slot))bySlot.set(item.slot,[]);bySlot.get(item.slot).push(item);}
  const scopeRank={homeTeam:3,awayTeam:3,league:2,sport:1};
  const candidates=[...bySlot].map(([slot,evidence])=>{
    evidence.sort((a,b)=>rank[b.grade]-rank[a.grade]||scopeRank[b.scope]-scopeRank[a.scope]||b.test.n-a.test.n||b.n-a.n);
    return {slot,evidence,best:evidence[0],scopeCount:new Set(evidence.map(e=>e.scope)).size};
  });
  // A weaker contrary exploration does not erase stronger evidence. Equally
  // strong or stronger opposing directions are explicitly reduced to C.
  return candidates.map(candidate=>{
    const opposing=candidates.filter(other=>other.slot!==candidate.slot),conflicting=opposing.some(other=>rank[other.best.grade]>=rank[candidate.best.grade]);
    return {...candidate,grade:conflicting?'C':candidate.best.grade,conflicting,opposingGrades:opposing.map(other=>other.best.grade)};
  }).sort((a,b)=>rank[b.grade]-rank[a.grade]||b.scopeCount-a.scopeCount||b.best.n-a.best.n);
}
