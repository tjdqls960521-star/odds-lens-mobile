import {assertVector,assertAsOfInput,canonicalEventId,marketIdentity,settlement,isUtc} from '../public/odds-lens/prediction-core.mjs';

export async function hashValue(value){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value)));
 return [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');
}
function db(env){if(!env?.DB)throw Error('원장 DB 연결이 없습니다.');return env.DB;}
const decode=row=>row?JSON.parse(row.data):null;
async function batch(env,records){
 const groups=new Map();
 for(const r of records){const key=r.table+':'+r.columns.join(',');if(!groups.has(key))groups.set(key,{table:r.table,columns:r.columns,rows:[]});groups.get(key).rows.push(r.values);}
 const statements=[];
 for(const {table,columns,rows} of groups.values()){
  const size=Math.max(1,Math.floor(90/columns.length));
  for(let i=0;i<rows.length;i+=size){const chunk=rows.slice(i,i+size);statements.push(db(env).prepare(`INSERT OR IGNORE INTO ${table} (${columns.join(',')}) VALUES ${chunk.map(()=>`(${columns.map(()=>'?').join(',')})`).join(',')}`).bind(...chunk.flat()));}
 }
 for(let i=0;i<statements.length;i+=40)await db(env).batch(statements.slice(i,i+40));
}
const insert=(_env,table,columns,values)=>({table,columns,values});
export async function leaseCollection(env,now){
 if(!env?.DB)return true; // Existing lookup remains available if migration is unavailable.
 const token=crypto.randomUUID();
 const result=await db(env).prepare('INSERT INTO collection_locks (id,expires_at,token) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at,token=excluded.token WHERE collection_locks.expires_at < ?').bind('betman',now+30000,token,now).run();
 return (result.meta?.changes||0)>0;
}
export async function preserveCollection(env,feed,rawPayloads,previousFeed=null){
 if(!env?.ODDS_STORE)throw Error('원본 스냅샷 저장소가 없습니다.');
 const rawHash=await hashValue(rawPayloads),observed=feed.fetchedAt,collectionId=await hashValue([observed,rawHash]);
 // Content-addressed objects never replace a different source response.
 await env.ODDS_STORE.put(`odds-lens/ledger/raw/${rawHash}.json`,JSON.stringify(rawPayloads),{httpMetadata:{contentType:'application/json'}});
 const statements=[insert(env,'collections',['id','observed_at','raw_hash','data'],[collectionId,observed,rawHash,JSON.stringify({source:feed.sourceId,observedAt:observed,priceUpdatedAt:null,rawHash,rounds:feed.rounds})])];
 const old=new Map((previousFeed?.events||[]).flatMap(e=>e.markets.map(m=>[m.id,m])));
 const snapshots=[];
 const semantics=m=>JSON.stringify([m.outcomes,m.line,m.period,m.saleStatus,m.saleClosesAt,m.rulesetVersion,m.canonicalMarketId]);
 for(const event of feed.events){
  const eventId=event.canonicalEventId||canonicalEventId(event),eventData={...event,markets:undefined};
  statements.push(insert(env,'events',['id','sport','league','start_at','data','created_at'],[eventId,event.sport,event.league||'',event.startsAt,JSON.stringify(eventData),observed]));
  for(const market of event.markets){
   const marketId=market.canonicalMarketId||marketIdentity(eventId,market),offerId=market.id,prior=old.get(offerId);
   // A source sale item whose kickoff/teams changed is retained as a new
   // observation, but is not silently declared a second independent event.
   if(prior?.canonicalMarketId&&prior.canonicalMarketId!==marketId&&previousFeed?.events?.some(e=>e.markets.some(m=>m.id===offerId)&&e.id!==event.id))market.identityUncertain=true;
   const unchanged=prior?.snapshotId&&semantics(prior)===semantics(market)&&Date.parse(observed)-Date.parse(prior.snapshotObservedAt)<15*60000;
   if(unchanged){market.snapshotId=prior.snapshotId;market.snapshotObservedAt=prior.snapshotObservedAt;market.inputSnapshotHash=prior.inputSnapshotHash;continue;}
   const snapshot={contractVersion:3,sourceId:feed.sourceId,eventId,marketId,offerId,observedAt:observed,availableAt:observed,priceUpdatedAt:null,rawHash,collectionId,market:market.market,outcomes:market.outcomes,outcomeKeys:market.outcomeKeys,period:market.period,line:market.line,rulesetVersion:market.rulesetVersion,probabilityBasis:market.probabilityBasis,saleStatus:market.saleStatus,qualityFlags:[...(market.pending?['INCOMPLETE_MARKET']:[]),...(market.identityUncertain?['UNKNOWN_EVENT_IDENTITY']:[]),...(feed.partial?['PARTIAL_SOURCE']:[])]};
   const snapshotId=await hashValue(snapshot);snapshot.id=snapshotId;
   market.snapshotId=snapshotId;market.snapshotObservedAt=observed;market.inputSnapshotHash=await hashValue(snapshot);
   statements.push(insert(env,'markets',['id','event_id','data'],[marketId,eventId,JSON.stringify({id:marketId,eventId,market:market.market,period:market.period,line:market.line,outcomeKeys:market.outcomeKeys,officialMarketType:market.officialMarketType,rulesetVersion:market.rulesetVersion,probabilityBasis:market.probabilityBasis})]));
   statements.push(insert(env,'offers',['id','data','created_at'],[offerId,JSON.stringify({id:offerId,provider:'betman',product:'G101',year:market.year,round:market.round,sourceGameNo:market.gameNumber}),observed]));
   statements.push(insert(env,'quote_snapshots',['id','event_id','market_id','offer_id','observed_at','raw_hash','data'],[snapshotId,eventId,marketId,offerId,observed,rawHash,JSON.stringify(snapshot)]));
   snapshots.push({event,market,snapshot});
  }
 }
 await batch(env,statements);
 return {rawHash,collectionId,snapshots};
}
export function validatePredictionRecord(p){
 if(p.p_market!==null)assertVector(p.p_market,p.market.outcomeKeys.length);
 if(p.p_model!==null)assertVector(p.p_model,p.market.outcomeKeys.length);
 assertAsOfInput({availableAt:p.snapshot_available_at,observedAt:p.snapshot_observed_at,priceUpdatedAt:p.price_updated_at},p.prediction_as_of);
 if(!p.snapshot_id||!p.input_snapshot_hash||Date.parse(p.prediction_as_of)>=Date.parse(p.event.startsAt))throw Error('NOT_PRE_EVENT_PREDICTION');
 if(p.p_model&&!p.model_version)throw Error('MISSING_MODEL_VERSION');
 if(p.train_cutoff&&Date.parse(p.train_cutoff)>=Date.parse(p.prediction_as_of))throw Error('FUTURE_TRAINING_DATA');
}
export async function appendPredictions(env,items){
 const statements=[];
 for(const p of items){validatePredictionRecord(p);statements.push(insert(env,'predictions',['id','event_id','market_id','offer_id','snapshot_id','as_of','model_version','eligibility','data'],[p.prediction_id,p.event_id,p.market_id,p.offer_id,p.snapshot_id,p.prediction_as_of,p.model_version,p.eligibility,JSON.stringify(p)]));}
 await batch(env,statements);
}
export async function appendResultRevisions(env,sport,rows,knownAt,rawHash){
 if(!isUtc(knownAt))throw Error('INVALID_RESULT_KNOWN_AT');
 const offers=(await db(env).prepare('SELECT o.id,o.data,s.data AS snapshot,e.data AS event FROM offers o JOIN quote_snapshots s ON s.offer_id=o.id JOIN events e ON e.id=s.event_id WHERE s.observed_at=(SELECT MAX(q.observed_at) FROM quote_snapshots q WHERE q.offer_id=o.id)').all()).results||[];
 const bySource=new Map();
 for(const row of offers){const offer=JSON.parse(row.data),snapshot=JSON.parse(row.snapshot),event=JSON.parse(row.event);if(event.sport!==sport)continue;bySource.set(`${offer.year}-${Number(String(offer.round).slice(2))}-${offer.sourceGameNo}`,{offer,snapshot,event});}
 const priorRows=(await db(env).prepare('SELECT r.source_key,r.data FROM result_revisions r WHERE r.source_key LIKE ? AND r.known_at=(SELECT MAX(p.known_at) FROM result_revisions p WHERE p.source_key=r.source_key)').bind(sport+':%').all()).results||[];
 const latest=new Map(priorRows.map(r=>[r.source_key,JSON.parse(r.data)]));
 const statements=[];
 for(const row of rows){
  const sourceKey=`${sport}:${row.id}`,contentHash=await hashValue(row);
  const candidate=bySource.get(row.id);
  const clean=v=>String(v||'').normalize('NFKC').replace(/[\s_]+/g,'');
  const contract=candidate?.snapshot;
  const exact=!!candidate&&clean(candidate.event.home)===clean(row.home)&&clean(candidate.event.away)===clean(row.away)&&contract.period===(String(row.market).includes('전반')?'first_half':'full')&&contract.market===row.market&&(['일반','승1패'].includes(row.market)||(row.line!==null&&Number(row.line)===contract.line));
  const match=exact?candidate:null,snapshot=match?.snapshot;
  const previous=latest.get(sourceKey);
  if(previous?.contentHash===contentHash&&previous?.marketId===(snapshot?.marketId||null))continue;
  const id=await hashValue([sourceKey,contentHash,knownAt,snapshot?.marketId||null]);
  // Sale item mapping is exact; unverified or unmatched source results stay
  // in the raw revision ledger and cannot become training labels.
  const outcomeKeys=snapshot?.outcomeKeys||[],result=settlement(row.result,outcomeKeys,row.market);
  const data={id,sourceKey,knownAt,rawHash,contentHash,rawResult:row.result,sourceRow:row,scoreMeaning:'unverified_source_adjusted_values',eventId:snapshot?.eventId||null,marketId:snapshot?.marketId||null,offerId:match?.offer.id||null,rulesetVersion:snapshot?.rulesetVersion||null,verified:false,...result};
  statements.push(insert(env,'result_revisions',['id','source_key','offer_id','event_id','market_id','known_at','status','raw_hash','data'],[id,sourceKey,data.offerId,data.eventId,data.marketId,knownAt,result.status,rawHash,JSON.stringify(data)]));
 }
 await batch(env,statements);
 return rows.length;
}
export async function evidence(env,id){
 const p=decode(await db(env).prepare('SELECT data FROM predictions WHERE id=?').bind(id).first());
 if(!p)return null;
 const snapshot=decode(await db(env).prepare('SELECT data FROM quote_snapshots WHERE id=?').bind(p.snapshot_id).first());
 const results=(await db(env).prepare('SELECT data FROM result_revisions WHERE market_id=? ORDER BY known_at,id').bind(p.market_id).all()).results.map(decode);
 return {prediction:p,snapshot,resultRevisions:results};
}
export async function ledgerSummary(env,{cursor='',limit=30}={}){
 const counts=await db(env).prepare("SELECT (SELECT COUNT(*) FROM events) events,(SELECT COUNT(*) FROM markets) markets,(SELECT COUNT(*) FROM quote_snapshots) snapshots,(SELECT COUNT(*) FROM predictions) predictions,(SELECT COUNT(*) FROM predictions WHERE model_version IS NOT NULL) modelPredictions,(SELECT COUNT(*) FROM result_revisions) resultRevisions,(SELECT MIN(observed_at) FROM collections) firstObservation").first();
 const rows=(await db(env).prepare('SELECT id,as_of,data FROM predictions WHERE (?=\'\' OR as_of||id < ?) ORDER BY as_of DESC,id DESC LIMIT ?').bind(cursor,cursor,Math.min(100,limit)).all()).results;
 const evaluations=(await db(env).prepare('SELECT data FROM evaluations ORDER BY created_at DESC LIMIT 20').all()).results.map(decode);
 return {counts,records:rows.map(decode),nextCursor:rows.length===Math.min(100,limit)?rows.at(-1).as_of+rows.at(-1).id:null,evaluations};
}
export async function exportLedger(env,{cursor='',limit=1000,table='predictions'}={}){
 if(!['predictions','quote_snapshots','result_revisions','evaluations','events','markets','offers','collections'].includes(table))throw Error('INVALID_EXPORT_TABLE');
 const rows=(await db(env).prepare(`SELECT id,data FROM ${table} WHERE id>? ORDER BY id LIMIT ?`).bind(cursor,Math.min(1000,limit)).all()).results;
 return {table,records:rows.map(decode),nextCursor:rows.length===Math.min(1000,limit)?rows.at(-1).id:null};
}
export async function appendEvaluation(env,report){
 if(!report.evaluation_id||!isUtc(report.created_at||report.createdAt))throw Error('INVALID_EVALUATION_PROVENANCE');
 const previous=decode(await db(env).prepare('SELECT data FROM evaluations WHERE id=?').bind(report.evaluation_id).first());
 if(previous){if(JSON.stringify(previous)!==JSON.stringify(report))throw Error('IMMUTABLE_EVALUATION_CONFLICT');return;}
 await batch(env,[insert(env,'evaluations',['id','created_at','model_version','data'],[report.evaluation_id,report.created_at||report.createdAt,report.model_version||null,JSON.stringify(report)])]);
}
export async function readEvaluation(env,id){return decode(await db(env).prepare('SELECT data FROM evaluations WHERE id=?').bind(id).first());}
