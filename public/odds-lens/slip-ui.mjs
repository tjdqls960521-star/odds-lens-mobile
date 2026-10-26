import {slipSummary,validStake} from './slip-core.mjs?v=20261005-3';
import {formatKst} from './prediction-core.mjs?v=20261005-3';
const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const won=v=>v==null?'—':Number(v).toLocaleString('ko-KR')+'원';
const statusLabels={pending:'결과 대기',won:'적중',lost:'미적중',void:'무효 · 1.00배',cancelled:'취소 · 1.00배'};
export function draftSummary(draft){
  const value=slipSummary(draft);
  return `<div><span>조합 배당</span><strong>${draft.picks.length?value.odds.toFixed(3):'—'}배</strong></div><div><span>예상 적중금 · 원금 포함</span><strong>${validStake(draft.stake)&&draft.picks.length?won(value.expected):draft.picks.length?'금액을 입력하세요':'픽을 담아주세요'}</strong></div>`;
}
function scoreText(result){
  if(!result)return '';
  const parts=[];
  if(result.score?.length===2)parts.push(`최종 ${result.score.join(' : ')}`);
  if(result.marketScore?.length===2&&result.scoreKind==='total')parts.push(`총점 ${result.marketScore[0]}`);
  if(result.marketScore?.length===2&&result.scoreKind==='handicap_adjusted')parts.push(`핸디 반영 ${result.marketScore.join(' : ')}`);
  return parts.join(' · ');
}
function pickRow(pick,{draft=false}={}){
  const r=pick.result,score=scoreText(r),label=r?.phase==='scheduled'?'시작 전':statusLabels[r?.status]||'결과 대기';
  return `<div class="slip-pick" data-pick-key="${esc(pick.marketId)}"><div><small>${esc(pick.league)} · ${esc(formatKst(pick.startsAt))}</small><b>${esc(pick.home)} vs ${esc(pick.away)}</b><span>${esc(pick.market)}${pick.line==null?'':` ${esc(pick.line)}`} · <strong>${esc(pick.label)} ${Number(pick.odds).toFixed(2)}</strong></span>${score?`<span class="slip-score">${esc(score)}</span>`:''}${pick.saleStatus==='closed'?'<small>발매 종료 당시의 관찰용 픽</small>':''}</div><div class="slip-result result-${esc(r?.status||'pending')}"><b>${esc(label)}</b><small>${esc(r?.sourceResult||r?.reason||'결과 확인 중')}</small>${r?.checkedAt?`<small>${r.source==='betman-official'?'공식 결과':'과거 원본'} · ${esc(formatKst(r.checkedAt))} 확인</small>`:''}${r?.refreshError?'<small class="refresh-error">재조회 지연 · 마지막 확인 결과</small>':''}${draft?`<button class="button remove-pick" data-remove-pick="${esc(pick.marketId)}" aria-label="${esc(pick.home)} 픽 제거">제거</button>`:''}</div></div>`;
}
function progress(picks){
  const count=status=>picks.filter(p=>(p.result?.status||'pending')===status).length;
  return `<div class="slip-progress"><span class="result-won">적중 ${count('won')}</span><span class="result-lost">미적중 ${count('lost')}</span><span>대기 ${count('pending')}</span>${count('void')+count('cancelled')?`<span>취소·무효 ${count('void')+count('cancelled')}</span>`:''}</div>`;
}
export function slipsView({draft,slips=[],loading=false,error='',saving=false,nextCursor=null,sources={},resultSource={}}){
  return `<div class="page-heading"><div><div class="eyebrow">MY PICKS</div><h1>픽 장바구니</h1><p>선택한 배당과 금액을 기록하고 결과를 확인합니다. 실제 구매 기능은 없습니다.</p></div><button class="button" data-refresh-slips ${loading?'disabled':''}>${loading?'결과 확인 중…':'결과 새로 확인'}</button></div>
  <div class="cart-workspace"><section class="card draft-slip"><div class="card-head"><h2>담은 픽 ${draft.picks.length}개</h2><button class="button" data-clear-draft ${draft.picks.length?'':'disabled'}>비우기</button></div>${draft.picks.map(p=>pickRow(p,{draft:true})).join('')||'<div class="draft-empty"><p class="muted">관심 있는 배당을 담아 조합을 비교하세요.</p><button class="button" data-route="today">경기에서 픽 담기</button></div>'}<label class="stake-label">금액 <input id="slip-stake" type="number" inputmode="numeric" min="1" max="1000000000" step="1" placeholder="금액 입력" value="${esc(draft.stake||'')}" ${saving?'disabled':''}> 원</label><div class="slip-totals" id="draft-totals">${draftSummary(draft)}</div><p class="caption">담은 픽은 저장 전에도 결과를 확인할 수 있습니다. 조합 기록은 경기 시작 전에 저장하세요. 예상 적중금은 원금 포함, 세금·수수료 적용 전 금액입니다.</p><button class="button primary" data-save-slip ${saving||!draft.picks.length?'disabled':''}>${saving?'저장 중…':'조합 기록 저장'}</button>${error?`<p class="refresh-error" role="alert">${esc(error)}</p>`:''}</section>
  <section class="slip-history"><div class="card-head"><h2>저장한 조합</h2><span>기기 간 연결되는 내 기록</span></div>${loading&&!slips.length?'<p>저장한 기록을 불러오는 중…</p>':''}${slips.map(slip=>{const s=slip.summary||slipSummary(slip);return `<article class="card saved-slip" data-scroll-key="slip:${esc(slip.id)}"><div class="card-head"><div><small>${esc(formatKst(slip.createdAt))}</small><h3>${slip.picks.length}폴더 · ${won(slip.stake)}</h3></div><span class="chip result-${s.status}">${esc(s.status==='void'?'전체 취소·무효':statusLabels[s.status])}</span></div>${progress(slip.picks)}${slip.picks.map(p=>pickRow(p)).join('')}<div class="slip-totals"><div><span>저장 배당</span><strong>${s.odds.toFixed(3)}배</strong></div><div><span>${s.status==='pending'?'예상 적중금 · 원금 포함':'결과 반영 금액 · 원금 포함'}</span><strong>${won(s.status==='pending'?s.expected:s.payout)}</strong></div></div>${s.effectiveOdds!==s.odds?'<p class="caption">취소·무효 픽은 1.00배로 계산했습니다.</p>':''}</article>`;}).join('')||(!loading?'<p class="card muted">아직 저장한 조합이 없습니다.</p>':'')}${nextCursor?`<button class="button" data-more-slips="${esc(nextCursor)}">이전 기록 더 보기</button>`:''}</section></div>
  <details class="card slip-source" data-disclosure="slip-source"><summary>결과 확인 출처</summary><h3>베트맨 공식 결과로 확인</h3><p class="caption">회차·경기번호·팀·시장·기준점을 대조합니다. 화면이 열려 있으면 30초마다 확인하며, 지난 회차의 결과도 조회합니다. 공식 발표 전에는 대기로 표시합니다.</p>${resultSource.refreshing?'<p class="caption">최신 공식 결과를 확인하고 있습니다.</p>':''}${(resultSource.rounds||[]).map(r=>`<small class="result-source">${esc(r.round)}회차 · ${r.lastSuccess?esc(formatKst(r.lastSuccess))+' 확인':'첫 결과 조회 중'}${r.error?`<span class="refresh-error"> · ${esc(r.error)}</span>`:''}</small>`).join('')}${Object.entries(sources).some(([,s])=>s.error)?'<p class="caption">일부 과거 시트 동기화가 지연되고 있습니다. 공식 결과는 별도로 확인합니다.</p>':''}</details>`;
}
