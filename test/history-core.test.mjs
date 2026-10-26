import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {HISTORY_SOURCES,normalizeHistoricalCsv,overlapStart,packHistoricalRows} from '../src/history-core.mjs';
import {buildPatternReport,distribution,highSignalCatalog,makeTarget,priceBand,priceBandPattern,recommendPatterns,resultIndex,selectedStats,teamPattern,teamUnderOverPattern,underOverLinePattern} from '../public/odds-lens/live-core.mjs';

const header='"연도","회차","번호","리그","유형","시간","경기장","홈","원정","초기승배당","초기무배당","초기패배당","초기핸디값","최종승배당","최종무배당","최종패배당","최종핸디값","배변여부","배당변경횟수","승배당변화","무배당변화","패배당변화","홈점수","원정점수","결과"';
const line=(number,type='일반',result='승')=>`"2026","1","${number}","K리그","${type}","2026-09-12 18:00","구장","홈팀","원정팀","1.60","3.20","4.00","0","1.65","3.10","3.90","0","X","0","0","0","0","2","1","${result}"`;

test('historical CSV normalizer retains supported outcomes, keeps the latest duplicate, and excludes SUM/승1패',()=>{
 const corrected=line('1').replace('"2","1","승"','"3","1","승"');
 const rows=normalizeHistoricalCsv([header,line('1'),corrected,line('2','SUM'),line('3','승1패')].join('\n'),HISTORY_SOURCES.soccer);
 assert.equal(rows.length,1);
 assert.deepEqual(rows[0].closing,[1.65,3.1,3.9]);
 assert.deepEqual(rows[0].score,[3,1]);
 assert.equal(rows[0].id,'2026-1-1');
 assert.equal(overlapStart('2026-09-12 18:00',14),'2026-08-29 18:00:00');
});

test('runtime pattern catalog uses time-ordered training data and excludes disabled markets',()=>{
 const rows=normalizeHistoricalCsv([header,...Array.from({length:8},(_,index)=>line(String(index+1),'일반',index<6?'승':'패')),line('9','SUM'),line('10','전반')].join('\n'),HISTORY_SOURCES.soccer).map((row,index)=>({...row,date:`2026-0${index<8?1:2}-0${index+1} 18:00`}));
 const report=buildPatternReport(rows,{sport:'soccer'});
 assert.equal(report.summary.eligibleObservations,8);
  assert.ok(report.split.holdoutStart);
  assert.ok(report.patterns.outcomeOdds.every(pattern=>!['SUM','전반','전반_언오버'].includes(pattern.scope.market)));
  assert.ok(report.patterns.outcomeOdds.some(pattern=>pattern.scope.sampleScope==='sport'));
  assert.ok(report.patterns.outcomeOdds.some(pattern=>pattern.scope.sampleScope==='league'));
  assert.ok(report.patterns.teamOutcomeOdds.every(pattern=>pattern.scope.sampleScope==='team'));
});

test('handicap draw is resolved as the draw slot and remains in the win-rate denominator',()=>{
 const target={
  market:'핸디캡',
  selections:[
   {slot:0,label:'홈 핸디승',odds:1.8},
   {slot:1,label:'무',odds:3.4},
   {slot:2,label:'원정 핸디승',odds:2.1}
  ],
  odds:[1.8,3.4,2.1]
 };
 const rows=[
  {market:'핸디캡',result:'핸디승',closing:[1.8,3.4,2.1]},
  {market:'핸디캡',result:'핸디무',closing:[1.8,3.4,2.1]},
  {market:'핸디캡',result:'핸디패',closing:[1.8,3.4,2.1]}
 ];
 assert.equal(resultIndex({market:'핸디캡',result:'핸디무'}),1);
 assert.equal(resultIndex({market:'전반_핸디캡',result:'핸디무'}),1);
 const summary=distribution(rows,target);
 assert.deepEqual(summary.counts,[1,1,1]);
 assert.equal(summary.known,3);
 assert.equal(summary.unresolved,0);
 const stats=selectedStats(rows,target,0);
 assert.equal(stats.n,3);
 assert.equal(stats.wins,1);
 assert.equal(stats.losses,2);
  assert.equal(stats.rate,1/3);
});

