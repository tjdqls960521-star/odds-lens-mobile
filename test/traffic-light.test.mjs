import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {load} from 'cheerio';
import {analyzeSignal,filterSignals,signalInterpretation,ORIGINAL_LEAGUES} from '../public/odds-lens/traffic-light-core.mjs';
import {signalsView,signalCardView} from '../public/odds-lens/traffic-light-ui.mjs';
import {parseNowgoal,targetDates,sourceUrl,collectSignalDay,getSignals} from '../src/nowgoal-signals.mjs';

function rawRow({id='123',league='1',early=[40,30,30],current=[46,27,27],home='Home',away='Away',short=false}={}){
 const cols=Array(33).fill('');cols[0]=id;cols[2]='2026-10-14 16:00';cols[4]=league;cols[9]=home;cols[10]=away;
 early.forEach((v,i)=>cols[23+i]=v);current.forEach((v,i)=>cols[30+i]=v);
 return (short?cols.slice(0,11):cols).join('^');
}
const raw=(rows=[rawRow()])=>JSON.stringify({ErrCode:0,Data:rows.join('!')+'$1^x^ENG PR#English Premier League!2^x^OTHER#Other League'});
const day='2026-10-14';
const fixture=()=>({...parseNowgoal(raw(),day).events[0],fetchedAt:'2026-10-14T01:00:00Z'});

