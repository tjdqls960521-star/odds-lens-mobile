import test from 'node:test';
import assert from 'node:assert/strict';
import {sequencePatterns,patternText} from '../public/odds-lens/sequence-patterns.mjs';
import {analyzePatternEvent,exactPatternCatalog} from '../public/odds-lens/pattern-board.mjs';
import {makeTarget,matchHistorical} from '../public/odds-lens/live-core.mjs';
import {prepareSlip,saveSlip,attachSlipResults} from '../src/slips.mjs';
import {resolvePick,slipSummary} from '../public/odds-lens/slip-core.mjs';
import {packHistoricalRows} from '../src/history-core.mjs';
const event={id:'future',sport:'baseball',league:'KBO',home:'홈팀',away:'원정팀',startsAt:'2026-12-20T10:00:00Z',available:true};
const market={id:'betman-260120-9',market:'언오버',line:8.5,period:'full',year:'2026',round:'260120',gameNumber:9,outcomes:[{key:'under',label:'언더',odds:1.7},{key:'over',label:'오버',odds:1.8}]};
function rows(sequence){return sequence.map((slot,i)=>({id:String(i),date:new Date(Date.UTC(2024,0,1+i*2)).toISOString().slice(0,10)+' 18:00',league:'KBO',market:'언오버',line:8.5,home:'홈팀',away:'상대'+i,closing:[1.7,null,1.8],result:slot==null?'미확인':['언더','무','오버'][slot]}));}
const cycle=n=>rows([...Array.from({length:n},()=>[2,2,2,0]).flat(),2,2,2]);
test('exact-only matching ignores legacy tolerance and never mixes line or half-time markets',()=>{
 const data=[...rows([0,2,0]),{...rows([0])[0],id:'near',closing:[1.71,null,1.8]},{...rows([0])[0],id:'half',market:'전반_핸디캡'},{...rows([0])[0],id:'line',line:9.5}];
 const selected=matchHistorical(data,makeTarget(event,market),{mode:'combo',tolerance:.1});
 assert.equal(selected.length,3);assert.ok(selected.every(row=>row.closing[0]===1.7&&row.line===8.5));
 assert.throws(()=>analyzePatternEvent(event,{...market,market:'전반_핸디캡'},data));
});
test('three overs followed by under is mined and tied to the current trailing sequence',()=>{
 const pattern=sequencePatterns(cycle(12),[0,2]).find(p=>p.id==='2,2,2');
 assert.equal(pattern.slot,0);assert.equal(pattern.n,12);assert.equal(pattern.wins,12);assert.equal(pattern.active,true);assert.equal(pattern.grade,'B');
 assert.match(patternText(pattern,['언더','무','오버']),/오버 3회 연속 뒤 언더 12\/12회/);
 const afterUnder=sequencePatterns(cycle(12),[0,2]).find(p=>p.id==='0');assert.equal(afterUnder.neverRepeats,true);
});
test('3/3 stays C, strong later replication can reach A, broken later results cannot',()=>{
 assert.equal(sequencePatterns(cycle(3),[0,2]).find(p=>p.id==='2,2,2').grade,'C');
 assert.equal(sequencePatterns(cycle(40),[0,2]).find(p=>p.id==='2,2,2').grade,'A');
 const data=cycle(40);for(let i=120;i<data.length;i++)data[i].result='오버';
 assert.equal(sequencePatterns(data,[0,2]).find(p=>p.id==='2,2,2').grade,'C');
});
test('unresolved, void and same-day results break sequence windows; duplicates are not extra samples',()=>{
 const data=cycle(12);for(let i=2;i<data.length;i+=4)data[i].result='미확인';
 assert.equal(sequencePatterns(data,[0,2]).some(p=>p.id==='2,2,2'),false);
 const sameDay=cycle(12).map(r=>({...r,date:'2024-01-01 18:00'}));assert.equal(sequencePatterns(sameDay,[0,2]).length,0);
 const source=cycle(12),single=analyzePatternEvent(event,market,source),duplicate=analyzePatternEvent(event,market,[...source,...source.map(r=>({...r,id:'duplicate-'+r.id}))]);
 assert.equal(single.scopes.sport.n,duplicate.scopes.sport.n);assert.equal(single.scopes.sport.patterns.find(p=>p.id==='2,2,2').n,duplicate.scopes.sport.patterns.find(p=>p.id==='2,2,2').n);
});
test('catalog isolates exact odds and labels the empirical grade without a prediction probability',()=>{
 const report=exactPatternCatalog(cycle(12),{market:'언오버',scope:'league'});assert.ok(report.items.length);assert.ok(report.items.every(p=>p.line==='8.5'&&p.odds[0]===1.7));assert.ok(report.items.some(p=>p.grade==='B'));assert.ok(report.items.every(p=>p.probability===undefined));
});
const now=new Date('2026-12-19T00:00:00Z'),feed={fetchedAt:now.toISOString(),events:[{...event,markets:[market]}]};
const input={id:'test-slip-000000001',stake:10000,picks:[{eventId:event.id,marketId:market.id,outcomeKey:'under',odds:1.7}]};
test('saved slips lock the official quote and reject stale/changed prices, duplicate games and half-time',()=>{
 const slip=prepareSlip(input,feed,now);assert.equal(slip.picks[0].odds,1.7);assert.equal(slipSummary(slip).expected,17000);
 assert.throws(()=>prepareSlip({...input,picks:[...input.picks,...input.picks]},feed,now),/한 가지/);
 assert.throws(()=>prepareSlip({...input,picks:[{...input.picks[0],odds:1.75}]},feed,now),/배당이 변경/);
 assert.throws(()=>prepareSlip(input,{...feed,fetchedAt:'2026-12-18T00:00:00Z'},now),/갱신/);
});
test('slip arithmetic is exact to won; draw never wins a home pick; voids refund and mismatched lines wait',()=>{
 const slip=prepareSlip(input,feed,now),pick=slip.picks[0];
 assert.equal(slipSummary({stake:'1e4',picks:[{odds:1.7},{odds:1.8}]}).expected,30600);
 const source={id:'2026-120-9',date:'2026-12-20 19:00',market:'언오버',line:8.5,home:pick.home,away:pick.away,result:'언더'};
 assert.equal(resolvePick(pick,source).status,'won');assert.equal(resolvePick(pick,{...source,result:'오버'}).status,'lost');
 assert.equal(resolvePick(pick,{...source,line:9.5}).status,'pending');assert.equal(resolvePick(pick,{...source,result:'적특'}).status,'void');
 const home={...pick,market:'일반',line:null,outcomeKey:'home',outcomeKeys:['home','draw','away']};assert.equal(resolvePick(home,{...source,market:'일반',result:'무'}).status,'lost');
 assert.equal(slipSummary({stake:10000,picks:[{odds:1.7,result:{status:'void'}},{odds:1.8,result:{status:'won'}}]}).payout,18000);
 const attached=attachSlipResults([slip],{baseball:{rows:packHistoricalRows([source]),lastSuccess:'2026-12-21T00:00:00Z'}});assert.equal(attached[0].summary.status,'won');assert.equal(attached[0].summary.payout,17000);
});

