// Presentation state for reviewing many fixtures; no prediction or payout policy.
export const MAX_COMPARE=4;
export const marketOrder=['일반','핸디캡','언오버','승1패'];
export function orderedMarkets(event,type='all'){
 return [...(event?.markets||[])].filter(m=>type==='all'||m.market===type).sort((a,b)=>{
  const priority=m=>{const i=marketOrder.indexOf(m.market);return i<0?99:i;};
  return priority(a)-priority(b)||Number(b.available===true)-Number(a.available===true)||String(b.round||'').localeCompare(String(a.round||''))||(Date.parse(b.observedAt)||0)-(Date.parse(a.observedAt)||0)||Number(a.gameNumber||0)-Number(b.gameNumber||0)||String(a.id).localeCompare(String(b.id));
 });
}
export function chooseMarket(event,type='all',preferredId=''){
 const markets=orderedMarkets(event,type);
 return markets.find(m=>String(m.id)===String(preferredId))||markets[0]||null;
}
export function reviewToken(event){
 return JSON.stringify([event?.startsAt,event?.saleClosesAt,(event?.markets||[]).map(m=>[m.id,m.market,m.line??null,m.saleStatus,m.available,m.pending,(m.outcomes||[]).map(o=>[o.key,o.odds]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))]);
}
export function reviewState(event,reviewed={}){
 const token=reviewed[event.id];return !token?'new':token===reviewToken(event)?'reviewed':'updated';
}
export function toggleCompare(ids,id){
 const clean=[...new Set(ids.filter(v=>typeof v==='string'))].slice(0,MAX_COMPARE);
 if(clean.includes(id))return {ids:clean.filter(v=>v!==id),action:'removed'};
 if(clean.length>=MAX_COMPARE)return {ids:clean,action:'limit'};
 return {ids:[...clean,id],action:'added'};
}
export function comparisonColumns(ids,events,type='일반',preferred={}){
 const byId=new Map(events.filter(Boolean).map(e=>[String(e.id),e]));
 return ids.map(id=>{const event=byId.get(String(id))||null;return {id,event,market:chooseMarket(event,type,preferred[id])};});
}
export function eventDayGroups(events){
 const format=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}),groups=new Map();
 for(const event of events){const date=Date.parse(event.startsAt),day=Number.isFinite(date)?format.format(new Date(date)):'시각 미확인';if(!groups.has(day))groups.set(day,[]);groups.get(day).push(event);}
 return [...groups].map(([day,events])=>({day,events}));
}
export function outcomeAtSlot(market,slot){
 if(!market?.outcomes?.length)return null;
 return market.outcomes[market.outcomes.length===2?(slot===0?0:slot===2?1:-1):slot]||null;
}
