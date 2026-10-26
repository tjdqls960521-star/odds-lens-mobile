import {quotePoint,quoteSummary} from '../public/odds-lens/quote-history-core.mjs';

// The existing append-only snapshot ledger is the source of truth. Compress
// consecutive identical prices in SQL before returning records to the Worker.
// Sale status, heartbeat snapshots, labels and prediction changes are not prices.
const historyCte=where=>`WITH prices AS (
 SELECT q.*,json_array(json_extract(q.data,'$.market'),COALESCE(json_extract(q.data,'$.period'),'full'),json_extract(q.data,'$.line'),
  (SELECT json_group_array(json_array(json_extract(value,'$.key'),json_extract(value,'$.odds'))) FROM
   (SELECT value FROM json_each(q.data,'$.outcomes') ORDER BY json_extract(value,'$.key')))) AS price_state
 FROM quote_snapshots q WHERE ${where}
 AND json_array_length(q.data,'$.outcomes') IN (2,3)
 AND NOT EXISTS (SELECT 1 FROM json_each(q.data,'$.outcomes') WHERE COALESCE(json_type(value,'$.odds'),'') NOT IN ('integer','real') OR json_extract(value,'$.odds')<=1)
), ordered AS (
 SELECT *,LAG(price_state) OVER (PARTITION BY offer_id,event_id ORDER BY observed_at,id) AS previous_state,
 LAG(data) OVER (PARTITION BY offer_id,event_id ORDER BY observed_at,id) AS previous_data FROM prices
), changes AS (SELECT * FROM ordered WHERE previous_state IS NULL OR price_state<>previous_state), ranked AS (
 SELECT *,ROW_NUMBER() OVER (PARTITION BY offer_id,event_id ORDER BY observed_at,id) AS first_rank,
 ROW_NUMBER() OVER (PARTITION BY offer_id,event_id ORDER BY observed_at DESC,id DESC) AS last_rank,
 COUNT(*) OVER (PARTITION BY offer_id,event_id) AS point_count FROM changes
)`;
const decodePoint=row=>quotePoint(JSON.parse(row.data),row.previous_data?JSON.parse(row.previous_data):null);
const groupKey=(offer,event)=>`${offer}\u0000${event}`;
function groupedSummary(rows,lastSeenAt){
 const first=rows.find(r=>Number(r.first_rank)===1),latest=rows.find(r=>Number(r.last_rank)===1);
 return first&&latest?quoteSummary(decodePoint(first),decodePoint(latest),latest.point_count,lastSeenAt):null;
}
export async function attachQuoteSummaries(env,feed){
 if(!env?.DB)throw Error('배당 이력 저장소에 연결하지 못했습니다.');
 const ids=[...new Set((feed.events||[]).flatMap(e=>(e.markets||[]).map(m=>m.id)))],byOffer=new Map();
 for(let offset=0;offset<ids.length;offset+=80){
  const chunk=ids.slice(offset,offset+80);
  const sql=historyCte(`q.offer_id IN (${chunk.map(()=>'?').join(',')})`)+` SELECT offer_id,event_id,data,previous_data,first_rank,last_rank,point_count FROM ranked WHERE first_rank=1 OR last_rank=1`;
  const rows=(await env.DB.prepare(sql).bind(...chunk).all()).results||[];
  for(const row of rows){const key=groupKey(row.offer_id,row.event_id);if(!byOffer.has(key))byOffer.set(key,[]);byOffer.get(key).push(row);}
 }
 for(const event of feed.events||[])for(const market of event.markets||[]){
  market.oddsHistory=groupedSummary(byOffer.get(groupKey(market.id,event.canonicalEventId||event.id))||[],market.observedAt||feed.fetchedAt);
 }
 feed.oddsHistoryVersion=1;
 return feed;
}
export async function readQuoteHistory(env,offerId,eventId,{cursor='',limit=100}={}){
 if(!/^betman-\d{6}-\d{1,8}$/.test(offerId)||typeof eventId!=='string'||!eventId.startsWith('event:')||eventId.length>2048)throw Error('INVALID_HISTORY_REQUEST');
 if(!env?.DB)throw Error('배당 이력 저장소에 연결하지 못했습니다.');
 let before='',beforeId='';
 if(cursor){
  let value;try{value=JSON.parse(cursor);}catch{throw Error('INVALID_HISTORY_CURSOR');}
  if(!Array.isArray(value)||value.length!==2||!/^\d{4}-\d\d-\d\dT.*Z$/.test(value[0])||!Number.isFinite(Date.parse(value[0]))||!/^[a-f0-9]{64}$/.test(value[1]))throw Error('INVALID_HISTORY_CURSOR');
  [before,beforeId]=value;
 }
 const size=Math.max(1,Math.min(100,Math.floor(Number(limit)||100))),cte=historyCte('q.offer_id=? AND q.event_id=?');
 const [ends,page]=await Promise.all([
  env.DB.prepare(cte+' SELECT * FROM ranked WHERE first_rank=1 OR last_rank=1').bind(offerId,eventId).all(),
  env.DB.prepare(cte+` SELECT * FROM ranked WHERE (?='' OR observed_at<? OR (observed_at=? AND id<?)) ORDER BY observed_at DESC,id DESC LIMIT ?`).bind(offerId,eventId,before,before,before,beforeId,size+1).all()
 ]);
 const summary=groupedSummary(ends.results||[]);
 if(!summary)return null;
 const rows=page.results||[],shown=rows.slice(0,size),last=shown.at(-1);
 return {offerId,eventId,summary,points:shown.map(decodePoint),nextCursor:rows.length>size?JSON.stringify([last.observed_at,last.id]):null,timeBasis:'app-observed-kst',notice:'최초 기록은 앱이 처음 확인한 배당입니다. 실제 발매 최초 배당이나 공식 변경 시각과 다를 수 있습니다. 30초 주기 조회 사이에 발생한 변경은 누락될 수 있습니다.'};
}
