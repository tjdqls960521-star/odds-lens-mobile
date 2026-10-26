import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseOfficialResults,preserveOfficialResults,savedOfficialResults,officialResultsForPicks} from '../src/betman-results.mjs';
import {attachSlipResults} from '../src/slips.mjs';
import {normalizePick,resolveOfficialPick,slipSummary} from '../public/odds-lens/slip-core.mjs';
import {slipsView} from '../public/odds-lens/slip-ui.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/betman-results-260117.json',import.meta.url)));
const record=parseOfficialResults(fixture,fixture.capturedAt),row=id=>record.rows.find(r=>r.gameNumber===id);
const pick=(id,key)=>{const r=row(id);return {eventId:r.eventId,marketId:r.marketId,sport:r.sport,league:r.league,home:r.home,away:r.away,startsAt:r.startsAt,market:r.market,line:r.line,year:'2026',round:r.round,gameNumber:id,outcomeKeys:r.outcomeKeys,outcomeKey:key,label:key,odds:1.7};};
const after=Date.parse('2026-10-06T00:00:00Z');
const settle=(id,key)=>resolveOfficialPick(pick(id,key),row(id),record,after);
const bucket=()=>{const stored=new Map();return {stored,env:{ODDS_STORE:{get:async k=>stored.has(k)?{text:async()=>stored.get(k)}:null,put:async(k,v)=>stored.set(k,v)}}};};

test('real official result rows settle saved moneyline and totals without the delayed spreadsheet',()=>{
 assert.equal(settle(6201,'home').status,'won');assert.equal(settle(6201,'away').status,'lost');
 assert.deepEqual(settle(6201,'home').score,[5,3]);
 const total=settle(6204,'under');assert.equal(total.status,'won');assert.deepEqual(total.score,[5,3]);assert.deepEqual(total.marketScore,[8,0]);assert.equal(total.scoreKind,'total');
 const slips=attachSlipResults([{stake:10000,picks:[pick(6201,'home'),pick(6211,'home')]}],{}, {'260117':record},after);
 assert.equal(slips[0].summary.status,'won');assert.equal(slips[0].summary.payout,28900);
});
test('handicap draws only win a draw selection; cancellation refunds at 1.00',()=>{
 assert.equal(settle(5883,'home').status,'lost');assert.equal(settle(5883,'draw').status,'won');assert.equal(settle(5883,'away').status,'lost');
 assert.equal(settle(6029,'home').status,'cancelled');
 const cancelled=resolveOfficialPick({...pick(6029,'home'),line:3.5},row(6029),record,after);assert.equal(cancelled.status,'cancelled');
 const summary=slipSummary({stake:10000,picks:[{...pick(6029,'home'),result:cancelled},{...pick(6201,'home'),result:settle(6201,'home')}]});assert.equal(summary.payout,17000);
});
test('pending, unknown codes, changed line/identity and excluded first-half markets cannot produce false wins',()=>{
 assert.equal(settle(6333,'home').status,'pending');
 const r=row(6204),p=pick(6204,'under');
 for(const changed of [{...r,line:9.5},{...r,eventId:r.eventId+'x'},{...r,period:'first_half'},{...r,marketId:r.marketId+'x'}])assert.equal(resolveOfficialPick(p,changed,record,after).status,'pending');
 const modify=(field,value)=>{const f=structuredClone(fixture),k=f.compSchedules.keys;const a=f.compSchedules.datas.find(a=>a[k.indexOf('matchSeq')]===6204);a[k.indexOf(field)]=value;return parseOfficialResults(f,fixture.capturedAt).rows.find(r=>r.gameNumber===6204);};
 assert.equal(resolveOfficialPick(p,modify('protoStatus','3'),record,after).status,'pending');
 assert.equal(resolveOfficialPick(p,modify('gameResult','02'),record,after).status,'pending');
 assert.equal(modify('betNm','야구 전반 언더오버'),undefined);
});
test('legacy unsaved drafts recover official IDs and show results, total and final score separately',()=>{
 const p=pick(6204,'under');delete p.sport;delete p.year;delete p.round;delete p.gameNumber;delete p.outcomeKeys;
 const restored=normalizePick(p);assert.equal(restored.sport,'baseball');assert.equal(restored.gameNumber,6204);
 const draft=attachSlipResults([{id:'draft',stake:'',picks:[p]}],{}, {'260117':record},after)[0];assert.equal(draft.picks[0].result.status,'won');
 const html=slipsView({draft,slips:[],resultSource:{rounds:[]}});assert.match(html,/최종 5 : 3 · 총점 8/);assert.match(html,/적중/);assert.match(html,/data-remove-pick/);assert.doesNotMatch(html,/최종 8 : 0/);
 const noTeamScore={...draft,picks:[{...draft.picks[0],result:{...draft.picks[0].result,score:null}}]};assert.match(slipsView({draft:noTeamScore}),/총점 8/);assert.doesNotMatch(slipsView({draft:noTeamScore}),/최종/);
});
test('completed prior-day rounds are queried by saved round, singleflight cached, and errors keep original observation time',async()=>{
 const {stored,env}=bucket(),picks=[pick(6201,'home'),pick(6204,'under')];let calls=0;
 const fetcher=async(url,opts)=>{assert.match(String(url),/gameInfoInq/);assert.equal(JSON.parse(opts.body).gmTs,260117);calls++;return Response.json(fixture);};
 const [a,b]=await Promise.all([officialResultsForPicks(env,picks,{force:true,fetcher}),officialResultsForPicks(env,picks,{force:true,fetcher})]);
 assert.equal(calls,1);assert.ok(a['260117'].rows.length);assert.equal(a['260117'].lastSuccess,b['260117'].lastSuccess);
 assert.ok([...stored.keys()].some(k=>k.includes('/raw/260117/')));
 const prior=await savedOfficialResults(env,'260117');prior.lastAttempt=Date.now()-60000;stored.set('odds-lens/results-v1/260117.json',JSON.stringify(prior));
 const failed=await officialResultsForPicks(env,picks,{force:true,fetcher:async()=>new Response('unavailable',{status:503})});
 assert.match(failed['260117'].error,/503/);assert.equal(failed['260117'].lastSuccess,prior.lastSuccess);assert.deepEqual(failed['260117'].rows,prior.rows);
 assert.equal(attachSlipResults([{stake:10000,picks}],{},failed,after)[0].summary.status,'won');
});
test('official corrections/retractions are read on the next request, with old snapshots preserved',async()=>{
 const {stored,env}=bucket(),picks=[pick(6201,'home')];await preserveOfficialResults(env,fixture,fixture.capturedAt);
 const updated=structuredClone(fixture),k=updated.compSchedules.keys;updated.compSchedules.datas.find(a=>a[k.indexOf('matchSeq')]===6201)[k.indexOf('gameResult')]='2';
 await preserveOfficialResults(env,updated,'2026-10-05T00:00:00Z');let current=await savedOfficialResults(env,'260117');
 assert.equal(attachSlipResults([{picks}],{}, {'260117':current},after)[0].picks[0].result.status,'lost');
 updated.compSchedules.datas.find(a=>a[k.indexOf('matchSeq')]===6201)[k.indexOf('protoStatus')]='3';
 await preserveOfficialResults(env,updated,'2026-10-05T00:01:00Z');current=await savedOfficialResults(env,'260117');
 assert.equal(attachSlipResults([{picks}],{}, {'260117':current},after)[0].picks[0].result.status,'pending');
 assert.equal([...stored.keys()].filter(k=>k.includes('/raw/260117/')).length,3);
 // Older concurrent completions must not overwrite a newer correction.
 await preserveOfficialResults(env,fixture,fixture.capturedAt);assert.equal((await savedOfficialResults(env,'260117')).lastSuccess,current.lastSuccess);
});