test('slips survive SQLite reopen and retry; the saved quote is immutable',async()=>{
 const {DatabaseSync}=await import('node:sqlite');
 const {mkdtempSync,readFileSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {listSlips}=await import('../src/slips.mjs');
 const directory=mkdtempSync(join(tmpdir(),'odds-lens-slips-')),file=join(directory,'slips.sqlite');let sqlite=new DatabaseSync(file);
 const env=()=>({DB:{prepare(sql){return {bind(...args){return {
  first:async()=>sqlite.prepare(sql).get(...args),
  all:async()=>({results:sqlite.prepare(sql).all(...args)}),
  run:async()=>sqlite.prepare(sql).run(...args)
 };}};}}});
 try{
  sqlite.exec(readFileSync(new URL('../drizzle/0002_dear_ghost_rider.sql',import.meta.url),'utf8'));
  const observed=new Date(),current={fetchedAt:observed.toISOString(),events:[{...event,startsAt:new Date(Date.now()+86400000).toISOString(),markets:[market]}]};
  const first=await saveSlip(env(),input,current);await saveSlip(env(),input,current);
  sqlite.close();sqlite=new DatabaseSync(file);
  const stored=await listSlips(env());assert.equal(stored.slips.length,1);assert.deepEqual(stored.slips[0],JSON.parse(JSON.stringify(first)));
  await assert.rejects(()=>saveSlip(env(),{...input,stake:999},current),/이미 저장/);
  assert.equal((await listSlips(env())).slips[0].stake,10000);
 }finally{sqlite.close();rmSync(directory,{recursive:true});}
});
