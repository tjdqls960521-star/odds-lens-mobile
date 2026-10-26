/*
 * Pure historical-query helpers for the live ODDS LENS screen.
 *
 * The imported archive has no true quote timestamps.  `opening` and `closing`
 * are therefore explicit research stages, never live quote observations.
 */

const resultMaps={
  '일반':{승:0,무:1,패:2},
  '전반':{승:0,무:1,패:2},
  '승1패':{승:0,'1':1,무:1,패:2},
  '핸디캡':{핸디승:0,무:1,핸디무:1,핸디패:2},
  '전반_핸디캡':{핸디승:0,무:1,핸디무:1,핸디패:2},
  '언오버':{언더:0,무:1,오버:2},
  '전반_언오버':{언더:0,무:1,오버:2},
  SUM:{홀:0,무:1,짝:2}
};

const labelMaps={
  '일반':['홈 승','무','원정 승'],
  '전반':['홈 승','무','원정 승'],
  '승1패':['홈 2점차 이상 승','① 1점차 이내','원정 2점차 이상 승'],
  '핸디캡':['홈 핸디승','무','원정 핸디승'],
  '전반_핸디캡':['홈 핸디승','무','원정 핸디승'],
  '언오버':['언더','무','오버'],
  '전반_언오버':['언더','무','오버'],
  SUM:['홀','무','짝']
};

const marketAliases={
  'matchwinner':'일반',
  'match_winner':'일반',
  winner:'일반',
  general:'일반',
  '1x2':'일반',
  '일반승패':'일반',
  total:'언오버',
  overunder:'언오버',
  over_under:'언오버',
  handicap:'핸디캡',
  spread:'핸디캡',
  sum:'SUM',
  firsthalf:'전반',
  first_half:'전반'
};

const aliases=new Map([
  ['애틀란타','애틀랜타'],
  ['드래건','드래곤'],
  ['클리블랜드인디언스','클리블랜드가디언스']
  ,['도쿄야쿠르트스왈로스','야쿠르트스왈로스']
  ,['도호쿠라쿠텐골든이글스','라쿠텐골든이글스']
  ,['사이타마세이부라이온즈','세이부라이온즈']
  ,['홋카이도닛폰햄파이터스','닛폰햄파이터스']
  ,['후쿠오카소프트뱅크호크스','소프트뱅크호크스']
]);

const numeric=value=>{
  const number=Number(value);
  return Number.isFinite(number)?number:null;
};

export function priceCents(value){
  const number=numeric(value);
  return number&&number>1?Math.round(number*100):null;
}

// Compatibility helper: each bucket is exactly one domestic 0.01 quote.
// A caller-supplied wider range is deliberately ignored.
export function priceBand(value){
  const cents=priceCents(value);
  return cents===null?null:{lower:cents/100,upper:(cents+1)/100,width:.01};
}

export function canonicalTeam(value){
  const compact=String(value??'').normalize('NFKC').toLowerCase().replace(/[\s·._-]+/g,'').replace(/[^0-9a-z가-힣]/g,'');
  return aliases.get(compact)||compact;
}

export function outcomeLabels(market){
  return labelMaps[market]||['선택 1','무','선택 2'];
}

export function canonicalMarket(value,label=''){
  const direct=String(value??'').trim();
  const text=direct+' '+String(label??'');
  if(/전반|first[ _-]?half|1h/i.test(text))return /핸디|handicap/i.test(text)?'전반_핸디캡':/언더|언오버|over|total/i.test(text)?'전반_언오버':'전반';
  const labelText=String(label??'').trim();
  const known=['일반','언오버','핸디캡','승1패','SUM','전반','전반_핸디캡','전반_언오버'];
  if(known.includes(direct))return direct;
  if(known.includes(labelText))return labelText;
  const compact=direct.toLowerCase().replace(/[\s-]+/g,'');
  const labelCompact=labelText.toLowerCase().replace(/[\s-]+/g,'');
  if(labelCompact.includes('언오버'))return '언오버';
  if(labelCompact.includes('핸디'))return '핸디캡';
  if(labelCompact.includes('일반'))return '일반';
  return marketAliases[compact]||marketAliases[direct.toLowerCase()]||direct;
}

export function marketUsesLine(market){
  return !['일반','전반','승1패','SUM'].includes(canonicalMarket(market));
}

function canonicalResult(value){
  const compact=String(value??'').normalize('NFKC').trim().replace(/\s+/g,'').toLowerCase();
  return {
    승:'승',홈승:'승',승리:'승',win:'승',
    무:'무',무승부:'무',draw:'무',tie:'무',
    패:'패',원정승:'패',패배:'패',loss:'패',lose:'패',
    핸디승:'핸디승',핸디홈승:'핸디승',
    핸디무:'핸디무',핸디무승부:'핸디무',
    핸디패:'핸디패',핸디원정승:'핸디패',
    언더:'언더',under:'언더',오버:'오버',over:'오버'
  }[compact]||compact;
}

export function resultIndex(row){
  const market=canonicalMarket(row?.market);
  return resultMaps[market]?.[canonicalResult(row?.result)]??null;
}

export function lineValue(value){
  if(value===null||value===undefined||String(value).trim()==='')return null;
  const number=numeric(value);
  if(number!==null)return Math.round(number*1e8)/1e8;
  const text=String(value??'').trim();
  return text||null;
}

export function sameLine(a,b){
  const left=lineValue(a),right=lineValue(b);
  if(left===null||right===null)return left===null&&right===null;
  if(typeof left==='number'&&typeof right==='number')return Math.abs(left-right)<1e-8;
  return String(left)===String(right);
}

export function slotsForOutcomeCount(count){
  if(count===2)return [0,2];
  if(count===3)return [0,1,2];
  return [];
}