test('a draw only settles the draw selection and remains a loss for home or away selections',()=>{
 const target=makeTarget({id:'future-draw',league:'EPL',home:'홈팀',away:'원정팀',startsAt:'2026-09-20T09:00:00.000Z'}, {market:'일반',marketLabel:'일반',outcomes:[{key:'home',label:'홈 승',odds:1.9},{key:'draw',label:'무',odds:3.2},{key:'away',label:'원정 승',odds:3.8}]});
 const rows=[
  {market:'일반',result:'승',closing:[1.9,3.2,3.8]},
  {market:'일반',result:'무승부',closing:[1.9,3.2,3.8]},
  {market:'일반',result:'패',closing:[1.9,3.2,3.8]}
 ];
 assert.equal(resultIndex({market:'일반',result:'무승부'}),1);
 assert.equal(resultIndex({market:'일반',result:' DRAW '}),1);
 const home=selectedStats(rows,target,0),draw=selectedStats(rows,target,1),away=selectedStats(rows,target,2);
 assert.equal(home.n,3);assert.equal(home.wins,1);assert.equal(home.losses,2);assert.equal(home.rate,1/3);
 assert.equal(draw.wins,1);assert.equal(draw.losses,2);
 assert.equal(away.wins,1);assert.equal(away.losses,2);
});

test('under/over line, price band, and team context keep the line, role, draw, and cutoff intact',()=>{
 const event={id:'future-total',sport:'baseball',league:'KBO',home:'홈팀',away:'원정팀',startsAt:'2026-09-20T09:00:00.000Z',available:true};
 const market={id:'total',market:'언오버',marketLabel:'언오버',line:8.5,available:true,outcomes:[{key:'under',label:'언더',odds:1.72},{key:'over',label:'오버',odds:1.84}]};
 const target=makeTarget(event,market);
 const row=(id,{date='2026-09-10 18:00',line=8.5,home='홈팀',away='상대',under=1.72,result='언더'}={})=>({id,date,league:'KBO',market:'언오버',line,home,away,closing:[under,null,1.84],opening:[under,null,1.84],result});
 const rows=[
  row('home-win-1'),
  row('home-win-2',{result:'언더'}),
  row('home-draw',{result:'무'}),
  row('home-away-win',{home:'상대',away:'홈팀',result:'언더'}),
  row('away-win',{home:'상대',away:'원정팀',result:'언더'}),
  row('same-band',{under:1.74,result:'언더'}),
  row('wrong-line',{line:9.5,result:'언더'}),
  row('after-cutoff',{date:'2026-09-20 01:00',result:'언더'})
 ];
 assert.deepEqual(priceBand(1.74),{lower:1.74,upper:1.75,width:.01});
 const exact=underOverLinePattern(rows,target,0);
 assert.equal(exact.line,8.5);
 assert.equal(exact.rows.length,5);
 assert.equal(exact.stats.n,5);
 assert.equal(exact.stats.wins,4);
 assert.equal(exact.stats.losses,1,'언오버 무승부도 손실로 분모에 남아야 한다');
 const band=priceBandPattern(rows,target,0);
 assert.deepEqual(band.oddsBand,{lower:1.72,upper:1.73,width:.01});
 assert.equal(band.stats.n,5);
 assert.equal(band.stats.wins,4);
 const homeOnly=teamUnderOverPattern(rows,target,'홈팀',0);
 assert.equal(homeOnly.role,'home');
 assert.equal(homeOnly.sameRole,true);
 assert.equal(homeOnly.stats.n,3);
 assert.equal(homeOnly.stats.wins,2);
 const allVenue=teamUnderOverPattern(rows,target,'홈팀',0,{sameRole:false});
 assert.equal(allVenue.stats.n,4);
 assert.equal(allVenue.stats.wins,3);
 const recommendations=recommendPatterns([{...event,markets:[market]}],rows,Date.parse('2026-09-19T00:00:00.000Z'));
 const under=recommendations.find(item=>item.slot===0);
 assert.ok(under);
 assert.ok(under.evidence.some(item=>item.id==='sport-price-band'&&item.scope==='sport'&&item.family==='under_over_line_price_band'&&item.stats?.n===5));
 assert.ok(under.evidence.some(item=>item.id==='home-team-under-over-price'&&item.stats?.n===3));
 assert.ok(under.evidence.some(item=>item.id==='away-team-under-over-price'&&item.stats?.n===1));
});

