// Inspect a captured official feed through the same archive and value modules
// used by the app. This checks current display coverage, not historical returns.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {groupFeedEvents} from '../public/odds-lens/prediction-core.mjs';
import {canonicalMarket} from '../public/odds-lens/live-core.mjs';
import {analyzePatternEvent,exactEvidenceCases} from '../public/odds-lens/pattern-board.mjs';
import {screenValuePicks} from '../public/odds-lens/value-picks.mjs';
import {valueBoardView} from '../public/odds-lens/value-picks-ui.mjs';
import {load} from 'cheerio';
const [snapshot,patchDirectory]=process.argv.slice(2);
if(!snapshot)throw Error('Pass an official feed snapshot path.');
const read=p=>JSON.parse(readFileSync(p,'utf8')),feed=read(snapshot),now=Date.parse(feed.fetchedAt),events=groupFeedEvents(feed.events),excluded=new Set(['SUM','승5패','전반','전반_핸디캡','전반_언오버']);
const report={capturedAt:feed.fetchedAt,kind:'current-feed-coverage-check',sports:{}};
for(const sport of ['baseball','soccer','basketball','volleyball']){
 const manifest=read(sport==='baseball'?'public/odds-lens/data/manifest.json':`public/odds-lens/data/v2/${sport}/manifest.json`),root=resolve('public/odds-lens',manifest.dataRoot||`data/${manifest.snapshot}`);
 const unpack=(rows,fields)=>rows.map(values=>Object.fromEntries(fields.map((field,i)=>[field,values[i]])));
 const rows=new Map(Object.keys(manifest.years).sort().flatMap(year=>unpack(read(`${root}/${year}.json`),manifest.fields)).map(row=>[row.id,row]));
 if(patchDirectory){const patch=read(resolve(patchDirectory,`value-history-${sport}.json`));for(const row of unpack(patch.rows,patch.fields||manifest.fields))rows.set(row.id,row);}
 const history=[...rows.values()].filter(r=>!excluded.has(canonicalMarket(r.market))&&!(sport==='soccer'&&r.league==='NPB')&&!(sport==='basketball'&&r.league==='축월드컵'));
 const groups=events.filter(e=>e.sport===sport).map(event=>({event,markets:event.markets.filter(m=>m.period!=='first_half'&&!excluded.has(m.market)).map(market=>({market,pattern:[2,3].includes(market.outcomes?.length)&&!market.pending&&market.saleStatus!=='suspended'?analyzePatternEvent(event,market,history,{includeSequences:false}):null}))}));
 const value=screenValuePicks(groups,{now,sourceCurrent:!feed.refreshState?.error&&!feed.partial}),$=load(valueBoardView(value,{tab:'all'}));
 if($('.value-card').length!==Math.min(12,value.priced)||$('.value-waiting').length!==Math.min(12,value.waiting.length))throw Error('Display coverage mismatch: '+sport);
 for(const pick of value.ranked){
  if(pick.evidence.n){const cases=exactEvidenceCases(pick.event,pick.market,history,{scope:pick.evidence.scope,basis:pick.evidence.basis,slot:pick.evidence.basis==='single'?pick.evidence.anchorSlot:pick.slot});if(cases.n!==pick.evidence.n)throw Error('Evidence drawer sample mismatch: '+pick.id);}
 }
 report.sports[sport]={historyRows:history.length,fixtures:value.totalFixtures,priced:value.priced,estimated:value.estimated,valueCandidates:value.candidates.length,pending:value.waiting.length,selling:value.selling,closed:value.closed,examples:value.ranked.slice(0,2).map(p=>({fixture:`${p.event.home} vs ${p.event.away}`,market:p.market.market,line:p.market.line,selection:p.selection.label,odds:p.selection.odds,probability:p.probability,breakEven:p.breakEven,edge:p.edge,n:p.evidence.n,cohort:`${p.evidence.scope}/${p.evidence.basis}`,sale:p.availability.code}))};
}
writeFileSync('reports/value-feed-check-20261014.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
