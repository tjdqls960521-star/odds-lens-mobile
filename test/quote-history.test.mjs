import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {preserveCollection} from '../src/ledger.mjs';
import {attachQuoteSummaries,readQuoteHistory} from '../src/quote-history.mjs';
import {canonicalEventId,marketIdentity} from '../public/odds-lens/prediction-core.mjs';
import {priceDelta,quoteComparable} from '../public/odds-lens/quote-history-core.mjs';
import {quoteMovementView,quoteHistoryDrawerView,fixtureToolsView} from '../public/odds-lens/odds-history-ui.mjs';

function storage(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync('drizzle/'+file,'utf8'));
 const prepare=(sql,args=[])=>({bind:(...values)=>prepare(sql,values),all:async()=>({results:sqlite.prepare(sql).all(...args)}),first:async()=>sqlite.prepare(sql).get(...args)||null,run:async()=>({meta:sqlite.prepare(sql).run(...args)})});
 const objects=new Map(),env={DB:{prepare,batch:async statements=>Promise.all(statements.map(s=>s.run()))},ODDS_STORE:{put:async(k,v)=>objects.set(k,v),get:async k=>objects.has(k)?{text:async()=>objects.get(k)}:null}};
 return {sqlite,env,objects};
}
function feed(minute,{odds=[1.8,2.1],line=null,pending=false,saleStatus='selling',eventPatch={},marketPatch={}}={}){
 const at=new Date(Date.UTC(2026,9,13,0,minute)).toISOString();
 const event={sport:'soccer',league:'TEST',leagueCode:'TEST',homeId:'H',awayId:'A',home:'테스트 홈',away:'테스트 원정',startsAt:'2026-10-14T01:00:00.000Z',...eventPatch};
 event.id=event.canonicalEventId=canonicalEventId(event);
 const market={id:'betman-260120-1',market:line===null?'일반':'핸디캡',marketLabel:line===null?'일반':'핸디캡',round:'260120',year:'2026',gameNumber:1,period:'full',line,saleStatus,pending,observedAt:at,outcomeKeys:['home','away'],outcomes:pending?[]:odds.map((n,i)=>({key:i?'away':'home',label:i?'원정 승':'홈 승',odds:n})),...marketPatch};
 market.canonicalMarketId=marketIdentity(event.id,market);event.markets=[market];
 return {sourceId:'betman-official-v1',rounds:['260120'],round:'260120',fetchedAt:at,events:[event]};
}
async function record(env,current,previous=null){await preserveCollection(env,current,{testOnly:true,at:current.fetchedAt},previous);return current;}