export function makeTarget(event,market){
  const outcomes=Array.isArray(market?.outcomes)?market.outcomes:[];
  const slots=slotsForOutcomeCount(outcomes.length);
  if(!slots.length)throw new Error('2개 또는 3개의 결과 배당이 있는 시장만 과거 비교를 지원합니다.');
  const odds=[null,null,null];
  const historicalMarket=canonicalMarket(market?.market,market?.marketLabel);
  const labels=outcomeLabels(historicalMarket);
  const selections=outcomes.map((item,index)=>{
    const oddsValue=numeric(item?.odds);
    if(!(oddsValue>1))throw new Error('비교하려는 배당은 1보다 큰 숫자여야 합니다.');
    const slot=slots[index];
    odds[slot]=oddsValue;
    return {slot,key:String(item?.key??`outcome_${index}`),label:String(item?.label??labels[slot]??`선택 ${index+1}`),odds:oddsValue};
  });
  return {
    id:String(event?.id??''),
    sport:String(event?.sport??'야구'),
    league:String(event?.league??''),
    startsAt:String(event?.startsAt??''),
    cutoffDay:/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(String(event?.startsAt??''))?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date(event.startsAt)):String(event?.startsAt??'').slice(0,10),
    home:String(event?.home??''),
    away:String(event?.away??''),
    teamNamesVerified:event?.teamNamesVerified!==false,
    market:historicalMarket,
    marketLabel:String(market?.marketLabel??market?.market??''),
    line:marketUsesLine(historicalMarket)?lineValue(market?.line):null,
    observedAt:String(market?.observedAt??event?.observedAt??''),
    odds,
    selections
  };
}

export function queryLabel(target,mode,selectionSlot){
  if(mode==='outcome'){
    const selection=target.selections.find(item=>item.slot===selectionSlot);
    return selection?`${selection.label} ${selection.odds.toFixed(2)}`:'선택 배당';
  }
  return target.selections.map(item=>`${item.label} ${item.odds.toFixed(2)}`).join(' · ');
}

function comparablePrice(left,right,tolerance){
  const a=numeric(left),b=numeric(right);
  if(!(a>1)||!(b>1))return false;
  return priceCents(a)===priceCents(b);
}

function beforeCutoff(row,target){
  if(!target.cutoffDay)return true;
  return String(row?.date??'').slice(0,10)<target.cutoffDay;
}

function eligibleBase(row,target,{league='all',stage='closing'}={}){
  if(!row)return false;
  const rowLine=marketUsesLine(target.market)?(stage==='opening'?row.openingLine:row.line):null;
  if(marketUsesLine(target.market)&&(lineValue(rowLine)===null||lineValue(target.line)===null))return false;
  if(canonicalMarket(row.market)!==target.market||!sameLine(rowLine,target.line)||!beforeCutoff(row,target))return false;
  if(league!=='all'&&row.league!==league)return false;
  const odds=row[stage];
  return Array.isArray(odds)&&odds.length>=3;
}

export function matchHistorical(rows,target,{league='all',stage='closing',mode='combo',selectionSlot=0,tolerance=0}={}){
  const matches=[];
  const seen=new Set();
  for(const row of rows){
    if(!eligibleBase(row,target,{league,stage}))continue;
    const rowOdds=row[stage];
    const isMatch=mode==='outcome'
      ?comparablePrice(rowOdds[selectionSlot],target.odds[selectionSlot],tolerance)
      :target.selections.every(selection=>comparablePrice(rowOdds[selection.slot],selection.odds,tolerance));
    if(!isMatch)continue;
    const key=String(row.id??row.event??'');
    if(key&&seen.has(key))continue;
    if(key)seen.add(key);
    matches.push(row);
  }
  return matches.sort((a,b)=>String(b.date??'').localeCompare(String(a.date??''))||String(b.id??'').localeCompare(String(a.id??'')));
}

// Same market and (where applicable) exact line, then the selected price's
// fixed-width quote band. This is intentionally a one-selection lookup: it
// does not blur the rest of a full quote combination.
export function priceBandPattern(rows,target,selectionSlot,{league='all',stage='closing',bandWidth=.05}={}){
  const selection=target?.selections?.find(item=>item.slot===selectionSlot);
  const band=priceBand(target?.odds?.[selectionSlot],bandWidth);
  if(!selection||!band)return {reason:'선택한 배당의 가격 구간을 확인할 수 없습니다.',rows:[],stats:null,oddsBand:null};
  const matches=[];
  const seen=new Set();
  for(const row of rows){
    if(!eligibleBase(row,target,{league,stage}))continue;
    const rowBand=priceBand(row[stage]?.[selectionSlot],band.width);
    if(!rowBand||rowBand.lower!==band.lower)continue;
    const key=String(row.id??row.event??'');
    if(key&&seen.has(key))continue;
    if(key)seen.add(key);
    matches.push(row);
  }
  matches.sort((a,b)=>String(b.date??'').localeCompare(String(a.date??''))||String(b.id??'').localeCompare(String(a.id??'')));
  return {
    reason:null,
    rows:matches,
    stats:selectedStats(matches,target,selectionSlot,{stage}),
    oddsBand:band,
    selectionSlot,
    selectionLabel:selection.label,
    currentOdds:target.odds[selectionSlot]
  };
}

export function wilson95(wins,n){
  if(!n)return null;
  const z=1.959963984540054,p=wins/n,denominator=1+z*z/n;
  const center=(p+z*z/(2*n))/denominator;
  const half=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/denominator;
  return {lower:Math.max(0,center-half),upper:Math.min(1,center+half)};
}

export function distribution(rows,target){
  const counts=[0,0,0],unresolved=[];
  for(const row of rows){
    const index=resultIndex(row);
    if(index===null)unresolved.push(row);else counts[index]++;
  }
  const known=counts.reduce((sum,value)=>sum+value,0);
  const labels=outcomeLabels(target.market).map((label,index)=>target.selections.find(item=>item.slot===index)?.label||label);
  return {n:rows.length,known,unresolved:unresolved.length,counts,labels,rate:known?counts.map(count=>count/known):[null,null,null]};
}

export function selectedStats(rows,target,selectionSlot,{stage='closing'}={}){
  const resolved=rows.filter(row=>resultIndex(row)!==null);
  if(!resolved.length)return null;
  const wins=resolved.filter(row=>resultIndex(row)===selectionSlot).length;
  const implied=resolved.map(row=>{
    const odds=row[stage].filter(value=>numeric(value)>1);
    const selected=numeric(row[stage][selectionSlot]);
    return selected&&odds.length>=2?(1/selected)/odds.reduce((sum,value)=>sum+1/value,0):null;
  }).filter(value=>value!==null);
  return {n:resolved.length,wins,losses:resolved.length-wins,rate:wins/resolved.length,wilson95:wilson95(wins,resolved.length),marketExpectedRate:implied.length?implied.reduce((sum,value)=>sum+value,0)/implied.length:null};
}

