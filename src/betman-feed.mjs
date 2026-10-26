// Public, unauthenticated read requests used by betman.co.kr's own pages.
// Never substitute a secondary site's quote for an official quote.
export const SOURCE='https://www.betman.co.kr/';
export const MOBILE_SOURCE='https://m.betman.co.kr/';
export const ROUND_SOURCE=new URL('buyPsblGame/inqCacheBuyAbleGameInfoList.do',SOURCE).href;
export const SCHEDULE_SOURCE=new URL('buyPsblGame/schedule.do',SOURCE).href;
export const GAME_SOURCE=new URL('buyPsblGame/gameInfoInq.do',SOURCE).href;
export const SOURCE_ID='betman-official-v1';
import {canonicalEventId,marketIdentity} from '../public/odds-lens/prediction-core.mjs';
import {resolveRuleset} from './model-registry.mjs';
const sports={SC:'soccer',BS:'baseball',BK:'basketball',VL:'volleyball'};
const kstDay=value=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date(value));
const kstMonth=value=>kstDay(value).slice(0,7).replace('-','');
const iso=value=>Number.isFinite(Number(value))&&Number(value)>0?new Date(Number(value)).toISOString():null;
const validRound=value=>/^\d{6}$/.test(String(value));
const sortRounds=rounds=>[...new Set(rounds.map(String).filter(validRound))].sort((left,right)=>Number(left)-Number(right));
const SCHEDULE_LOOKBACK_MS=48*60*60*1000;
const BROWSER_USER_AGENT='Mozilla/5.0 (compatible; ODDS-LENS/1.0; official-public-feed)';
const OFFICIAL_ATTEMPTS=2;
const OFFICIAL_TIMEOUT_MS=8000;
const OFFICIAL_RETRY_DELAY_MS=250;
const retryableStatus=status=>status===408||status===429||status>=500;
const waitRetry=()=>new Promise(resolve=>setTimeout(resolve,OFFICIAL_RETRY_DELAY_MS));
const requestName=(url,params)=>url.includes('/inqCacheBuyAbleGameInfoList.do')?'회차 목록':url.includes('/schedule.do')?'일정 목록':url.includes('/gameInfoInq.do')?`회차 ${params.gmTs} 경기표`:'경기표';
const connectionReason=error=>error?.name==='TimeoutError'||error?.name==='AbortError'?'응답 시간 초과':/failed to fetch|networkerror/i.test(String(error?.message||''))?'네트워크 연결 중단':error?.message||'응답 없음';
const recoverableOfficialError=error=>/연결 실패|응답 (?:408|5\d\d)/.test(String(error?.message||error||''));
const officialEndpoint=(source,path)=>new URL(`buyPsblGame/${path}`,source).href;

export function emptyFeed(){
 return {schemaVersion:2,sourceId:SOURCE_ID,provider:'베트맨 공식 · 국내 프로토',sourceUrl:SOURCE,oddsBasis:'domestic-betman',sourceLicense:'베트맨 공개 경기표 직접 조회',fetchedAt:null,round:null,rounds:[],events:[],excludedMarkets:0,unidentifiedMarkets:0};
}

function responseCookies(response){
 const headers=response?.headers;
 const values=typeof headers?.getSetCookie==='function'?headers.getSetCookie():String(headers?.get('set-cookie')||'').split(/,(?=\s*[^;,]+=)/);
 return values.flatMap(value=>String(value).split(/,(?=\s*[^;,]+=)/)).map(value=>value.split(';',1)[0].trim()).filter(value=>/^[^=\s]+=/.test(value)).join('; ');
}

async function officialSession(fetcher,source=SOURCE){
 // Betman issues JSESSIONID and CCN_VKEY on the public landing page. Its
 // unauthenticated game endpoints reject a server-side POST without them.
 for(let attempt=0;attempt<OFFICIAL_ATTEMPTS;attempt++){
  try{
   const response=await fetcher(source,{headers:{accept:'text/html,application/xhtml+xml','user-agent':BROWSER_USER_AGENT},redirect:'manual',signal:AbortSignal.timeout(OFFICIAL_TIMEOUT_MS)});
   if(response.ok)return responseCookies(response);
   if(!retryableStatus(response.status))return '';
  }catch{}
  if(attempt+1<OFFICIAL_ATTEMPTS)await waitRetry();
 }
 return '';
}

