import {SIGNAL_SPORTS,marketSignalInterpretation} from './multisport-signals.mjs?v=20261014-4';
import {COLAB_URL,ORIGINAL_LEAGUES,SIGNAL_LABELS,OUTCOME_LABELS,filterSignals,signalInterpretation} from './traffic-light-core.mjs?v=20261014-2';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const value=v=>v===null||v===undefined?'—':`${Number(v).toFixed(2)}%`;
const change=v=>v===null||v===undefined?'—':`${v>0?'+':''}${Number(v).toFixed(2)}%p`;
const stamp=v=>Number.isFinite(Date.parse(v))?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v)):'미확인';
const dot=color=>`<span class="tl-dot tl-${color}" aria-hidden="true"></span>`;
const labelsFor=a=>a.labels||OUTCOME_LABELS;
const reading=a=>a.model==='domestic-v1'?marketSignalInterpretation(a):signalInterpretation(a);
const quoteValue=v=>typeof v==='number'&&Number.isFinite(v)&&v>1?v.toFixed(2):'—';
const badge=a=>`<span class="tl-badge tl-${a.color}">${dot(a.color)}${a.model&&a.color==='missing'?'판정 보류':SIGNAL_LABELS[a.color]}${a.direction===null?'':` · ${esc(labelsFor(a)[a.direction])}`}</span>`;

export function signalEntryView(){
  return `<button class="tl-entry" data-route="signals"><span class="tl-entry-lights" aria-hidden="true">${dot('green')}${dot('yellow')}${dot('red')}</span><span><b>배당 신호등</b><small>야구·축구·농구·배구 배당 변화 확인</small></span><span aria-hidden="true">→</span></button>`;
}

function probabilityGrid(a){
  return `<div class="tl-probability-grid" style="grid-template-columns:repeat(${labelsFor(a).length},minmax(0,1fr))">${labelsFor(a).map((label,i)=>`<div class="${a.direction===i?'tl-direction':''}"><span>${esc(label)}${a.direction===i?' · 신호 방향':''}</span>${a.currentOdds?`<small>배당 ${quoteValue(a.earlyOdds[i])} → ${quoteValue(a.currentOdds[i])}</small>`:''}<b>${value(a.early[i])} <i>→</i> ${value(a.current[i])}</b><strong>${change(a.changes?.[i])}</strong></div>`).join('')}</div>`;
}

export function signalCardView(event){
  const a=event.analysis;
  return `<article class="tl-card tl-card-${a.color}" data-scroll-key="signal-${esc(event.id)}">
    <div class="tl-card-meta"><b>${event.sport?esc(SIGNAL_SPORTS[event.sport])+' · ':''}${esc(event.league)}</b><time datetime="${esc(event.startsAt)}">${esc(event.displayTime)} <span>KST</span></time></div>
    <div class="tl-teams"><div><small>홈</small><h3>${esc(event.home)}</h3></div><span aria-hidden="true">vs</span><div><small>원정</small><h3>${esc(event.away)}</h3></div></div>
    ${event.market?`<p class="tl-market-name">${esc(event.market)}${event.line===null?'':' · 기준 '+esc(event.line)} · ${labelsFor(a).length}결과${event.started?' · 시작·종료 참고용':event.saleStatus!=='selling'?' · 판매 상태 확인 필요':''}</p>`:''}
    <div class="tl-verdict">${badge(a)}${a.direction===null?'':`<span>보조 조건 <b>${a.supports.length}/${a.supportTotal??2}</b></span>`}</div>
    <p class="tl-reading">${esc(reading(a))}</p>
    ${event.stale?'<p class="tl-stale">이전 수집값 기준 · 최신 신호 확인 필요</p>':''}
    <details class="tl-evidence" data-disclosure="signal-${esc(event.id)}"><summary>${a.model?'최초 관측':'초기'} → 현재 값과 판정 근거</summary>
      ${probabilityGrid(a)}
      <p class="tl-caption">${a.model?'배당 환산 비중 · 실제 적중확률 아님 · 변화는 현재 − 최초 관측':'원본 확률값 · 변화는 현재 − 초기'} · %p는 퍼센트포인트</p>
      ${a.direction===null?'':`<ul class="tl-checks"><li><b>주 조건 충족</b><span>${esc(labelsFor(a)[a.direction])} 증가 ${change(a.changes[a.direction])} ≥ 5%p</span></li>${labelsFor(a).map((_,i)=>i).filter(i=>i!==a.direction).map(i=>`<li><b>${a.supports.includes(i)?'보조 충족':'보조 미충족'}</b><span>${esc(labelsFor(a)[i])} ${change(a.changes[i])} · 감소 3%p 이상 기준</span></li>`).join('')}</ul>`}
      ${a.qualified?.length>1?`<p class="tl-caption">동시 조건 충족: ${a.qualified.map(i=>esc(labelsFor(a)[i])+' '+change(a.changes[i])).join(' · ')}</p>`:''}
      ${a.model?`<p class="tl-caption">최초 관측 ${esc(stamp(a.firstObservedAt))} KST · 실제 발매 최초 배당과 다를 수 있습니다.</p>`:''}
      ${a.bothMain?'<p class="tl-caption">홈·원정이 동시에 주 조건을 충족해, 원본 코드의 나중 판정인 원정을 표시합니다.</p>':''}
      <p class="tl-caption">수집 ${esc(stamp(event.fetchedAt))} KST · ${a.model?'베트맨 공식 경기 시각':'경기 시각은 원본처럼 UTC를 KST로 변환'}</p>
    </details>
  </article>`;
}

