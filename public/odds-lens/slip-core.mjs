import {canonicalMarket,canonicalTeam,sameLine} from './live-core.mjs?v=20261005-3';
import {settlement} from './prediction-core.mjs?v=20261005-3';

export const validStake=value=>Number.isSafeInteger(Number(value))&&Number(value)>0&&Number(value)<=1_000_000_000;
export const pickKey=pick=>String(pick.marketId)+':'+String(pick.outcomeKey);
// Old browser drafts already contain these two IDs. Recover metadata without
// changing their saved selection/price, or guessing a team-name alias.
export function normalizePick(pick){
  const offer=String(pick.marketId||'').match(/^betman-(\d{6})-(\d+)$/);
  let identity=[];try{identity=String(pick.eventId||'').split(':').map(decodeURIComponent);}catch{}
  return {...pick,...(offer?{round:offer[1],gameNumber:Number(offer[2]),year:pick.year||'20'+offer[1].slice(0,2)}:{}),sport:pick.sport||(identity[0]==='event'?identity[1]:undefined)};
}
export function combinedOdds(picks,{settled=false}={}){
  return picks.reduce((value,pick)=>value*(settled&&['void','cancelled'].includes(pick.result?.status)?1:Number(pick.odds)),1);
}
function gross(picks,stake,settled=false){
  if(!validStake(stake)||!picks.length)return null;
  let numerator=BigInt(Number(stake)),denominator=1n;
  for(const pick of picks){
    if(settled&&['void','cancelled'].includes(pick.result?.status))continue;
    const cents=Math.round(Number(pick.odds)*100);
    if(!Number.isSafeInteger(cents)||cents<=100)return null;
    numerator*=BigInt(cents);denominator*=100n;
  }
  return Number(numerator/denominator);
}
export function slipSummary(slip){
  const picks=slip.picks||[],lost=picks.some(p=>p.result?.status==='lost'),complete=picks.length>0&&picks.every(p=>['won','lost','void','cancelled'].includes(p.result?.status));
  const allVoid=complete&&picks.every(p=>['void','cancelled'].includes(p.result?.status));
  const odds=combinedOdds(picks),effectiveOdds=combinedOdds(picks,{settled:true});
  return {odds,effectiveOdds,expected:gross(picks,slip.stake),
    status:lost?'lost':allVoid?'void':complete?'won':'pending',
    payout:lost?0:complete?gross(picks,slip.stake,true):null};
}
export function resolvePick(pick,row,knownAt=null){
  const pending=reason=>({status:'pending',reason,checkedAt:knownAt});
  if(!row)return pending('원본 결과 업데이트 대기');
  const expectedId=`${pick.year}-${Number(String(pick.round).slice(2))}-${pick.gameNumber}`;
  if(!Number.isFinite(Date.parse(pick.startsAt)))return pending('경기 시작시각 확인 필요');
  const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date(pick.startsAt));
  if(String(row.id)!==expectedId||String(row.date).slice(0,10)!==date||canonicalMarket(row.market)!==pick.market||
    (!['일반','승1패'].includes(pick.market)&&!sameLine(row.line,pick.line))||canonicalTeam(row.home)!==canonicalTeam(pick.home)||canonicalTeam(row.away)!==canonicalTeam(pick.away))return pending('원본 경기·팀·기준점 대조 대기');
  const result=settlement(row.result,pick.outcomeKeys,pick.market);
  if(['cancelled','void'].includes(result.status))return {...result,sourceResult:row.result,sourceId:row.id,checkedAt:knownAt};
  if(result.status!=='settled')return pending(result.status==='unsupported'?'이 결과의 정산 규칙 확인 대기':'원본 결과 업데이트 대기');
  return {status:result.outcome===pick.outcomeKey?'won':'lost',outcome:result.outcome,sourceResult:row.result,sourceId:row.id,source:'historical-sheet',checkedAt:knownAt};
}

export function resolveOfficialPick(pick,row,record={},now=Date.now()){
  const scheduled=Number.isFinite(Date.parse(pick.startsAt))&&Date.parse(pick.startsAt)>now;
  const pending=(reason,phase=scheduled?'scheduled':'awaiting')=>({status:'pending',phase,reason,checkedAt:record.lastSuccess||null,refreshError:record.error||null,source:'betman-official'});
  if(!row)return pending(scheduled?'경기 시작 전':record.error?'공식 결과 재조회 대기':'공식 결과 발표 확인 중');
  const identityMatch=String(pick.eventId).startsWith('event:')?pick.eventId===row.eventId:
    Date.parse(pick.startsAt)===Date.parse(row.startsAt)&&canonicalTeam(pick.home)===canonicalTeam(row.home)&&canonicalTeam(pick.away)===canonicalTeam(row.away);
  if(row.marketId!==pick.marketId||row.sport!==pick.sport||!identityMatch||row.market!==canonicalMarket(pick.market)||row.period!=='full')return pending('경기·판매 항목 대조 불일치','mismatch');
  // An explicit official cancellation applies to all prices/lines of this
  // same offer. Cancelled rows may reset the published line to zero.
  if(row.status!=='cancelled'&&!['일반','승1패'].includes(pick.market)&&!sameLine(pick.line,row.line))return pending('저장 기준점과 공식 결과 기준점이 달라 정산 보류','mismatch');
  if(!row.outcomeKeys.includes(pick.outcomeKey)||pick.outcomeKeys&&JSON.stringify(pick.outcomeKeys)!==JSON.stringify(row.outcomeKeys))return pending('저장한 선택 항목과 공식 결과 항목 대조 필요','mismatch');
  const meta={source:'betman-official',sourceId:row.marketId,checkedAt:record.lastSuccess||row.observedAt,refreshError:record.error||null,rawCode:row.rawCode,score:row.score,marketScore:row.marketScore,scoreKind:row.scoreKind,sourceUrl:row.sourceUrl};
  if(row.status==='cancelled')return {...meta,status:'cancelled',sourceResult:'공식 취소 · 1.00배 적용',score:null,marketScore:null};
  if(row.status==='unsupported')return {...pending('공식 특수 결과의 정산 규칙 확인 필요','review'),...meta};
  if(row.status!=='settled')return {...pending(scheduled?'경기 시작 전':'진행 중 또는 공식 결과 발표 대기'),...meta};
  const label=row.market==='승1패'?{home:'홈 2점차 이상 승',draw:'① 1점차 이내(무승부 포함)',away:'원정 2점차 이상 승'}:row.market==='핸디캡'?{home:'홈 핸디승',draw:'핸디무',away:'원정 핸디승'}:{home:'홈 승',draw:'무승부',away:'원정 승',under:'언더',over:'오버'};
  return {...meta,status:row.outcome===pick.outcomeKey?'won':'lost',outcome:row.outcome,sourceResult:label[row.outcome]};
}