export function isTeamMarket(market){
  return !['언오버','전반_언오버','SUM'].includes(market);
}

// A total-market result belongs to the game, not to either team.  Keep this
// separate from isTeamMarket so callers cannot accidentally present an
// under/over frequency as a team's win rate.
export function isUnderOverMarket(market){
  const normalized=canonicalMarket(market);
  return normalized==='언오버'||normalized==='전반_언오버';
}

function teamRole(row,teamKey){
  if(canonicalTeam(row.home)===teamKey)return {role:'home',slot:0};
  if(canonicalTeam(row.away)===teamKey)return {role:'away',slot:2};
  return null;
}

export function teamPattern(rows,target,team,{league='all',stage='closing',mode='combo',tolerance=0,sameRole=true}={}){
  if(!isTeamMarket(target.market))return {reason:'팀 승패 결과가 없는 시장이라 팀별 승패 패턴을 계산하지 않습니다.',rows:[],stats:null};
  const teamKey=canonicalTeam(team);
  const currentRole=canonicalTeam(target.home)===teamKey?{role:'home',slot:0}:canonicalTeam(target.away)===teamKey?{role:'away',slot:2}:null;
  if(!teamKey||!currentRole)return {reason:'현재 경기의 팀 정보를 확인할 수 없습니다.',rows:[],stats:null};
  const matched=[];
  const seen=new Set();
  for(const row of rows){
    if(!eligibleBase(row,target,{league,stage}))continue;
    const role=teamRole(row,teamKey);
    if(!role)continue;
    const odds=row[stage];
    const matches=mode==='combo'
      ?role.role===currentRole.role&&target.selections.every(selection=>comparablePrice(odds[selection.slot],target.odds[selection.slot],tolerance))
      :(sameRole?role.role===currentRole.role:true)&&comparablePrice(odds[role.slot],target.odds[currentRole.slot],tolerance);
    if(!matches)continue;
    const key=String(row.id??row.event??'');
    if(key&&seen.has(key))continue;
    if(key)seen.add(key);
    matched.push({...row,_teamSlot:role.slot,_teamRole:role.role});
  }
  matched.sort((a,b)=>String(b.date??'').localeCompare(String(a.date??''))||String(b.id??'').localeCompare(String(a.id??'')));
  const resolved=matched.filter(row=>resultIndex(row)!==null);
  const wins=resolved.filter(row=>resultIndex(row)===row._teamSlot).length;
  return {
    reason:null,
    rows:matched,
    stats:resolved.length?{n:resolved.length,wins,losses:resolved.length-wins,rate:wins/resolved.length,wilson95:wilson95(wins,resolved.length)}:null,
    role:currentRole.role,
    currentOdds:target.odds[currentRole.slot],
    sameRole
  };
}

// Exact total line + price lookup. `matchHistorical` already enforces the
// target-day cutoff, but this wrapper makes the total-specific scope explicit
// for the fast-scan and recommendation callers.
export function underOverLinePattern(rows,target,selectionSlot,{league='all',stage='closing',mode='outcome',tolerance=0}={}){
  if(!isUnderOverMarket(target?.market))return {reason:'언더/오버 시장에서만 기준값·배당 패턴을 계산합니다.',rows:[],stats:null};
  const selection=target?.selections?.find(item=>item.slot===selectionSlot);
  if(!selection||!(numeric(target?.odds?.[selectionSlot])>1))return {reason:'선택한 언더/오버 배당을 확인할 수 없습니다.',rows:[],stats:null};
  if(target.line===null||target.line===undefined||target.line==='')return {reason:'언더/오버 기준값을 확인할 수 없습니다.',rows:[],stats:null};
  const comparisonMode=mode==='combo'?'combo':'outcome';
  const matched=matchHistorical(rows,target,{league,stage,mode:comparisonMode,selectionSlot,tolerance});
  return {
    reason:null,
    rows:matched,
    stats:selectedStats(matched,target,selectionSlot,{stage}),
    line:target.line,
    selectionSlot,
    selectionLabel:selection.label,
    currentOdds:target.odds[selectionSlot],
    mode:comparisonMode
  };
}

// Team context for an under/over result. This is deliberately labelled as a
// team *included in the game* pattern: it never turns an under/over outcome
// into a team win. Screening keeps the current home/away role by default;
// callers can explicitly opt into a broader all-venue descriptive view.
export function teamUnderOverPattern(rows,target,team,selectionSlot,{league='all',stage='closing',mode='outcome',tolerance=0,sameRole=true}={}){
  if(!isUnderOverMarket(target?.market))return {reason:'언더/오버 시장에서만 팀 포함 패턴을 계산합니다.',rows:[],stats:null};
  const selection=target?.selections?.find(item=>item.slot===selectionSlot);
  if(!selection||!(numeric(target?.odds?.[selectionSlot])>1))return {reason:'선택한 언더/오버 배당을 확인할 수 없습니다.',rows:[],stats:null};
  if(target.line===null||target.line===undefined||target.line==='')return {reason:'언더/오버 기준값을 확인할 수 없습니다.',rows:[],stats:null};
  const teamKey=canonicalTeam(team);
  const currentRole=teamRole(target,teamKey);
  if(!teamKey||!currentRole)return {reason:'현재 경기의 팀 정보를 확인할 수 없습니다.',rows:[],stats:null};
  const comparisonMode=mode==='combo'?'combo':'outcome';
  const matched=[];
  const seen=new Set();
  for(const row of rows){
    if(!eligibleBase(row,target,{league,stage}))continue;
    const role=teamRole(row,teamKey);
    if(!role)continue;
    const odds=row[stage];
    const matches=comparisonMode==='combo'
      ?role.role===currentRole.role&&target.selections.every(item=>comparablePrice(odds[item.slot],item.odds,tolerance))
      :(sameRole?role.role===currentRole.role:true)&&comparablePrice(odds[selectionSlot],target.odds[selectionSlot],tolerance);
    if(!matches)continue;
    const key=String(row.id??row.event??'');
    if(key&&seen.has(key))continue;
    if(key)seen.add(key);
    matched.push({...row,_teamRole:role.role});
  }
  matched.sort((a,b)=>String(b.date??'').localeCompare(String(a.date??''))||String(b.id??'').localeCompare(String(a.id??'')));
  return {
    reason:null,
    rows:matched,
    stats:selectedStats(matched,target,selectionSlot,{stage}),
    role:currentRole.role,
    line:target.line,
    selectionSlot,
    selectionLabel:selection.label,
    currentOdds:target.odds[selectionSlot],
    mode:comparisonMode,
    sameRole
  };
}