export function signalGuideView(domestic=false){
  if(domestic)return `<details class="tl-guide" data-disclosure="signal-guide"><summary><span>전 종목 신호등, 이렇게 적용합니다</span><span aria-hidden="true">＋</span></summary><div class="tl-guide-body">
    <p><b>종목 이름보다 결과의 개수로 구분합니다.</b> 야구·축구·농구·배구의 일반·핸디캡·언오버 등 공개된 2·3결과 시장에 적용합니다. 최초 관측과 현재의 동일 시장·동일 기준점만 비교합니다.</p>
    <div class="tl-guide-note"><b>모든 종목에 같은 단위</b><p>각 시점의 <code>(1/해당 배당) ÷ Σ(1/전체 선택지 배당) × 100</code>으로 합계 100%의 배당 환산 비중을 구합니다. 실제 승리 확률을 추정한 값은 아닙니다. 동점 환불·적특 등의 정산 확률도 계산하지 않습니다.</p></div>
    <div class="tl-legend"><div>${dot('green')}<span><b>초록 · 보조 2개 충족</b><small>한 결과 +5%p 이상, 다른 두 결과 각각 −3%p 이하</small></span></div><div>${dot('yellow')}<span><b>노랑 · 보조 1개 충족</b><small>한 결과 +5%p 이상, 다른 결과 하나 −3%p 이하</small></span></div><div>${dot('red')}<span><b>빨강 · 주 조건만 충족</b><small>+5%p를 충족하지만 −3%p인 다른 결과 없음</small></span></div></div>
    <p><b>승·패, 오버·언더처럼 2결과인 시장은 노랑 방향 신호입니다.</b> 합계 100%이므로 한쪽이 +5%p이면 반대쪽은 −5%p입니다. 존재하지 않는 세 번째 결과를 만들거나 이를 독립 근거 두 개로 세지 않습니다. 따라서 이 시장에는 초록·빨강이 발생하지 않습니다.</p>
    <p>3결과 확장 판정은 무승부·①·⑤ 등 모든 선택지를 검사하며, 동시에 충족하면 증가 폭이 가장 큰 방향을 대표로 표시하고 상세에 함께 적습니다. 축구 Colab 원본 탭은 기존 홈·원정 판정 순서를 유지합니다.</p>
    <p>5%p·3%p는 원본의 표시 기준이며 종목별 적중률이 검증된 기준은 아닙니다. 이력 누락·기준점 변경은 판정 보류, 원본 지연은 이전 수집값으로 표시합니다.</p>
    <a href="https://help.smarkets.com/hc/en-gb/articles/214058369-How-to-calculate-implied-probability-in-betting" target="_blank" rel="noopener noreferrer">배당 역수 환산의 근거 ↗</a>
  </div></details>`;

  return `<details class="tl-guide" data-disclosure="signal-guide"><summary><span>신호등, 이렇게 읽으세요</span><span aria-hidden="true">＋</span></summary><div class="tl-guide-body">
    <p><b>먼저 방향, 그다음 보조 조건을 봅니다.</b> 홈 또는 원정의 현재 확률이 초기보다 5%p 이상 증가하면 신호가 생깁니다. 다른 두 결과의 확률이 각각 3%p 이상 감소했는지에 따라 색이 달라집니다.</p>
    <div class="tl-legend">${[['green','보조 2개 충족','다른 두 결과가 모두 3%p 이상 감소'],['yellow','보조 1개 충족','다른 두 결과 중 하나만 3%p 이상 감소'],['red','보조 조건 없음','주 조건만 충족 · 패배 예측을 뜻하지 않음']].map(([color,title,body])=>`<div>${dot(color)}<span><b>${SIGNAL_LABELS[color]} · ${title}</b><small>${body}</small></span></div>`).join('')}</div>
    <p>신호 없음은 주 조건 미충족, 값 부족은 계산에 필요한 자료가 누락된 상태입니다. 색은 확률 변화의 동반 여부를 나타내며 적중률이나 승리 확률의 등급이 아닙니다.</p>
    <div class="tl-guide-note"><b>원본 실행 코드 그대로</b><p>계산식은 <code>round(초기/100 − 현재/100, 4)</code>입니다. 원본 설명의 ‘배당 등락률’과 달리 실제 계산은 확률 차이이며, 정배 여부를 검사하지 않습니다. 무승부 방향 신호는 없고, 홈·원정 동시 충족 시 원정이 최종 표시됩니다.</p></div>
    <a href="${COLAB_URL}" target="_blank" rel="noopener noreferrer">Colab 원본 열기 ↗</a>
  </div></details>`;
}