test('Worker refresh returns official saved results and supports legacy draft lookup without saving a slip',async()=>{
 const {build}=await import('esbuild');const {mkdtemp}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {pathToFileURL}=await import('node:url');
 const dir=await mkdtemp(tmpdir()+'/odds-slip-result-worker-');await build({entryPoints:['src/worker.mjs'],outfile:dir+'/worker.mjs',bundle:true,format:'esm',platform:'browser',external:['cloudflare:sockets']});
 const {default:worker}=await import(pathToFileURL(dir+'/worker.mjs'));
 const {env}=bucket();const savedSlip={id:'qa-official-results',createdAt:'2026-10-03T18:00:00Z',stake:10000,picks:[pick(6201,'home'),pick(6211,'home')]};
 let writes=0;env.DB={prepare:sql=>({bind:()=>({all:async()=>{assert.match(sql,/SELECT data FROM pick_slips/);return {results:[{data:JSON.stringify(savedSlip)}]};},run:async()=>writes++})})};
 const original=globalThis.fetch;globalThis.fetch=async url=>String(url).endsWith('/')?new Response('public session'):Response.json(fixture);
 try{
  const response=await worker.fetch(new Request('https://example.com/odds-lens/api/slips/refresh',{method:'POST'}),env);
  assert.equal(response.status,200);const payload=await response.json();assert.equal(payload.slips[0].summary.status,'won');assert.equal(payload.slips[0].summary.payout,28900);assert.equal(payload.resultSource.rounds.length,1);
  const draft=pick(6204,'under');delete draft.sport;delete draft.round;delete draft.year;delete draft.gameNumber;delete draft.outcomeKeys;
  const result=await worker.fetch(new Request('https://example.com/odds-lens/api/slips/results',{method:'POST',body:JSON.stringify({picks:[draft]})}),env);
  assert.equal(result.status,200);assert.equal((await result.json()).picks[0].result.status,'won');assert.equal(writes,0);
  const blocked=await worker.fetch(new Request('https://example.com/odds-lens/api/slips/refresh',{method:'POST',headers:{Origin:'https://unrelated.invalid'}}),env);assert.equal(blocked.status,403);
 }finally{globalThis.fetch=original;}
});