test('team price screening keeps the current home or away role unless a broad descriptive scope is requested',()=>{
 const event={id:'future-winner',league:'KBO',home:'팀A',away:'팀B',startsAt:'2026-09-20T09:00:00.000Z'};
 const target=makeTarget(event,{market:'일반',marketLabel:'일반',outcomes:[{key:'home',label:'홈 승',odds:1.8},{key:'away',label:'원정 승',odds:2}]});
 const row=(id,home,away,closing,result)=>({id,date:'2026-09-10 18:00',league:'KBO',market:'일반',line:null,home,away,closing,opening:closing,result});
 const rows=[
  row('home-1','팀A','상대1',[1.8,null,2],'승'),
  row('home-2','팀A','상대2',[1.8,null,2],'승'),
  row('home-3','팀A','상대3',[1.8,null,2],'승'),
  row('away-1','상대4','팀A',[2,null,1.8],'패')
 ];
 assert.equal(teamPattern(rows,target,'팀A',{mode:'outcome'}).stats.n,3);
 assert.equal(teamPattern(rows,target,'팀A',{mode:'outcome',sameRole:false}).stats.n,4);
});

test('high-signal fast scan exposes team and under/over line-price patterns using training only',()=>{
 const rows=Array.from({length:12},(_,index)=>({
  id:`total-${index}`,
  date:`2025-01-${String(index+1).padStart(2,'0')} 18:00`,
  league:'KBO',market:'언오버',line:8.5,home:'팀A',away:`상대${index}`,
  closing:[1.72,null,1.84],opening:[1.72,null,1.84],result:index<9?'언더':'오버'
 }));
 const report=buildPatternReport(rows,{sport:'baseball'});
 assert.equal(report.schemaVersion,3);
 assert.ok(report.patterns.underOverLineOdds.some(pattern=>pattern.scope.line===8.5&&pattern.scope.outcome.index===0));
 assert.ok(report.patterns.teamUnderOverLineOdds.some(pattern=>pattern.scope.team==='팀A'&&pattern.scope.teamRole==='home'));
 const scan=highSignalCatalog(report,{minimumSamples:1,minimumWinRate:.5,limit:50});
 assert.deepEqual(scan.thresholds,{minimumSamples:3,minimumWinRate:.7});
 assert.ok(scan.items.some(item=>item.family==='under_over_line_price_band'));
 assert.ok(scan.items.some(item=>item.family==='team_under_over_line_price_band'));
 assert.ok(scan.items.every(item=>item.stats.n>=3&&item.stats.winRate>=.7&&item.rankedOn==='trainingOnly'));
 const total=scan.items.find(item=>item.family==='under_over_line_price_band'&&item.selection.slot===0);
 assert.equal(total.stats.n,9);
 assert.equal(total.stats.winRate,1);
 assert.equal(total.holdout.n,3);
 assert.equal(total.holdout.winRate,0);
});

test('worker stores a source patch and returns packed historical records',async()=>{
 const dir=await mkdtemp(tmpdir()+'/odds-history-worker-');
 await build({entryPoints:['src/worker.mjs'],outfile:dir+'/worker.mjs',external:['cloudflare:sockets'],bundle:true,format:'esm',platform:'browser'});
 const {default:worker}=await import(pathToFileURL(dir+'/worker.mjs').href+'?history-patch');
 const stored=new Map();
 const bucket={get:async key=>stored.has(key)?{text:async()=>stored.get(key)}:null,put:async(key,value)=>stored.set(key,value)};
 const previous=globalThis.fetch;
 globalThis.fetch=async url=>{
   assert.match(String(url),/gviz\/tq/);
   return new Response([header,line('1')].join('\n'),{status:200});
 };
 try{
   const response=await worker.fetch(new Request('https://example.com/odds-lens/api/history/soccer/current.json'),{ODDS_STORE:bucket});
   assert.equal(response.status,200);
   const payload=await response.json();
   assert.equal(payload.rows.length,1,JSON.stringify(payload));
   assert.equal(payload.rows[0][0],'2026-1-1');
   const summaryResponse=await worker.fetch(new Request('https://example.com/odds-lens/api/history/soccer/current.json?summary=1'),{ODDS_STORE:bucket});
   const summary=await summaryResponse.json();
   assert.equal(summary.sport,'soccer');
   assert.equal('rows' in summary,false);
   assert.match(summary.sourceVersion,/^[a-f0-9]{64}$/);
   const saved=JSON.parse(stored.get('odds-lens/history-v2/soccer.json'));
   assert.deepEqual(saved.rows,packHistoricalRows(normalizeHistoricalCsv([header,line('1')].join('\n'),HISTORY_SOURCES.soccer)));
 }finally{globalThis.fetch=previous;}
});