function calculatorView({calculatorValues=[],calculatorResult=null,calculatorError=''}){
  return `<details class="tl-guide" data-disclosure="signal-calculator"><summary><span>확률값으로 직접 판정해 보기</span><span aria-hidden="true">＋</span></summary><div class="tl-guide-body"><p>입력값에 원본의 동일한 계산식을 적용합니다. 실제 경기 목록에는 추가되지 않습니다.</p><form id="signal-calculator"><div class="tl-calc-grid"><span></span>${OUTCOME_LABELS.map(l=>`<b>${l}</b>`).join('')}${['초기','현재'].map((label,row)=>`<b>${label} %</b>${OUTCOME_LABELS.map((outcome,col)=>`<input id="signal-p${row*3+col}" name="p${row*3+col}" type="number" inputmode="decimal" min="0" max="100" step="any" required aria-label="${label} ${outcome} 확률 퍼센트" value="${esc(calculatorValues[row*3+col]??'')}" placeholder="%">`).join('')}`).join('')}</div><div class="tl-calc-actions"><button class="button primary" type="submit">신호 판정</button><button class="button" type="button" data-signal-example>예시값 넣기</button></div></form>${calculatorError?`<p role="alert">${esc(calculatorError)}</p>`:''}<div class="tl-calc-result" role="status">${calculatorResult?`${badge(calculatorResult)}<p>${esc(signalInterpretation(calculatorResult))}</p>`:''}</div></div></details>`;
}

