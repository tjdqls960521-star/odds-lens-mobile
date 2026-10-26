// Descriptive archive lookups only. The frequencies and transitions below are
// observed cases, not calibrated probabilities or a betting recommendation.
import {
  canonicalMarket, canonicalTeam, lineValue, makeTarget, marketUsesLine,
  outcomeLabels, priceCents, resultIndex, sameLine
} from './live-core.mjs?v=20261005-3';
import {isUtc} from './prediction-core.mjs?v=20261005-3';
import {sequencePatterns} from './sequence-patterns.mjs?v=20261005-3';
import {statisticalEvidence,statisticalRecommendations} from './statistics-recommendations.mjs?v=20261005-3';

const indexCache=new WeakMap();
const excludedMarkets=new Set(['SUM','승5패','전반','전반_핸디캡','전반_언오버']);
const dateKey=value=>/^\d{4}-\d\d-\d\d/.test(String(value??''))?String(value).slice(0,10):null;
const marketKey=(market,line)=>`${market}\u0000${marketUsesLine(market)?String(lineValue(line)??'missing'):'none'}`;
const exactPrice=(a,b)=>priceCents(a)!==null&&priceCents(a)===priceCents(b);
const quoteKey=(odds,slots)=>slots.map(slot=>`${slot}:${priceCents(odds?.[slot])??'missing'}`).join('|');
function add(map,key,row){if(!map.has(key))map.set(key,[]);map.get(key).push(row);}

function actualEventKey(row){
  // Archive `event`/`id` identify a sold item (round + game number), not an
  // actual fixture. Its date, league and teams are the available fixture key.
  const dayTime=String(row.date??'').trim(),home=canonicalTeam(row.home),away=canonicalTeam(row.away);
  if(!dateKey(dayTime)||!home||!away)return null;
  return String(row.actualEventId||row.canonicalEventId||JSON.stringify([dayTime,row.league,home,away]));
}

function buildIndex(rows){
  if(indexCache.has(rows))return indexCache.get(rows);
  const groups=new Map();
  for(const row of rows){
    const market=canonicalMarket(row?.market),eventKey=actualEventKey(row),slot=resultIndex(row);
    if(!market||excludedMarkets.has(market)||!eventKey||!Array.isArray(row.closing))continue;
    if(marketUsesLine(market)&&lineValue(row.line)===null)continue;
    const key=marketKey(market,row.line),identity=JSON.stringify([eventKey,market,lineValue(row.line)]);
    if(!groups.has(key))groups.set(key,new Map());
    // Later source rows supersede earlier revisions of the same physical
    // event/market/line, independently of whether their price matches today.
    groups.get(key).set(identity,row);
  }
  const index=new Map();
  for(const [key,items] of groups){
    const bucket={combo2:new Map(),combo3:new Map(),single:[new Map(),new Map(),new Map()]};
    for(const row of items.values()){
      add(bucket.combo2,quoteKey(row.closing,[0,2]),row);
      add(bucket.combo3,quoteKey(row.closing,[0,1,2]),row);
      for(const slot of [0,1,2]){
        const cents=priceCents(row.closing[slot]);
        if(cents!==null)add(bucket.single[slot],cents,row);
      }
    }
    index.set(key,bucket);
  }
  indexCache.set(rows,index);
  return index;
}

function beforeTarget(row,startMs,targetDay){
  const day=dateKey(row.date);
  if(!day||day>targetDay)return false;
  // Actual result timestamps, when present, take precedence. The current
  // public archive has no such field, so those rows need an earlier KST day.
  if(row.resultKnownAt!==null&&row.resultKnownAt!==undefined&&row.resultKnownAt!==''){
    return isUtc(row.resultKnownAt)&&Date.parse(row.resultKnownAt)<startMs;
  }
  return day<targetDay;
}