export function feedFreshness(feed,now=Date.now(),staleMinutes=2){
  if(!feed||!Array.isArray(feed.events))return {kind:'missing',label:'승인된 경기·배당 소스 대기'};
  const captured=Date.parse(feed.fetchedAt||feed.capturedAt||'');
  if(!Number.isFinite(captured))return {kind:'invalid',label:'소스 갱신 시각이 없습니다.'};
  const ageMinutes=Math.max(0,(now-captured)/60000);
  if(feed.refreshState?.error)return {kind:'stale',label:'공식 조회 실패 · 이전 값',ageMinutes};
  if(ageMinutes>staleMinutes)return {kind:'stale',label:`갱신 후 ${Math.floor(ageMinutes)}분 경과`,ageMinutes};
  return {kind:'live',label:ageMinutes<1?'공식 조회 1분 이내':`공식 조회 ${Math.floor(ageMinutes)}분 전`,ageMinutes};
}

export function eventHasAvailableMarket(event,now=Date.now()){
  return Date.parse(event?.startsAt)>now&&Array.isArray(event?.markets)&&event.markets.some(market=>
    (market.available===true||market.available==null&&event.available!==false)&&!market.pending&&market.outcomes?.length>=2&&
    (!market.saleClosesAt||Date.parse(market.saleClosesAt)>now));
}

function recommendationEvidence(id,label,mode,stats,context={}){
  const eligible=!!stats&&stats.n>=3;
  return {id,label,mode,stats:stats||null,eligible,support:eligible&&stats.rate>=.7,conflict:eligible&&stats.rate<.5,...context};
}

const evidenceScopeRank={sport:1,league:2,team:3};

const recommendationIndexCache=new WeakMap();

function scopeRank(item){
  return evidenceScopeRank[item?.scope]||0;
}

function recommendationBaseKey(market,line){
  const normalized=canonicalMarket(market),normalizedLine=marketUsesLine(normalized)?lineValue(line):null;
  return `${normalized}\u0000${normalizedLine===null?'—':String(normalizedLine)}`;
}

function quoteKey(odds,slots=[0,1,2]){
  return slots.map(slot=>`${slot}:${priceCents(odds?.[slot])??'—'}`).join('|');
}

function historicalQuoteKeys(odds){
  // A two-way screen compares only home/away (or under/over), while a
  // three-way screen also compares the draw slot. Keep both keys so a
  // historical three-way quote can still be a valid two-way comparison.
  return [quoteKey(odds,[0,2]),quoteKey(odds,[0,1,2])];
}

function exactScopeKey(value){
  return `${typeof value}:${String(value)}`;
}

function addIndexedRow(bucket,key,row){
  if(!bucket.has(key))bucket.set(key,[]);
  bucket.get(key).push(row);
}

function createRecommendationScope({includeTeams=false}={}){
  return {combo:new Map(),price:[new Map(),new Map(),new Map()],band:[new Map(),new Map(),new Map()],teamCombo:includeTeams?new Map():null,teamPrice:includeTeams?[new Map(),new Map(),new Map()]:null};
}

function indexRecommendationRow(scope,row,includeTeams){
  const odds=row.closing||[],combos=historicalQuoteKeys(odds);
  for(const combo of combos)addIndexedRow(scope.combo,combo,row);
  for(const slot of [0,1,2]){
    const cents=priceCents(odds[slot]),band=priceBand(odds[slot],.05);
    if(cents!==null)addIndexedRow(scope.price[slot],String(cents),row);
    if(band)addIndexedRow(scope.band[slot],String(band.lower),row);
  }
  if(!includeTeams)return;
  for(const [role,team] of [['home',row.home],['away',row.away]]){
    const teamKey=canonicalTeam(team);
    if(!teamKey)continue;
    for(const combo of combos)addIndexedRow(scope.teamCombo,`${role}\u0000${teamKey}\u0000${combo}`,row);
    for(const slot of [0,1,2]){
      const cents=priceCents(odds[slot]);
      if(cents!==null)addIndexedRow(scope.teamPrice[slot],`${role}\u0000${teamKey}\u0000${cents}`,row);
    }
  }
}

function recommendationIndex(rows){
  if(Array.isArray(rows)&&recommendationIndexCache.has(rows))return recommendationIndexCache.get(rows);
  const bases=new Map();
  for(const row of rows){
    const market=canonicalMarket(row?.market);
    if(!market||!Array.isArray(row?.closing)||row.closing.length<3)continue;
    const key=recommendationBaseKey(market,row.line);
    if(!bases.has(key))bases.set(key,{sport:createRecommendationScope({includeTeams:true}),leagues:new Map()});
    const base=bases.get(key);
    indexRecommendationRow(base.sport,row,true);
    const league=exactScopeKey(row.league);
    if(!base.leagues.has(league))base.leagues.set(league,createRecommendationScope());
    indexRecommendationRow(base.leagues.get(league),row,false);
  }
  if(Array.isArray(rows))recommendationIndexCache.set(rows,bases);
  return bases;
}

function indexMatches(bucket,key,target){
  const seen=new Set(),matches=[];
  for(const row of bucket?.get(key)||[]){
    if(!beforeCutoff(row,target))continue;
    const rowKey=String(row?.id??row?.event??'');
    if(rowKey&&seen.has(rowKey))continue;
    if(rowKey)seen.add(rowKey);
    matches.push(row);
  }
  return matches;
}