test('312 synthetic threshold cases match the original Python executable and rounding exactly',()=>{
 const reference=JSON.parse(readFileSync('test/fixtures/colab-traffic-light-parity.json','utf8'));
 assert.equal(reference.cases.length,312);
 for(const row of reference.cases){const actual=analyzeSignal(row.early,row.current);assert.deepEqual(actual.differences,row.differences,JSON.stringify(row));assert.equal(actual.signal,row.signal,JSON.stringify(row));}
});
test('all colors, missing values, neutral and away overwrite retain notebook meaning',()=>{
 assert.equal(analyzeSignal([40,30,30],[46,27,27]).signal,'🟢 홈');
 assert.equal(analyzeSignal([40,30,30],[45,27,28]).signal,'🟡 홈');
 assert.equal(analyzeSignal([40,30,30],[45,28,28]).signal,'🔴 홈');
 const both=analyzeSignal([30,40,30],[35,30,35]);assert.equal(both.signal,'🟡 원정');assert.equal(both.bothMain,true);
 assert.equal(analyzeSignal([40,30,30],[44,28,28]).color,'none');
 for(const missing of [null,undefined,'',NaN,'oops'])assert.equal(analyzeSignal([40,missing,30],[46,27,27]).color,'missing');
 assert.match(signalInterpretation(both),/원정 확률이 5.00%p 증가/);
});
test('official migrated source URL keeps original parameters, 21 leagues, date rollover and positional fields are preserved',()=>{
 assert.equal(ORIGINAL_LEAGUES.length,21);
 assert.deepEqual(targetDates(new Date('2026-12-31T15:00:00Z')),['2027-01-01','2027-01-02']);
 assert.equal(sourceUrl(day),'https://www.nowgoal.world/ajax/soccerajax?type=12&cid=177&date=2026-10-14&timezone=9');
 const result=parseNowgoal(raw([rawRow(),rawRow({id:'missing',short:true}),rawRow({id:'neutral',current:[41,29,30]}),rawRow({league:'2'})]),day);
 assert.equal(result.events.length,3);assert.equal(result.excludedRows,1);
 assert.deepEqual(result.events.map(e=>e.analysis.color),['green','missing','none']);
 assert.equal(result.events[0].displayTime,'2026.10.15 01:00');assert.equal(result.events[0].queryDate,day);
});
test('HTML / bad formats and upstream errors are not misrepresented as zero fixtures',async()=>{
 for(const input of ['<html>blocked</html>','{}','{"ErrCode":1,"Data":""}','{"ErrCode":0,"Data":"changed"}'])assert.throws(()=>parseNowgoal(input,day));
 await assert.rejects(collectSignalDay(day,{fetcher:async()=>new Response('bad',{status:502})}),/HTTP 502/);
 assert.equal(parseNowgoal('{"ErrCode":0,"Data":""}',day).events.length,0);
});
test('source cache retains last successful values per date and marks stale instead of fabricating picks',async()=>{
 const data=new Map(),env={ODDS_STORE:{get:async key=>data.has(key)?{text:async()=>data.get(key)}:null,put:async(key,value)=>data.set(key,value)}};
 const first=await getSignals(env,null,{now:new Date('2032-06-20T00:00:00Z'),fetcher:async()=>new Response(raw())});
 assert.equal(first.events.length,2);assert.ok(first.days.every(d=>!d.error));
 assert.ok([...data.keys()].every(key=>key.startsWith('odds-lens/nowgoal-signals-v2/')));
 const fail=await getSignals(env,null,{force:true,now:new Date('2032-06-20T00:02:00Z'),fetcher:async()=>new Response('bad',{status:403})});
 assert.equal(fail.events.length,2);assert.ok(fail.events.every(e=>e.stale));assert.ok(fail.days.every(d=>/403/.test(d.error)));
 assert.deepEqual(fail.days.map(d=>d.fetchedAt),first.days.map(d=>d.fetchedAt));
});
test('empty first-time failures remain explicit and can retry; one failing date keeps the successful date',async()=>{
 let calls=0;const first=await getSignals({},null,{now:new Date('2033-01-01T00:00:00Z'),fetcher:async()=>{calls++;throw Error('offline');}});
 assert.equal(calls,2);assert.equal(first.events.length,0);assert.ok(first.days.every(d=>d.error==='offline'&&!d.fetchedAt));
 const partial=await getSignals({},null,{force:true,now:new Date('2033-01-01T00:01:01Z'),fetcher:async url=>url.includes('date=2033-01-01')?new Response(raw()):new Response('',{status:502})});
 assert.equal(partial.events.length,1);assert.equal(partial.days.filter(d=>d.error).length,1);
});
test('filters preserve neutral / missing games and use query date instead of display date',()=>{
 const events=parseNowgoal(raw([rawRow(),rawRow({short:true}),rawRow({current:[41,29,30]})]),day).events;
 assert.equal(filterSignals(events).length,3);assert.equal(filterSignals(events,{filter:'missing'}).length,1);
 assert.equal(filterSignals(events,{search:'home',date:day}).length,3);
 assert.equal(filterSignals(events,{date:'2026-10-15'}).length,0);
});
test('mobile cards provide text color labels, both probabilities and precise interpretation; source text is escaped',()=>{
 const event={...fixture(),home:'<img src=x onerror=alert(1)>',stale:true};
 const $=load(signalCardView(event));assert.equal($('img').length,0);
 assert.match($('.tl-badge').text(),/초록 · 홈/);assert.match($('.tl-reading').text(),/6.00%p 증가/);
 assert.equal($('.tl-probability-grid>div').length,3);assert.match($('.tl-probability-grid').text(),/40.00%.*46.00%/s);
 assert.match($('.tl-stale').text(),/이전 수집값/);assert.match($('.tl-checks').text(),/보조 충족/);
});
test('board distinguishes loading, failure, no fixtures and filter exclusions',()=>{
 assert.match(signalsView({loading:true}),/원본 경기표를 읽고 있습니다/);
 assert.match(signalsView({error:'offline'}),/원본 경기표를 아직 받지 못했습니다/);
 const payload={dates:[day],events:[],days:[{date:day,count:0,fetchedAt:'2026-10-14T01:00:00Z'}]};
 assert.match(signalsView({payload}),/원본 리그 목록에 해당하는 경기가 없습니다/);
 payload.events=[fixture()];assert.match(signalsView({payload,filter:'red'}),/선택한 조건의 경기가 없습니다/);
 const $=load(signalsView({payload}));assert.equal($('.tl-card').length,1);assert.equal($('#signal-calculator input').length,6);
 assert.match($.text(),/적중률이나 승리 확률의 등급이 아닙니다/);
});
test('removed picker has no navigation or rendering path and direct signals bypass domestic loading',()=>{
 const app=readFileSync('public/odds-lens/app-v2.js','utf8');
 assert.doesNotMatch(app,/픽 고르기|screenValuePicks|valueEntryView|highProbability\(/);
 assert.match(app,/\['signals','◉','배당 신호등'\]/);
 assert.match(app,/hash==='high-probability'.*#signals/);
 assert.match(app,/state.route==='signals'\)return;\s+await loadStoredFeed/);
});
