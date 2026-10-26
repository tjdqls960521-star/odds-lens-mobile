import {getSignals} from './nowgoal-signals.mjs';
import {buildDomesticSignals} from '../public/odds-lens/multisport-signals.mjs';
import {collectFeed,emptyFeed,SOURCE_ID} from './betman-feed.mjs';
import {HISTORY_FIELDS,HISTORY_SOURCES,latestHistoricalDate,normalizeHistoricalCsv,overlapStart,packHistoricalRows,sourceUrl,unpackHistoricalRows} from './history-core.mjs';

import {appendEvaluation,readEvaluation,leaseCollection,preserveCollection,appendResultRevisions,evidence,ledgerSummary,exportLedger,hashValue} from './ledger.mjs';
import {recordDecisions,currentPredictions,highProbabilityResponse} from './prediction-service.mjs';
import {FEATURE_FLAGS} from './model-registry.mjs';
import modelReport from './validation-status.json' with {type:'json'};
import {saveSlip,listSlips,attachSlipResults} from './slips.mjs';
import {preserveOfficialResults,officialResultsForPicks,officialResultStatus} from './betman-results.mjs';
import {normalizePick} from '../public/odds-lens/slip-core.mjs';
import {attachQuoteSummaries,readQuoteHistory} from './quote-history.mjs';

const STORAGE_KEY='odds-lens/betman-official-feed-v2.json';
const HISTORY_KEY_PREFIX='odds-lens/history-v2/';
const REFRESH_INTERVAL_MS=30000;
const HISTORY_REFRESH_INTERVAL_MS=15*60*1000;
const MAX_HISTORY_DELTA_BYTES=18000000;
let cachedState=null;
let inFlight=null;
const historyCached=new Map();
const historyInFlight=new Map();

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const fallback=()=>({feed:emptyFeed(),lastAttempt:null,error:null});
const validState=value=>value&&typeof value==='object'&&value.feed?.sourceId===SOURCE_ID&&Array.isArray(value.feed.events);
const historyFallback=source=>({source:source.key,rows:[],lastAttempt:null,lastSuccess:null,sourceLatestAt:source.baselineMax,lastDeltaRows:0,error:null});
const validHistoryState=(value,source)=>value&&typeof value==='object'&&value.source===source.key&&Array.isArray(value.rows);

async function saved(env,preferStore=false){
 if(cachedState&&!preferStore)return cachedState;
 if(!env?.ODDS_STORE)return cachedState||(cachedState=fallback());
 try{
  const object=await env.ODDS_STORE.get(STORAGE_KEY);
  if(object){const state=JSON.parse(await object.text());if(validState(state))return cachedState=state;}
 }catch{}
 return cachedState||(cachedState=fallback());
}

async function persist(env,state){
 cachedState=state;
 if(!env?.ODDS_STORE)return state;
 try{await env.ODDS_STORE.put(STORAGE_KEY,JSON.stringify(state),{httpMetadata:{contentType:'application/json'}});}
 catch(error){state.error=`저장된 최신값 기록 실패: ${error.message}`;}
 cachedState=state;
 return state;
}

function refreshDue(previous,force=false,now=Date.now()){
 const hasPreviousEvents=Array.isArray(previous.feed?.events)&&previous.feed.events.length>0;
 // An empty board must be retried promptly, but must not make every open tab
 // start another upstream collection while the source is unavailable.
 if(!hasPreviousEvents)return !previous.lastAttempt||now-previous.lastAttempt>=10000;
 if(previous.lastAttempt&&now-previous.lastAttempt<(force?5000:REFRESH_INTERVAL_MS))return false;
 if(!force&&now-Date.parse(previous.feed.fetchedAt)<REFRESH_INTERVAL_MS)return false;
 return true;
}

