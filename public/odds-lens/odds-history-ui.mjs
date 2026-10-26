import {priceDelta,quoteComparable,hasQuoteChanges} from './quote-history-core.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const price=value=>Number(value)>1?Number(value).toFixed(2):'—';
const time=value=>Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(value)):'시각 미확인';
const line=value=>value===null||value===undefined?'없음':String(value);
export function deltaView(delta){
 if(delta===null)return '<span class="quote-delta neutral">조건 변경</span>';
 if(delta===0)return '<span class="quote-delta neutral">변동 없음</span>';
 return `<span class="quote-delta ${delta>0?'up':'down'}" aria-label="${Math.abs(delta).toFixed(2)} ${delta>0?'상승':'하락'}">${delta>0?'↑':'↓'} ${Math.abs(delta).toFixed(2)}</span>`;
}
export function quoteMovementLabel(market,outcome){
 const first=market.oddsHistory?.first;if(!first)return '';
 const initial=first.outcomes.find(o=>o.key===outcome.key),delta=priceDelta(first,market,outcome.key);
 return ` · 최초 기록 ${price(initial?.odds)}배 · ${delta===null?'기준·조건 변경':delta===0?'변동 없음':Math.abs(delta).toFixed(2)+(delta>0?' 상승':' 하락')}`;
}
export function quoteMovementView(market,outcome){
 const first=market.oddsHistory?.first;
 if(!first)return '';
 const initial=first.outcomes.find(o=>o.key===outcome.key);
 if(!initial)return '<small class="quote-origin">선택 구성 변경</small>';
 const comparable=quoteComparable(first,market);
 return `<small class="quote-origin">최초 ${price(initial.odds)}</small>${comparable?deltaView(priceDelta(first,market,outcome.key)):'<span class="quote-delta neutral">기준·조건 변경</span>'}`;
}
export function historyTriggerView(event,market,{standalone=false}={}){
 const history=market.oddsHistory,count=history?.changeCount;
 return `<div class="quote-history-access ${standalone?'standalone':''}"><span>${history?.first?`최초 기록 ${esc(time(history.first.observedAt))}${history.comparable===false?' · 기준·조건 변경':''}`:'수집된 배당 기록 확인'}</span><button class="quote-history-button ${hasQuoteChanges(market)?'has-changes':''}" data-open-odds-history data-event-id="${esc(event.id)}" data-market-id="${esc(market.id)}" aria-haspopup="dialog" aria-controls="odds-history-drawer" aria-label="${esc(event.home+' 대 '+event.away+' '+(market.marketLabel||market.market)+' 배당 이력')} 배당 이력${count===undefined?'':` · 변경 ${count}회`}">${hasQuoteChanges(market)?`변경 ${count}회`:'배당 이력'} <span aria-hidden="true">↗</span></button></div>`;
}
export function fixtureToolsView(events,{search='',filter='all',sort='time',favorites=new Set()}={}){
 const changed=events.filter(e=>e.markets.some(hasQuoteChanges)).length,favorite=events.filter(e=>favorites.has(String(e.id))).length;
 return `<section class="fixture-tools" aria-label="경기 빠른 찾기"><div class="fixture-search"><label class="sr-only" for="fixture-search">팀·리그 검색</label><input type="search" id="fixture-search" placeholder="팀·리그 검색" autocomplete="off" value="${esc(search)}"><label class="sr-only" for="fixture-sort">경기 정렬</label><select id="fixture-sort" aria-label="경기 정렬"><option value="time" ${sort==='time'?'selected':''}>시작시간순</option><option value="changes" ${sort==='changes'?'selected':''}>최근 변경순</option></select></div><div class="fixture-segments" role="group" aria-label="경기 보기">${[['all','전체',events.length],['changed','배당 변경',changed],['favorites','관심 경기',favorite]].map(([key,label,count])=>`<button data-fixture-filter="${key}" aria-pressed="${filter===key}">${label} <span>${count}</span></button>`).join('')}</div>${search||filter!=='all'?'<button class="fixture-reset" data-reset-fixtures>검색·빠른 필터 초기화</button>':''}</section>`;
}
function summaryView(summary){
 if(!summary)return '';
 const {first,latest,changeCount}=summary,comparable=quoteComparable(first,latest);
 return `<section class="quote-history-overview"><div class="quote-history-overview-heading"><b>최초 기록 → 최신 기록</b><span>변경 ${changeCount}회</span></div><div class="quote-history-comparison" style="--outcome-count:${latest.outcomes.length}">${latest.outcomes.map(o=>{const start=first.outcomes.find(v=>v.key===o.key);return `<div><span>${esc(o.label)}</span><small>최초 ${price(start?.odds)}</small><strong>${price(o.odds)}</strong>${deltaView(comparable?priceDelta(first,latest,o.key):null)}</div>`;}).join('')}</div><p>최초 ${esc(time(first.observedAt))}<br>최신 변경 ${esc(time(latest.observedAt))} · KST</p>${!comparable?`<div class="quote-condition-note">기준점 ${esc(line(first.line))} → ${esc(line(latest.line))}${first.line===latest.line?' · 선택·시장 조건 변경':''}<br>조건이 달라 가격 차이를 직접 비교하지 않습니다.</div>`:''}</section>`;
}
function pointView(point){
 const kind={first:'최초 기록',price:'배당 변경',conditions:'기준·조건 변경'}[point.kind]||'배당 기록';
 return `<li class="quote-history-point ${point.kind}"><div class="quote-point-head"><time datetime="${esc(point.observedAt)}">${esc(time(point.observedAt))}</time><span>${kind}</span></div>${point.kind==='conditions'?`<p class="quote-condition-note">기준점 ${esc(line(point.previousLine))} → ${esc(line(point.line))}${point.previousLine===point.line?' · 시장·선택 구성 변경':''}</p>`:point.line!==null?`<small class="quote-point-line">기준점 ${esc(point.line)}</small>`:''}<div class="quote-history-values" style="--outcome-count:${point.outcomes.length}">${point.outcomes.map(o=>`<div><span>${esc(o.label)}</span><b>${price(o.odds)}</b>${point.kind==='first'?'':deltaView(point.deltas?.[o.key]??null)}</div>`).join('')}</div></li>`;
}
export function quoteHistoryDrawerView({event,market,payload=null,loading=false,error='',moreLoading=false}={}){
 const summary=payload?.summary||market?.oddsHistory;
 return `<div class="quote-history-header"><div><span>${esc(event?.league)} · ${esc(market?.marketLabel||market?.market)}${market?.line===null||market?.line===undefined?'':' '+esc(market.line)}</span><h2 id="odds-history-title">배당 변경 이력</h2></div><button class="button" data-close-odds-history aria-label="배당 이력 닫기">닫기</button></div><div class="quote-history-body"><p class="quote-history-fixture">${esc(event?.home)} <span>vs</span> ${esc(event?.away)}</p>${summaryView(summary)}<p class="quote-history-notice">최초 기록은 앱이 처음 확인한 값으로, 실제 발매 최초 배당과 다를 수 있습니다. 시각은 변경을 확인한 시각(KST)이며 30초 조회 사이의 변경은 누락될 수 있습니다.</p>${error?`<div class="quote-history-error" role="alert">${esc(error)}<button class="button" data-retry-odds-history>다시 불러오기</button></div>`:''}${loading?'<p class="quote-history-loading" role="status">저장된 이력을 불러오고 있습니다…</p>':''}${payload?.points?.length?`<div class="quote-timeline-heading"><h3>변경 기록</h3><span>최신순 · 직전 기록과 비교</span></div><ol class="quote-history-timeline">${payload.points.map(pointView).join('')}</ol>`:!loading&&!error?'<p class="quote-history-empty">아직 수집된 배당 이력이 없습니다. 공식 배당이 수집되면 기록을 시작합니다.</p>':''}${payload?.nextCursor?`<button class="button quote-history-more" data-more-odds-history ${moreLoading?'disabled':''}>${moreLoading?'불러오는 중…':'이전 기록 더 보기'}</button>`:''}<p class="quote-history-note">동일 배당의 반복 조회와 판매 상태 변경은 변경 횟수에서 제외합니다. 새 회차·다른 경기의 이력은 각각 보관합니다.</p></div>`;
}
