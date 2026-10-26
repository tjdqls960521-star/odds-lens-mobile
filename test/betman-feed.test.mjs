import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseFeed,collectFeed,ROUND_SOURCE,SCHEDULE_SOURCE,GAME_SOURCE,SOURCE,MOBILE_SOURCE} from '../src/betman-feed.mjs';
import {eventHasAvailableMarket,feedFreshness,recommendPatterns} from '../public/odds-lens/live-core.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/betman-public.json',import.meta.url)));
const now=new Date(fixture.capturedAt);

test('official public snapshot keeps the numbered quote, side direction and line',()=>{
 const feed=parseFeed(fixture,now);
 assert.equal(feed.sourceId,'betman-official-v1');
 const event=feed.events.find(e=>e.markets.some(m=>m.gameNumber===2735));
 assert.equal(event.home,'흐로닝언');assert.equal(event.away,'PEC즈볼러');
 assert.equal(event.league,'에레디비');
 assert.equal(event.startsAt,'2026-09-18T18:00:00.000Z');
 assert.equal(event.saleClosesAt,'2026-09-18T14:00:00.000Z');
 const quote=event.markets.find(m=>m.gameNumber===2735);
 assert.deepEqual(quote.outcomes.map(o=>o.odds),[1.47,3.85,4.8]);
 const handicap=event.markets.find(m=>m.gameNumber===2736);
 assert.equal(handicap.line,-1);assert.deepEqual(handicap.outcomes.map(o=>o.odds),[2.22,3.55,2.4]);
 const total=event.markets.find(m=>m.gameNumber===2737);
 assert.equal(total.line,3.5);assert.deepEqual(total.outcomes.map(o=>[o.key,o.odds]),[['under',1.72],['over',1.8]]);
});

test('all sports retain pending fixtures; prohibited markets and suspended quotes never become picks',()=>{
 const feed=parseFeed(fixture,now),markets=feed.events.flatMap(e=>e.markets);
 assert.deepEqual([...new Set(feed.events.map(e=>e.sport))].sort(),['baseball','basketball','soccer','volleyball']);
 assert.ok(feed.events.some(e=>e.league==='MLB'));
 assert.ok(markets.every(m=>m.period==='full'));
 assert.ok(markets.every(m=>!['전반','전반_핸디캡','전반_언오버','SUM','승5패'].includes(m.market)));
 assert.ok(markets.some(m=>m.pending));
 assert.ok(markets.filter(m=>m.pending).every(m=>!m.available&&!m.outcomes.length));
 assert.ok(markets.filter(m=>m.status.includes('중지')).every(m=>!m.available));
});

test('a Betman row without published prices stays pending without blocking the remaining official fixture board',()=>{
 const source=structuredClone(fixture),keys=source.compSchedules.keys,row=source.compSchedules.datas[0];
 const field=name=>keys.indexOf(name),future=Number(now)+3600000;
 row[field('gameDate')]=future;row[field('endDate')]=future-600000;
 row[field('protoStatus')]='2';row[field('buyReject')]='0';row[field('gameReject')]='0';
 row[field('winAllot')]=0;row[field('loseAllot')]=0;
 const feed=parseFeed(source,now);
 const market=feed.events.flatMap(event=>event.markets).find(item=>item.gameNumber===Number(row[field('matchSeq')]));
 assert.ok(market);assert.equal(market.pending,true);assert.equal(market.available,false);assert.deepEqual(market.outcomes,[]);
 assert.ok(feed.events.length>1);
});

test('unidentified postseason offers stay in the raw source rather than merging into a fictitious fixture',()=>{
 const source=structuredClone(fixture),keys=source.compSchedules.keys;
 const field=name=>keys.indexOf(name);
 const template=source.compSchedules.datas.find(values=>values[field('itemCode')]==='BS'&&values[field('betNm')]==='야구 승패');
 assert.ok(template);
 for(const matchSeq of [9001,9005]){
  const row=[...template];
  row[field('matchSeq')]=matchSeq;
  row[field('gameDate')]=+now+86400000;
  row[field('endDate')]=+now+72000000;
  row[field('homeId')]='999';row[field('awayId')]='999';
  row[field('homeName')]='미정';row[field('awayName')]='미정';
  row[field('protoStatus')]='1';row[field('winAllot')]=0;row[field('loseAllot')]=0;
  source.compSchedules.datas.push(row);
 }
 const baseline=parseFeed(fixture,now),feed=parseFeed(source,now);
 assert.equal(feed.unidentifiedMarkets,baseline.unidentifiedMarkets+2);
 assert.equal(feed.events.length,baseline.events.length);
 assert.ok(feed.events.every(event=>event.markets.every(market=>![9001,9005].includes(market.gameNumber))));
});