function summarize(rows,labels,allowedSlots,includeSequences){
  const ordered=[...rows].sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(actualEventKey(a)).localeCompare(String(actualEventKey(b))));
  const counts=[0,0,0];
  const settled=ordered.filter(row=>allowedSlots.has(resultIndex(row))&&(!row.resultStatus||row.resultStatus==='settled'));
  for(const row of settled)counts[resultIndex(row)]++;
  const n=settled.length,rates=n?counts.map((count,slot)=>allowedSlots.has(slot)?count/n:null):[null,null,null];
  const recent=ordered.slice(-12).reverse().map(row=>{
    const slot=resultIndex(row);
    return {date:String(row.date),result:labels[slot]||'미확인·무효',slot:allowedSlots.has(slot)?slot:null,home:String(row.home),away:String(row.away),eventId:actualEventKey(row)};
  });
  const latestSlot=ordered.length?resultIndex(ordered.at(-1)):null;
  const nextRows=[];
  for(let i=1;i<ordered.length;i++)if(allowedSlots.has(latestSlot)&&resultIndex(ordered[i-1])===latestSlot&&allowedSlots.has(resultIndex(ordered[i]))&&String(ordered[i-1].date).slice(0,10)<String(ordered[i].date).slice(0,10))nextRows.push(ordered[i]);
  const nextCounts=[0,0,0];
  for(const row of nextRows)nextCounts[resultIndex(row)]++;
  const transition={
    after:latestSlot===null?null:{slot:latestSlot,result:labels[latestSlot]},
    n:nextRows.length,
    counts:nextCounts,
    rates:nextRows.length?nextCounts.map((count,slot)=>allowedSlots.has(slot)?count/nextRows.length:null):[null,null,null],
    dateRange:nextRows.length?{first:String(nextRows[0].date),last:String(nextRows.at(-1).date)}:null
  };
  return {n,unresolved:ordered.length-n,counts,rates,dateRange:n?{first:String(ordered[0].date),last:String(ordered.at(-1).date)}:null,recent,transition,statistics:statisticalEvidence(settled,[...allowedSlots]),patterns:includeSequences?sequencePatterns(ordered,[...allowedSlots]):[]};
}

function scoped(rows,target,labels,allowedSlots,includeSequences){
  const sameLeague=row=>row.league===target.league;
  const homeKey=target.teamNamesVerified?canonicalTeam(target.home):null,awayKey=target.teamNamesVerified?canonicalTeam(target.away):null;
  return {
    sport:summarize(rows,labels,allowedSlots,includeSequences),
    league:summarize(rows.filter(sameLeague),labels,allowedSlots,includeSequences),
    homeTeam:summarize(rows.filter(row=>homeKey&&canonicalTeam(row.home)===homeKey),labels,allowedSlots,includeSequences),
    awayTeam:summarize(rows.filter(row=>awayKey&&canonicalTeam(row.away)===awayKey),labels,allowedSlots,includeSequences)
  };
}

export function analyzePatternEvent(event,market,rows,{includeSequences=true}={}){
  if(!Array.isArray(rows))throw new TypeError('Historical rows must be an array.');
  if(!isUtc(event?.startsAt))throw new TypeError('A time-zoned event start is required.');
  const target=makeTarget(event,market),marketName=target.market;
  if(excludedMarkets.has(marketName))throw new TypeError('This market is excluded from pattern analysis.');
  const targetDay=target.cutoffDay,startMs=Date.parse(event.startsAt),allowedSlots=new Set(target.selections.map(item=>item.slot));
  const labels=outcomeLabels(marketName).map((label,slot)=>target.selections.find(item=>item.slot===slot)?.label||label);
  const bucket=buildIndex(rows).get(marketKey(marketName,target.line));
  const eligible=row=>
    sameLine(marketUsesLine(marketName)?row.line:null,target.line)&&
    beforeTarget(row,startMs,targetDay)&&
    (target.selections.length===2?priceCents(row.closing[1])===null:priceCents(row.closing[1])!==null)
  ;
  const combo=(bucket?.[target.selections.length===2?'combo2':'combo3'].get(quoteKey(target.odds,target.selections.map(item=>item.slot)))||[])
    .filter(row=>eligible(row)&&target.selections.every(selection=>exactPrice(row.closing[selection.slot],selection.odds)));
  const singlePrice=Object.fromEntries(target.selections.map(selection=>[
    selection.slot,scoped((bucket?.single[selection.slot].get(priceCents(selection.odds))||[])
      .filter(row=>eligible(row)&&exactPrice(row.closing[selection.slot],selection.odds)),target,labels,allowedSlots,includeSequences)
  ]));
  const result={
    eventId:String(event.id??''),marketId:String(market.id??''),market:marketName,line:target.line,
    labels,slots:[...allowedSlots],comparison:'historical closing-odds column; no quote observation timestamp',
    scopes:scoped(combo,target,labels,allowedSlots,includeSequences),singlePrice,
    patternPrediction:{result:null,probabilities:null,highConfidence:false,reason:'SEQUENCE_NOT_VALIDATED'}
  };
  result.recommendations=statisticalRecommendations(result);
  return result;
}

