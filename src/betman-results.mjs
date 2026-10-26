import {readOfficialRound,supportedMarket,SOURCE} from './betman-feed.mjs';
import {canonicalEventId} from '../public/odds-lens/prediction-core.mjs';

const PREFIX='odds-lens/results-v1/';
const REFRESH_MS=30000;
const flights=new WeakMap();
const sports={SC:'soccer',BS:'baseball',BK:'basketball',VL:'volleyball'};
// Official gameSlipProtoVictory.html.js: result highlighting, not sale closure.
const PUBLISHED=new Set(['4','20','51','52','68','115','116','132','179','180','196','243','244']);
const pair=value=>/^\s*-?\d+(?:\.\d+)?\s*:\s*-?\d+(?:\.\d+)?\s*$/.test(String(value??''))?String(value).split(':').map(Number):null;
export const resultRound=pick=>String(pick?.marketId||'').match(/^betman-(\d{6})-\d+$/)?.[1]||null;

export function parseOfficialResults(payload,observedAt,sourceUrl=SOURCE){
 const round=String(payload?.currentLottery?.gmTs||''),packed=payload?.compSchedules;
 if(payload?.rsMsg?.statusCode!=='S'||payload?.currentLottery?.gmId!=='G101'||!/^\d{6}$/.test(round)||!Array.isArray(packed?.keys)||!Array.isArray(packed?.datas)||!packed.datas.length)throw Error('공식 결과 경기표가 비어 있거나 형식이 변경되었습니다.');
 for(const key of ['matchSeq','itemCode','gameDate','homeName','awayName','betNm','betTypNm','winHandi','drawTxt','protoStatus','gameResult','mchScore'])if(!packed.keys.includes(key))throw Error('공식 결과 필드 누락: '+key);
 const rows=[];
 for(const values of packed.datas){
  if(!Array.isArray(values)||values.length!==packed.keys.length)throw Error('공식 결과 행 형식 변경');
  const raw=Object.fromEntries(packed.keys.map((key,i)=>[key,values[i]])),market=supportedMarket(raw),sport=sports[raw.itemCode];
  if(!market||!sport)continue;
  if(!Number.isFinite(Number(raw.gameDate))||Number(raw.gameDate)<=0||!Number.isInteger(Number(raw.matchSeq))||Number(raw.matchSeq)<=0||!raw.homeName||!raw.awayName)throw Error('공식 결과 경기 식별값 누락');
  const startsAt=new Date(Number(raw.gameDate)).toISOString();
  const identity={sport,league:raw.leagueShortName||raw.leagueName,leagueCode:raw.leagueCode,homeId:raw.homeId&&String(raw.homeId)!=='999'?String(raw.homeId):null,awayId:raw.awayId&&String(raw.awayId)!=='999'?String(raw.awayId):null,home:String(raw.homeName).replaceAll('_',' '),away:String(raw.awayName).replaceAll('_',' '),startsAt};
  const outcomeKeys=market==='언오버'?['under','over']:(market==='승1패'||/승무패|정수핸디캡/.test(String(raw.betTypNm))||raw.drawTxt==='무')?['home','draw','away']:['home','away'];
  const code=raw.gameResult==null?'':String(raw.gameResult),published=PUBLISHED.has(String(raw.protoStatus));
  const outcome=market==='언오버'?({'0':'under','2':'over'})[code]:({'0':'home','1':'draw','2':'away'})[code];
  const status=!published?'pending':code==='4'?'cancelled':outcomeKeys.includes(outcome)?'settled':'unsupported';
  const score=pair(raw.mchScore),line=['일반','승1패'].includes(market)||raw.winHandi==null?null:Number(raw.winHandi);
  rows.push({...identity,eventId:canonicalEventId(identity),marketId:`betman-${round}-${Number(raw.matchSeq)}`,round,gameNumber:Number(raw.matchSeq),market,line:Number.isFinite(line)?line:null,period:'full',outcomeKeys,status,outcome:status==='settled'?outcome:null,rawCode:code,protoStatus:String(raw.protoStatus??''),marketScore:published?score:null,score:published&&market==='일반'?score:null,scoreKind:market==='언오버'?'total':market==='핸디캡'?'handicap_adjusted':'final',observedAt,sourceUrl});
 }
 // Totals/handicap rows contain transformed scores. A separately published
 // ordinary full-game row may supply a real team score; never relabel totals.
 const finals=new Map();
 for(const row of rows)if(row.market==='일반'&&row.status==='settled'&&row.score){const old=finals.get(row.eventId);finals.set(row.eventId,old&&JSON.stringify(old)!==JSON.stringify(row.score)?null:row.score);}
 for(const row of rows)if(row.market!=='일반'&&row.status==='settled')row.score=finals.get(row.eventId)||null;
 if(new Set(rows.map(r=>r.marketId)).size!==rows.length)throw Error('공식 결과 경기번호 중복');
 return {round,rows,lastSuccess:observedAt,lastAttempt:Date.parse(observedAt),sourceUrl,error:null};
}
const empty=round=>({round,rows:[],lastSuccess:null,lastAttempt:null,error:null});
export async function savedOfficialResults(env,round){
 if(!env?.ODDS_STORE)return empty(round);
 try{const object=await env.ODDS_STORE.get(PREFIX+round+'.json');if(object){const value=JSON.parse(await object.text());if(value.round===round&&Array.isArray(value.rows))return value;}}
 catch(error){return {...empty(round),error:'저장된 공식 결과 읽기 실패: '+error.message};}
 return empty(round);
}
export async function preserveOfficialResults(env,payload,observedAt,sourceUrl=SOURCE){
 const value=parseOfficialResults(payload,observedAt,sourceUrl);
 if(!env?.ODDS_STORE)return value;
 const previous=await savedOfficialResults(env,value.round);
 if(previous.lastSuccess&&previous.lastSuccess>observedAt)return previous;
 const raw={rsMsg:payload.rsMsg,currentLottery:{gmId:'G101',gmTs:payload.currentLottery.gmTs},compSchedules:payload.compSchedules};
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(raw)));
 value.rawHash=[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
 if(value.rawHash!==previous.rawHash)await env.ODDS_STORE.put(`${PREFIX}raw/${value.round}/${value.rawHash}.json`,JSON.stringify(raw),{httpMetadata:{contentType:'application/json'}});
 await env.ODDS_STORE.put(PREFIX+value.round+'.json',JSON.stringify(value),{httpMetadata:{contentType:'application/json'}});
 return value;
}
async function refreshRound(env,round,{force=false,fetcher=fetch}={}){
 const key=env.ODDS_STORE||env;
 if(!flights.has(key))flights.set(key,new Map());
 const pending=flights.get(key);if(pending.has(round))return pending.get(round);
 const task=(async()=>{
  const previous=await savedOfficialResults(env,round),now=Date.now();
  if(previous.lastAttempt&&now-previous.lastAttempt<(force?5000:REFRESH_MS))return previous;
  try{const source=await readOfficialRound(round,fetcher);return await preserveOfficialResults(env,source.payload,source.fetchedAt,source.sourceUrl);}
  catch(error){
   // Keep actual observation time and completed results when upstream is down.
   const latest=await savedOfficialResults(env,round);
   const retained={...latest,lastAttempt:now,error:'베트맨 결과 조회 실패: '+error.message};
   if(env?.ODDS_STORE)await env.ODDS_STORE.put(PREFIX+round+'.json',JSON.stringify(retained),{httpMetadata:{contentType:'application/json'}});
   return retained;
  }
 })();pending.set(round,task);
 try{return await task;}finally{pending.delete(round);}
}
export async function officialResultsForPicks(env,picks,{force=false,ctx=null,fetcher=fetch}={}){
 const rounds=[...new Set(picks.map(resultRound).filter(Boolean))];
 const records=Object.fromEntries(await Promise.all(rounds.map(async round=>[round,await savedOfficialResults(env,round)])));
 // Bound upstream work per request; subsequent polls handle older rounds.
 const due=rounds.filter(round=>!records[round].lastAttempt||Date.now()-records[round].lastAttempt>=(force?5000:REFRESH_MS)).sort((a,b)=>(records[a].lastAttempt||0)-(records[b].lastAttempt||0)).slice(0,4);
 if(due.length){
  const refresh=Promise.all(due.map(async round=>[round,await refreshRound(env,round,{force,fetcher})]));
  if(!force&&ctx?.waitUntil){ctx.waitUntil(refresh);for(const round of due)records[round]={...records[round],refreshing:true};}
  else for(const [round,value] of await refresh)records[round]=value;
 }
 return records;
}
export function officialResultStatus(records){
 const rounds=Object.values(records).map(({round,lastSuccess,lastAttempt,error,refreshing})=>({round,lastSuccess,lastAttempt,error,refreshing:!!refreshing}));
 return {provider:'베트맨 공식 결과',rounds,refreshing:rounds.some(r=>r.refreshing),intervalSeconds:REFRESH_MS/1000};
}