export function signalsView(state){
  const {payload,loading,error,filter='all',search='',date='all',league='all',limit=40,sport='all',market='all',phase='all'}=state;
  const domestic=state.source==='domestic';
  const events=(payload?.events||[]).map(e=>({...e,stale:!!error||e.stale||Date.now()-Date.parse(e.fetchedAt)>120000})),days=payload?.days||[],failures=days.filter(d=>d.error),checked=days.filter(d=>d.fetchedAt);
  const scoped=events.filter(e=>(!domestic||sport==='all'||e.sport===sport)&&(!domestic||market==='all'||e.market===market)&&(!domestic||phase==='all'||!e.started));
  const base=filterSignals(scoped,{search,date,league}),visible=filterSignals(base,{filter});
  const hasConditions=!!search||date!=='all'||league!=='all'||filter!=='all'||sport!=='all'||market!=='all';
  const sourceProblem=!!error||failures.length>0||!!payload?.error||!!payload?.historyError;
  const sourceLabel=loading?'원본 연결 중':sourceProblem?'연결 확인 필요':payload?.stale?'이전 수집값':checked.length||payload?.fetchedAt?'원본 수집 완료':'수집 대기';
  const counts=Object.fromEntries(Object.keys(SIGNAL_LABELS).map(color=>[color,base.filter(e=>e.analysis.color===color).length]));
  const dates=payload?.dates||[];
  const allLeagues=[...new Set(events.filter(e=>!domestic||sport==='all'||e.sport===sport).map(e=>e.league))].sort();
  let list='';
  if(!payload&&loading)list=`<div class="tl-empty" role="status"><span class="tl-loading-lights" aria-hidden="true">● ● ●</span><h2>${domestic?'국내 전 종목 경기표를 읽고 있습니다':'오늘·내일의 원본 경기표를 읽고 있습니다'}</h2><p>연결 결과와 신호를 함께 표시합니다.</p></div>`;
  else if(!events.length&&sourceProblem)list='<div class="tl-empty"><h2>원본 경기표를 아직 받지 못했습니다</h2><p>아래 출처 상세에서 날짜별 오류를 확인할 수 있습니다. 잠시 후 원본 다시 연결을 눌러주세요.</p><button class="button" data-refresh-signals>원본 다시 연결</button></div>';
  else if(!events.length&&domestic)list='<div class="tl-empty"><h2>현재 표시할 공개 배당이 없습니다</h2><p>해당 종목의 배당이 공개되고 수집되면 자동으로 표시됩니다. 없는 배당이나 신호를 만들지 않습니다.</p></div>';
  else if(!events.length)list=`<div class="tl-empty"><h2>${checked.length?'원본 리그 목록에 해당하는 경기가 없습니다':'아직 수집된 경기표가 없습니다'}</h2><p>${checked.length?'오늘·내일 조회 결과입니다. 신호가 없는 경기도 숨기지 않고 표시합니다.':'원본 연결을 눌러 경기표를 불러오세요.'}</p></div>`;
  else if(!visible.length)list='<div class="tl-empty"><h2>선택한 조건의 경기가 없습니다</h2><p>다른 신호 색을 선택하거나 검색 조건을 초기화해 보세요.</p><button class="button" data-reset-signals>전체 경기 보기</button></div>';
  else list=`<div class="tl-card-list">${visible.slice(0,limit).map(signalCardView).join('')}</div>${visible.length>limit?`<button class="button tl-more" data-more-signals>40경기 더 보기 · ${Math.min(limit,visible.length)}/${visible.length}</button>`:''}`;
  return `<section class="tl-page">
    <div class="tl-heading"><span class="eyebrow">ODDS TRAFFIC LIGHT</span><h1>배당 신호등 <span>${domestic?'전 종목':'축구 원본'}</span></h1><p>확률의 움직임을 읽는 세 가지 신호</p></div>
    <div class="tl-source-tabs" role="group" aria-label="신호 데이터 선택"><button data-signal-source="domestic" aria-pressed="${domestic}">국내 · 전 종목</button><button data-signal-source="colab" aria-pressed="${!domestic}">축구 · Colab 원본</button></div>
    <section class="tl-overview"><div class="tl-overview-top"><div><span>${domestic?'ALL SPORTS · SAME CONDITIONS':'COLAB ORIGINAL'}</span><h2>어느 방향으로 움직였을까?</h2><p>${domestic?'최초 관측':'초기'} → 현재 · 주 조건 5%p / 보조 조건 3%p</p></div><span class="tl-housing" aria-hidden="true">${dot('green')}${dot('yellow')}${dot('red')}</span></div><div class="tl-source-line"><span>${esc(sourceLabel)}${domestic&&payload?` · ${new Set(events.map(e=>e.eventId)).size}경기 / ${events.length}시장`:checked.length?` · ${events.length}경기`:''}</span><button data-refresh-signals ${loading?'disabled':''}>${loading?'연결 중…':'새로고침 ↻'}</button></div></section>
    ${sourceProblem?`<div class="tl-source-alert" role="status"><b>${events.length?'일부 날짜의 최신 수집을 확인하지 못했습니다.':domestic?'국내 배당 원본 연결을 확인해주세요.':'Nowgoal 원본 연결을 확인해주세요.'}</b><p>${esc(error||payload?.error||payload?.historyError||failures.map(d=>`${d.date}: ${d.error}`).join(' / '))}${events.length?' 이전 수집값에는 별도 표시가 붙습니다.':''}</p></div>`:''}
    <p class="tl-intro-note">색은 적중률 순위가 아니라, 확률 변화의 보조 조건 수를 뜻합니다.</p>
    ${domestic&&payload?.stale?'<p class="tl-stale" role="status">국내 배당이 2분 이상 경과했거나 수집 오류가 있습니다. 현재 신호로 단정하지 말고 수집 시각을 확인하세요.</p>':''}
    ${domestic?`<div class="tl-sport-tabs" role="group" aria-label="종목 필터"><button data-signal-sport="all" aria-pressed="${sport==='all'}">전체</button>${Object.entries(SIGNAL_SPORTS).map(([key,label])=>`<button data-signal-sport="${key}" aria-pressed="${sport===key}">${label}<small>${payload?.coverage?.[key]?.matches??0}경기</small></button>`).join('')}</div><p class="tl-caption">${sport==='all'?'전체':SIGNAL_SPORTS[sport]} · 배당 공개 대기 ${Object.entries(payload?.coverage||{}).filter(([key])=>sport==='all'||sport===key).reduce((sum,[,v])=>sum+v.waiting,0)}시장 · 값이 공개되면 자동 포함</p>`:''}
    ${signalGuideView(domestic)}
    <section class="tl-controls" aria-label="신호등 경기 필터"><div class="tl-color-filters" role="group" aria-label="신호 색 선택"><button data-signal-filter="all" aria-pressed="${filter==='all'}">전체 <b>${base.length}</b></button>${['green','yellow','red'].map(color=>`<button data-signal-filter="${color}" aria-pressed="${filter===color}">${dot(color)}${SIGNAL_LABELS[color]} <b>${counts[color]}</b></button>`).join('')}</div><div class="tl-minor-filters" role="group" aria-label="미판정 경기"><button data-signal-filter="none" aria-pressed="${filter==='none'}">신호 없음 ${counts.none}</button><button data-signal-filter="missing" aria-pressed="${filter==='missing'}">판정 보류 ${counts.missing}</button></div>
    <label class="tl-search"><span>팀·리그 검색</span><input id="signal-search" type="search" placeholder="팀 이름 또는 리그" value="${esc(search)}" autocomplete="off"></label><div class="tl-selects"><label>조회 날짜<select id="signal-date"><option value="all">${domestic?'전체 경기일':'오늘·내일 전체'}</option>${dates.map(d=>`<option value="${d}" ${date===d?'selected':''}>${d}</option>`).join('')}</select></label><label>리그<select id="signal-league"><option value="all">${domestic?'국내 리그 전체':'원본 리그 전체'}</option>${allLeagues.map(l=>`<option value="${esc(l)}" ${league===l?'selected':''}>${esc(l)}</option>`).join('')}</select></label></div>${domestic?`<div class="tl-selects"><label>시장<select id="signal-market"><option value="all">전체 시장</option>${[...new Set(events.filter(e=>sport==='all'||e.sport===sport).map(e=>e.market))].sort().map(m=>`<option value="${esc(m)}" ${market===m?'selected':''}>${esc(m)}</option>`).join('')}</select></label><label>진행 상태<select id="signal-phase"><option value="upcoming" ${phase==='upcoming'?'selected':''}>시작 전 경기</option><option value="all" ${phase==='all'?'selected':''}>시작·종료 포함</option></select></label></div>`:''}</section>
    <div class="tl-list-heading"><h2>${domestic?'시장별 신호':'경기 목록'} <span>${visible.length}</span></h2>${hasConditions?'<button data-reset-signals>조건 초기화</button>':'<span>경기 시각순 · KST</span>'}</div>
    ${list}
    ${domestic?domesticSourceView(payload):`<details class="tl-guide" data-disclosure="signal-source"><summary><span>데이터 출처와 수집 상태</span><span aria-hidden="true">＋</span></summary><div class="tl-guide-body"><p>Colab과 같은 Nowgoal 데이터 경로에서 한국 날짜 기준 오늘·내일을 조회합니다. 원본의 구 도메인 nowgoal.com에서 데이터가 제공되지 않아 새 공식 도메인 nowgoal.world로 연결합니다. 조회 조건과 확률 열, 신호 계산식은 그대로입니다. 화면이 열려 있으면 60초 간격으로 수집 상태를 확인합니다.</p><div class="tl-source-days">${days.map(d=>`<div><b>${esc(d.date)} · ${d.error?'연결 오류':d.fetchedAt?'수집 완료':'대기'}</b><span>${d.count}경기 · 마지막 성공 ${esc(stamp(d.fetchedAt))} KST</span>${d.error?`<small>${esc(d.error)}</small>`:''}${d.storageError?`<small>${esc(d.storageError)}</small>`:''}<a href="${esc(d.sourceUrl)}" target="_blank" rel="noopener noreferrer">원본 응답 ↗</a></div>`).join('')||'<p>아직 수집 기록이 없습니다.</p>'}</div><p>리그는 Colab의 ‘배트맨’ 고정 목록으로 제한합니다. 실제 베트맨 판매 경기 여부를 확인한 표시는 아닙니다. 오늘·예정의 국내 배당과 이 화면의 원본 확률은 별도 자료입니다.</p><p>경기 시각은 원본 설정대로 원시값을 UTC로 보고 KST로 변환합니다. 날짜 필터는 표시 날짜가 아닌 원본 조회 날짜입니다.</p><p class="tl-caption">원본 목록: ${ORIGINAL_LEAGUES.join(', ')}</p><a href="${COLAB_URL}" target="_blank" rel="noopener noreferrer">사용한 Colab 확인 ↗</a></div></details>`}
    ${domestic?'':calculatorView(state)}
  </section>`;
}