export function exactPatternCatalog(rows,{scope='league',mode='combo',league='all',market='all',minimum=3,offset=0,limit=50}={}){
  const items=[];
  const cutoffDay=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
  for(const [marketKey,bucket] of buildIndex(rows)){
    const [name,lineText]=marketKey.split('\u0000');
    if(market!=='all'&&name!==market)continue;
    const maps=mode==='single'?bucket.single.map((map,slot)=>({map,slot})):[{map:bucket.combo2,slot:null},{map:bucket.combo3,slot:null}];
    for(const {map,slot} of maps)for(const [quote,group] of map){
      const eligible=group.filter(row=>(league==='all'||row.league===league)&&String(row.date).slice(0,10)<cutoffDay&&(mode==='single'||(map===bucket.combo2?priceCents(row.closing[1])===null:priceCents(row.closing[1])!==null)));
      if(eligible.length<minimum)continue;
      const scopes=new Map();
      for(const row of eligible){
        const keys=scope==='sport'?['같은 종목']:scope==='team'?[`홈팀 ${row.home}`,`원정팀 ${row.away}`]:[row.league];
        for(const key of keys)add(scopes,JSON.stringify([key,priceCents(row.closing[1])===null?2:3]),row);
      }
      for(const [scopeKey,members] of scopes){
        const [scopeLabel]=JSON.parse(scopeKey);
        if(members.length<minimum)continue;
        const labels=outcomeLabels(name),slots=priceCents(members[0].closing[1])===null?[0,2]:[0,1,2];
        for(const pattern of sequencePatterns(members,slots))if(pattern.n>=minimum)items.push({...pattern,market:name,line:lineText==='none'?null:lineText,scope,scopeLabel,mode,priceSlot:slot,odds:mode==='single'?Number(quote)/100:members[0].closing,labels,id:JSON.stringify([marketKey,quote,scopeLabel,pattern.id,slot])});
      }
    }
  }
  const grades={A:3,B:2,C:1};
  items.sort((a,b)=>grades[b.grade]-grades[a.grade]||b.test.n-a.test.n||b.n-a.n||b.lift-a.lift);
  return {total:items.length,offset,items:items.slice(offset,offset+limit),gradeCounts:Object.fromEntries(['A','B','C'].map(grade=>[grade,items.filter(item=>item.grade===grade).length]))};
}

export function analyzePatternCandidates(events,rows){
  if(!Array.isArray(events)||!Array.isArray(rows))throw new TypeError('Events and historical rows must be arrays.');
  const results=[];
  for(const event of events)for(const market of event?.markets||[]){
    if(!Array.isArray(market?.outcomes)||![2,3].includes(market.outcomes.length))continue;
    try{results.push(analyzePatternEvent(event,market,rows));}
    catch(error){if(!(error instanceof TypeError))throw error;}
  }
  return results;
}

export function exactEvidenceCases(event,market,rows,{scope='sport',basis='single',slot=0,offset=0,limit=50}={}){
  if(!['sport','league','homeTeam','awayTeam'].includes(scope)||!['single','combo'].includes(basis))throw new TypeError('지원하지 않는 사례 범위입니다.');
  const target=makeTarget(event,market),selection=target.selections.find(item=>item.slot===Number(slot));
  if(!selection||excludedMarkets.has(target.market)||!isUtc(event.startsAt))throw new TypeError('사례 비교 조건을 확인해주세요.');
  const bucket=buildIndex(rows).get(marketKey(target.market,target.line)),slots=target.selections.map(item=>item.slot);
  const candidates=basis==='single'?bucket?.single[slot]?.get(priceCents(selection.odds)):bucket?.[slots.length===2?'combo2':'combo3'].get(quoteKey(target.odds,slots));
  const matches=(candidates||[]).filter(row=>
    beforeTarget(row,Date.parse(event.startsAt),target.cutoffDay)&&sameLine(marketUsesLine(target.market)?row.line:null,target.line)&&
    (slots.length===2?priceCents(row.closing[1])===null:priceCents(row.closing[1])!==null)&&
    (basis==='single'?exactPrice(row.closing[slot],selection.odds):target.selections.every(s=>exactPrice(row.closing[s.slot],s.odds)))&&
    (scope==='sport'||scope==='league'&&row.league===target.league||scope==='homeTeam'&&target.teamNamesVerified&&canonicalTeam(row.home)===canonicalTeam(target.home)||scope==='awayTeam'&&target.teamNamesVerified&&canonicalTeam(row.away)===canonicalTeam(target.away))
  );
  const settled=matches.filter(row=>slots.includes(resultIndex(row))&&(!row.resultStatus||row.resultStatus==='settled')).sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(a.id).localeCompare(String(b.id)));
  const wins=settled.filter(row=>resultIndex(row)===Number(slot)).length;
  offset=Math.max(0,Number(offset)||0);limit=Math.min(100,Math.max(1,Number(limit)||50));
  return {n:settled.length,wins,rate:settled.length?wins/settled.length:null,unresolved:matches.length-settled.length,offset,nextOffset:offset+limit<settled.length?offset+limit:null,
    dateRange:settled.length?{first:settled.at(-1).date,last:settled[0].date}:null,
    cases:settled.slice(offset,offset+limit).map(row=>({id:row.id,date:row.date,league:row.league,home:row.home,away:row.away,line:row.line,odds:row.closing,result:outcomeLabels(target.market)[resultIndex(row)],slot:resultIndex(row),won:resultIndex(row)===Number(slot)}))};
}