function indexedScopeEvidence(scope,target,selection){
  const quote=quoteKey(target.odds,target.selections.map(item=>item.slot)),cents=priceCents(selection.odds),band=priceBand(selection.odds,.05);
  return {
    combo:indexMatches(scope?.combo,quote,target),
    outcome:cents===null?[]:indexMatches(scope?.price?.[selection.slot],String(cents),target),
    band:!band?[]:indexMatches(scope?.band?.[selection.slot],String(band.lower),target),
    oddsBand:band
  };
}

function indexedTeamEvidence(scope,target,team,role,selection){
  const teamKey=canonicalTeam(team),quote=quoteKey(target.odds,target.selections.map(item=>item.slot)),cents=priceCents(selection.odds);
  if(!teamKey||cents===null)return {combo:[],outcome:[]};
  return {
    combo:indexMatches(scope?.teamCombo,`${role}\u0000${teamKey}\u0000${quote}`,target),
    outcome:indexMatches(scope?.teamPrice?.[selection.slot],`${role}\u0000${teamKey}\u0000${cents}`,target)
  };
}

function hasSaleClosedQuote(event,market){
  return /발매 종료/.test(`${event?.status||''} ${market?.status||''}`)&&Array.isArray(market?.outcomes)&&market.outcomes.length>=2;
}

function recommendationRank(candidate){
  const eligible=candidate.evidence.filter(item=>item.eligible);
  const support=eligible.filter(item=>item.support);
  const supportedScopes=new Set(support.map(item=>item.scope).filter(Boolean));
  const highestSupportScopeRank=Math.max(0,...support.map(scopeRank));
  return {...candidate,evidenceCount:eligible.length,supportCount:support.length,conflictCount:eligible.filter(item=>item.conflict).length,historicalExploration:true,supportedScopeCount:supportedScopes.size,highestSupportScopeRank};
}

// Descriptive screening, using settled archive cases before the target day.
// Every offered selection is checked against the full quote combination, the
// selected price alone, and (when the selection names a team) that team's
// records at the sport, league, and team scopes. Under/over selections additionally retain their
// exact total line and show each current team's game-total history. The
// overlapping samples stay separate instead of being pooled into a misleading
// synthetic win rate.
export function exploreHistoricalPatterns(events,rows,now=Date.now()){
  const found=[];
  const indexed=recommendationIndex(rows);
  for(const event of events){
    if(Date.parse(event.startsAt)<=now||!Number.isFinite(Date.parse(event.startsAt)))continue;
    const eventHasClosedQuote=event.markets?.some(market=>hasSaleClosedQuote(event,market));
    if(event.available===false&&!eventHasClosedQuote)continue;
    for(const market of event.markets){
      const closedQuote=hasSaleClosedQuote(event,market);
      if((market.available===false&&!closedQuote)||market.pending||!market.outcomes?.length)continue;
      if(['SUM','승5패','전반','전반_핸디캡','전반_언오버'].includes(canonicalMarket(market.market,market.marketLabel)))continue;
      const target=makeTarget(event,market);
      const indexedBase=indexed.get(recommendationBaseKey(target.market,target.line));
      const scopes=[
        {scope:'sport',scopeLabel:'같은 종목',index:indexedBase?.sport},
        {scope:'league',scopeLabel:'같은 리그',index:indexedBase?.leagues.get(exactScopeKey(event.league))}
      ];
      const candidates=[];
      const totalMarket=isUnderOverMarket(target.market);
      for(const selection of target.selections){
        if(priceCents(selection.odds)<140)continue;
        const evidence=[];
        for(const scope of scopes){
          const matches=indexedScopeEvidence(scope.index,target,selection);
          const context={scope:scope.scope,scopeLabel:scope.scopeLabel,line:totalMarket?target.line:null};
          evidence.push(
            recommendationEvidence(`${scope.scope}-combo`,`${scope.scopeLabel} · ${totalMarket?'동일 기준값·배당 조합':'동일 배당 조합'}`,'combo',selectedStats(matches.combo,target,selection.slot),{...context,family:totalMarket?'under_over_line_combo':'quote_combo'}),
            recommendationEvidence(`${scope.scope}-outcome`,`${scope.scopeLabel} · ${totalMarket?'기준값·선택 배당':'선택 배당 하나'}`,'outcome',selectedStats(matches.outcome,target,selection.slot),{...context,family:totalMarket?'under_over_line_price':'outcome_price'}),
            recommendationEvidence(`${scope.scope}-price-band`,`${scope.scopeLabel} · ${totalMarket?'기준값·정확한 선택 배당':'정확한 선택 배당'}`,'outcome',selectedStats(matches.band,target,selection.slot),{...context,family:totalMarket?'under_over_line_price_band':'outcome_price_band',oddsBand:matches.oddsBand})
          );
        }
        if(totalMarket&&target.teamNamesVerified){
          for(const [teamRoleLabel,team,teamRole] of [['홈팀',event.home,'home'],['원정팀',event.away,'away']]){
            const teamMatches=indexedTeamEvidence(indexedBase?.sport,target,team,teamRole,selection);
            evidence.push(
              recommendationEvidence(`${teamRoleLabel==='홈팀'?'home':'away'}-team-under-over-combo`,`같은 팀 · ${teamRoleLabel} ${team} 포함 · 동일 기준값·배당 조합`,'combo',selectedStats(teamMatches.combo,target,selection.slot),{scope:'team',scopeLabel:'같은 팀',family:'team_under_over_line_combo',team,teamRole:teamRoleLabel,line:target.line}),
              recommendationEvidence(`${teamRoleLabel==='홈팀'?'home':'away'}-team-under-over-price`,`같은 팀 · ${teamRoleLabel} ${team} 포함 · 기준값·선택 배당`,'outcome',selectedStats(teamMatches.outcome,target,selection.slot),{scope:'team',scopeLabel:'같은 팀',family:'team_under_over_line_price',team,teamRole:teamRoleLabel,line:target.line})
            );
          }
        }else if(target.teamNamesVerified){
          const teamContexts=selection.slot===1
            ?[['홈팀',event.home,'home','home-team-draw'],['원정팀',event.away,'away','away-team-draw']]
            :selection.slot===0
              ?[['홈팀',event.home,'home','team']]
              :selection.slot===2
                ?[['원정팀',event.away,'away','team']]
                :[];
          for(const [teamRoleLabel,team,teamRole,evidenceId] of teamContexts){
            if(!team||!isTeamMarket(target.market))continue;
            const teamMatches=indexedTeamEvidence(indexedBase?.sport,target,team,teamRole,selection);
            const teamLabel=selection.slot===1?`같은 팀 · ${teamRoleLabel} ${team} 포함`:`같은 팀 · ${team}`;
            evidence.push(
              recommendationEvidence(`${evidenceId}-combo`,`${teamLabel} · 동일 조합`,'combo',selectedStats(teamMatches.combo,target,selection.slot),{scope:'team',scopeLabel:'같은 팀',family:'team_quote_combo',team,teamRole:teamRoleLabel}),
              recommendationEvidence(`${evidenceId}-outcome`,`${teamLabel} · 같은 배당`,'outcome',selectedStats(teamMatches.outcome,target,selection.slot),{scope:'team',scopeLabel:'같은 팀',family:'team_outcome_price',team,teamRole:teamRoleLabel})
            );
          }
        }
        const ranked=recommendationRank({eventId:event.id,marketId:market.id,slot:selection.slot,selection,event,market,evidence,possibilities:target.selections.length});
        if(ranked.evidenceCount>0){
          const strongest=[...ranked.evidence].filter(item=>item.support).sort((a,b)=>b.stats.rate-a.stats.rate||b.stats.n-a.stats.n)[0];
          const bestAvailable=[...ranked.evidence].filter(item=>item.eligible).sort((a,b)=>b.stats.rate-a.stats.rate||b.stats.n-a.stats.n)[0];
          candidates.push({...ranked,mode:strongest?.mode||bestAvailable?.mode||'outcome'});
        }
      }
      candidates.sort((a,b)=>a.slot-b.slot);
      found.push(...candidates);
    }
  }
  return found.sort((a,b)=>Date.parse(a.event.startsAt)-Date.parse(b.event.startsAt)||String(a.eventId).localeCompare(String(b.eventId))||String(a.marketId).localeCompare(String(b.marketId))||a.slot-b.slot);
}

