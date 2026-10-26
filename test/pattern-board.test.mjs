import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzePatternCandidates,analyzePatternEvent} from '../public/odds-lens/pattern-board.mjs';
import {patternBoardView,patternDetailView,patternReferenceView} from '../public/odds-lens/pattern-ui.mjs';
import {validationView} from '../public/odds-lens/prediction-ui.mjs';
import {readFileSync} from 'node:fs';
import {exploreHistoricalPatterns} from '../public/odds-lens/live-core.mjs';

const event={id:'today-a',sport:'축구',league:'EPL',home:'Alpha',away:'Beta',startsAt:'2026-09-20T09:00:00.000Z'};
const winner={id:'winner',market:'일반',line:null,outcomes:[
  {key:'home',label:'홈 승',odds:1.8},{key:'draw',label:'무',odds:3.2},{key:'away',label:'원정 승',odds:4.0}
]};
const row=(id,date,league,home,away,result,closing=[1.8,3.2,4],extra={})=>({
  id,event:`soccer:${id}`,date,league,market:'일반',line:null,home,away,result,closing,...extra
});

test('same complete quote shows separate sport, league and same-role team outcomes, recent cases and transitions',()=>{
  const rows=[
    row('1','2026-08-01 20:00','EPL','Alpha','Other1','승'),
    row('2','2026-08-03 20:00','EPL','Alpha','Other2','무'),
    row('3','2026-08-05 20:00','EPL','Other3','Beta','패'),
    row('4','2026-08-07 20:00','LaLiga','Alpha','Other4','승'),
    row('5','2026-08-09 20:00','EPL','Other5','Other6','승'),
    // A different sold-item ID for the same actual game cannot add a label.
    row('99','2026-08-03 20:00','EPL','Alpha','Other2','무'),
    row('6','2026-09-21 20:00','EPL','Alpha','Beta','패'),
    row('7','2026-09-20 08:00','EPL','Alpha','Beta','패')
  ];
  const result=analyzePatternEvent(event,winner,rows);
  assert.deepEqual(result.scopes.sport.counts,[3,1,1]);
  assert.deepEqual(result.scopes.league.counts,[2,1,1]);
  assert.deepEqual(result.scopes.homeTeam.counts,[2,1,0]);
  assert.deepEqual(result.scopes.awayTeam.counts,[0,0,1]);
  assert.equal(result.scopes.sport.n,5);
  assert.equal(result.scopes.sport.rates[0],3/5);
  assert.deepEqual(result.scopes.sport.recent.map(item=>item.result),['홈 승','홈 승','원정 승','무','홈 승']);
  assert.deepEqual(result.scopes.sport.dateRange,{first:'2026-08-01 20:00',last:'2026-08-09 20:00'});
  assert.deepEqual(result.scopes.sport.transition.after,{slot:0,result:'홈 승'});
  assert.deepEqual(result.scopes.sport.transition.counts,[1,1,0]);
  assert.equal(result.scopes.sport.transition.n,2);
  assert.equal(result.scopes.homeTeam.transition.n,1);
  assert.equal(result.scopes.homeTeam.transition.counts[1],1);
  assert.equal('prediction' in result,false);
  assert.deepEqual(result.patternPrediction,{result:null,probabilities:null,highConfidence:false,reason:'SEQUENCE_NOT_VALIDATED'});
});

test('mobile official team aliases do not create unverified team history matches',()=>{
  const rows=[
    row('a','2026-08-01 20:00','EPL','Alpha','Other1','승'),
    row('b','2026-08-03 20:00','EPL','Alpha','Other2','무'),
    row('c','2026-08-05 20:00','EPL','Other3','Beta','패')
  ];
  const aliasEvent={...event,teamNamesVerified:false,available:true,markets:[{...winner,available:true}]};
  const board=analyzePatternEvent(aliasEvent,winner,rows);
  assert.equal(board.scopes.sport.n,3);
  assert.equal(board.scopes.league.n,3);
  assert.equal(board.scopes.homeTeam.n,0);
  assert.equal(board.scopes.awayTeam.n,0);
  const candidates=exploreHistoricalPatterns([aliasEvent],rows,Date.parse('2026-09-18T00:00:00Z'));
  assert.ok(candidates.length>0);
  assert.ok(candidates.every(candidate=>candidate.evidence.every(item=>item.scope!=='team')));
});

test('one selected price is independent of the complete combination and unavailable outcomes have no invented rate',()=>{
  const twoWay={id:'two-way',market:'일반',outcomes:[{key:'home',label:'홈 승',odds:1.8},{key:'away',label:'원정 승',odds:2.1}]};
  const rows=[
    row('1','2026-08-01 18:00','EPL','Alpha','X','승',[1.8,null,2.1]),
    row('2','2026-08-02 18:00','EPL','Alpha','Y','패',[1.8,null,2.3]),
    row('3','2026-08-03 18:00','EPL','Z','Beta','패',[1.9,null,2.1]),
    row('4','2026-08-04 18:00','EPL','Z','Beta','무',[1.8,3.2,2.1])
  ];
  const result=analyzePatternEvent(event,twoWay,rows);
  assert.deepEqual(result.slots,[0,2]);
  assert.deepEqual(result.scopes.sport.counts,[1,0,0]);
  assert.deepEqual(result.scopes.sport.rates,[1,null,0]);
  assert.equal(result.singlePrice[0].sport.n,2);
  assert.deepEqual(result.singlePrice[0].sport.counts,[1,0,1]);
  assert.equal(result.singlePrice[2].sport.n,2);
  assert.deepEqual(result.singlePrice[2].sport.counts,[1,0,1]);
  assert.deepEqual(result.scopes.sport.transition.rates,[null,null,null]);
});

