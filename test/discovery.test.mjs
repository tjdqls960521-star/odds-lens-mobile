import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzePatternEvent,exactEvidenceCases} from '../public/odds-lens/pattern-board.mjs';
import {discoveryRecords,evidenceTitle} from '../public/odds-lens/discovery-core.mjs';
import {discoveryPanel,evidenceDrawerView} from '../public/odds-lens/discovery-ui.mjs';
const event={id:'discovery',sport:'baseball',startsAt:'2027-01-01T09:00:00Z',home:'Alpha',away:'Beta',league:'KBO',teamNamesVerified:true};
const market={id:'total',market:'언오버',line:8.5,period:'full',outcomes:[{key:'under',label:'언더',odds:1.7},{key:'over',label:'오버',odds:1.8}]};
const archive=Array.from({length:60},(_,i)=>({id:'case-'+i,date:new Date(Date.UTC(2024,0,1+i)).toISOString().slice(0,10)+' 18:00',home:i<7?'Alpha':'Other',away:'Past'+i,league:'KBO',market:'언오버',line:8.5,closing:[1.7,null,1.8],result:i<7?'언더':'오버'}));
const groups=rows=>[{event,markets:[{market,pattern:analyzePatternEvent(event,market,rows,{includeSequences:false})}]}];

test('discovery reveals a perfect team cohort without borrowing the larger cohort grade',()=>{
 const records=discoveryRecords(groups(archive),{focus:'perfect'}),record=records.find(r=>r.rec.slot===0);
 assert.ok(record);assert.equal(record.lead.scope,'homeTeam');assert.equal(record.lead.n,7);assert.equal(record.lead.wins,7);assert.equal(record.grade,'C');
 assert.equal(record.lead.basis,'single');assert.ok(record.lead.dateRange);
 assert.equal(discoveryRecords(groups(archive),{focus:'perfect',minimum:10}).length,0);
 assert.equal(discoveryRecords(groups(archive),{focus:'perfect',grade:'A'}).length,0);
 const html=discoveryPanel({groups:groups(archive),focus:'team'});assert.match(html,/7\/7건 적중/);assert.match(html,/소표본/);assert.match(html,/실제 사례 7건/);assert.match(html,/C등급/);
 assert.doesNotMatch(html,/이번 경기(?:의)? (?:예측)?확률[\s:은이]*100%/);
 assert.match(html,/이번 경기 확률이 아닙니다/);
});
test('shown evidence cases exactly reconcile the card across duplicate, nearby, unresolved and future rows',()=>{
 const data=[...archive,{...archive[0],id:'duplicate'},
  {...archive[0],id:'near',date:'2024-05-01 18:00',closing:[1.71,null,1.8]},
  {...archive[0],id:'line',date:'2024-05-02 18:00',line:9.5},
  {...archive[0],id:'future',date:'2027-01-02 18:00'},
  {...archive[0],id:'unknown',date:'2024-05-03 18:00',result:'미확인'}];
 const lead=discoveryRecords(groups(data),{focus:'perfect'}).find(r=>r.rec.slot===0).lead;
 const first=exactEvidenceCases(event,market,data,{scope:lead.scope,basis:lead.basis,slot:0,limit:3});
 assert.equal(first.n,lead.n);assert.equal(first.wins,lead.wins);assert.equal(first.n,7);assert.equal(first.unresolved,1);assert.equal(first.nextOffset,3);
 const second=exactEvidenceCases(event,market,data,{scope:lead.scope,basis:lead.basis,slot:0,offset:3,limit:100});
 assert.equal(new Set([...first.cases,...second.cases].map(row=>row.date)).size,7);assert.ok(first.cases.every(row=>row.won));
 assert.equal(exactEvidenceCases({...event,teamNamesVerified:false},market,data,{scope:'homeTeam',slot:0}).n,0);
 const all=exactEvidenceCases(event,market,data,{scope:'sport',slot:0});assert.equal(all.wins,7);assert.equal(all.n,60);assert.ok(all.cases.some(row=>!row.won));
 const html=evidenceDrawerView({event,market,slot:0,item:lead,report:all});assert.match(html,/53건 미적중/);assert.match(html,/7\/60건 적중/);
});
test('team wording distinguishes own wins, opponents, draws, totals and full combinations',()=>{
 const winner={...market,market:'일반',line:null,outcomes:[{label:'홈 승',odds:1.85},{label:'무',odds:3.1},{label:'원정 승',odds:3.7}]};
 const item={scope:'homeTeam',basis:'single',n:7,wins:7};
 assert.match(evidenceTitle(event,winner,0,item).text,/Alpha, 1.85배에서 7전 7승/);
 assert.doesNotMatch(evidenceTitle(event,winner,2,item).text,/7전 7승/);
 assert.match(evidenceTitle(event,winner,1,item).text,/무승부 7\/7회/);
 assert.match(evidenceTitle(event,winner,0,{...item,basis:'combo'}).text,/배당 조합/);
 assert.match(evidenceTitle(event,market,0,item).text,/언더 7\/7회/);
});