function priceBin(value){
  const cents=priceCents(value);
  return cents!==null&&cents>=140?priceBand(value,.05):null;
}

function scopeLine(row){
  return marketUsesLine(row.market)?lineValue(row.line):null;
}

function accumulator(){
  return {n:0,wins:0,odds:0,implied:0,impliedN:0,first:null,last:null,examples:[]};
}

function exampleFor(row,slot){
  const odds=row.closing||[];
  const others=odds.filter((value,index)=>index!==slot&&numeric(value)>1);
  return {date:row.date,event:row.event,marketId:row.id,home:row.home,away:row.away,line:scopeLine(row),result:row.result,selectedOdds:odds[slot],otherOdds:others[0]||null,won:resultIndex(row)===slot};
}

function addToAccumulator(value,row,slot,keepExamples=true){
  value.n++;
  if(resultIndex(row)===slot)value.wins++;
  const selected=numeric(row.closing?.[slot]);
  if(selected>1)value.odds+=selected;
  const valid=(row.closing||[]).filter(item=>numeric(item)>1);
  if(selected>1&&valid.length>=2){value.implied+=(1/selected)/valid.reduce((sum,item)=>sum+1/item,0);value.impliedN++;}
  const date=String(row.date||'');
  value.first=!value.first||date<value.first?date:value.first;
  value.last=!value.last||date>value.last?date:value.last;
  if(keepExamples){value.examples.push(exampleFor(row,slot));if(value.examples.length>3)value.examples.shift();}
}

function accumulatorStats(value){
  const n=value?.n||0,wins=value?.wins||0;
  return {n,wins,losses:n-wins,winRate:n?wins/n:0,wilson95:n?wilson95(wins,n):null,averageOdds:n?value.odds/n:null,marketExpectedRate:value?.impliedN?value.implied/value.impliedN:null,dateRange:value?.first?[value.first,value.last]:[],examples:value?.examples||[]};
}

function groupValue(map,key,scope){
  if(!map.has(key))map.set(key,{scope,train:accumulator(),holdout:accumulator()});
  return map.get(key);
}

function comparison(train,holdout){
  const trainStats=accumulatorStats(train),holdoutStats=accumulatorStats(holdout);
  return {minimumHoldoutSamples:5,minimumHoldoutSamplesMet:holdoutStats.n>=5,holdoutRateInsideTrainWilson95:!!(trainStats.wilson95&&holdoutStats.winRate>=trainStats.wilson95.lower&&holdoutStats.winRate<=trainStats.wilson95.upper),holdoutRateMinusTrainRate:holdoutStats.winRate-trainStats.winRate,selectionUsedHoldout:false};
}

function ranked(items,score){
  return items.filter(item=>score(item).n>=3).sort((left,right)=>{
    const a=score(left),b=score(right);
    return b.winRate-a.winRate||b.n-a.n||(b.wilson95?.lower||0)-(a.wilson95?.lower||0)||left.id.localeCompare(right.id);
  }).slice(0,1200);
}