test('overlapping rounds use each market closing time for fixture availability',()=>{
 const early=structuredClone(fixture),later=structuredClone(fixture);
 const keys=early.compSchedules.keys,field=name=>keys.indexOf(name);
 early.compSchedules.datas=early.compSchedules.datas.slice(0,3);
 later.compSchedules.datas=later.compSchedules.datas.slice(0,3);
 early.compSchedules.datas.forEach(row=>row[field('endDate')]=+now-3600000);
 later.compSchedules.datas.forEach(row=>row[field('endDate')]=+now+3600000);
 later.currentLottery.gmTs=260112;
 const feed=parseFeed([early,later],now),event=feed.events[0];
 assert.equal(feed.events.length,1);
 assert.equal(event.markets.length,6);
 assert.equal(event.saleClosesAt,new Date(+now+3600000).toISOString());
 assert.equal(eventHasAvailableMarket(event,+now),true);
 assert.equal(eventHasAvailableMarket(event,+now+7200000),false);
 assert.equal(eventHasAvailableMarket({...event,available:false,markets:[{outcomes:event.markets[3].outcomes}]},+now),false);
});

test('malformed response and unrecognised direction fail closed',()=>{
 assert.throws(()=>parseFeed('<html>오류</html>',now));
 const changed=structuredClone(fixture),i=changed.compSchedules.keys.indexOf('winTxt');
 changed.compSchedules.datas[0][i]='오버';
 assert.throws(()=>parseFeed(changed,now),/방향/);
});

const schedule=(rounds,now)=>({rsMsg:{statusCode:'S'},schedules:{data:rounds.map((gmTs,index)=>({gmId:'G101',gmTs,saleEndDate:+now+(index+1)*3600000}))}});

test('collector unions the official sale list with the current official schedule and never requests an overseas provider',async()=>{
 const calls=[];
 const feed=await collectFeed(async(url,options)=>{
  calls.push(url);assert.equal(new URL(url).hostname,'www.betman.co.kr');assert.equal(options.method,'POST');
  if(url===ROUND_SOURCE)return Response.json({rsMsg:{statusCode:'S'},protoGames:[{gmId:'G101',gmTs:260111},{gmId:'G102',gmTs:260100},{gmId:'G101',gmTs:260112}]});
  if(url===SCHEDULE_SOURCE)return Response.json(schedule([260111,260112],now));
  assert.equal(url,GAME_SOURCE);const round=JSON.parse(options.body).gmTs;
  return Response.json({...fixture,currentLottery:{gmId:'G101',gmTs:round}});
 },now);
 assert.equal(calls.length,4);assert.deepEqual(feed.rounds,['260111','260112']);
 assert.equal(new Set(feed.events.flatMap(e=>e.markets.map(m=>m.id))).size,feed.events.flatMap(e=>e.markets).length);
 await assert.rejects(()=>collectFeed(async()=>new Response('<html>error</html>'),now),/오류 화면/);
});

test('temporary official connection failures retry each public endpoint without replacing the source',async()=>{
 const attempts=new Map();
 const feed=await collectFeed(async(url,options)=>{
  const key=url===GAME_SOURCE?`${url}:${JSON.parse(options.body).gmTs}`:url;
  const count=(attempts.get(key)||0)+1;attempts.set(key,count);
  if(count===1)throw new TypeError('Failed to fetch');
  if(url===ROUND_SOURCE)return Response.json({rsMsg:{statusCode:'S'},protoGames:[{gmId:'G101',gmTs:260111}]});
  if(url===SCHEDULE_SOURCE)return Response.json(schedule([260111],now));
  return Response.json({...fixture,currentLottery:{gmId:'G101',gmTs:260111}});
 },now);
 assert.ok(feed.events.length>0);
 assert.deepEqual([...attempts.values()],[2,2,2]);
 assert.equal(feed.sourceId,'betman-official-v1');
});

