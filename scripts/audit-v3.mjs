import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resultIndex} from '../public/odds-lens/live-core.mjs';
const root=new URL('../public/odds-lens/',import.meta.url),excluded=new Set(['SUM','승1패','승5패','전반','전반_언오버']);
const sports={baseball:'data/manifest.json',soccer:'data/v2/soccer/manifest.json',basketball:'data/v2/basketball/manifest.json',volleyball:'data/v2/volleyball/manifest.json'};
const report={auditVersion:3,scope:'local baseline only; cloud deltas excluded',sources:{},trainingEligibility:{eligible:false,reasons:['MISSING_HISTORY_TIMESTAMP','MISSING_RESULT_KNOWN_AT','UNVERIFIED_RULESET','UNVERIFIED_SOURCE_TIMEZONE']}};
for(const [sport,path] of Object.entries(sports)){
 const manifest=JSON.parse(await readFile(new URL(path,root))),dataRoot=manifest.dataRoot||`data/${manifest.snapshot}`;
 const rows=(await Promise.all(Object.keys(manifest.years).map(async y=>JSON.parse(await readFile(new URL(`${dataRoot}/${y}.json`,root))).map(v=>Object.fromEntries(manifest.fields.map((k,i)=>[k,v[i]])))))).flat();
 const visible=rows.filter(r=>!excluded.has(r.market));
 const quarantine=visible.filter(r=>sport==='soccer'&&r.league==='NPB'||sport==='basketball'&&r.league==='축월드컵');
 const quarantinedIds=new Set(quarantine.map(r=>r.id)),analysis=visible.filter(r=>!quarantinedIds.has(r.id)),known=analysis.filter(r=>resultIndex(r)!==null);
 const events=new Set(analysis.filter(r=>!/미정|승자|패자/.test(r.home+' '+r.away)).map(r=>[r.date,r.league,r.home,r.away].join('|')));
 report.sources[sport]={source:manifest.sourceUrl,sourceFileCollectedAt:manifest.fetchedAt,rows:rows.length,retainedMarketRows:visible.length,analysisMarketRows:analysis.length,known:known.length,unresolved:analysis.length-known.length,approximateEventIdentityGroups:events.size,eventIdentityVerified:false,period:manifest.dateRange,duplicateRowIds:rows.length-new Set(rows.map(r=>r.id)).size,quarantineCount:quarantine.length,quarantineSample:quarantine.slice(0,20).map(r=>({id:r.id,reason:'SPORT_LEAGUE_MISMATCH',league:r.league})),quoteTimestampsAvailable:manifest.quoteTimestampsAvailable===true,sourceTimezone:manifest.timezone,scoreZeroCount:analysis.filter(r=>r.score?.includes(0)).length};
}
await mkdir(new URL('../reports/',import.meta.url),{recursive:true});
await writeFile(new URL('../reports/data-audit.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