// Lightweight, sport-agnostic pattern catalog. It is calculated from the
// currently loaded source, so source patches are reflected without shipping a
// second, stale report file for every sport.
export function buildPatternReport(rows,{sport=''}={}){
  const eligible=rows.filter(row=>!['SUM','승5패','전반','전반_핸디캡','전반_언오버'].includes(row.market)&&resultIndex(row)!==null&&Array.isArray(row.closing)&&row.closing.some(value=>numeric(value)>1)).sort((left,right)=>String(left.date).localeCompare(String(right.date))||String(left.id).localeCompare(String(right.id)));
  const splitAt=eligible[Math.max(0,Math.floor(eligible.length*.75))]?.date||'';
  const outcomes=new Map(),sportOutcomes=new Map(),teams=new Map(),pairs=new Map(),teamTotals=new Map();
  for(const row of eligible){
    const isHoldout=splitAt&&String(row.date)>=splitAt;
    const side=isHoldout?'holdout':'train';
    const line=scopeLine(row),lineKey=line===null?'—':String(line);
    const slots=(row.closing||[]).map((value,index)=>numeric(value)>1?index:null).filter(index=>index!==null);
    for(const slot of slots){
      const bin=priceBin(row.closing[slot]);
      if(!bin)continue;
      const outcomeScope={league:row.league,sampleScope:'league',market:row.market,line,stage:'closing',oddsBin:bin,outcome:{index:slot,label:outcomeLabels(row.market)[slot]||`선택 ${slot+1}`}};
      const outcomeKey=[row.league,row.market,lineKey,slot,bin.lower].join('|');
      addToAccumulator(groupValue(outcomes,outcomeKey,outcomeScope)[side],row,slot);
      const sportOutcomeScope={...outcomeScope,league:'전체',sampleScope:'sport'};
      const sportOutcomeKey=[row.market,lineKey,slot,bin.lower].join('|');
      addToAccumulator(groupValue(sportOutcomes,sportOutcomeKey,sportOutcomeScope)[side],row,slot);
      if(isTeamMarket(row.market)&&(slot===0||slot===2)){
        const team=slot===0?row.home:row.away,role=slot===0?'home':'away';
        const teamScope={...outcomeScope,league:'전체',sampleScope:'team',sourceLeague:row.league,team,teamRole:role};
        const teamKey=[row.market,lineKey,role,canonicalTeam(team),bin.lower].join('|');
        addToAccumulator(groupValue(teams,teamKey,teamScope)[side],row,slot);
      }
      // A total outcome is shared by both teams. Keep the exact line,
      // selected quote band, and team role so the catalog matches the
      // role-restricted screening used for an upcoming fixture.
      if(isUnderOverMarket(row.market)&&line!==null){
        for(const [teamRole,team] of [['home',row.home],['away',row.away]]){
          const teamKey=canonicalTeam(team);
          if(!teamKey)continue;
          const teamTotalScope={...outcomeScope,league:'전체',sampleScope:'team',sourceLeague:row.league,team,teamRole,comparison:'team included'};
          const teamTotalKey=[row.market,lineKey,teamRole,teamKey,slot,bin.lower].join('|');
          addToAccumulator(groupValue(teamTotals,teamTotalKey,teamTotalScope)[side],row,slot);
        }
      }
    }
    if(slots.length===2&&slots.includes(0)&&slots.includes(2)){
      const homeBin=priceBin(row.closing[0]),awayBin=priceBin(row.closing[2]);
      if(homeBin&&awayBin){
        const pairScope={league:row.league,sampleScope:'league',market:row.market,line,stage:'closing',homeOddsBin:{...homeBin,label:outcomeLabels(row.market)[0]||'홈'},awayOddsBin:{...awayBin,label:outcomeLabels(row.market)[2]||'원정'}};
        const pairKey=[row.league,row.market,lineKey,homeBin.lower,awayBin.lower].join('|');
        const group=groupValue(pairs,pairKey,pairScope);
        if(!group[side].home){group[side].n=0;group[side].home=accumulator();group[side].away=accumulator();}
        group[side].n++;
        addToAccumulator(group[side].home,row,0);
        addToAccumulator(group[side].away,row,2);
      }
    }
  }
  const allOutcomeRows=[...outcomes.values(),...sportOutcomes.values()].map(group=>{
    const train=accumulatorStats(group.train),holdout=accumulatorStats(group.holdout);
    return {id:`${sport}:outcome:${group.scope.sampleScope}:${group.scope.league}:${group.scope.market}:${group.scope.line}:${group.scope.outcome.index}:${group.scope.oddsBin.lower}`,family:'outcome_odds_bin',scope:group.scope,train,holdout,holdoutComparison:comparison(group.train,group.holdout),trainingFlags:{historicalHighWinRate:train.winRate>=.7,minimumSamplesMet:train.n>=3,rankedOnlyOnTraining:true}};
  });
  const outcomeRows=ranked(allOutcomeRows,item=>item.train);
  const teamRows=ranked([...teams.values()].map(group=>{
    const train=accumulatorStats(group.train),holdout=accumulatorStats(group.holdout);
    return {id:`${sport}:team:${group.scope.sampleScope}:${group.scope.market}:${group.scope.line}:${group.scope.teamRole}:${canonicalTeam(group.scope.team)}:${group.scope.oddsBin.lower}`,family:'team_outcome_odds_bin',scope:group.scope,train,holdout,holdoutComparison:comparison(group.train,group.holdout),trainingFlags:{historicalHighWinRate:train.winRate>=.7,minimumSamplesMet:train.n>=3,rankedOnlyOnTraining:true}};
  }),item=>item.train);
  // `outcomeOdds` already stores total line + price. Expose a focused view so
  // a fast screen never has to infer that a generic outcome row is an
  // under/over pattern.
  const underOverRows=ranked(allOutcomeRows.filter(row=>isUnderOverMarket(row.scope.market)).map(row=>({
    ...row,
    id:`${sport}:under-over:${row.scope.sampleScope}:${row.scope.league}:${row.scope.market}:${row.scope.line}:${row.scope.outcome.index}:${row.scope.oddsBin.lower}`,
    family:'under_over_line_odds_bin',
    sourcePatternId:row.id
  })),item=>item.train);
  const teamUnderOverRows=ranked([...teamTotals.values()].map(group=>{
    const train=accumulatorStats(group.train),holdout=accumulatorStats(group.holdout);
    return {id:`${sport}:team-under-over:${group.scope.sampleScope}:${group.scope.market}:${group.scope.line}:${group.scope.teamRole}:${canonicalTeam(group.scope.team)}:${group.scope.outcome.index}:${group.scope.oddsBin.lower}`,family:'team_under_over_line_odds_bin',scope:group.scope,train,holdout,holdoutComparison:comparison(group.train,group.holdout),trainingFlags:{historicalHighWinRate:train.winRate>=.7,minimumSamplesMet:train.n>=3,rankedOnlyOnTraining:true}};
  }),item=>item.train);
  const pairRows=ranked([...pairs.values()].map(group=>{
    const trainHome=accumulatorStats(group.train.home),trainAway=accumulatorStats(group.train.away),holdoutHome=accumulatorStats(group.holdout.home),holdoutAway=accumulatorStats(group.holdout.away);
    return {id:`${sport}:pair:${group.scope.league}:${group.scope.market}:${group.scope.line}:${group.scope.homeOddsBin.lower}:${group.scope.awayOddsBin.lower}`,family:'two_way_odds_pair',scope:group.scope,train:{n:group.train.n||0,outcomes:{home:trainHome,away:trainAway}},holdout:{n:group.holdout.n||0,outcomes:{home:holdoutHome,away:holdoutAway}},holdoutComparison:{home:comparison(group.train.home,group.holdout.home),away:comparison(group.train.away,group.holdout.away),selectionUsedHoldout:false},trainingFlags:{historicalHighWinRate:Math.max(trainHome.winRate,trainAway.winRate)>=.7,minimumSamplesMet:(group.train.n||0)>=3,rankedOnlyOnTraining:true}};
  }),item=>({n:item.train.n||0,winRate:Math.max(item.train.outcomes.home.winRate,item.train.outcomes.away.winRate),wilson95:{lower:Math.max(item.train.outcomes.home.wilson95?.lower||0,item.train.outcomes.away.wilson95?.lower||0)}}));
  const trainObservations=eligible.filter(row=>String(row.date)<splitAt).length;
  return {schemaVersion:3,kind:'runtime-pattern-catalog',asOf:eligible.at(-1)?.date||null,split:{method:'시간 순서 75/25 분리',holdoutStart:splitAt},summary:{eligibleObservations:eligible.length,trainObservations,holdoutObservations:eligible.length-trainObservations},patterns:{outcomeOdds:outcomeRows,teamOutcomeOdds:teamRows,twoWayOddsPairs:pairRows,underOverLineOdds:underOverRows,teamUnderOverLineOdds:teamUnderOverRows}};
}

