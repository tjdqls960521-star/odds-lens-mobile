// A price history begins at the first valid quote actually observed by this app.
// Never infer an official opening price or an upstream publication timestamp.
export function validQuote(quote){
  const outcomes=quote?.outcomes;
  return [2,3].includes(outcomes?.length)&&new Set(outcomes.map(o=>o.key)).size===outcomes.length&&outcomes.every(o=>typeof o.key==='string'&&typeof o.odds==='number'&&Number.isFinite(o.odds)&&o.odds>1);
}
export function quoteComparable(a,b){
  return !!a&&!!b&&a.market===b.market&&(a.period||'full')===(b.period||'full')&&(a.line??null)===(b.line??null)&&JSON.stringify(a.outcomes.map(o=>o.key).sort())===JSON.stringify(b.outcomes.map(o=>o.key).sort());
}
export function priceDelta(first,current,key){
  if(!quoteComparable(first,current))return null;
  const before=first.outcomes.find(o=>o.key===key)?.odds,after=current.outcomes.find(o=>o.key===key)?.odds;
  if(!(before>1)||!(after>1))return null;
  return Math.round((after-before)*100)/100;
}
export function quotePoint(snapshot,previous=null){
  const point={id:snapshot.id,observedAt:snapshot.observedAt,market:snapshot.market,period:snapshot.period||'full',line:snapshot.line??null,outcomes:snapshot.outcomes.map(o=>({key:o.key,label:o.label||o.key,odds:o.odds}))};
  point.kind=!previous?'first':quoteComparable(previous,point)?'price':'conditions';
  point.previousLine=previous?.line??null;
  point.deltas=Object.fromEntries(point.outcomes.map(o=>[o.key,previous?priceDelta(previous,point,o.key):null]));
  return point;
}
export function quoteSummary(first,latest,pointCount,lastSeenAt){
  const changeCount=Math.max(0,Number(pointCount)-1);
  return {version:1,basis:'first-observed',officialOpeningKnown:false,first,latest,changeCount,lastChangedAt:changeCount?latest.observedAt:null,lastSeenAt:lastSeenAt||latest.observedAt,comparable:quoteComparable(first,latest)};
}
export const hasQuoteChanges=market=>Number(market?.oddsHistory?.changeCount)>0;
export function latestEventChange(event){return Math.max(0,...(event.markets||[]).map(m=>Date.parse(m.oddsHistory?.lastChangedAt)||0));}
