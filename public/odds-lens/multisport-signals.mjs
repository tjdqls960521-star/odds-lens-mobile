import {pythonRound4} from './traffic-light-core.mjs';
import {validQuote,quoteComparable} from './quote-history-core.mjs';
export const SIGNAL_SPORTS={baseball:'야구',soccer:'축구',basketball:'농구',volleyball:'배구'};
const icons={green:'🟢',yellow:'🟡',red:'🔴'};
const sameKeys=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
export function oddsShares(outcomes){
  if(![2,3].includes(outcomes?.length)||outcomes.some(o=>typeof o.odds!=='number'||!Number.isFinite(o.odds)||o.odds<=1))return null;
  const inverse=outcomes.map(o=>1/o.odds),total=inverse.reduce((a,b)=>a+b,0);
  return inverse.map(p=>100*p/total);
}
export function analyzeMarketSignal(market){
  const outcomes=market?.outcomes||[],first=market?.oddsHistory?.first;
  const labels=outcomes.map(o=>o.label||o.key),keys=outcomes.map(o=>o.key);
  const base={model:'domestic-v1',labels,keys,color:'missing',direction:null,supports:[],signal:'',bothMain:false,qualified:[],supportTotal:Math.max(0,outcomes.length-1),early:outcomes.map(()=>null),current:oddsShares(outcomes)||outcomes.map(()=>null),earlyOdds:outcomes.map(o=>first?.outcomes?.find(v=>v.key===o.key)?.odds??null),currentOdds:outcomes.map(o=>o.odds),differences:null,changes:null,firstObservedAt:first?.observedAt||null};
  if(!validQuote(market)||Array.isArray(market.outcomeKeys)&&!sameKeys(market.outcomeKeys,keys))return {...base,reason:'incomplete'};
  if(!first||!validQuote(first))return {...base,reason:'no-baseline'};
  if(!quoteComparable(first,market))return {...base,reason:'conditions',previousLine:first.line??null,currentLine:market.line??null};
  if(!Number.isFinite(Date.parse(first.observedAt))||!Number.isFinite(Date.parse(market.observedAt))||Date.parse(first.observedAt)>Date.parse(market.observedAt))return {...base,reason:'time'};
  const ordered=outcomes.map(o=>first.outcomes.find(p=>p.key===o.key)),early=oddsShares(ordered),current=base.current;
  const differences=early.map((p,i)=>pythonRound4(p*.01-current[i]*.01)),changes=differences.map(d=>-d*100);
  // Generalized markets also evaluate the middle outcome (draw / one-run / five-point).
  // Display the largest increase; retain all simultaneous qualifying directions.
  const qualified=differences.map((d,i)=>i).filter(i=>differences[i]<=-.05).sort((a,b)=>differences[a]-differences[b]||keys[a].localeCompare(keys[b]));
  const direction=qualified[0]??null,supports=direction===null?[]:differences.map((d,i)=>i).filter(i=>i!==direction&&differences[i]>=.03);
  // Absolute support count keeps the original color semantics: do not invent
  // a second independent confirmation in complementary two-outcome markets.
  const color=direction===null?'none':supports.length===2?'green':supports.length===1?'yellow':'red';
  return {...base,early,current,differences,changes,direction,supports,color,qualified,reason:null,signal:direction===null?'':`${icons[color]} ${labels[direction]}`};
}
export function marketSignalInterpretation(a){
  if(a.color==='missing')return ({incomplete:'현재 배당의 선택지가 모두 공개되지 않아 판정을 보류합니다.','no-baseline':'비교할 최초 관측 배당이 아직 없어 판정을 보류합니다.',conditions:'기준점·시장·선택지가 최초 기록과 달라 직접 비교하지 않습니다.',time:'관측 시각을 확인할 수 없어 판정을 보류합니다.'})[a.reason]||'비교할 배당 자료를 확인하고 있습니다.';
  if(a.color==='none')return '최초 관측 대비 5%p 이상 증가한 선택지가 없어 신호가 없습니다.';
  const main=`${a.labels[a.direction]}의 배당 환산 비중이 ${a.changes[a.direction].toFixed(2)}%p 증가했습니다.`;
  if(a.labels.length===2)return `${main} 반대 결과의 비중도 같은 폭으로 감소합니다. 2결과 시장의 노랑 방향 신호이며, 독립된 보조 근거 2개를 뜻하지 않습니다.`;
  return `${main} 다른 결과 ${a.supports.length}개가 3%p 이상 감소했습니다.${a.qualified.length>1?' 동시에 조건을 충족한 방향 중 증가 폭이 가장 큰 방향을 표시합니다.':''}`;
}
export function buildDomesticSignals(feed,{now=new Date(),error=null,historyError=null}={}){
  const day=new Date(now.getTime()+9*3600000).toISOString().slice(0,10),rows=[],coverage=Object.fromEntries(Object.keys(SIGNAL_SPORTS).map(s=>[s,{matches:0,markets:0,waiting:0,comparable:0,signals:0}]));
  const fetchedAt=feed?.fetchedAt||null,stale=!!error||!fetchedAt||!Number.isFinite(Date.parse(fetchedAt))||now-Date.parse(fetchedAt)>120000;
  for(const event of feed?.events||[]){
    if(!SIGNAL_SPORTS[event.sport]||!Number.isFinite(Date.parse(event.startsAt)))continue;
    const displayTime=new Date(Date.parse(event.startsAt)+9*3600000).toISOString().slice(0,16).replace('T',' '),queryDate=displayTime.slice(0,10);
    if(queryDate<day)continue;
    coverage[event.sport].matches++;
    for(const market of event.markets||[]){
      coverage[event.sport].markets++;
      if(!market.outcomes?.length){coverage[event.sport].waiting++;continue;}
      const analysis=analyzeMarketSignal(market);
      if(analysis.color!=='missing')coverage[event.sport].comparable++;
      if(analysis.direction!==null)coverage[event.sport].signals++;
      rows.push({id:market.id,eventId:event.id,sport:event.sport,league:event.league,home:event.home,away:event.away,startsAt:event.startsAt,displayTime,queryDate,market:market.marketLabel||market.market,line:market.line??null,period:market.period||'full',saleStatus:market.saleStatus,started:Date.parse(event.startsAt)<=now.getTime(),fetchedAt:market.observedAt||fetchedAt,stale:stale||!market.observedAt||now-Date.parse(market.observedAt)>120000,analysis});
    }
  }
  rows.sort((a,b)=>a.startsAt.localeCompare(b.startsAt)||a.league.localeCompare(b.league)||String(a.id).localeCompare(String(b.id)));
  return {sourceId:'betman-multisport-signals-v1',sourceName:'베트맨 공식 · 전 종목',sourceUrl:'https://www.betman.co.kr/',fetchedAt,error,historyError,stale,generatedAt:now.toISOString(),coverage,dates:[...new Set(rows.map(e=>e.queryDate))].sort(),events:rows,days:[]};
}