test('retryable official HTTP errors recover, while persistent failures identify the failed stage',async()=>{
 let catalogAttempts=0;
 const recovered=await collectFeed(async(url,options)=>{
  if(url===ROUND_SOURCE){
   catalogAttempts++;
   if(catalogAttempts===1)return new Response('',{status:503});
   return Response.json({rsMsg:{statusCode:'S'},protoGames:[{gmId:'G101',gmTs:260111}]});
  }
  if(url===SCHEDULE_SOURCE)return Response.json(schedule([260111],now));
  return Response.json({...fixture,currentLottery:{gmId:'G101',gmTs:JSON.parse(options.body).gmTs}});
 },now);
 assert.ok(recovered.events.length>0);
 assert.equal(catalogAttempts,2);
 let attempts=0;
 await assert.rejects(()=>collectFeed(async url=>{
  attempts++;
  if(url===ROUND_SOURCE)return new Response('',{status:503});
  throw Error('later endpoints must not be called');
 },now),/회차 목록 응답 503/);
 assert.equal(attempts,2);
 attempts=0;
 await assert.rejects(()=>collectFeed(async url=>{
  attempts++;
  if(url===ROUND_SOURCE)throw new TypeError('Failed to fetch');
  throw Error('later endpoints must not be called');
 },now),/회차 목록 연결 실패: 네트워크 연결 중단/);
 assert.equal(attempts,2);
 attempts=0;
 await assert.rejects(()=>collectFeed(async url=>{
  attempts++;
  if(url===ROUND_SOURCE)return new Response('',{status:403});
  throw Error('later endpoints must not be called');
 },now),/회차 목록 응답 403/);
 assert.equal(attempts,1);
});

test('deployed collector establishes the public Betman session before requesting domestic odds',async()=>{
 const previous=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options={})=>{
  calls.push({url:String(url),options});
  if(String(url)===SOURCE)return new Response('',{headers:{'set-cookie':'JSESSIONID=official-session; Path=/, CCN_VKEY=official-vkey; Path=/'}});
  assert.equal(options.headers.cookie,'JSESSIONID=official-session; CCN_VKEY=official-vkey');
  if(url===ROUND_SOURCE)return Response.json({rsMsg:{statusCode:'S'},protoGames:[{gmId:'G101',gmTs:260111}]});
  if(url===SCHEDULE_SOURCE)return Response.json(schedule([260111],now));
  assert.equal(url,GAME_SOURCE);
  return Response.json({...fixture,currentLottery:{gmId:'G101',gmTs:260111}});
 };
 try{
  const feed=await collectFeed(undefined,now);
  assert.ok(feed.events.length>0);
  assert.equal(calls[0].url,SOURCE);
  assert.equal(calls.filter(call=>call.url!==SOURCE).length,3);
 }finally{globalThis.fetch=previous;}
});

test('deployed collector retries a temporary public session failure before reading protected odds',async()=>{
 const previous=globalThis.fetch;
 let sessions=0;
 globalThis.fetch=async(url,options={})=>{
  if(String(url)===SOURCE){
   sessions++;
   if(sessions===1)throw new TypeError('Failed to fetch');
   return new Response('',{headers:{'set-cookie':'JSESSIONID=recovered-session; Path=/'}});
  }
  assert.equal(options.headers.cookie,'JSESSIONID=recovered-session');
  if(url===ROUND_SOURCE)return Response.json({rsMsg:{statusCode:'S'},protoGames:[{gmId:'G101',gmTs:260111}]});
  if(url===SCHEDULE_SOURCE)return Response.json(schedule([260111],now));
  return Response.json({...fixture,currentLottery:{gmId:'G101',gmTs:260111}});
 };
 try{
  const feed=await collectFeed(undefined,now);
  assert.ok(feed.events.length>0);
  assert.equal(sessions,2);
 }finally{globalThis.fetch=previous;}
});