async function update(env,force=false){
 const previous=await saved(env),now=Date.now();
 if(!refreshDue(previous,force,now))return previous;
 if(inFlight)return inFlight;
 inFlight=(async()=>{
  let result={...previous,lastAttempt:now,error:null};
  try{
   if(!await leaseCollection(env,now))return previous;
   const collected=await collectFeed(fetch,new Date(),{retainRaw:true});
   const {rawPayloads,...feed}=collected;
   // An upstream product-list change must never replace a last known official
   // fixture board with an empty success response.  Treat it as a failed
   // refresh so callers retain the last verified domestic Betman quotes.
   if(!Array.isArray(feed?.events)||feed.events.length===0)throw Error('베트맨 승부식 경기표가 비어 있어 기존 공식 배당을 유지합니다.');
   result.feed=feed;
   try{await Promise.all(rawPayloads.map(payload=>preserveOfficialResults(env,payload,feed.fetchedAt,feed.sourceUrl)));result.resultsError=null;}
   catch(error){result.resultsError=error.message;}
   try{
    const archived=await preserveCollection(env,feed,rawPayloads,previous.ledgerVersion===3&&!previous.ledgerError?previous.feed:null);
    await recordDecisions(env,feed,archived.snapshots,previous.feed);
    await appendEvaluation(env,modelReport);
    result.ledgerVersion=3;result.ledgerError=null;
    try{await attachQuoteSummaries(env,feed);result.quoteHistoryError=null;}catch(error){result.quoteHistoryError=error.message;}
   }catch(error){result.ledgerError=`배당·예측 원장 저장 실패: ${error.message}`;}
  }catch(error){
   result.error=`원본 재수집 실패: ${error.message}`;
   console.error('Betman official collection failed',JSON.stringify({reason:error.message,lastOfficialAt:previous.feed?.fetchedAt||null,attemptedAt:new Date(now).toISOString()}));
  }
  return persist(env,result);
 })();
 try{return await inFlight;}finally{inFlight=null;}
}

// Page reads return the last official snapshot immediately. Collection and
// ledger writes continue in the Worker background, so a slow Betman response
// cannot time out a mobile page load or multiply upstream requests per tab.
async function currentState(env,ctx){
 // Other Worker isolates may have written a newer snapshot after a manual
 // refresh. Read durable storage for page requests instead of trusting an
 // indefinitely cached copy in this isolate.
 const previous=await saved(env,true);
 if(previous.feed?.events?.length&&ctx?.waitUntil){
  if(refreshDue(previous))ctx.waitUntil(update(env));
  return previous;
 }
 return update(env);
}

async function savedHistory(env,key,preferStore=false){
 const source=HISTORY_SOURCES[key];
 if(!source)throw Error('지원하지 않는 과거 원본입니다.');
 if(historyCached.has(key)&&!preferStore)return historyCached.get(key);
 let state=historyCached.get(key)||historyFallback(source);
 if(env?.ODDS_STORE){
  try{
   const object=await env.ODDS_STORE.get(`${HISTORY_KEY_PREFIX}${key}.json`);
   if(object){const savedState=JSON.parse(await object.text());if(validHistoryState(savedState,source))state=savedState;}
  }catch{}
 }
 historyCached.set(key,state);
 return state;
}

async function persistHistory(env,key,state){
 historyCached.set(key,state);
 if(!env?.ODDS_STORE)return state;
 try{await env.ODDS_STORE.put(`${HISTORY_KEY_PREFIX}${key}.json`,JSON.stringify(state),{httpMetadata:{contentType:'application/json'}});}
 catch(error){state.error=`과거 기록 저장 실패: ${error.message}`;}
 return state;
}