async function readOfficial(url,params,fetcher,cookie=''){
 const source=new URL(url).origin;
 const headers={'content-type':'application/json; charset=UTF-8',accept:'application/json','X-Requested-With':'XMLHttpRequest',referer:source+'/',origin:source,'user-agent':BROWSER_USER_AGENT};
 if(cookie)headers.cookie=cookie;
 const options={method:'POST',headers,redirect:'manual',body:JSON.stringify({...params,_sbmInfo:{_sbmInfo:{debugMode:'false'}}})};
 const name=requestName(url,params);
 let response,lastError;
 for(let attempt=0;attempt<OFFICIAL_ATTEMPTS;attempt++){
  response=undefined;
  try{
   response=await fetcher(url,{...options,signal:AbortSignal.timeout(OFFICIAL_TIMEOUT_MS)});
   if(response.ok||!retryableStatus(response.status))break;
   lastError=new Error(`베트맨 응답 ${response.status}`);
  }catch(error){lastError=error;}
  if(attempt+1<OFFICIAL_ATTEMPTS)await waitRetry();
 }
 // HTTP-only runtime: TLS/source errors are reported, never substituted.
 if(!response)throw Error(`베트맨 ${name} 연결 실패: ${connectionReason(lastError)}`);
 if(!response.ok)throw Error(`베트맨 ${name} 응답 ${response.status}`);
 const text=await response.text();
 if(text.length>10000000)throw Error(`베트맨 ${name} 응답 크기 초과`);
 let result;try{result=JSON.parse(text);}catch{throw Error(`베트맨 ${name}가 경기 데이터 대신 오류 화면을 반환했습니다.`);}
 if(result.rsMsg?.statusCode!=='S')throw Error(`베트맨 ${name} 조회가 정상 처리되지 않았습니다.`);
 return result;
}

function catalogRounds(catalog){
 if(!Array.isArray(catalog?.protoGames))throw Error('베트맨 회차 목록 형식 변경');
 const values=catalog.protoGames.filter(game=>game?.gmId==='G101').map(game=>String(game.gmTs));
 if(values.some(round=>!validRound(round)))throw Error('베트맨 회차 번호 형식 변경');
 return sortRounds(values);
}

function scheduleRounds(schedule,now){
 const rows=schedule?.schedules?.data;
 if(!Array.isArray(rows))throw Error('베트맨 승부식 일정 목록 형식 변경');
 const cutoff=now.getTime()-SCHEDULE_LOOKBACK_MS;
 const values=rows.filter(row=>{
  const gmId=String(row?.gmId||row?.gameMaster?.gmId||'');
  const saleEnd=Number(row?.saleEndDate);
  return gmId==='G101'&&validRound(row?.gmTs)&&(!Number.isFinite(saleEnd)||saleEnd>=cutoff);
 }).map(row=>String(row.gmTs));
 if(!values.length)throw Error('베트맨 승부식의 최근·예정 회차를 찾지 못했습니다.');
 return sortRounds(values);
}

async function scheduledRounds(fetcher,now,cookie,source=SOURCE){
 const schedule=await readOfficial(officialEndpoint(source,'schedule.do'),{gmId:'G101',league:'',team:'',yearMonth:kstMonth(now),start:0,length:100},fetcher,cookie);
 return scheduleRounds(schedule,now);
}

async function roundPayloads(rounds,fetcher,cookie,source=SOURCE){
 return Promise.all(rounds.map(async round=>{
  const payload=await readOfficial(officialEndpoint(source,'gameInfoInq.do'),{gmId:'G101',gmTs:Number(round),gameYear:''},fetcher,cookie);
  if(String(payload.currentLottery?.gmTs)!==round)throw Error('요청한 베트맨 회차와 응답 회차가 다릅니다.');
  return payload;
 }));
}