test('deployed collector retries the complete board through the official mobile host after a 525',async()=>{
 const previous=globalThis.fetch,calls=[];
 const mobileRound=new URL('buyPsblGame/inqCacheBuyAbleGameInfoList.do',MOBILE_SOURCE).href;
 const mobileSchedule=new URL('buyPsblGame/schedule.do',MOBILE_SOURCE).href;
 const mobileGame=new URL('buyPsblGame/gameInfoInq.do',MOBILE_SOURCE).href;
 globalThis.fetch=async(url,options={})=>{
  calls.push(String(url));
  if(url===SOURCE)return new Response('',{headers:{'set-cookie':'JSESSIONID=primary; Path=/'}});
  if(url===ROUND_SOURCE)return new Response('',{status:525});
  if(url===MOBILE_SOURCE)return new Response('',{headers:{'set-cookie':'JSESSIONID=mobile; Path=/'}});
  assert.equal(options.headers.cookie,'JSESSIONID=mobile');
  assert.equal(options.headers.origin,'https://m.betman.co.kr');
  assert.equal(options.headers.referer,MOBILE_SOURCE);
  if(url===mobileRound)return Response.json({rsMsg:{statusCode:'S'},protoGames:[{gmId:'G101',gmTs:260111}]});
  if(url===mobileSchedule)return Response.json(schedule([260111],now));
  assert.equal(url,mobileGame);
  return Response.json({...fixture,currentLottery:{gmId:'G101',gmTs:260111}});
 };
 try{
  const feed=await collectFeed(undefined,now);
  assert.ok(feed.events.length>0);
  assert.equal(feed.sourceUrl,MOBILE_SOURCE);
  assert.equal(feed.status.originHost,'m.betman.co.kr');
  assert.equal(feed.status.fallbackFrom,'www.betman.co.kr');
  assert.ok(feed.events.every(event=>event.teamNamesVerified===false));
  assert.equal(calls.filter(url=>url===ROUND_SOURCE).length,2);
  assert.ok(calls.includes(mobileGame));
 }finally{globalThis.fetch=previous;}
});

test('an access denial or invalid official JSON never switches hosts',async()=>{
 const previous=globalThis.fetch;
 try{
  for(const response of [new Response('',{status:403}),new Response('',{status:429}),new Response('<html>error</html>')]){
   const calls=[];
   globalThis.fetch=async url=>{
    calls.push(String(url));
    if(url===SOURCE)return new Response('',{headers:{'set-cookie':'JSESSIONID=primary; Path=/'}});
    assert.equal(url,ROUND_SOURCE);
    return response.clone();
   };
   await assert.rejects(()=>collectFeed(undefined,now));
   assert.equal(calls.filter(url=>url===MOBILE_SOURCE).length,0);
  }
 }finally{globalThis.fetch=previous;}
});

test('collector uses the official monthly G101 schedule when the buyable catalog omits G101',async()=>{
 const calls=[];
 const feed=await collectFeed(async(url,options)=>{
  calls.push(url);
  if(url===ROUND_SOURCE)return Response.json({rsMsg:{statusCode:'S'},protoGames:[{gmId:'G102',gmTs:260094}]});
  if(url===SCHEDULE_SOURCE){
   const body=JSON.parse(options.body);
   assert.deepEqual({gmId:body.gmId,league:body.league,team:body.team,yearMonth:body.yearMonth,start:body.start,length:body.length},{gmId:'G101',league:'',team:'',yearMonth:'202609',start:0,length:100});
   return Response.json(schedule([260111,260112],now));
  }
  assert.equal(url,GAME_SOURCE);const round=JSON.parse(options.body).gmTs;
  return Response.json({...fixture,currentLottery:{gmId:'G101',gmTs:round}});
 },now);
 assert.deepEqual(feed.rounds,['260111','260112']);
 assert.ok(feed.events.length>0);
 assert.equal(calls.filter(url=>url===GAME_SOURCE).length,2);
});

test('collector fails closed when official G101 discovery yields no current schedule',async()=>{
 await assert.rejects(()=>collectFeed(async url=>{
  if(url===ROUND_SOURCE)return Response.json({rsMsg:{statusCode:'S'},protoGames:[{gmId:'G102',gmTs:260094}]});
  if(url===SCHEDULE_SOURCE)return Response.json({rsMsg:{statusCode:'S'},schedules:{data:[]}});
  throw Error('game endpoint must not be called');
 },now),/최근·예정 회차/);
});