async function textHash(text){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
 return [...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('');
}

async function updateHistory(env,key,force=false){
 const source=HISTORY_SOURCES[key];
 if(!source)throw Error('지원하지 않는 과거 원본입니다.');
 const previous=await savedHistory(env,key,true),now=Date.now();
 const needsMarketBackfill=key==='baseball'&&previous.marketSupportVersion!==2;
 if(!force&&previous.lastAttempt&&now-previous.lastAttempt<60000)return previous;
 if(!force&&!needsMarketBackfill&&previous.lastSuccess&&now-Date.parse(previous.lastSuccess)<HISTORY_REFRESH_INTERVAL_MS)return previous;
 if(historyInFlight.has(key))return historyInFlight.get(key);
 const task=(async()=>{
  let result={...previous,lastAttempt:now,error:null};
  try{
   // Previously excluded 승1패 rows need one catch-up from the bundled
   // archive boundary, even if other markets were synced more recently.
   const start=overlapStart(needsMarketBackfill?source.baselineMax:previous.sourceLatestAt||source.baselineMax,14);
   if(!start)throw Error('마지막 과거 기록 시각이 올바르지 않습니다.');
   const response=await fetch(sourceUrl(source,`where H >= datetime '${start}'`),{signal:AbortSignal.timeout(45000)});
   if(!response.ok)throw Error(`원본 응답 ${response.status}`);
   const text=await response.text();
   if(text.length>MAX_HISTORY_DELTA_BYTES)throw Error('증분 원본이 허용 크기를 넘었습니다.');
   const hash=await textHash(text);
   if(!needsMarketBackfill&&hash===previous.tailHash&&hash===previous.resultLedgerHash){
    result={...result,lastSuccess:new Date(now).toISOString(),lastDeltaRows:0,error:null};
    return persistHistory(env,key,result);
   }
   const incoming=normalizeHistoricalCsv(text,source);
   try{
    if(!env?.ODDS_STORE)throw Error('결과 원본 저장소가 없습니다.');
    await env.ODDS_STORE.put(`odds-lens/ledger/history-raw/${hash}.csv`,text,{httpMetadata:{contentType:'text/csv'}});
    await appendResultRevisions(env,key,incoming,new Date().toISOString(),hash);
    result.resultLedgerError=null;result.resultLedgerHash=hash;
   }catch(error){result.resultLedgerError=error.message;}
   const merged=new Map(unpackHistoricalRows(previous.rows).map(row=>[row.id,row]));
   let changedRows=0;
   for(const row of incoming){
    const existing=merged.get(row.id);
    if(!existing||JSON.stringify(existing)!==JSON.stringify(row))changedRows++;
    merged.set(row.id,row);
   }
   const rows=[...merged.values()].sort((left,right)=>left.date.localeCompare(right.date)||left.id.localeCompare(right.id));
   result={
    ...result,
    rows:packHistoricalRows(rows),
    tailHash:hash,
    ...(key==='baseball'?{marketSupportVersion:2}:{}),
    lastSuccess:new Date(now).toISOString(),
    sourceLatestAt:latestHistoricalDate(incoming,previous.sourceLatestAt||source.baselineMax),
    lastDeltaRows:changedRows,
    error:null
   };
  }catch(error){result.error=`과거 원본 증분 동기화 실패: ${error.message}`;}
  return persistHistory(env,key,result);
 })();
 historyInFlight.set(key,task);
 try{return await task;}finally{historyInFlight.delete(key);}
}

const status=record=>({lastSuccess:record.feed?.fetchedAt?Date.parse(record.feed.fetchedAt)/1000:null,lastAttempt:record.lastAttempt?record.lastAttempt/1000:null,error:record.error,ledgerError:record.ledgerError||null,ledgerVersion:record.ledgerVersion||null,quoteHistoryError:record.quoteHistoryError||null,intervalSeconds:REFRESH_INTERVAL_MS/1000,runtime:'cloud',sourceId:SOURCE_ID});
const historyStatus=(record,key)=>({sport:key,lastSuccess:record.lastSuccess,lastAttempt:record.lastAttempt?record.lastAttempt/1000:null,sourceLatestAt:record.sourceLatestAt||null,sourceRows:Array.isArray(record.rows)?record.rows.length:0,lastDeltaRows:record.lastDeltaRows||0,sourceVersion:record.tailHash?(record.marketSupportVersion===2?record.tailHash+':markets-v2':record.tailHash):null,error:record.error,resultLedgerError:record.resultLedgerError||null,intervalSeconds:HISTORY_REFRESH_INTERVAL_MS/1000,mode:'접속 시 증분 동기화'});
const validOrigin=(request,url)=>!request.headers.get('Origin')||request.headers.get('Origin')===url.origin;

export default {async fetch(request,env,ctx){
 try{
  const url=new URL(request.url);
  if(url.pathname==='/')return Response.redirect(url.origin+'/odds-lens/',302);
  if(url.pathname==='/odds-lens/api/signals'){
   if(request.method!=='GET')return json({error:'허용되지 않은 요청'},405);
   return json(await getSignals(env,ctx,{force:url.searchParams.get('refresh')==='1'}));
  }
  if(url.pathname==='/odds-lens/api/signals/domestic'){
   if(request.method!=='GET')return json({error:'허용되지 않은 요청'},405);
   const result=await currentState(env,ctx);
   if(result.feed?.events?.length&&result.feed.oddsHistoryVersion!==1){
    try{await attachQuoteSummaries(env,result.feed);result.quoteHistoryError=null;}catch(error){result.quoteHistoryError=error.message;}
   }
   return json(buildDomesticSignals(result.feed,{error:result.error,historyError:result.quoteHistoryError}));
  }
  if(url.pathname==='/odds-lens/api/slips/results'){
   if(request.method!=='POST')return json({error:'허용되지 않은 요청'},405);
   if(!validOrigin(request,url))return json({error:'잘못된 요청 출처'},403);
   const body=await request.text();if(body.length>40000)return json({error:'픽 조회 요청이 너무 큽니다.'},413);
   let input;try{input=JSON.parse(body);}catch{return json({error:'픽 조회 형식 확인 필요'},400);}
   if(!Array.isArray(input.picks)||input.picks.length>20||input.picks.some(p=>!p||typeof p!=='object'||!/^betman-\d{6}-\d+$/.test(p.marketId||'')||!Number.isFinite(Date.parse(p.startsAt))))return json({error:'픽 경기 정보 확인 필요'},400);
   const picks=input.picks.map(normalizePick),officials=await officialResultsForPicks(env,picks,{force:url.searchParams.get('refresh')==='1',ctx});
   return json({picks:attachSlipResults([{picks}],{},officials)[0].picks,resultSource:officialResultStatus(officials)});
  }
  if(url.pathname==='/odds-lens/api/slips'||url.pathname==='/odds-lens/api/slips/refresh'){
   const force=url.pathname.endsWith('/refresh');
   if(force&&(request.method!=='POST'||!validOrigin(request,url)))return json({error:'잘못된 결과 갱신 요청'},403);
   if(!force&&request.method==='POST'){
    if(!validOrigin(request,url))return json({error:'잘못된 요청 출처'},403);
    const body=await request.text();if(body.length>30000)return json({error:'픽 기록이 너무 큽니다.'},413);
    try{const current=await saved(env,true);if(current.error)throw Error('최신 공식 배당 조회 후 저장해주세요.');return json(await saveSlip(env,JSON.parse(body),current.feed));}
    catch(error){return json({error:error.message},400);}
   }
   if(!force&&request.method!=='GET')return json({error:'허용되지 않은 요청'},405);
   const page=await listSlips(env,url.searchParams.get('cursor')||'');
   const sports=[...new Set(page.slips.flatMap(slip=>slip.picks.map(pick=>pick.sport)))].filter(key=>HISTORY_SOURCES[key]);
   const [histories,officials]=await Promise.all([
    Promise.all(sports.map(async key=>[key,await savedHistory(env,key,true)])).then(Object.fromEntries),
    officialResultsForPicks(env,page.slips.flatMap(s=>s.picks),{force,ctx})
   ]);
   if(ctx?.waitUntil)ctx.waitUntil(Promise.all(sports.map(key=>updateHistory(env,key))));
   return json({...page,slips:attachSlipResults(page.slips,histories,officials),resultSource:officialResultStatus(officials),sources:Object.fromEntries(sports.map(key=>[key,historyStatus(histories[key],key)]))});
  }
  if(url.pathname==='/odds-lens/api/refresh'&&request.method==='POST'){
   if(!validOrigin(request,url))return json({error:'잘못된 요청 출처'},403);
   return json(status(await update(env,true)));
  }
  const quoteHistoryMatch=url.pathname.match(/^\/odds-lens\/api\/odds-history\/(betman-\d{6}-\d{1,8})$/);
  if(quoteHistoryMatch){
   if(request.method!=='GET')return json({error:'허용되지 않은 요청'},405);
   try{
    const history=await readQuoteHistory(env,quoteHistoryMatch[1],url.searchParams.get('event_id'),{cursor:url.searchParams.get('cursor')||''});
    return json(history||{error:'아직 수집된 배당 이력이 없습니다.'},history?200:404);
   }catch(error){return json({error:error.message},error.message.startsWith('INVALID_HISTORY')?400:503);}
  }
  if(url.pathname==='/odds-lens/api/refresh-status')return json(status(await saved(env,true)));
  if(url.pathname==='/odds-lens/api/predictions')return json(currentPredictions(await currentState(env,ctx)));
  if(url.pathname==='/odds-lens/api/high-probability'){
   const options={date:url.searchParams.get('date')||'all',league:url.searchParams.get('league')||'all',market:url.searchParams.get('market')||'all',sport:url.searchParams.get('sport')||'all',includeClosed:url.searchParams.get('include_closed')==='1'};
   return json(highProbabilityResponse(await currentState(env,ctx),options));
  }
  const evidenceMatch=url.pathname.match(/^\/odds-lens\/api\/predictions\/([a-f0-9]{64})\/evidence$/);
  if(evidenceMatch){const item=await evidence(env,evidenceMatch[1]);return json(item||{error:'예측 원장을 찾지 못했습니다.'},item?200:404);}
  if(url.pathname==='/odds-lens/api/validation'){
   try{return json({flags:FEATURE_FLAGS,report:modelReport,ledger:await ledgerSummary(env,{cursor:url.searchParams.get('cursor')||''}),storageStatus:'ready'});}
   catch(error){return json({flags:FEATURE_FLAGS,report:modelReport,ledger:null,storageStatus:'unavailable',error:error.message});}
  }
  if(url.pathname==='/odds-lens/api/ledger-export')return json(await exportLedger(env,{table:url.searchParams.get('table')||'predictions',cursor:url.searchParams.get('cursor')||''}));
  if(url.pathname==='/odds-lens/api/evaluations/current')return json(modelReport);
  const evaluationMatch=url.pathname.match(/^\/odds-lens\/api\/evaluations\/([a-z0-9-]+)$/);
  if(evaluationMatch){const report=await readEvaluation(env,evaluationMatch[1]);return json(report||{error:'검증 보고서를 찾지 못했습니다.'},report?200:404);}
  const historyMatch=url.pathname.match(/^\/odds-lens\/api\/history\/(baseball|soccer|basketball|volleyball)\/(current\.json|refresh)$/);
  if(historyMatch){
   const [,key,action]=historyMatch;
   if(action==='refresh'&&request.method!=='POST')return json({error:'허용되지 않은 요청'},405);
   if(action==='refresh'&&!validOrigin(request,url))return json({error:'잘못된 요청 출처'},403);
   let record;
   if(action==='current.json'&&ctx?.waitUntil){record=await savedHistory(env,key,true);ctx.waitUntil(updateHistory(env,key));}
   else record=await updateHistory(env,key,action==='refresh');
   const snapshot=historyStatus(record,key);
   return action==='refresh'||url.searchParams.get('summary')==='1'?json(snapshot):json({fields:HISTORY_FIELDS,rows:record.rows,refreshState:snapshot});
  }
  if(url.pathname==='/odds-lens/api/history-status'){
   const entries=await Promise.all(Object.keys(HISTORY_SOURCES).map(async key=>[key,historyStatus(await savedHistory(env,key),key)]));
   return json(Object.fromEntries(entries));
  }
  if(url.pathname==='/odds-lens/data/live/current.json'){
   const result=await currentState(env,ctx);
   if(result.feed?.events?.length&&result.feed.oddsHistoryVersion!==1){
    try{await attachQuoteSummaries(env,result.feed);result.quoteHistoryError=null;}catch(error){result.quoteHistoryError=error.message;}
   }
   return result.feed?json({...result.feed,refreshState:status(result)}):json({error:result.error},503);
  }
  return env.ASSETS.fetch(request);
 }catch(error){return json({error:`서버 처리 실패: ${error.message}`},503);}
},scheduled(_controller,env,ctx){ctx.waitUntil(update(env,true));}};