function compactScanStats(stats){
  if(!stats)return null;
  return {
    n:stats.n||0,
    wins:stats.wins||0,
    losses:stats.losses||0,
    winRate:stats.winRate||0,
    wilson95:stats.wilson95||null,
    averageOdds:stats.averageOdds??null,
    marketExpectedRate:stats.marketExpectedRate??null,
    dateRange:Array.isArray(stats.dateRange)?stats.dateRange:[],
    examples:Array.isArray(stats.examples)?stats.examples:[]
  };
}

function scanEntry(pattern,{family=pattern.family,stats=pattern.train,holdout=pattern.holdout,selection=null}={}){
  const compact=compactScanStats(stats),future=compactScanStats(holdout);
  return {
    id:selection?.side?`${pattern.id}:${selection.side}`:pattern.id,
    family,
    scope:pattern.scope,
    selection,
    stats:compact,
    holdout:future,
    holdoutComparison:pattern.holdoutComparison||null,
    confidenceLower:compact?.wilson95?.lower??0,
    rankedOn:'trainingOnly'
  };
}

// Compact, fast-scan view of the catalog. It only uses the time-ordered
// training segment to qualify and rank a row. Holdout results travel beside
// the item for inspection but cannot improve its rank. This keeps the screen
// short while preserving the distinction between a historical observation and
// a prediction.
export function highSignalCatalog(report,{minimumSamples=3,minimumWinRate=.7,limit=120}={}){
  const minSamples=Math.max(3,Math.floor(numeric(minimumSamples)??3));
  const minWinRate=Math.max(.7,numeric(minimumWinRate)??.7);
  const maxItems=Math.max(1,Math.floor(numeric(limit)??120));
  const patterns=report?.patterns||{};
  const entries=[];
  const addSimple=(items,family)=>{
    for(const pattern of Array.isArray(items)?items:[]){
      entries.push(scanEntry(pattern,{family,selection:{slot:pattern.scope?.outcome?.index??null,label:pattern.scope?.outcome?.label||'선택',oddsBand:pattern.scope?.oddsBin||null}}));
    }
  };
  // Generic outcome rows contain total markets too. The focused total family
  // below is used instead so the same under/over pattern is not shown twice.
  addSimple((patterns.outcomeOdds||[]).filter(pattern=>!isUnderOverMarket(pattern.scope?.market)),'outcome_price_band');
  addSimple(patterns.teamOutcomeOdds,'team_price_band');
  addSimple(patterns.underOverLineOdds,'under_over_line_price_band');
  addSimple(patterns.teamUnderOverLineOdds,'team_under_over_line_price_band');
  for(const pattern of Array.isArray(patterns.twoWayOddsPairs)?patterns.twoWayOddsPairs:[]){
    for(const side of ['home','away']){
      const stats=pattern.train?.outcomes?.[side],holdout=pattern.holdout?.outcomes?.[side];
      entries.push(scanEntry(pattern,{family:'two_way_price_pair',stats,holdout,selection:{side,label:side==='home'?pattern.scope?.homeOddsBin?.label||'홈':pattern.scope?.awayOddsBin?.label||'원정',oddsBand:side==='home'?pattern.scope?.homeOddsBin||null:pattern.scope?.awayOddsBin||null}}));
    }
  }
  const catalogScopeRank=item=>evidenceScopeRank[item?.scope?.sampleScope]||0;
  const items=entries.filter(item=>item.stats&&item.stats.n>=minSamples&&item.stats.winRate>=minWinRate).sort((left,right)=>{
    return right.confidenceLower-left.confidenceLower||right.stats.n-left.stats.n||right.stats.winRate-left.stats.winRate||left.id.localeCompare(right.id);
  }).slice(0,maxItems);
  return {
    schemaVersion:1,
    kind:'high-signal-fast-scan',
    asOf:report?.asOf||null,
    rankedOn:'trainingOnly',
    thresholds:{minimumSamples:minSamples,minimumWinRate:minWinRate},
    total:items.length,
    items
  };
}

export function buildHighSignalCatalog(rows,{sport='',...options}={}){
  return highSignalCatalog(buildPatternReport(rows,{sport}),options);
}

// Backward-compatible name for saved consumers; descriptive exploration only.
export const recommendPatterns=exploreHistoricalPatterns;