async function collectFromOfficial(source,fetcher,now,retainRaw){
 // Test fetchers provide complete fixtures directly. The deployed collector
 // first creates the same public, cookie-backed session as a normal visitor.
 const cookie=fetcher===globalThis.fetch?await officialSession(fetcher,source):'';
 const catalog=await readOfficial(officialEndpoint(source,'inqCacheBuyAbleGameInfoList.do'),{},fetcher,cookie);
 const listed=catalogRounds(catalog);
 let scheduled=[],scheduleError=null;
 try{scheduled=await scheduledRounds(fetcher,now,cookie,source);}
 catch(error){if(!listed.length)throw error;scheduleError=error.message;}
 const rounds=sortRounds([...listed,...scheduled]);
 if(!rounds.length)throw Error('베트맨 승부식의 최근·예정 회차를 찾지 못했습니다.');
 const payloads=await roundPayloads(rounds,fetcher,cookie,source);
 const observed=retainRaw?new Date():now;
 const feed=parseFeed(payloads,observed);
 feed.sourceUrl=source;
 feed.status.originHost=new URL(source).hostname;
 feed.partial=!!scheduleError;feed.partialReason=scheduleError;
 if(retainRaw)feed.rawPayloads=payloads;
 // The buyable-game cache lists only active sale rounds.  The official monthly
 // schedule adds just-closed and sale-before rounds so pre-start fixtures stay
 // visible even while their sale state changes.
 if(!feed.events.length){
  throw Error('베트맨 공식 승부식 경기표에서 오늘·예정 경기를 찾지 못했습니다.');
 }
 return feed;
}

export async function collectFeed(fetcher=fetch,now=new Date(),{retainRaw=false,officialFallback=fetcher===globalThis.fetch}={}){
 let primary;
 try{primary=await collectFromOfficial(SOURCE,fetcher,now,retainRaw);}
 catch(error){
  if(!officialFallback||!recoverableOfficialError(error))throw error;
  try{
   const alternate=await collectFromOfficial(MOBILE_SOURCE,fetcher,now,retainRaw);
   alternate.status.fallbackFrom='www.betman.co.kr';
   alternate.status.fallbackReason=error.message;
   alternate.status.teamNamesVerified=false;
   for(const event of alternate.events)event.teamNamesVerified=false;
   return alternate;
  }catch(alternateError){throw Error(`${error.message}; 베트맨 모바일 공식 호스트도 실패: ${alternateError.message}`);}
 }
 if(primary.partial&&officialFallback&&recoverableOfficialError(primary.partialReason)){
  try{
   const alternate=await collectFromOfficial(MOBILE_SOURCE,fetcher,now,retainRaw);
   alternate.status.fallbackFrom='www.betman.co.kr';
   alternate.status.fallbackReason=primary.partialReason;
   alternate.status.teamNamesVerified=false;
   for(const event of alternate.events)event.teamNamesVerified=false;
   return alternate;
  }catch{return primary;}
 }
 return primary;
}

// Read a saved offer's round even after it has disappeared from today's board.
export async function readOfficialRound(round,fetcher=fetch,{officialFallback=fetcher===globalThis.fetch}={}){
 if(!validRound(round))throw Error('올바르지 않은 베트맨 회차입니다.');
 const read=async source=>{
  const cookie=fetcher===globalThis.fetch?await officialSession(fetcher,source):'';
  const [payload]=await roundPayloads([String(round)],fetcher,cookie,source);
  return {payload,sourceUrl:source,fetchedAt:new Date().toISOString()};
 };
 try{return await read(SOURCE);}
 catch(error){if(!officialFallback||!recoverableOfficialError(error))throw error;return read(MOBILE_SOURCE);}
}

export function supportedMarket(row){
 const name=String(row.betNm||''),type=String(row.betTypNm||'');
 const half=name.includes('전반');
 if(half||/전반/.test(type))return null;
 if(row.itemCode==='BS'&&/승1패/.test(name)&&/승N패|승1패/.test(type))return '승1패';
 if(/SUM|홀짝|승[15N]패/.test(name+type))return null;
 if(/핸디캡/.test(name))return '핸디캡';
 if(/언더오버/.test(name))return '언오버';
 if(/승무패|승패/.test(name)&&/승무패|일반 승패/.test(type))return '일반';
 return null;
}

