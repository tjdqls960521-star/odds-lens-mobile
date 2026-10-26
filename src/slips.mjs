import {validStake,resolvePick,resolveOfficialPick,normalizePick,slipSummary} from '../public/odds-lens/slip-core.mjs';
import {unpackHistoricalRows} from './history-core.mjs';
import {resultRound} from './betman-results.mjs';
const db=env=>{if(!env?.DB)throw Error('픽 기록 저장소 연결 실패');return env.DB;};

export function prepareSlip(input,feed,now=new Date()){
  if(!/^[a-zA-Z0-9-]{16,80}$/.test(input?.id||''))throw Error('기록 번호를 확인해주세요.');
  if(!validStake(input.stake))throw Error('금액은 1원~10억원 사이의 정수로 입력해주세요.');
  if(!Array.isArray(input.picks)||!input.picks.length||input.picks.length>20)throw Error('픽은 1~20개까지 담을 수 있습니다.');
  if(!feed?.fetchedAt||now-Date.parse(feed.fetchedAt)>5*60000)throw Error('공식 배당을 갱신한 뒤 저장해주세요.');
  const used=new Set();
  const picks=input.picks.map(request=>{
    const event=feed.events.find(e=>String(e.id)===String(request.eventId));
    const market=event?.markets.find(m=>String(m.id)===String(request.marketId));
    const outcome=market?.outcomes.find(o=>o.key===request.outcomeKey);
    if(!event||!market||!outcome||market.period==='first_half'||/전반/.test(market.market))throw Error('공식 경기표에서 찾을 수 없는 픽입니다.');
    if(Date.parse(event.startsAt)<=now.getTime())throw Error('이미 시작한 경기는 새 기록에 담을 수 없습니다.');
    if(market.pending||market.saleStatus==='suspended')throw Error('배당 미발표·발매 중지 항목은 담을 수 없습니다.');
    if(Number(request.odds)!==Number(outcome.odds))throw Error('배당이 변경됐습니다. 해당 픽을 제거하고 현재 배당으로 다시 담아주세요.');
    if(used.has(event.id))throw Error('같은 경기에서는 한 가지 픽만 담을 수 있습니다.');
    used.add(event.id);
    return {eventId:event.id,marketId:market.id,canonicalMarketId:market.canonicalMarketId,sport:event.sport,league:event.league,home:event.home,away:event.away,startsAt:event.startsAt,
      year:market.year,round:market.round,gameNumber:market.gameNumber,market:market.market,line:market.line,outcomeKeys:market.outcomes.map(o=>o.key),outcomeKey:outcome.key,label:outcome.label,odds:Number(outcome.odds),observedAt:market.observedAt||feed.fetchedAt,saleStatus:market.saleStatus};
  });
  const slip={id:input.id,createdAt:now.toISOString(),stake:Number(input.stake),picks,kind:'paper'};
  if(!Number.isSafeInteger(slipSummary(slip).expected))throw Error('조합 금액이 너무 큽니다. 픽 수 또는 금액을 줄여주세요.');
  return slip;
}

export async function saveSlip(env,input,feed){
  const previous=await db(env).prepare('SELECT data FROM pick_slips WHERE id=?').bind(input?.id||'').first();
  if(previous){
    const saved=JSON.parse(previous.data),shape=picks=>picks.map(p=>[p.eventId,p.marketId,p.outcomeKey,Number(p.odds)]);
    if(saved.stake!==Number(input.stake)||JSON.stringify(shape(saved.picks))!==JSON.stringify(shape(input.picks||[])))throw Error('이미 저장된 기록입니다. 기록을 확인한 뒤 새 조합으로 담아주세요.');
    return saved;
  }
  const slip=prepareSlip(input,feed);
  await db(env).prepare('INSERT OR IGNORE INTO pick_slips (id,created_at,data) VALUES (?,?,?)').bind(slip.id,slip.createdAt,JSON.stringify(slip)).run();
  return slip;
}
export async function listSlips(env,cursor=''){
  const records=(await db(env).prepare("SELECT data FROM pick_slips WHERE (?='' OR created_at < ?) ORDER BY created_at DESC,id DESC LIMIT 51").bind(cursor,cursor).all()).results||[];
  const slips=records.slice(0,50).map(row=>JSON.parse(row.data));
  return {slips,nextCursor:records.length>50?slips.at(-1).createdAt:null};
}
export function attachSlipResults(slips,histories,officials={},now=Date.now()){
  const indices=new Map(Object.entries(histories).map(([sport,record])=>[sport,{rows:new Map(unpackHistoricalRows(record.rows||[]).map(row=>[row.id,row])),knownAt:record.lastSuccess}]));
  const officialRows=new Map(Object.values(officials).flatMap(record=>(record.rows||[]).map(row=>[row.marketId,row])));
  return slips.map(slip=>{
    const picks=slip.picks.map(original=>{
      const pick=normalizePick(original),official=officials[resultRound(pick)],row=officialRows.get(pick.marketId);
      if(official){
        const result=resolveOfficialPick(pick,row,official,now);
        // A verified current official offer is authoritative, including a
        // correction/retraction or an explicitly withheld ambiguous result.
        if(row||!indices.get(pick.sport)?.rows.size)return {...pick,result};
      }
      const index=indices.get(pick.sport),id=`${pick.year}-${Number(String(pick.round).slice(2))}-${pick.gameNumber}`;
      const historical=resolvePick(pick,index?.rows.get(id),index?.knownAt);
      return {...pick,result:historical.status!=='pending'||!official?historical:resolveOfficialPick(pick,null,official,now)};
    });
    const item={...slip,picks};return {...item,summary:slipSummary(item)};
  });
}
