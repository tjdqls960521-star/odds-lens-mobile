import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {parseFeed,supportedMarket} from '../src/betman-feed.mjs';
import {parseOfficialResults} from '../src/betman-results.mjs';
import {prepareSlip} from '../src/slips.mjs';
import {HISTORY_SOURCES,HISTORY_FIELDS,normalizeHistoricalCsv,unpackHistoricalRows} from '../src/history-core.mjs';
import {resultIndex} from '../public/odds-lens/live-core.mjs';
import {analyzePatternEvent} from '../public/odds-lens/pattern-board.mjs';
import {resolveOfficialPick,resolvePick} from '../public/odds-lens/slip-core.mjs';
import {evidenceTitle} from '../public/odds-lens/discovery-core.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/betman-public.json',import.meta.url)));
const feed=parseFeed(fixture,new Date(fixture.capturedAt));
const event=feed.events.find(e=>e.markets.some(m=>m.gameNumber===2767));
const market=event.markets.find(m=>m.gameNumber===2767);
const header='연도,회차,번호,리그,유형,시간,경기장,홈,원정,초기승배당,초기무배당,초기패배당,초기핸디값,최종승배당,최종무배당,최종패배당,최종핸디값,배변여부,배당변경횟수,승배당변화,무배당변화,패배당변화,홈점수,원정점수,결과';
const csvRow=(id,result='①')=>`2026,120,${id},KBO,승1패,2026-09-12 18:00,구장,홈팀,원정팀,1.97,3.30,2.95,0,1.97,3.30,2.95,0,X,0,0,0,0,3,2,${result}`;

test('official baseball 승1패 retains all three exact prices and a pending third price holds the entire market',()=>{
 assert.equal(market.market,'승1패');assert.equal(market.line,null);
 assert.deepEqual(market.outcomes.map(o=>o.odds),[1.97,3.3,2.95]);
 assert.deepEqual(market.outcomes.map(o=>o.key),['home','draw','away']);
 assert.match(market.outcomes[1].label,/①/);
 const saved=prepareSlip({id:'qa-one-run-pick-record',stake:10000,picks:[{eventId:event.id,marketId:market.id,outcomeKey:'draw',odds:3.3}]},feed,new Date(fixture.capturedAt));
 assert.match(saved.picks[0].label,/①/);assert.equal(saved.picks[0].line,null);assert.equal(saved.picks[0].market,'승1패');
 assert.equal(supportedMarket({itemCode:'SC',betNm:'축구 승1패',betTypNm:'승N패'}),null);
 assert.equal(supportedMarket({itemCode:'BS',betNm:'야구 전반 승1패',betTypNm:'승N패'}),null);
 const copy=structuredClone(fixture),k=copy.compSchedules.keys;
 copy.compSchedules.datas.find(r=>r[k.indexOf('matchSeq')]===2767)[k.indexOf('drawAllot')]=0;
 const pending=parseFeed(copy,new Date(fixture.capturedAt)).events.flatMap(e=>e.markets).find(m=>m.gameNumber===2767);
 assert.equal(pending.pending,true);assert.deepEqual(pending.outcomes,[]);
});

test('baseball archive and CSV treat ①/1 as the middle outcome and keep it in every denominator',()=>{
 const rows=normalizeHistoricalCsv([header,csvRow(1,'승'),csvRow(2),csvRow(3,'패')].join('\n'),HISTORY_SOURCES.baseball);
 assert.equal(rows.length,3);
 assert.deepEqual(rows.map(resultIndex),[0,1,2]);
 assert.equal(resultIndex({market:'승1패',result:'1'}),1);
 assert.equal(normalizeHistoricalCsv([header,csvRow(1)].join('\n'),HISTORY_SOURCES.soccer).length,0);
 const manifest=JSON.parse(readFileSync('public/odds-lens/data/manifest.json'));
 const archive=JSON.parse(readFileSync(`public/odds-lens/data/${manifest.snapshot}/2025.json`));
 const middle=archive.map(r=>Object.fromEntries(manifest.fields.map((f,i)=>[f,r[i]]))).filter(r=>r.market==='승1패'&&r.result==='①');
 assert.ok(middle.length>0);assert.ok(middle.every(r=>resultIndex(r)===1));
 const separateGames=rows.map((r,i)=>({...r,date:`2026-09-${12+i} 18:00`}));
 const pattern=analyzePatternEvent({...event,home:'홈팀',away:'원정팀',league:'KBO'},market,separateGames);
 assert.deepEqual(pattern.scopes.sport.counts,[1,1,1]);assert.equal(pattern.scopes.homeTeam.n,3);
 assert.equal(pattern.scopes.sport.rates[0],1/3);
 assert.match(evidenceTitle(event,market,1,{scope:'league',basis:'single',wins:2,n:3}).text,/① 1점차 이내/);
});