export function parseFeed(payloads,now=new Date()){
 const feed={...emptyFeed(),fetchedAt:now.toISOString(),status:{mode:'betman-public-json',network:'enabled'},limitations:['공식 게시값을 30초 간격으로 조회 · 변경 즉시 전송 방식은 아님','SUM·승5패·모든 전반 시장 제외']};
 const today=kstDay(now),events=new Map();
 for(const payload of Array.isArray(payloads)?payloads:[payloads]){
  const lottery=payload?.currentLottery,round=String(lottery?.gmTs||''),packed=payload?.compSchedules;
  if(payload?.rsMsg?.statusCode!=='S'||lottery?.gmId!=='G101'||!/^\d{6}$/.test(round)||!Array.isArray(packed?.keys)||!Array.isArray(packed?.datas))throw Error('베트맨 공식 경기표 형식 변경');
  for(const field of ['itemCode','gameDate','endDate','matchSeq','homeName','awayName','betNm','betTypNm','winTxt','winAllot','drawTxt','drawAllot','loseTxt','loseAllot','winHandi','protoStatus','buyReject','gameReject']){
   if(!packed.keys.includes(field))throw Error(`베트맨 필수 항목 누락: ${field}`);
  }
  feed.rounds.push(round);
  for(const values of packed.datas){
   if(!Array.isArray(values)||values.length!==packed.keys.length)throw Error('베트맨 경기 필드 개수 변경');
   const row=Object.fromEntries(packed.keys.map((key,i)=>[key,values[i]]));
   const sport=sports[row.itemCode],market=supportedMarket(row);
   if(!sport||!market){feed.excludedMarkets++;continue;}
   const startsAt=iso(row.gameDate),saleClosesAt=iso(row.endDate);
   if(!startsAt||!row.homeName||!row.awayName||!Number.isInteger(Number(row.matchSeq))||Number(row.matchSeq)<=0)throw Error('베트맨 경기 식별값 누락');
   if(kstDay(startsAt)<today)continue;
   // Several distinct postseason fixtures can share Betman's 999/미정 IDs,
   // names, league and start time. No verified fixture grouping key is present
   // in those rows; archive them until teams are published instead of merging
   // unrelated sale offers into one event.
   if(String(row.homeName).trim()==='미정'||String(row.awayName).trim()==='미정'){
    feed.unidentifiedMarkets++;
    continue;
   }
   const expectedKeys=market==='언오버'?['under','over']:(market==='승1패'||/승무패|정수핸디캡/.test(String(row.betTypNm))||row.drawTxt==='무')?['home','draw','away']:['home','away'];
   const quoteValues=expectedKeys.length===3?[row.winAllot,row.drawAllot,row.loseAllot]:[row.winAllot,row.loseAllot];
   const hasQuote=quoteValues.every(value=>Number.isFinite(Number(value))&&Number(value)>1);
   // Betman can open a match row before every individual market quote is
   // published. Preserve the fixture as an official pending market instead of
   // aborting the entire refresh because one price is still blank.
   const pending=['0','1'].includes(String(row.protoStatus))||row.protoStatus==null||!hasQuote;
   const available=!pending&&String(row.protoStatus)==='2'&&String(row.buyReject)==='0'&&String(row.gameReject)==='0'&&Date.parse(startsAt)>now.getTime()&&!!saleClosesAt&&Date.parse(saleClosesAt)>now.getTime();
   const status=pending?'배당 발표 대기':String(row.gameReject)!=='0'||String(row.buyReject)!=='0'?'발매 중지 · 분석 참고용':available?'발매 중':Date.parse(startsAt)<=now.getTime()?'시작·종료 경기 · 분석 참고용':'발매 종료 · 분석 참고용';
   const total=market==='언오버';
   let outcomes=[];
   if(!pending){
    const expected=total?['언더','오버']:['승','패'];
    if(row.winTxt!==expected[0]||row.loseTxt!==expected[1])throw Error(`베트맨 ${row.matchSeq} 배당 방향 확인 실패`);
    outcomes=[{key:total?'under':'home',label:total?'언더':market==='승1패'?'홈 2점차 이상 승':market.includes('핸디캡')?'홈 핸디승':'홈 승',odds:Number(row.winAllot)}];
    if(Number(row.drawAllot)>1){if(market==='승1패'?!['1','①'].includes(row.drawTxt):row.drawTxt!=='무')throw Error('베트맨 가운데 선택 항목 확인 실패');outcomes.push({key:'draw',label:market==='승1패'?'① 1점차 이내':'무',odds:Number(row.drawAllot)});}
    outcomes.push({key:total?'over':'away',label:total?'오버':market==='승1패'?'원정 2점차 이상 승':market.includes('핸디캡')?'원정 핸디승':'원정 승',odds:Number(row.loseAllot)});
   }
   const line=['일반','승1패'].includes(market)||pending?null:Number(row.winHandi);
   if(!['일반','승1패'].includes(market)&&!pending&&(row.winHandi==null||!Number.isFinite(line)))throw Error('베트맨 핸디캡·언더오버 기준값 누락');
   const identity={sport,league:row.leagueShortName||row.leagueName,leagueCode:row.leagueCode,homeId:row.homeId&&String(row.homeId)!=='999'?String(row.homeId):null,awayId:row.awayId&&String(row.awayId)!=='999'?String(row.awayId):null,home:String(row.homeName).replaceAll('_',' '),away:String(row.awayName).replaceAll('_',' '),startsAt};
   const id=canonicalEventId(identity);
   if(!events.has(id))events.set(id,{...identity,id,canonicalEventId:id,sourceTimezone:'UTC epoch milliseconds',doubleheaderNo:null,sport,league:row.leagueShortName||row.leagueName,leagueName:row.leagueName,round,home:String(row.homeName).replaceAll('_',' '),away:String(row.awayName).replaceAll('_',' '),startsAt,saleClosesAt,status,available:false,markets:[]});
   const event=events.get(id);
   // A real fixture may be sold in multiple rounds with different closing
   // times. Keep the latest event-level close for display; eligibility still
   // uses each market's own saleClosesAt.
   if(saleClosesAt&&(!event.saleClosesAt||Date.parse(saleClosesAt)>Date.parse(event.saleClosesAt)))event.saleClosesAt=saleClosesAt;
   if(available){event.available=true;event.status='발매 중';}
   const quote={id:`betman-${round}-${row.matchSeq}`,market,marketLabel:market,line,round,year:kstDay(startsAt).slice(0,4),gameNumber:Number(row.matchSeq),officialMarketName:row.betNm,officialMarketType:row.betTypNm,period:String(row.betNm).includes('전반')?'first_half':'full',outcomeKeys:expectedKeys,rulesetVersion:null,probabilityBasis:null,observedAt:feed.fetchedAt,availableAt:feed.fetchedAt,priceUpdatedAt:null,saleClosesAt,status,saleStatus:pending?'pending':String(row.gameReject)!=='0'||String(row.buyReject)!=='0'?'suspended':available?'selling':Date.parse(startsAt)<=now.getTime()?'started':'closed',available:available&&outcomes.length>=2,pending,outcomes,rawStatus:{protoStatus:row.protoStatus,buyReject:row.buyReject,gameReject:row.gameReject}};
   const rules=resolveRuleset(event,quote,feed.fetchedAt);
   quote.rulesetVersion=rules?.version||null;quote.probabilityBasis=rules?.probabilityBasis||null;
   quote.canonicalMarketId=marketIdentity(id,quote);
   if(!event.markets.some(m=>m.id===quote.id))event.markets.push(quote);
  }
 }
 feed.round=feed.rounds.join(', ');
 feed.events=[...events.values()].sort((a,b)=>a.startsAt.localeCompare(b.startsAt)||a.id.localeCompare(b.id));
 return feed;
}