test('market line sign, pre-start result knowledge, unsettled rows and duplicate revisions stay separate',()=>{
  const handicap={id:'handicap',market:'핸디캡',line:-1,outcomes:[
    {key:'home',label:'홈 핸디승',odds:1.8},{key:'draw',label:'무',odds:3.2},{key:'away',label:'원정 핸디승',odds:4}
  ]};
  const rows=[
    {...row('1','2026-09-18 18:00','EPL','Alpha','X','핸디무'),market:'핸디캡',line:-1},
    {...row('2','2026-09-18 19:00','EPL','Alpha','Y','핸디승'),market:'핸디캡',line:1},
    {...row('3','2026-09-20 10:00','EPL','Alpha','Z','핸디패'),market:'핸디캡',line:-1,resultKnownAt:'2026-09-20T08:00:00.000Z'},
    {...row('4','2026-09-20 11:00','EPL','Alpha','Q','핸디패'),market:'핸디캡',line:-1,resultKnownAt:'2026-09-20T10:00:00.000Z'},
    {...row('5','2026-09-17 18:00','EPL','Alpha','R','핸디승'),market:'핸디캡',line:-1,resultStatus:'cancelled'},
    {...row('6','2026-09-18 18:00','EPL','Alpha','X','핸디무'),market:'핸디캡',line:-1,closing:[2.2,3.2,4]}
  ];
  const result=analyzePatternEvent(event,handicap,rows);
  assert.deepEqual(result.scopes.sport.counts,[0,0,1]);
  assert.equal(result.scopes.sport.n,1);
  assert.equal(result.scopes.sport.recent[0].result,'원정 핸디승');
});

test('candidate batch returns one board per valid market and keeps empty evidence honest',()=>{
  const noRows=analyzePatternCandidates([{...event,markets:[winner,{...winner,id:'broken',outcomes:[]}]}],[]);
  assert.equal(noRows.length,1);
  assert.equal(noRows[0].scopes.sport.n,0);
  assert.deepEqual(noRows[0].scopes.sport.rates,[null,null,null]);
  assert.equal(noRows[0].scopes.sport.transition.after,null);
  assert.equal(noRows[0].scopes.sport.transition.n,0);
  assert.deepEqual(noRows[0].scopes.sport.recent,[]);
});

test('pattern dashboard shows outcomes by scope and explicitly holds the unvalidated next-result forecast',()=>{
  const rows=[row('1','2026-08-01 20:00','EPL','Alpha','Other1','승'),row('2','2026-08-03 20:00','EPL','Alpha','Other2','무'),row('3','2026-08-05 20:00','EPL','Other3','Beta','패')];
  const pattern=analyzePatternEvent(event,winner,rows);
  const html=patternBoardView({groups:[{event,markets:[{market:winner,pattern}]}],sourceCurrent:true,sourceLabel:'공식 조회 완료'});
  assert.match(html,/A·B·C 등급 기준/);
  assert.match(html,/과거 적중률/);
  assert.match(html,/같은 종목/);
  assert.match(html,/같은 리그/);
  assert.match(html,/홈팀 · 같은 위치/);
  assert.match(html,/원정팀 · 같은 위치/);
  assert.doesNotMatch(html,/pattern-board-sequence-cell/);
  const reference=patternReferenceView(event,winner,pattern);
  for(const slot of [0,1,2])assert.match(reference,new RegExp(`pattern-board-sequence-cell outcome-${slot}`));
  const detail=patternDetailView(event,winner,pattern);
  assert.match(detail,/각 배당별 종목·리그·팀 통계/);
  assert.match(reference,/이번 경기의 확률을 뜻하지 않습니다/);
});

test('validation screen reports sequence replay separately from model validation',()=>{
  const sequenceReport=JSON.parse(readFileSync(new URL('../reports/pattern-sequence-backtest.json',import.meta.url)));
  const html=validationView({report:{metrics:{},historicalAudit:{}},ledger:{counts:{},records:[]}},{sequenceReport});
  assert.match(html,/직전 결과 패턴 검증/);
  assert.match(html,/2026 후향 재현/);
  assert.match(html,/동일 배당 보정/);
  assert.match(html,/고신뢰 선정 보류/);
  assert.doesNotMatch(html,/2026 독립 시험 통과/);
});

test('recent sequence is capped at twelve and a draw transitions only from previous draws',()=>{
  const rows=Array.from({length:15},(_,index)=>row(
    String(index+1),`2026-08-${String(index+1).padStart(2,'0')} 18:00`,'EPL',
    `Home${index}`,`Away${index}`,index%3===2?'무':index%3===1?'패':'승'
  ));
  const result=analyzePatternEvent(event,winner,rows).scopes.sport;
  assert.equal(result.n,15);
  assert.equal(result.recent.length,12);
  assert.equal(result.recent[0].result,'무');
  assert.equal(result.recent.at(-1).date,'2026-08-04 18:00');
  assert.deepEqual(result.transition.after,{slot:1,result:'무'});
  assert.deepEqual(result.transition.counts,[4,0,0]);
  assert.equal(result.transition.n,4);
});
