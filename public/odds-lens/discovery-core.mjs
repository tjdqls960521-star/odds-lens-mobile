const rank={A:3,B:2,C:1};
export const isTeamEvidence=item=>['homeTeam','awayTeam'].includes(item.scope);
const family=item=>isTeamEvidence(item)?'team':item.scope;
const perfect=item=>item.n>0&&item.wins===item.n;

// Presentation only. The statistical selection policy and sample counts remain
// unchanged. A highlighted 3/3 team cohort never borrows a broader A grade.
export function discoveryRecords(groups,{focus='all',minimum=3,grade='all',sort='agreement'}={}){
  const records=[];
  for(const {event,markets} of groups)for(const {market,pattern} of markets)for(const rec of pattern.recommendations||[]){
    const evidence=rec.evidence.filter(item=>item.n>=minimum);
    let choices=evidence;
    if(focus==='team')choices=choices.filter(isTeamEvidence);
    if(focus==='perfect')choices=choices.filter(perfect);
    const scopeCount=new Set(evidence.map(family)).size;
    if(focus==='agreement'&&scopeCount<2)continue;
    if(!choices.length)continue;
    const ownTeam=item=>(item.scope==='homeTeam'&&rec.slot===0)||(item.scope==='awayTeam'&&rec.slot===2);
    choices=[...choices].sort((a,b)=>Number(isTeamEvidence(b))-Number(isTeamEvidence(a))||Number(perfect(b))-Number(perfect(a))||Number(ownTeam(b))-Number(ownTeam(a))||b.rate-a.rate||b.n-a.n||Number(b.basis==='single')-Number(a.basis==='single'));
    const lead=choices[0],displayGrade=rec.conflicting?'C':lead.grade;
    if(grade!=='all'&&displayGrade!==grade)continue;
    records.push({event,market,pattern,rec,lead,evidence,scopeCount,grade:displayGrade,perfect:perfect(lead),hasPerfect:evidence.some(perfect),hasTeam:evidence.some(isTeamEvidence)});
  }
  const stable=(a,b)=>a.event.startsAt.localeCompare(b.event.startsAt)||String(a.market.id).localeCompare(String(b.market.id))||a.rec.slot-b.rec.slot;
  records.sort((a,b)=>{
    if(sort==='time')return stable(a,b);
    if(sort==='samples')return b.lead.n-a.lead.n||b.lead.rate-a.lead.rate||stable(a,b);
    if(sort==='team')return Number(b.hasTeam)-Number(a.hasTeam)||Number(b.perfect)-Number(a.perfect)||b.lead.n-a.lead.n||stable(a,b);
    return b.scopeCount-a.scopeCount||rank[b.grade]-rank[a.grade]||Number(b.hasTeam)-Number(a.hasTeam)||b.lead.interval.lower-a.lead.interval.lower||stable(a,b);
  });
  return records;
}

export function evidenceTitle(event,market,slot,item){
  const total=market.market==='언오버',team=item.scope==='homeTeam'?event.home:item.scope==='awayTeam'?event.away:null;
  const position=item.scope==='homeTeam'?'홈':'원정';
  const outcome=market.market==='승1패'?['홈 2점차 이상 승','① 1점차 이내','원정 2점차 이상 승'][slot]:total?(slot===0?'언더':'오버'):slot===0?'홈 승':slot===1?'무승부':'원정 승';
  const price=Number(market.outcomes[market.outcomes.length===2?(slot===0?0:1):slot]?.odds).toFixed(2);
  const simpleWin=market.market==='일반'&&team&&((item.scope==='homeTeam'&&slot===0)||(item.scope==='awayTeam'&&slot===2));
  const scope=team?`${team} · ${position}`:item.scope==='league'?event.league:'같은 종목';
  const quote=item.basis==='combo'?'이 배당 조합':`${price}배`;
  return {scope,quote,outcome,line:market.line,text:simpleWin?`${team}, ${quote}에서 ${item.n}전 ${item.wins}승`:`${scope}, ${quote}에서 ${outcome} ${item.wins}/${item.n}회`};
}
