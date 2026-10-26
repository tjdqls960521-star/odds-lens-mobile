import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {readFileSync} from 'node:fs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/betman-public.json',import.meta.url)));
test('source outage never falls back to an unverified Scorebase seed or cache',async()=>{
 const dir=await mkdtemp(tmpdir()+'/odds-worker-');
 await build({entryPoints:['src/worker.mjs'],outfile:dir+'/worker.mjs',external:['cloudflare:sockets'],bundle:true,format:'esm',platform:'browser'});
 const {default:worker}=await import(pathToFileURL(dir+'/worker.mjs'));
 const previous=globalThis.fetch;
 globalThis.caches={get default(){throw Error('This Worker is not permitted to access the default cache.');}};
 globalThis.fetch=async()=>new Response('upstream temporarily down',{status:503});
 try{
  const r=await worker.fetch(new Request('https://example.com/odds-lens/data/live/current.json'),{});
  assert.equal(r.status,200);
  const f=await r.json();assert.equal(f.events.length,0);assert.equal(f.fetchedAt,null);assert.ok(f.refreshState.error.includes('503'));
  const status=await worker.fetch(new Request('https://example.com/odds-lens/api/refresh-status'),{});
  assert.equal(status.status,200);
 }finally{globalThis.fetch=previous;delete globalThis.caches;}
});
test('successful collection is retained in the durable feed store',async()=>{
 const dir=await mkdtemp(tmpdir()+'/odds-worker-r2-');
 await build({entryPoints:['src/worker.mjs'],outfile:dir+'/worker.mjs',external:['cloudflare:sockets'],bundle:true,format:'esm',platform:'browser'});
 const {default:worker}=await import(pathToFileURL(dir+'/worker.mjs').href+'?durable-feed');
 const stored=new Map();
 const bucket={get:async key=>stored.has(key)?{text:async()=>stored.get(key)}:null,put:async(key,value)=>stored.set(key,value)};
 const source=structuredClone(fixture);
 const index=source.compSchedules.keys.indexOf('gameDate');
 for(const row of source.compSchedules.datas)row[index]=Date.now()+86400000;
 const previous=globalThis.fetch;
 globalThis.fetch=async url=>String(url).includes('inqCacheBuyAble')?Response.json({rsMsg:{statusCode:'S'},protoGames:[{gmId:'G101',gmTs:260111}]}):Response.json(source);
 try{
  const response=await worker.fetch(new Request('https://example.com/odds-lens/data/live/current.json'),{ODDS_STORE:bucket});
  assert.equal(response.status,200);
  assert.ok((await response.json()).events.length>0);
  const saved=JSON.parse(stored.get('odds-lens/betman-official-feed-v2.json'));
  assert.equal(saved.feed.round,'260111');
  assert.equal(saved.feed.sourceId,'betman-official-v1');
  // Simulate a cold isolate after an upstream outage: retain the exact old
  // official timestamp, not a newly stamped or alternate-provider quote.
  saved.lastAttempt=Date.now()-60000;saved.feed.fetchedAt=new Date(Date.now()-60000).toISOString();
  stored.set('odds-lens/betman-official-feed-v2.json',JSON.stringify(saved));
  const {default:cold}=await import(pathToFileURL(dir+'/worker.mjs').href+'?outage');
  globalThis.fetch=async()=>new Response('outage',{status:503});
  const outage=await (await cold.fetch(new Request('https://example.com/odds-lens/data/live/current.json'),{ODDS_STORE:bucket})).json();
  assert.equal(outage.fetchedAt,saved.feed.fetchedAt);
  assert.deepEqual(outage.events,saved.feed.events);
  assert.ok(outage.refreshState.error.includes('503'));
 }finally{globalThis.fetch=previous;}
});

test('an empty official product response cannot overwrite the last verified fixture board',async()=>{
 const dir=await mkdtemp(tmpdir()+'/odds-worker-empty-feed-');
 await build({entryPoints:['src/worker.mjs'],outfile:dir+'/worker.mjs',external:['cloudflare:sockets'],bundle:true,format:'esm',platform:'browser'});
 const {default:worker}=await import(pathToFileURL(dir+'/worker.mjs').href+'?first-live-board');
 const stored=new Map();
 const bucket={get:async key=>stored.has(key)?{text:async()=>stored.get(key)}:null,put:async(key,value)=>stored.set(key,value)};
 const source=structuredClone(fixture);
 const index=source.compSchedules.keys.indexOf('gameDate');
 for(const row of source.compSchedules.datas)row[index]=Date.now()+86400000;
 const previous=globalThis.fetch;
 try{
  globalThis.fetch=async url=>String(url).includes('inqCacheBuyAble')
   ?Response.json({rsMsg:{statusCode:'S'},protoGames:[{gmId:'G101',gmTs:260111}]})
   :Response.json(source);
  const first=await (await worker.fetch(new Request('https://example.com/odds-lens/data/live/current.json'),{ODDS_STORE:bucket})).json();
  assert.ok(first.events.length>0);
  const saved=JSON.parse(stored.get('odds-lens/betman-official-feed-v2.json'));
  saved.lastAttempt=Date.now()-60000;
  saved.feed.fetchedAt=new Date(Date.now()-60000).toISOString();
  stored.set('odds-lens/betman-official-feed-v2.json',JSON.stringify(saved));
  const {default:cold}=await import(pathToFileURL(dir+'/worker.mjs').href+'?empty-product-list');
  globalThis.fetch=async url=>String(url).includes('inqCacheBuyAble')
   ?Response.json({rsMsg:{statusCode:'S'},protoGames:[{gmId:'G102',gmTs:260094}]})
   :String(url).includes('/schedule.do')
    ?Response.json({rsMsg:{statusCode:'S'},schedules:{data:[]}})
    :new Response('unexpected game lookup',{status:500});
  const retained=await (await cold.fetch(new Request('https://example.com/odds-lens/data/live/current.json'),{ODDS_STORE:bucket})).json();
  assert.deepEqual(retained.events,saved.feed.events);
  assert.equal(retained.fetchedAt,saved.feed.fetchedAt);
  assert.match(retained.refreshState.error,/기존 공식 배당을 유지|승부식/);
 }finally{globalThis.fetch=previous;}
});