function domesticSourceView(payload){
  return `<details class="tl-guide" data-disclosure="signal-source"><summary><span>국내 전 종목 · 출처와 비교 기준</span><span aria-hidden="true">＋</span></summary><div class="tl-guide-body"><p><b>베트맨 공식 국내 배당</b> · 최근 관측 ${esc(stamp(payload?.fetchedAt))} KST</p><p>최초값은 앱이 처음 수집해 저장한 배당입니다. 실제 발매 최초 배당과 다를 수 있습니다. 동일 경기·회차·시장·기준점·선택지 구성일 때만 비교하고, 최초 관측 이력이 없거나 기준점이 달라지면 판정을 보류합니다.</p><p>일반·핸디캡·언오버 및 ①·⑤ 시장을 원본 선택지 명칭 그대로 구분합니다. 확률처럼 표시한 값은 배당 역수를 합계 100%로 환산한 비중이며, 예측확률이나 적중률이 아닙니다. 적특·동점 환불 등의 정산 확률은 포함하지 않습니다.</p><p>공식 수집은 기존 30초 주기를 유지하고 이 화면은 60초마다 저장된 결과를 확인합니다. 수집이 지연되면 이전 관측 시각과 상태를 함께 표시합니다.</p><a href="https://www.betman.co.kr/" target="_blank" rel="noopener noreferrer">베트맨 원본 ↗</a></div></details>`;
}