test('a failed refresh is stale immediately; sale-closed quotes before kickoff remain eligible while pending and suspended quotes do not',()=>{
 const feed=parseFeed(fixture,now);
 assert.equal(feedFreshness({...feed,refreshState:{error:'failed'}},+now).kind,'stale');
 assert.equal(feedFreshness(feed,+now+180000).kind,'stale');
 const event=feed.events.find(e=>e.available),market=event.markets[0];
 const rows=Array.from({length:4},(_,i)=>({id:String(i),date:'2025-01-01 18:00',league:event.league,market:market.market,line:null,home:event.home,away:event.away,closing:market.outcomes.map(o=>o.odds),opening:market.outcomes.map(o=>o.odds),result:'승'}));
 const recommendations=recommendPatterns([event],rows,+now);
 assert.ok(recommendations.length>0);
 assert.ok(recommendations.every(item=>item.evidenceCount>0));
 assert.ok(recommendations.every((item,index)=>index===0||recommendations[index-1].supportCount>=item.supportCount));
 assert.ok(recommendations[0].evidence.some(item=>item.id==='team-outcome'&&item.stats?.n===4));
 assert.ok(recommendations.filter(item=>item.marketId===market.id).length>1);
 assert.equal(recommendPatterns([{...event,available:false}],rows,+now).length,0);
 assert.equal(recommendPatterns([{...event,markets:event.markets.map(m=>({...m,available:false}))}],rows,+now).length,0);
 const closedEvent={...event,available:false,status:'발매 종료 · 분석 참고용',saleClosesAt:new Date(+now-60000).toISOString(),markets:event.markets.map(item=>({...item,available:false,status:'발매 종료 · 분석 참고용'}))};
 const closedRecommendations=recommendPatterns([closedEvent],rows,+now);
 assert.ok(closedRecommendations.length>0);
 assert.ok(closedRecommendations.every(item=>item.event.status.includes('발매 종료')));
 const suspendedEvent={...closedEvent,status:'발매 중지 · 분석 참고용',markets:closedEvent.markets.map(item=>({...item,status:'발매 중지 · 분석 참고용'}))};
 assert.equal(recommendPatterns([suspendedEvent],rows,+now).length,0);
});

test('conflicting team evidence remains visible and is ranked with every selection',()=>{
 const event={id:'future',sport:'baseball',league:'KBO',home:'홈팀',away:'원정팀',startsAt:'2026-09-20T09:00:00.000Z',available:true,markets:[{id:'winner',market:'일반',marketLabel:'일반',line:null,available:true,outcomes:[{key:'home',label:'홈 승',odds:1.8},{key:'away',label:'원정 승',odds:1.8}]}]};
 const rows=[];
 for(let i=0;i<10;i++)rows.push({id:`general-${i}`,date:`2025-01-${String(i+1).padStart(2,'0')} 18:00`,league:'KBO',market:'일반',line:null,home:`다른홈${i}`,away:`다른원정${i}`,closing:[1.8,null,1.8],opening:[1.8,null,1.8],result:'승'});
 for(let i=0;i<4;i++)rows.push({id:`team-${i}`,date:`2025-02-${String(i+1).padStart(2,'0')} 18:00`,league:'KBO',market:'일반',line:null,home:'홈팀',away:`상대${i}`,closing:[1.8,null,2],opening:[1.8,null,2],result:'패'});
 const recommendations=recommendPatterns([event],rows,Date.parse('2026-09-18T00:00:00Z'));
 const home=recommendations.find(item=>item.slot===0);
 assert.ok(recommendations.length>=2);
 assert.ok(home);
  assert.ok(home.conflictCount>0);
});