test('pending prices, heartbeat snapshots and sale-status changes do not replace or inflate the first recorded quote',async()=>{
 const {env,sqlite}=storage();
 let previous=await record(env,feed(0,{pending:true}));
 previous=await record(env,feed(1),previous);
 previous=await record(env,feed(20),previous); // a stored 15-minute heartbeat
 previous=await record(env,feed(21,{saleStatus:'closed'}),previous);
 await attachQuoteSummaries(env,previous);
 const h=previous.events[0].markets[0].oddsHistory;
 assert.equal(h.changeCount,0);assert.equal(h.first.observedAt,'2026-10-13T00:01:00.000Z');assert.equal(h.first.outcomes[0].odds,1.8);
 assert.equal(h.officialOpeningKnown,false);assert.equal(h.basis,'first-observed');
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM quote_snapshots').get().n,4);
 const detail=await readQuoteHistory(env,'betman-260120-1',previous.events[0].id);
 assert.equal(detail.points.length,1);assert.equal(detail.points[0].kind,'first');
 sqlite.close();
});
test('a price returning to its opening value preserves every intermediate change, including across a cold isolate',async()=>{
 const {env,sqlite}=storage();
 const a=await record(env,feed(0)),b=await record(env,feed(1,{odds:[1.7,2.2]}),a),c=await record(env,feed(2),b);
 await attachQuoteSummaries(env,c);const h=c.events[0].markets[0].oddsHistory;
 assert.equal(h.changeCount,2);assert.equal(priceDelta(h.first,h.latest,'home'),0);
 const detail=await readQuoteHistory(env,'betman-260120-1',c.events[0].id);
 assert.deepEqual(detail.points.map(p=>p.outcomes[0].odds),[1.8,1.7,1.8]);
 assert.deepEqual(detail.points.map(p=>p.deltas.home),[.1,-.1,null]);
 const cold=structuredClone(c);delete cold.oddsHistoryVersion;delete cold.events[0].markets[0].oddsHistory;
 await attachQuoteSummaries({DB:env.DB},cold);assert.deepEqual(cold.events[0].markets[0].oddsHistory,h);
 sqlite.close();
});
test('changed handicap/total conditions remain in one offer timeline but never become misleading price arrows',async()=>{
 const {env,sqlite}=storage();
 const a=await record(env,feed(0,{line:-1.5})),b=await record(env,feed(1,{line:-2.5,odds:[1.6,2.4]}),a);
 await attachQuoteSummaries(env,b);const market=b.events[0].markets[0],h=market.oddsHistory;
 assert.equal(h.changeCount,1);assert.equal(h.first.line,-1.5);assert.equal(h.latest.line,-2.5);assert.equal(h.comparable,false);
 assert.equal(quoteComparable(h.first,h.latest),false);assert.equal(priceDelta(h.first,h.latest,'home'),null);
 const detail=await readQuoteHistory(env,market.id,b.events[0].id);assert.equal(detail.points[0].kind,'conditions');assert.equal(detail.points[0].deltas.home,null);
 const html=quoteMovementView(market,market.outcomes[0]);assert.match(html,/기준·조건 변경/);assert.doesNotMatch(html,/↓|↑/);
 sqlite.close();
});
test('a reused sale item with a different event identity starts a separate baseline, and different rounds never merge',async()=>{
 const {env,sqlite}=storage();
 const a=await record(env,feed(0)),b=await record(env,feed(1,{eventPatch:{startsAt:'2026-10-14T02:00:00.000Z'},odds:[1.6,2.4]}),a);
 const c=await record(env,feed(2,{marketPatch:{id:'betman-260121-1',round:'260121'},odds:[1.5,2.5]}),b);
 await attachQuoteSummaries(env,b);await attachQuoteSummaries(env,c);
 assert.equal(b.events[0].markets[0].oddsHistory.changeCount,0);assert.equal(c.events[0].markets[0].oddsHistory.changeCount,0);
 assert.equal((await readQuoteHistory(env,'betman-260120-1',a.events[0].id)).points[0].outcomes[0].odds,1.8);
 sqlite.close();
});
test('timeline pagination keeps the true initial quote, totals and every older price without duplicates',async()=>{
 const {env,sqlite}=storage();let previous=null;
 for(let i=0;i<7;i++)previous=await record(env,feed(i,{odds:[1.8+i*.01,2.1-i*.01]}),previous);
 const id=previous.events[0].id;let cursor='',points=[],pages=0;
 do{const page=await readQuoteHistory(env,'betman-260120-1',id,{cursor,limit:2});assert.equal(page.summary.changeCount,6);assert.equal(page.summary.first.outcomes[0].odds,1.8);points.push(...page.points);cursor=page.nextCursor;pages++;}while(cursor);
 assert.equal(pages,4);assert.equal(new Set(points.map(p=>p.id)).size,7);assert.equal(points.at(-1).kind,'first');
 await assert.rejects(readQuoteHistory(env,'bad',id),/INVALID_HISTORY_REQUEST/);
 await assert.rejects(readQuoteHistory(env,'betman-260120-1',id,{cursor:'broken'}),/INVALID_HISTORY_CURSOR/);
 sqlite.close();
});
test('history API serves saved evidence without contacting the price provider and validates pagination input',async()=>{
 const {env,sqlite}=storage(),f=await record(env,feed(0));
 const dir=mkdtempSync(tmpdir()+'/odds-history-worker-');await build({entryPoints:['src/worker.mjs'],outfile:dir+'/worker.mjs',external:['cloudflare:sockets'],bundle:true,format:'esm',platform:'browser'});
 const {default:worker}=await import(pathToFileURL(dir+'/worker.mjs'));
 const url='https://example.com/odds-lens/api/odds-history/betman-260120-1?event_id='+encodeURIComponent(f.events[0].id),previousFetch=globalThis.fetch;
 globalThis.fetch=async()=>assert.fail('history reads must use only durable evidence');
 try{
  const r=await worker.fetch(new Request(url),env);assert.equal(r.status,200);assert.equal((await r.json()).summary.first.outcomes[0].odds,1.8);
  const cached=structuredClone(f);cached.fetchedAt=new Date().toISOString();await env.ODDS_STORE.put('odds-lens/betman-official-feed-v2.json',JSON.stringify({feed:cached,lastAttempt:Date.now(),error:null}));
  const current=await (await worker.fetch(new Request('https://example.com/odds-lens/data/live/current.json'),env)).json();assert.equal(current.oddsHistoryVersion,1);assert.equal(current.events[0].markets[0].oddsHistory.first.observedAt,f.fetchedAt);
  assert.equal((await worker.fetch(new Request(url+'&cursor=bad'),env)).status,400);
  assert.equal((await worker.fetch(new Request(url,{method:'POST'}),env)).status,405);
  assert.equal((await worker.fetch(new Request(url.replace('260120','260122')),env)).status,404);
 }finally{globalThis.fetch=previousFetch;sqlite.close();}
});
test('mobile history text distinguishes first observed prices and escapes team names in the rendered controls',()=>{
 const event={id:'event:test',home:'<img src=x onerror=alert(1)>',away:'원정',league:'TEST',markets:[]},market=feed(0).events[0].markets[0];
 const html=quoteHistoryDrawerView({event,market,loading:true});assert.match(html,/실제 발매 최초 배당과 다를/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);
 const tools=fixtureToolsView([event],{search:'" onclick="bad',filter:'favorites',favorites:new Set([event.id])});assert.match(tools,/aria-pressed="true"/);assert.doesNotMatch(tools,/value="" onclick=/);
});