test('official 승1패 result codes settle only the selected bucket, preserve cancellation and never infer wins from scores',()=>{
 const pick={eventId:event.id,marketId:market.id,sport:'baseball',startsAt:event.startsAt,home:event.home,away:event.away,market:'승1패',line:null,outcomeKeys:market.outcomeKeys,outcomeKey:'draw',year:market.year,round:market.round,gameNumber:market.gameNumber};
 for(const [code,status] of [['0','lost'],['1','won'],['2','lost'],['4','cancelled'],['02','pending']]){
  const copy=structuredClone(fixture),k=copy.compSchedules.keys,row=copy.compSchedules.datas.find(r=>r[k.indexOf('matchSeq')]===2767);
  row[k.indexOf('gameResult')]=code;row[k.indexOf('protoStatus')]='4';row[k.indexOf('mchScore')]='3:2';
  const record=parseOfficialResults(copy,'2026-10-05T00:00:00Z'),result=record.rows.find(r=>r.gameNumber===2767);
  assert.deepEqual(result.outcomeKeys,['home','draw','away']);assert.equal(result.line,null);
  assert.equal(resolveOfficialPick(pick,result,record,Date.parse('2026-10-05T00:00:00Z')).status,status);
  if(code==='1'){assert.match(resolveOfficialPick(pick,result,record).sourceResult,/①/);assert.equal(resolveOfficialPick({...pick,outcomeKey:'home'},result,record).status,'lost');}
 }
 const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date(pick.startsAt));
 const historical={id:`${pick.year}-${Number(pick.round.slice(2))}-${pick.gameNumber}`,date,market:'승1패',line:0,home:pick.home,away:pick.away,result:'①'};
 assert.equal(resolvePick(pick,historical).status,'won');
 assert.equal(resolvePick({...pick,outcomeKey:'home'},historical).status,'lost');
});

test('existing baseball history catches up previously excluded markets once without dropping other history',async()=>{
 const dir=await mkdtemp(tmpdir()+'/odds-one-run-');
 await build({entryPoints:['src/worker.mjs'],outfile:dir+'/worker.mjs',bundle:true,format:'esm',platform:'browser'});
 const {default:worker}=await import(pathToFileURL(dir+'/worker.mjs'));
 const key='odds-lens/history-v2/baseball.json',old=HISTORY_FIELDS.map(f=>({id:'old',date:'2026-09-20 18:00',market:'일반',home:'홈팀',away:'원정팀',result:'승'})[f]??null);
 const stored=new Map([[key,JSON.stringify({source:'baseball',rows:[old],sourceLatestAt:'2026-10-04 18:00',lastSuccess:new Date().toISOString(),lastAttempt:Date.now()-60001})]]);
 const env={ODDS_STORE:{get:async k=>stored.has(k)?{text:async()=>stored.get(k)}:null,put:async(k,v)=>stored.set(k,v)}};
 const previous=globalThis.fetch;let calls=0;
 globalThis.fetch=async url=>{calls++;assert.match(new URL(url).searchParams.get('tq'),/2026-08-28/);return new Response(header+'\n'+csvRow(1));};
 try{
  const response=await worker.fetch(new Request('https://example.com/odds-lens/api/history/baseball/current.json'),env);
  assert.equal(response.status,200);const data=await response.json();assert.equal(data.rows.length,2);
  assert.equal(unpackHistoricalRows(data.rows).find(r=>r.market==='승1패').result,'①');
  assert.equal(JSON.parse(stored.get(key)).marketSupportVersion,2);assert.match(data.refreshState.sourceVersion,/:markets-v2$/);
  await worker.fetch(new Request('https://example.com/odds-lens/api/history/baseball/current.json'),env);
  assert.equal(calls,1);
 }finally{globalThis.fetch=previous;}
});
