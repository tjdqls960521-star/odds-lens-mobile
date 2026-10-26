import {analyzeSignal,ORIGINAL_LEAGUES,COLAB_URL} from '../public/odds-lens/traffic-light-core.mjs';

export const SOURCE_ID='nowgoal-colab-signals-v2';
const KEY_PREFIX='odds-lens/nowgoal-signals-v2/';
const INTERVAL=60000,MAX_BYTES=4000000;
const memory=new Map(),pending=new Map();
const HEADERS={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'};
export function targetDates(now=new Date()){
  const day=new Date(now.getTime()+9*3600000).toISOString().slice(0,10);
  return [day,new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString().slice(0,10)];
}
// nowgoal.com is now parked. The provider's official domain notice identifies
// nowgoal.world as its new domain. The same public path and field layout were
// verified against the live response; notebook parameters and math stay intact.
export const sourceUrl=date=>`https://www.nowgoal.world/ajax/soccerajax?type=12&cid=177&date=${date}&timezone=9`;

export function parseNowgoal(raw,queryDate){
  if(typeof raw!=='string'||raw.length>MAX_BYTES)throw Error('원본 응답 크기를 확인해주세요.');
  let payload;
  try{payload=JSON.parse(raw);}catch{throw Error('원본 응답이 예상한 JSON 형식이 아닙니다.');}
  if(payload.ErrCode!==0||typeof payload.Data!=='string')throw Error('원본 서버가 정상 데이터를 반환하지 않았습니다.');
  if(payload.Data==='')return {events:[],totalRows:0,excludedRows:0};
  if(!payload.Data.includes('$'))throw Error('원본 경기·리그 구분 형식이 변경되었습니다.');
  const [matches,divisions]=payload.Data.split('$'),leagues=new Map();
  for(const row of divisions.split('!').filter(r=>r.trim())){
    const cols=row.split('^');if(cols.length>=3&&/^-?\d+$/.test(cols[0]))leagues.set(Number(cols[0]),cols[2].split('#')[0]);
  }
  const rows=matches.split('!').filter(r=>r.trim()),events=[];let excludedRows=0;
  if(rows.length&&!leagues.size)throw Error('원본 리그 목록을 읽지 못했습니다.');
  for(const [index,row] of rows.entries()){
    const cols=row.split('^');
    if(cols.length<=10)throw Error('원본 경기 열 구성이 변경되었습니다.');
    const league=leagues.get(Number(cols[4]))||'';
    if(!ORIGINAL_LEAGUES.includes(league)){excludedRows++;continue;}
    const rawTime=cols[2];
    if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(rawTime)||!Number.isFinite(Date.parse(rawTime.replace(' ','T')+':00Z')))throw Error('원본 경기 시각 형식을 읽지 못했습니다.');
    const startsAt=rawTime.replace(' ','T')+':00Z';
    const displayTime=new Date(Date.parse(startsAt)+9*3600000).toISOString().slice(0,16).replace('T',' ').replaceAll('-','.');
    events.push({id:`${queryDate}-${index}-${cols[0]}`,queryDate,league,home:cols[9],away:cols[10],startsAt,displayTime,rawTime,analysis:analyzeSignal([cols[23],cols[24],cols[25]],[cols[30],cols[31],cols[32]])});
  }
  events.sort((a,b)=>a.displayTime.localeCompare(b.displayTime)||a.league.localeCompare(b.league));
  return {events,totalRows:rows.length,excludedRows};
}

export async function collectSignalDay(date,{fetcher=fetch,now=new Date()}={}){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await fetcher(sourceUrl(date),{headers:HEADERS,signal:controller.signal});
    if(!response.ok)throw Error(`원본 서버 응답 오류 (HTTP ${response.status})`);
    if(Number(response.headers.get('content-length'))>MAX_BYTES)throw Error('원본 응답 크기 초과');
    const parsed=parseNowgoal(await response.text(),date);
    return {date,...parsed,fetchedAt:now.toISOString(),lastAttempt:now.toISOString(),error:null};
  }catch(error){throw Error(error.name==='AbortError'?'원본 서버가 15초 안에 응답하지 않았습니다.':error.message);}
  finally{clearTimeout(timeout);}
}

async function readDay(env,date){
  if(memory.has(date))return memory.get(date);
  try{
    const object=await env?.ODDS_STORE?.get(KEY_PREFIX+date+'.json');
    if(object){const value=JSON.parse(await object.text());if(value.date===date&&Array.isArray(value.events)){memory.set(date,value);return value;}}
  }catch{}
  return {date,events:[],fetchedAt:null,lastAttempt:null,error:null};
}
async function refreshDay(env,date,previous,options){
  if(pending.has(date))return pending.get(date);
  const task=(async()=>{
    let next;
    try{next=await collectSignalDay(date,options);}catch(error){next={...previous,lastAttempt:options.now.toISOString(),error:error.message};}
    try{await env?.ODDS_STORE?.put(KEY_PREFIX+date+'.json',JSON.stringify(next),{httpMetadata:{contentType:'application/json'}});}catch{next.storageError='이번 결과를 저장하지 못했습니다.';}
    memory.set(date,next);
    for(const key of memory.keys())if(key<targetDates(options.now)[0])memory.delete(key);
    return next;
  })();
  pending.set(date,task);try{return await task;}finally{pending.delete(date);}
}
export async function getSignals(env,ctx,{force=false,now=new Date(),fetcher=fetch}={}){
  const dates=targetDates(now);
  const days=await Promise.all(dates.map(async date=>{
    const previous=await readDay(env,date),elapsed=now-Date.parse(previous.lastAttempt||0);
    if(previous.lastAttempt&&elapsed<(force?5000:INTERVAL))return previous;
    // The client keeps existing cards visible while refreshing. Return the new
    // outcome here so one-minute polling never perpetually trails the cache.
    return refreshDay(env,date,previous,{now,fetcher});
  }));
  const events=days.flatMap(day=>day.events.map(event=>({...event,fetchedAt:day.fetchedAt,stale:!!day.error||now-Date.parse(day.fetchedAt)>2*INTERVAL}))).sort((a,b)=>a.displayTime.localeCompare(b.displayTime)||a.league.localeCompare(b.league));
  return {sourceId:SOURCE_ID,sourceName:'Nowgoal · Colab 원본',colabUrl:COLAB_URL,dates,generatedAt:now.toISOString(),refreshIntervalSeconds:60,days:days.map(({events,...day})=>({...day,count:events.length,sourceUrl:sourceUrl(day.date)})),events};
}