test('price recommendations keep same-sport, same-league, and same-team evidence separate',()=>{
 const event={id:'future-scope',sport:'baseball',league:'KBO',home:'팀A',away:'팀B',startsAt:'2026-09-20T09:00:00.000Z',available:true,markets:[{id:'winner',market:'일반',marketLabel:'일반',line:null,available:true,outcomes:[{key:'home',label:'홈 승',odds:1.8},{key:'away',label:'원정 승',odds:2}]}]};
 const row=(id,league,home,away,result)=>({id,date:`2025-01-${String(Number(id.replace(/\D/g,''))+1).padStart(2,'0')} 18:00`,league,market:'일반',line:null,home,away,closing:[1.8,null,2],opening:[1.8,null,2],result});
 const rows=[
  row('sport1','MLB','다른홈1','다른원정1','승'),row('sport2','MLB','다른홈2','다른원정2','승'),row('sport3','NPB','다른홈3','다른원정3','승'),row('sport4','NPB','다른홈4','다른원정4','패'),
  row('league1','KBO','팀A','상대1','승'),row('league2','KBO','팀A','상대2','승'),row('league3','KBO','팀A','상대3','승')
 ];
 const recommendations=recommendPatterns([event],rows,Date.parse('2026-09-18T00:00:00Z'));
 const home=recommendations.find(item=>item.slot===0);
 assert.ok(home);
 const evidence=id=>home.evidence.find(item=>item.id===id);
 assert.equal(evidence('sport-outcome').scope,'sport');assert.equal(evidence('sport-outcome').stats.n,7);
 assert.equal(evidence('league-outcome').scope,'league');assert.equal(evidence('league-outcome').stats.n,3);
 assert.equal(evidence('team-outcome').scope,'team');assert.equal(evidence('team-outcome').stats.n,3);
 assert.equal(home.highestSupportScopeRank,3);
 assert.equal(home.supportedScopeCount,3);
});

test('two-way price combinations ignore an unused draw slot in historical quotes',()=>{
 const event={id:'future-two-way',sport:'baseball',league:'KBO',home:'팀A',away:'팀B',startsAt:'2026-09-20T09:00:00.000Z',available:true,markets:[{id:'winner',market:'일반',marketLabel:'일반',line:null,available:true,outcomes:[{key:'home',label:'홈 승',odds:1.8},{key:'away',label:'원정 승',odds:2}]}]};
 const rows=Array.from({length:3},(_,index)=>({id:`two-way-${index}`,date:`2025-01-0${index+1} 18:00`,league:'KBO',market:'일반',line:null,home:'팀A',away:`상대${index}`,closing:[1.8,3.1+index/10,2],opening:[1.8,3.1+index/10,2],result:'승'}));
 const home=recommendPatterns([event],rows,Date.parse('2026-09-18T00:00:00Z')).find(item=>item.slot===0);
 assert.ok(home);
 assert.equal(home.evidence.find(item=>item.id==='sport-combo').stats.n,3);
 assert.equal(home.evidence.find(item=>item.id==='league-combo').stats.n,3);
 assert.equal(home.evidence.find(item=>item.id==='team-combo').stats.n,3);
});

test('a draw selection also keeps each team context separate and only counts draws as hits',()=>{
 const event={id:'future-draw-context',sport:'soccer',league:'EPL',home:'팀A',away:'팀B',startsAt:'2026-09-20T09:00:00.000Z',available:true,markets:[{id:'winner',market:'일반',marketLabel:'일반',line:null,available:true,outcomes:[{key:'home',label:'홈 승',odds:2},{key:'draw',label:'무',odds:3.2},{key:'away',label:'원정 승',odds:4}]}]};
 const row=(id,home,away,result)=>({id,date:`2025-02-0${id} 18:00`,league:'EPL',market:'일반',line:null,home,away,closing:[2,3.2,4],opening:[2,3.2,4],result});
 const rows=[row(1,'팀A','상대1','무'),row(2,'팀A','상대2','무승부'),row(3,'팀A','상대3','승'),row(4,'상대4','팀B','무'),row(5,'상대5','팀B','패'),row(6,'상대6','팀B','DRAW')];
 const draw=recommendPatterns([event],rows,Date.parse('2026-09-18T00:00:00Z')).find(item=>item.slot===1);
 assert.ok(draw);
 const homeEvidence=draw.evidence.find(item=>item.id==='home-team-draw-outcome');
 const awayEvidence=draw.evidence.find(item=>item.id==='away-team-draw-outcome');
 assert.deepEqual({n:homeEvidence.stats.n,wins:homeEvidence.stats.wins,losses:homeEvidence.stats.losses},{n:3,wins:2,losses:1});
 assert.deepEqual({n:awayEvidence.stats.n,wins:awayEvidence.stats.wins,losses:awayEvidence.stats.losses},{n:3,wins:2,losses:1});
});
