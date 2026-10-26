// Fixed-policy, frozen-history retrospective replay. Not a live-odds backtest.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {analyzePatternEvent} from '../public/odds-lens/pattern-board.mjs';
import {assessPick,comparePicks,PICK_POLICY} from '../public/odds-lens/pick-policy.mjs';
import {canonicalMarket,canonicalTeam,priceCents,resultIndex,outcomeLabels,wilson95} from '../public/odds-lens/live-core.mjs';
const ROOT=resolve(import.meta.dirname,'..'),read=p=>JSON.parse(readFileSync(resolve(ROOT,p),'utf8'));
const excluded=new Set(['SUM','승5패','전반','전반_핸디캡','전반_언오버']);
const trainingEnd='2024-12-31',evaluationStart='2025-01-03',maxFixtures=1200;
const startsAt=date=>new Date(String(date).replace(' ','T')+(String(date).length===16?':00':'')+'+09:00').toISOString();
const tally=rows=>{const n=rows.length,wins=rows.filter(r=>r.won).length;return {n,wins,rate:n?wins/n:null,interval:n?wilson95(wins,n):null,averageOdds:n?rows.reduce((a,r)=>a+r.odds,0)/n:null};};
const report={policyVersion:PICK_POLICY.version,createdAt:new Date().toISOString(),kind:'frozen-history-retrospective-replay',trainingEnd,evaluationStart,maxFixturesPerSport:maxFixtures,sampling:'Evenly spaced chronological fixtures, selected without using results',limitations:['Final closing prices have no observation timestamps','Result-known timestamps are absent; calendar gap only approximates availability','Archive timezone is assumed KST','Rules fixed before this replay; not prospectively registered','Selection coverage and odds mix differ from the unfiltered baseline','No live accuracy or profitability claim'],sports:{}};
for(const sport of ['baseball','soccer','basketball','volleyball']){
 const manifest=read(sport==='baseball'?'public/odds-lens/data/manifest.json':`public/odds-lens/data/v2/${sport}/manifest.json`),root=sport==='baseball'?`public/odds-lens/data/${manifest.snapshot}`:`public/odds-lens/data/v2/${sport}`;
 const rows=Object.keys(manifest.years).sort().flatMap(year=>read(`${root}/${year}.json`).map(values=>Object.fromEntries(manifest.fields.map((field,i)=>[field,values[i]]))));
 const valid=rows.filter(r=>!excluded.has(canonicalMarket(r.market))&&resultIndex(r)!==null&&Array.isArray(r.closing));
 const training=valid.filter(r=>String(r.date).slice(0,10)<=trainingEnd),fixtures=new Map();
 for(const row of valid){
  if(String(row.date).slice(0,10)<evaluationStart)continue;
  const key=JSON.stringify([row.date,row.league,canonicalTeam(row.home),canonicalTeam(row.away)]),market=canonicalMarket(row.market);
  const slots=priceCents(row.closing[1])===null?[0,2]:[0,1,2];
  if(!slots.every(slot=>priceCents(row.closing[slot])!==null)||!slots.includes(resultIndex(row)))continue;
  if(['핸디캡','언오버'].includes(market)&&(row.line===null||row.line===undefined||!Number.isFinite(Number(row.line))))continue;
  if(!fixtures.has(key))fixtures.set(key,{key,date:row.date,rows:new Map()});
  fixtures.get(key).rows.set(JSON.stringify([market,row.line]),{...row,market,slots});
 }
 const ordered=[...fixtures.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.key.localeCompare(b.key));
 const sampled=ordered.length<=maxFixtures?ordered:Array.from({length:maxFixtures},(_,i)=>ordered[Math.floor(i*(ordered.length-1)/(maxFixtures-1))]);
 const selected=[],baseline=[],reasonCounts={};let processed=0;
 for(const group of sampled){
  const source=[...group.rows.values()][0],event={id:group.key,startsAt:startsAt(source.date),sport,league:source.league,home:source.home,away:source.away,teamNamesVerified:true},now=Date.parse(event.startsAt)-60000,candidates=[],references=[];
  for(const row of group.rows.values()){
   const labels=outcomeLabels(row.market),market={id:String(row.id),market:row.market,line:row.market==='일반'?null:row.line,period:'full',available:true,saleStatus:'selling',observedAt:new Date(now).toISOString(),outcomes:row.slots.map(slot=>({key:['home','draw','away'][slot],label:labels[slot],odds:Number(row.closing[slot])}))};
   const min=Math.min(...market.outcomes.map(o=>o.odds)),pattern=analyzePatternEvent(event,market,training,{includeSequences:false});
   for(const slot of row.slots.filter(slot=>Number(row.closing[slot])===min)){
    const pick=assessPick(event,market,pattern,slot,{now,sourceCurrent:true});pick.won=resultIndex(row)===slot;
    candidates.push(pick);references.push({id:pick.id,odds:min,won:pick.won});
   }
  }
  candidates.sort(comparePicks);references.sort((a,b)=>a.odds-b.odds||a.id.localeCompare(b.id));
  if(references.length)baseline.push(references[0]);
  const pick=candidates[0];if(pick?.status==='candidate')selected.push({odds:pick.selection.odds,won:pick.won});
  else for(const code of pick?.reasons||[])reasonCounts[code]=(reasonCounts[code]||0)+1;
  if(++processed%300===0)process.stderr.write(`${sport}: ${processed}/${sampled.length}\n`);
 }
 report.sports[sport]={availableEvaluationFixtures:ordered.length,evaluatedFixtures:sampled.length,trainingRows:training.length,evaluationStart:String(sampled[0]?.date||evaluationStart).slice(0,10),evaluationEnd:String(sampled.at(-1)?.date||'').slice(0,10),selected:tally(selected),baseline:tally(baseline),coverage:baseline.length?selected.length/baseline.length:0,reasonCounts};
 process.stderr.write(`${sport}: completed, ${selected.length} candidates\n`);
}
writeFileSync(resolve(ROOT,'public/odds-lens/data/pick-policy-replay.json'),JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify(report.sports,null,2)+'\n');