test('an open page receives its saved official board while a slow refresh runs in the background',async()=>{
 const dir=await mkdtemp(tmpdir()+'/odds-worker-background-');
 await build({entryPoints:['src/worker.mjs'],outfile:dir+'/worker.mjs',external:['cloudflare:sockets'],bundle:true,format:'esm',platform:'browser'});
 const {default:worker}=await import(pathToFileURL(dir+'/worker.mjs').href+'?background');
 const oldTime=new Date(Date.now()-60000).toISOString();
 const stored=new Map([['odds-lens/betman-official-feed-v2.json',JSON.stringify({feed:{sourceId:'betman-official-v1',fetchedAt:oldTime,round:'260111',events:[{id:'saved-official-game',markets:[]}]},lastAttempt:Date.now()-60000,error:null})]]);
 const bucket={get:async key=>stored.has(key)?{text:async()=>stored.get(key)}:null,put:async(key,value)=>stored.set(key,value)};
 const background=[];
 let unblock;
 let released=false;
 const previous=globalThis.fetch;
 globalThis.fetch=async url=>String(url)==='https://www.betman.co.kr/'
  ?new Response('',{status:200})
  :released?new Response('temporarily down',{status:503})
  :new Promise(resolve=>{unblock=()=>{released=true;resolve(new Response('temporarily down',{status:503}));};});
 try{
  const response=await worker.fetch(new Request('https://example.com/odds-lens/data/live/current.json'),{ODDS_STORE:bucket},{waitUntil:promise=>background.push(promise)});
  const body=await response.json();
  assert.equal(response.status,200);
  assert.equal(body.fetchedAt,oldTime);
  assert.equal(body.events[0].id,'saved-official-game');
  assert.equal(background.length,1);
  // The upstream request is still unresolved, yet the page has its quote.
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(typeof unblock,'function');
  unblock();
  await Promise.all(background);
  const saved=JSON.parse(stored.get('odds-lens/betman-official-feed-v2.json'));
  assert.equal(saved.feed.fetchedAt,oldTime);
  assert.match(saved.error,/원본 재수집 실패/);
 }finally{globalThis.fetch=previous;}
});

test('page reads see a newer official snapshot written by another Worker isolate',async()=>{
 const dir=await mkdtemp(tmpdir()+'/odds-worker-shared-store-');
 await build({entryPoints:['src/worker.mjs'],outfile:dir+'/worker.mjs',external:['cloudflare:sockets'],bundle:true,format:'esm',platform:'browser'});
 const {default:worker}=await import(pathToFileURL(dir+'/worker.mjs').href+'?shared-store');
 const stored=new Map();
 const bucket={get:async key=>stored.has(key)?{text:async()=>stored.get(key)}:null,put:async(key,value)=>stored.set(key,value)};
 const makeState=(round,secondsAgo)=>({feed:{sourceId:'betman-official-v1',fetchedAt:new Date(Date.now()-secondsAgo*1000).toISOString(),round,events:[{id:`official-${round}`,markets:[]}]},lastAttempt:Date.now()-secondsAgo*1000,error:null});
 const key='odds-lens/betman-official-feed-v2.json';
 stored.set(key,JSON.stringify(makeState('260111',2)));
 const context={waitUntil:()=>assert.fail('a fresh quote must not trigger another collection')};
 const first=await (await worker.fetch(new Request('https://example.com/odds-lens/data/live/current.json'),{ODDS_STORE:bucket},context)).json();
 assert.equal(first.round,'260111');
 stored.set(key,JSON.stringify(makeState('260112',1)));
 const second=await (await worker.fetch(new Request('https://example.com/odds-lens/data/live/current.json'),{ODDS_STORE:bucket},context)).json();
 assert.equal(second.round,'260112');
 assert.equal(second.events[0].id,'official-260112');
});
