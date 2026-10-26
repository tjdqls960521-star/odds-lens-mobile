import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {exactPatternCatalog} from '../public/odds-lens/pattern-board.mjs';
const report={createdAt:new Date().toISOString(),policy:'exact-sequence-1',comparison:'exact complete closing odds, fixed line, same league',note:'Exploratory archive evidence; not an independent prediction validation.',sports:[]};
for(const key of ['baseball','soccer','basketball','volleyball']){
 const manifest=JSON.parse(fs.readFileSync(key==='baseball'?'public/odds-lens/data/manifest.json':`public/odds-lens/data/v2/${key}/manifest.json`));
 const root=`public/odds-lens/${manifest.dataRoot||'data/'+manifest.snapshot}`,hash=createHash('sha256');
 const rows=Object.keys(manifest.years).flatMap(year=>{const bytes=fs.readFileSync(`${root}/${year}.json`);hash.update(bytes);return JSON.parse(bytes).map(r=>Object.fromEntries(manifest.fields.map((f,i)=>[f,r[i]])));}).filter(row=>!(key==='soccer'&&row.league==='NPB')&&!(key==='basketball'&&row.league==='축월드컵'));
 const start=performance.now(),catalog=exactPatternCatalog(rows,{scope:'league',mode:'combo',limit:3});
 report.sports.push({sport:key,sourceRows:rows.length,sourceHash:hash.digest('hex'),sourceRange:manifest.dateRange,patterns:catalog.total,grades:catalog.gradeCounts,catalogMs:Math.round(performance.now()-start),examples:catalog.items.map(p=>({scope:p.scopeLabel,market:p.market,line:p.line,odds:p.odds,sequence:p.prefix,next:p.slot,n:p.n,wins:p.wins,grade:p.grade,test:p.test}))});
}
fs.writeFileSync('reports/exact-sequence-oct4.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report.sports.map(({sport,patterns,grades,catalogMs})=>({sport,patterns,grades,catalogMs}))));
