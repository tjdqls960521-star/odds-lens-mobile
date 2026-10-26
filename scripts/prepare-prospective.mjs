import {readFile,writeFile} from 'node:fs/promises';
// Input is a bundle assembled from the paginated ledger-export endpoints.
// Unverified rules/results are preserved in the bundle, never upgraded here.
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Usage: node scripts/prepare-prospective.mjs ledger-bundle.json prospective-rows.json');
const b=JSON.parse(await readFile(input,'utf8')),events=new Map((b.events||[]).map(x=>[x.id,x])),markets=new Map((b.markets||[]).map(x=>[x.id,x]));
const revisions=new Map();for(const result of b.result_revisions||[]){if(!result.marketId)continue;const old=revisions.get(result.marketId);if(!old||result.knownAt>old.knownAt)revisions.set(result.marketId,result);}
const rows=[];
for(const snapshot of b.quote_snapshots||[]){
 const event=events.get(snapshot.eventId),market=markets.get(snapshot.marketId),result=revisions.get(snapshot.marketId);
 if(!event||!market||!result)continue;
 rows.push({sourceId:snapshot.sourceId,saleStatus:snapshot.saleStatus,qualityFlags:snapshot.qualityFlags,eventId:event.id,marketId:market.id,snapshotId:snapshot.id,rawHash:snapshot.rawHash,sport:event.sport,league:event.league,homeId:event.homeId,awayId:event.awayId,startAt:event.startsAt,market:market.market,period:market.period,line:market.line,outcomeKeys:market.outcomeKeys,rulesetVersion:market.rulesetVersion,probabilityBasis:market.probabilityBasis,asOf:snapshot.observedAt,observedAt:snapshot.observedAt,availableAt:snapshot.availableAt,priceUpdatedAt:snapshot.priceUpdatedAt,odds:snapshot.outcomes.map(o=>o.odds),resultKnownAt:result.knownAt,resultStatus:result.status,resultRevisionId:result.id,labelVerified:result.verified===true,y:result.outcome?market.outcomeKeys.indexOf(result.outcome):null});
}
await writeFile(output,JSON.stringify(rows,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({rows:rows.length,verified:rows.filter(r=>r.labelVerified&&r.rulesetVersion).length,output}));
