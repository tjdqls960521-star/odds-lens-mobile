import {pickConditionKey} from './pick-policy.mjs?v=20261013-3';
import {analyzeSignal} from './traffic-light-core.mjs?v=20261014-2';
import {signalEntryView,signalsView} from './traffic-light-ui.mjs?v=20261014-4';
import {MARKET_PRESETS} from './market-reading-core.mjs?v=20261020-3';
import {marketReadingView} from './market-reading-ui.mjs?v=20261020-3';
import {cartSelectionNote} from './pick-ui.mjs?v=20261013-3';
import {chooseMarket,reviewToken,reviewState,toggleCompare,eventDayGroups} from './workbench-core.mjs?v=20261013-2';
import {scanControlsView,scanFixtureView,workbenchDockView} from './workbench-ui.mjs?v=20261013-2';
import {createWorkbench} from './workbench-controller.mjs?v=20261013-3';
import {hasQuoteChanges,latestEventChange} from './quote-history-core.mjs?v=20261013-1';
import {quoteMovementView,quoteMovementLabel,historyTriggerView,quoteHistoryDrawerView} from './odds-history-ui.mjs?v=20261013-1';
import {discoveryPanel,evidenceDrawerView} from './discovery-ui.mjs?v=20261005-3';
import {groupFeedEvents,formatKst,compareEvents} from './prediction-core.mjs?v=20261005-3';
import {validationView,evidenceView} from './prediction-ui.mjs?v=20261005-3';
import {patternDetailView,patternReferenceView,recommendationGrid,gradeGuide,sequenceGradeGuide,addPickButton,catalogView} from './pattern-ui.mjs?v=20261005-3';
import {analyzeExact,loadExactCatalog,loadEvidenceCases} from './analysis-client.mjs?v=20261005-3';
import {slipsView,draftSummary} from './slip-ui.mjs?v=20261005-3';
import {validStake,normalizePick,pickKey} from './slip-core.mjs?v=20261005-3';
import {
  canonicalMarket,
  distribution,
  feedFreshness,
  eventHasAvailableMarket,
  isTeamMarket,
  makeTarget,
  marketUsesLine,
  matchHistorical,
  outcomeLabels,
  queryLabel,
  resultIndex,
  selectedStats,
  teamPattern,
  teamUnderOverPattern
} from './live-core.mjs?v=20261005-3';

const routes=[
  ['today','◎','오늘·예정'],
  ['signals','◉','배당 신호등'],
  ['reading','⌁','배당 해석'],
  ['cart','▣','장바구니'],
  ['patterns','⊞','참고 패턴'],
  ['validation','✓','검증'],
  ['data','▱','데이터 연결'],
  ['method','◇','분석 기준']
];
const navPaths={today:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z', signals:'M8 2h8v20H8z M12 6h.01 M12 12h.01 M12 18h.01',reading:'M4 6h16 M4 12h10 M4 18h16 M17 9l3 3-3 3',cart:'M3 3h2l3 12h11l3-9H6 M9 20h.01 M18 20h.01',patterns:'M4 7h4l4 10 4-10h4 M3 20h18',validation:'M9 12l2 2 4-4 M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z',data:'M3 7c0-5 18-5 18 0s-18 5-18 0 M3 7v10c0 5 18 5 18 0V7 M3 12c0 5 18 5 18 0',method:'M4 4h7v16H4z M13 4h7v16h-7z',more:'M5 12h.01 M12 12h.01 M19 12h.01'};
const navIcon=id=>`<span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${navPaths[id]||navPaths.more}"/></svg></span>`;
const primaryRoutes=new Set(['today','signals','cart']);
const $=selector=>document.querySelector(selector);
const app=$('#app');
const SPORT_DATA={
  야구:{key:'baseball',manifestUrl:'data/manifest.json'},
  축구:{key:'soccer',manifestUrl:'data/v2/soccer/manifest.json'},
  농구:{key:'basketball',manifestUrl:'data/v2/basketball/manifest.json'},
  배구:{key:'volleyball',manifestUrl:'data/v2/volleyball/manifest.json'}
};
const EXCLUDED_MARKETS=new Set(['SUM','승5패','전반','전반_핸디캡','전반_언오버']);
const esc=value=>String(value??'—').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const number=value=>Number(value||0).toLocaleString('ko-KR');
const pct=value=>value===null||value===undefined?'—':`${(value*100).toFixed(1)}%`;
const price=value=>Number(value)>1?Number(value).toFixed(2):'—';
const shortDate=value=>/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(String(value??''))?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date(value)):String(value??'').slice(0,10);
const state={
  discoveryFocus:'all',discoveryMinimum:3,discoverySort:'agreement',recommendationGrade:'all',recommendationLimit:18,catalogScope:'league',catalogMode:'combo',catalogOffset:0,
  draft:{id:crypto.randomUUID(),stake:'',picks:[]},slips:[],slipError:'',slipSaving:false,slipLoading:false,slipLoaded:false,slipSources:{},slipCursor:null,
  historyDataVersion:{},
  highIncludeClosed:true,validationCursor:'',evidenceId:null,
  openDisclosures:new Set(),
  fixtureSearch:'',fixtureFilter:'all',fixtureSort:'time',fixtureFavorites:new Set(),
  fixtureView:'scan',fixtureLimit:40,reviewed:{},compareIds:[],compareBySport:{},compareLabels:{},
  route:'today',
  reading:{preset:'1X2',reference:[...MARKET_PRESETS['1X2'].reference],current:[...MARKET_PRESETS['1X2'].current],shares:[...MARKET_PRESETS['1X2'].shares],handle:100,outcome:0,estimate:'',lower:''},
  sport:'야구',
  manifest:null,
  manifests:{},
  feed:null,
  feedError:null,
  refreshStatus:null,
  refreshing:false,
  feedPreview:false,
  selected:null,
  detailReturnRoute:'today',
  mode:'combo',
  selectionSlot:0,
  liveDate:'all',
  liveLeague:'all',
  liveMarket:'all',
  historyLeague:'all',
  stage:'closing',
  tolerance:0,
  historyBase:{},
  history:{},
  historyPromise:{},
  historyCheckedAt:{},
  historyStatus:{},
  historyRefreshing:false,
  patterns:{},
  catalogFamily:'highSignalCatalog',
  catalogLeague:'all',
  catalogMarket:'all',
  catalogMinN:3,
  catalogStable:false,
  catalogSelected:null,
  sequence:0,
  feedSignature:null,
  renderedFreshnessKind:null,
  routeScroll:{},
  pendingRouteScroll:null,
  restoringScroll:false,
  scrollRestoreSequence:0
};
let feedRequest=null;
let feedRetryTimer=null;
let feedRetryFailures=0;
let historicalWarmRequest=null;
let nextHistoryWarmAt=0;
let scrollMemoryFrame=0;
const HISTORY_WARM_INTERVAL_MS=15*60*1000;
const sportKey=(sport=state.sport)=>SPORT_DATA[sport]?.key||'baseball';
const dataRoot=(manifest=state.manifest)=>manifest?.dataRoot||`data/${manifest?.snapshot||''}`;

function metric(label,value,detail=''){
  return `<div class="card metric"><div class="metric-label">${esc(label)}</div><strong>${esc(value)}</strong><small>${esc(detail)}</small></div>`;
}

function heading(eyebrow,title,description,actions=''){
  return `<div class="page-heading"><div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1><p>${esc(description)}</p></div>${actions}</div>`;
}

function empty(title,description,action=''){
  return `<section class="card empty"><div class="empty-mark">◎</div><h2>${esc(title)}</h2><p>${esc(description)}</p>${action}</section>`;
}

function json(url,options={}){
  return fetch(url,{cache:/api\/|live\//.test(url)?'no-store':'default',...options}).then(response=>{
    if(!response.ok)throw new Error(`데이터 응답 오류 (${response.status})`);
    return response.json();
  });
}

async function officialJson(url){
  let lastError;
  for(let attempt=0;attempt<2;attempt++){
    const controller=new AbortController();
    // An empty cache needs the first full official collection, which can take
    // longer than an ordinary read of the saved feed.
    const timeout=setTimeout(()=>controller.abort(),state.feed?.fetchedAt?12000:70000);
    try{return await json(url,{signal:controller.signal});}
    catch(error){lastError=error;}
    finally{clearTimeout(timeout);}
    if(attempt===0)await new Promise(resolve=>setTimeout(resolve,700));
  }
  throw lastError;
}

function unpack(rows,fields=state.manifest?.fields||[]){
  return rows.map(row=>Object.fromEntries(fields.map((field,index)=>[field,row[index]])));
}

function canonicalSport(value){
  const key=String(value??'').trim().toLowerCase();
  return {baseball:'야구',soccer:'축구',football:'축구',basketball:'농구',volleyball:'배구'}[key]||String(value??'').trim();
}

function feedEvents(){
  return groupFeedEvents(Array.isArray(state.feed?.events)?state.feed.events:[])
    .map(event=>({...event,markets:event.markets.filter(m=>m.period!=='first_half'&&!EXCLUDED_MARKETS.has(canonicalMarket(m.market,m.marketLabel)))}))
    .filter(event=>event.markets.length);
}

function selectionSignalKey(eventId,marketId,slot){
  return `${String(eventId)}\u0000${String(marketId)}\u0000${Number(slot)}`;
}

function marketSignalKey(eventId,marketId){
  return `${String(eventId)}\u0000${String(marketId)}`;
}

function currentScrollPosition(){
  if(typeof window==='undefined')return {x:0,y:0};
  const root=document.scrollingElement||document.documentElement;
  return {x:window.scrollX||root.scrollLeft||0,y:window.scrollY||root.scrollTop||0};
}

function visibleScrollAnchor(){
  if(typeof window==='undefined')return null;
  const reference=Math.min(Math.max(16,window.innerHeight*.18),180);
  let closest=null;
  for(const element of document.querySelectorAll('[data-scroll-key]')){
    const rect=element.getBoundingClientRect();
    if(rect.bottom<0||rect.top>window.innerHeight)continue;
    const distance=Math.abs(rect.top-reference);
    if(!closest||distance<closest.distance)closest={key:element.dataset.scrollKey,top:rect.top,distance};
  }
  return closest?{key:closest.key,top:closest.top}:null;
}

function captureScrollSnapshot(){
  if(typeof window==='undefined')return null;
  return {...currentScrollPosition(),anchor:visibleScrollAnchor()};
}

function scrollAnchorByKey(key){
  if(!key||typeof document==='undefined')return null;
  return [...document.querySelectorAll('[data-scroll-key]')].find(element=>element.dataset.scrollKey===key)||null;
}

function restoreScrollSnapshot(snapshot,sequence,route){
  if(!snapshot||typeof window==='undefined')return;
  const frame=typeof window.requestAnimationFrame==='function'?window.requestAnimationFrame.bind(window):callback=>setTimeout(callback,0);
  state.restoringScroll=true;
  state.scrollRestoreSequence=sequence;
  const finish=()=>{
    if(state.scrollRestoreSequence===sequence)state.restoringScroll=false;
  };
  const apply=()=>{
    if(sequence!==state.sequence||route!==state.route){finish();return false;}
    window.scrollTo(snapshot.x||0,snapshot.y||0);
    const anchor=scrollAnchorByKey(snapshot.anchor?.key);
    if(anchor){
      const offset=anchor.getBoundingClientRect().top-snapshot.anchor.top;
      if(Math.abs(offset)>.5)window.scrollBy(0,offset);
    }
    return true;
  };
  if(!apply())return;
  frame(()=>{
    if(!apply())return;
    frame(()=>{apply();finish();});
  });
}

function rememberRouteScroll(route=state.route){
  if(state.restoringScroll||typeof window==='undefined')return;
  state.routeScroll[route]=captureScrollSnapshot();
}

function scheduleRouteScrollMemory(){
  if(state.restoringScroll||scrollMemoryFrame||typeof window==='undefined')return;
  const frame=typeof window.requestAnimationFrame==='function'?window.requestAnimationFrame.bind(window):callback=>setTimeout(callback,0);
  scrollMemoryFrame=frame(()=>{
    scrollMemoryFrame=0;
    if(!state.restoringScroll)rememberRouteScroll();
  });
}

function normalizeFeed(payload){
  if(!payload||typeof payload!=='object'||!Array.isArray(payload.events))throw new Error('events 배열이 있는 승인된 소스 JSON이 필요합니다.');
  const events=payload.events.filter(event=>event&&typeof event==='object'&&Array.isArray(event.markets));
  if(events.length!==payload.events.length)throw new Error('일부 경기의 시장 구조가 올바르지 않습니다.');
  return {...payload,events};
}

function freshness(){
  if(state.feedError||state.refreshStatus?.error)return {kind:'stale',label:'공식 조회 실패 · 이전 값'};
  if(state.feed?.partial)return {kind:'stale',label:'공식 일정 일부 확인 대기'};
  return feedFreshness(state.feed);
}

function predictionsReady(){
  return freshness().kind==='live'&&!state.feedError&&!state.refreshStatus?.error&&state.refreshStatus?.ledgerVersion===3&&!state.refreshStatus?.ledgerError;
}

function sourceName(){
  return state.feedPreview?'이 기기의 미리보기':String(state.feed?.provider||'승인된 소스');
}

function formatDateTime(value){return formatKst(value);}

function sourcePanel(){
  const status=freshness();
  if(!state.feed?.fetchedAt){
    return `<section class="card source-state"><div class="source-state-copy"><span class="source-dot pending"></span><div><div class="eyebrow">BETMAN OFFICIAL</div><h2>베트맨 공식 배당 연결 대기</h2><p>로그인 없이 공개된 베트맨 경기표를 서버에서 직접 조회합니다. 확인된 국내 배당만 표시합니다.</p>${state.refreshStatus?.error?`<p class="refresh-error" role="alert">${esc(state.refreshStatus.error)}</p>`:state.feedError?`<p class="caption">${esc(state.feedError.message)}</p>`:''}</div></div><div class="source-actions"><button class="button primary" data-reload-feed ${state.refreshing?'disabled':''}>${state.refreshing?'공식 조회 중…':'공식 배당 다시 조회'}</button></div></section>`;
  }
  return `<section class="card source-state ${status.kind}"><div class="source-state-copy"><span class="source-dot ${esc(status.kind)}"></span><div><div class="eyebrow">BETMAN OFFICIAL · DOMESTIC ODDS</div><h2>${esc(sourceName())} · ${esc(status.label)}</h2><p>공식 조회 ${esc(formatDateTime(state.feed.fetchedAt))} · 원천 가격 변경시각 미제공 · 회차 ${esc(state.feed.round||'발매 대기')} · ${number(feedEvents().length)}경기${state.feed.unidentifiedMarkets?" · 대진 미정 "+number(state.feed.unidentifiedMarkets)+"개 판매 항목 보류":""}</p></div></div><div class="source-actions"><button class="button" data-reload-feed ${state.refreshing?'disabled':''}>${state.refreshing?'공식 조회 중…':'공식 배당 지금 갱신'}</button><a class="button" href="https://www.betman.co.kr/" target="_blank" rel="noopener">베트맨 원본 ↗</a></div>${state.refreshStatus?.error?`<p class="refresh-error" role="alert">${esc(state.refreshStatus.error)} · 마지막 공식 조회값이며 새 예측은 보류됩니다.</p>`:''}${state.feed.status?.teamNamesVerified===false?'<p class="refresh-error" role="status">베트맨 모바일 공식 경로로 조회했습니다. 팀명이 별칭일 수 있어 팀별 과거 대조는 보류합니다.</p>':''}<p class="caption">화면을 열면 베트맨 공식 값을 직접 조회하고, 열린 화면에서 30초마다 확인합니다. 경기별 번호로 원본을 대조할 수 있습니다. 배당 미발표·발매 중지 경기는 과거 대조에서 제외합니다. 발매 종료라도 시작 전이고 마지막 공식 배당이 있으면 통계 신호에 포함합니다.</p></section>`;
}

function eventDates(events){
  const sourceDay=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
  return [...new Set(events.map(event=>shortDate(event.startsAt)).filter(day=>day&&(!sourceDay||day>=sourceDay)))].sort();
}

function liveLeagues(events){
  return [...new Set([...events.map(event=>event.league).filter(Boolean),...(state.sport==='야구'?['MLB']:[])])].sort((a,b)=>a.localeCompare(b,'ko'));
}

function liveMarkets(events){
  const byKey=new Map();
  for(const event of events){
    for(const market of event.markets){
      const key=canonicalMarket(market.market,market.marketLabel);
      if(key&&!byKey.has(key))byKey.set(key,market.marketLabel||key);
    }
  }
  return [...byKey].sort((a,b)=>a[1].localeCompare(b[1],'ko')).map(([key,label])=>({key,label}));
}

function optionList(values,current,allLabel){
  return `<option value="all">${esc(allLabel)}</option>${values.map(value=>`<option value="${esc(value)}" ${value===current?'selected':''}>${esc(value)}</option>`).join('')}`;
}

function marketOptionList(values,current,allLabel){
  return `<option value="all">${esc(allLabel)}</option>${values.map(({key,label})=>`<option value="${esc(key)}" ${key===current?'selected':''}>${esc(label)}</option>`).join('')}`;
}

function filteredEvents({focus=true,market=true}={}){
  return feedEvents().filter(event=>{
    if(event.sport&&canonicalSport(event.sport)!==state.sport)return false;
    const sourceDay=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
    if(shortDate(event.startsAt)<sourceDay)return false;
    if(state.liveDate!=='all'&&shortDate(event.startsAt)!==state.liveDate)return false;
    if(state.liveLeague!=='all'&&event.league!==state.liveLeague)return false;
    if(market&&state.liveMarket!=='all'&&!event.markets.some(market=>canonicalMarket(market.market,market.marketLabel)===state.liveMarket))return false;
    if((state.route==='today')){
      const query=state.fixtureSearch.normalize('NFKC').toLowerCase().replace(/\s+/g,'');
      if(query&&!`${event.home} ${event.away} ${event.league}`.normalize('NFKC').toLowerCase().replace(/\s+/g,'').includes(query))return false;
      if(focus&&state.route==='today'&&state.fixtureFilter==='changed'&&!event.markets.some(m=>(state.liveMarket==='all'||canonicalMarket(m.market,m.marketLabel)===state.liveMarket)&&hasQuoteChanges(m)))return false;
      if(focus&&state.route==='today'&&state.fixtureFilter==='favorites'&&!state.fixtureFavorites.has(String(event.id)))return false;
      if(focus&&state.route==='today'&&state.fixtureFilter==='unreviewed'&&reviewState(event,state.reviewed)==='reviewed')return false;
    }
    return true;
  }).sort(state.route==='today'&&state.fixtureSort==='changes'?(a,b)=>latestEventChange(b)-latestEventChange(a)||compareEvents(a,b):compareEvents);
}

function isAvailableEvent(event,now=Date.now()){
  return eventHasAvailableMarket(event,now);
}

function isFutureEvent(event,now=Date.now()){
  const startsAt=Date.parse(event?.startsAt);
  return Number.isFinite(startsAt)&&startsAt>now;
}

function fixturePhaseSignature(events=filteredEvents(),now=Date.now()){
  return events.map(event=>`${event.id}:${isFutureEvent(event,now)?'upcoming':'started'}`).join('|');
}

function marketRow(event,market,patternSignals,confidence=null){
  const scrollKey=`market:${esc(event.id)}:${esc(market.id)}`;
  if(!market.outcomes?.length)return `<div class="market-row" data-scroll-key="${scrollKey}"><div class="market-info"><b>${esc(market.marketLabel||market.market)}</b><small>베트맨 #${esc(market.gameNumber)} · ${esc(market.round)}회차</small></div><p class="muted">${esc(market.pending?'공식 배당 발표 대기':market.status||'공식 배당 없음')}</p></div>`;
  const labels=outcomeLabels(market.market);
  const outcomes=Array.isArray(market.outcomes)?market.outcomes:[];
  const slots=outcomes.length===2?[0,2]:outcomes.length===3?[0,1,2]:[];
  const sourceSelected=state.selected?.eventId===String(event.id)&&state.selected?.marketId===String(market.id);
  const marketSignal=patternSignals?.markets?.get(marketSignalKey(event.id,market.id));
  const gradeBits=marketSignal?[marketSignal.priority?`A ${number(marketSignal.priority)}`:'',marketSignal.explore?`B ${number(marketSignal.explore)}`:'',marketSignal.review?`C ${number(marketSignal.review)}`:''].filter(Boolean):[];
  const marketBadge=marketSignal?`<span class="market-signal-count">${gradeBits.join(' · ')||`신호 ${number(marketSignal.selectionCount)}`}</span>`:'';
  const marketLabel=marketSignal?`정확한 배당의 통계 추천 ${number(marketSignal.selectionCount)}개, 동일 팀·리그·종목 근거 ${number(marketSignal.supportCount)}개`:'';
  const showModel=false;
  return `<div class="market-row ${sourceSelected?'selected':''}" data-scroll-key="${scrollKey}"><div class="market-info"><b>${esc(market.marketLabel||market.market)}</b>${market.line!==null&&market.line!==undefined&&market.line!==''?`<span>${esc(market.line)}</span>`:''}<small>베트맨 #${esc(market.gameNumber)} · ${esc(market.round)}회차</small>${market.available===false?`<small>${esc(market.status)}</small>`:''}</div><div class="odds-pills">${outcomes.map((outcome,index)=>{const slot=slots[index];const label=outcome.label||labels[slot]||`선택 ${index+1}`;const signal=patternSignals?.selections?.get(selectionSignalKey(event.id,market.id,slot));const scopeLabels=signal?.scopeSummary?.filter(scope=>scope.support).map(scope=>scope.label).join(' · ')||'';const signalLabel=signal?` · ${signal.label}, ${scopeLabels||`${number(signal.supportGroups)}개 범위`}`:'';const signalBadge=signal?`<span class="pattern-signal-count signal-${esc(signal.grade)}"><b>${esc(signal.code)}</b><span>${scopeLabels||`${number(signal.supportGroups)}범위`}</span></span>`:'';const modelProbability=showModel?market.prediction?.p_model?.[index]:null;const modelLabel=Number.isFinite(modelProbability)?` · 시간순 M1 ${pct(modelProbability)}`:'';const modelBadge=Number.isFinite(modelProbability)?`<small class="model-probability">M1 ${pct(modelProbability)}</small>`:'';const confidenceMatch=showModel&&confidence&&confidence.marketId===String(market.id)&&confidence.index===index;const confidenceBadge=confidenceMatch?`<small class="model-confidence tier-${esc(confidence.tier.id)}">${esc(confidence.tier.label)}</small>`:'';return `<div class="quote-with-add"><button class="odds-pill side-${slot} ${sourceSelected&&state.mode==='outcome'&&state.selectionSlot===slot?'active':''} ${confidenceMatch?'confidence-selected':''}" data-select-odds data-event-id="${esc(event.id)}" data-market-id="${esc(market.id)}" data-slot="${slot}" title="${esc(label)}만 과거에서 보기" aria-label="${esc(`${label} ${price(outcome.odds)}배${quoteMovementLabel(market,outcome)}${signalLabel}${modelLabel}${confidenceMatch?` · ${confidence.tier.label}`:''}`)}"><span>${esc(label)}</span><b>${price(outcome.odds)}</b>${quoteMovementView(market,outcome)}${confidenceBadge}${modelBadge}${signalBadge}</button>${addPickButton(event,market,slot)}</div>`;}).join('')}</div><button class="combo-link ${sourceSelected&&state.mode==='combo'?'active':''}" data-select-market data-event-id="${esc(event.id)}" data-market-id="${esc(market.id)}" ${marketLabel?`aria-label="조합 전체 · ${esc(marketLabel)}"`:''}>조합 전체${marketBadge}</button>${historyTriggerView(event,market)}</div>`;
}

function patternStrip(rows,target){
  const cases=rows.slice(0,24).reverse();
  return `<section class="card pattern-strip"><div class="card-head"><div><div class="eyebrow">RESULT SEQUENCE</div><h2>한눈에 보는 결과 패턴</h2></div><div class="result-legend">${outcomeLabels(target.market).map((label,i)=>`<span class="chip outcome-${i}">${esc(label)}</span>`).join('')}<span class="chip outcome-unknown">미확인</span></div></div><div class="sequence-track">${cases.map(row=>`<span class="sequence-cell outcome-${resultIndex(row)??'unknown'}" title="${esc(row.date)} · ${esc(row.home)} vs ${esc(row.away)} · ${esc(outcomeResult(row,target))}">${resultIndex(row)===null?'?':esc(outcomeLabels(target.market)[resultIndex(row)])}</span>`).join('')||'<p>일치 사례 없음</p>'}</div><div class="sequence-axis"><span>과거 →</span><span>최근 ${cases.length}건 · 최신</span></div></section>`;
}

function fixtureCard(event,patternSignals,confidenceByEvent=new Map()){
  const order=['일반','핸디캡','언오버'];
  const markets=event.markets.filter(market=>(state.liveMarket==='all'||canonicalMarket(market.market,market.marketLabel)===state.liveMarket)&&(state.fixtureFilter!=='changed'||hasQuoteChanges(market))).sort((a,b)=>order.indexOf(a.market)-order.indexOf(b.market));
  const confidence=confidenceByEvent.get(String(event.id))||null;
  const visibleConfidence=confidence&&markets.some(market=>String(market.id)===confidence.marketId);
  return `<article class="fixture-card ${visibleConfidence?'has-confidence':''}" data-scroll-key="event:${esc(event.id)}"><div class="fixture-top"><div><span class="fixture-league">${esc(event.league||'리그 미표기')}</span><span class="fixture-time">${esc(formatDateTime(event.startsAt))}</span></div><div class="fixture-status-chips"><button class="fixture-favorite" data-toggle-fixture-favorite="${esc(event.id)}" aria-pressed="${state.fixtureFavorites.has(String(event.id))}" aria-label="${esc(event.home+' 대 '+event.away)} ${state.fixtureFavorites.has(String(event.id))?'관심 경기 해제':'관심 경기 저장'}">${state.fixtureFavorites.has(String(event.id))?'★':'☆'}</button>${visibleConfidence?`<span class="chip ${confidence.tier.id==='top'?'confidence-top':'confidence-high'}">${esc(confidence.tier.label)}</span>`:''}<span class="chip ${String(event.status||'').toLowerCase().includes('sale')?'green':'amber'}">${esc(event.status||'상태 미제공')}</span></div></div><div class="fixture-teams"><strong>${esc(event.home)}</strong><span>vs</span><strong>${esc(event.away)}</strong></div><div class="fixture-markets">${markets.length?markets.map(market=>marketRow(event,market,patternSignals,confidence)).join(''):'<p class="muted">선택한 시장이 없습니다.</p>'}</div></article>`;
}

const exactCache=new Map();
async function exactGroups(){
  const sport=state.sport,key=sportKey(sport),events=feedEvents().filter(event=>canonicalSport(event.sport)===sport&&isFutureEvent(event)),signature=state.feedSignature||JSON.stringify(events);
  const rows=await historyRows();
  const cache=exactCache.get(key);
  if(cache?.signature===signature&&cache.rows===rows)return cache.promise;
  const items=events.flatMap(event=>event.markets.filter(market=>[2,3].includes(market.outcomes?.length)&&!market.pending&&market.saleStatus!=='suspended').map(market=>({event,market})));
  const promise=analyzeExact(key,rows,items).then(patterns=>{
    const grouped=new Map();items.forEach(({event,market},i)=>{if(!grouped.has(event.id))grouped.set(event.id,{event,markets:[]});grouped.get(event.id).markets.push({market,pattern:patterns[i]});});
    return [...grouped.values()];
  });
  exactCache.set(key,{signature,rows,promise});return promise;
}
function visibleGroups(groups){
  const ids=new Set(filteredEvents().map(e=>e.id));
  return groups.filter(g=>ids.has(g.event.id)&&isFutureEvent(g.event)).map(g=>({...g,markets:g.markets.filter(({market})=>(state.liveMarket==='all'||market.market===state.liveMarket)&&(state.highIncludeClosed||market.available!==false))})).filter(g=>g.markets.length);
}
// Price rows render immediately; historical analysis fills in once per source version.
let scanAnalysis=null;
function analysisContext(){return `${state.sport}:${state.feedSignature}:${state.historyDataVersion[sportKey()]||''}`;}
function canShowStatistics(){return freshness().kind==='live'&&!state.feedError&&!state.refreshStatus?.error&&!state.feedPreview;}
function ensureScanAnalysis(){
  const context=analysisContext();
  if(scanAnalysis?.context===context&&(scanAnalysis.loading||scanAnalysis.ready||Date.now()<scanAnalysis.retryAt))return scanAnalysis;
  const entry={context,sport:state.sport,signature:state.feedSignature,groups:[],loading:true,ready:false,retryAt:0,promise:null};
  scanAnalysis=entry;
  entry.promise=exactGroups().then(groups=>{
    entry.groups=groups;entry.loading=false;entry.ready=true;
    if(entry.sport===state.sport&&entry.signature===state.feedSignature){
      entry.context=analysisContext();
      if((state.route==='today'))void render({preserveScroll:true});
    }
    return entry;
  }).catch(()=>{
    entry.loading=false;entry.error=true;entry.retryAt=Date.now()+60000;
    if(scanAnalysis===entry&&(state.route==='today'))void render({preserveScroll:true});
    return entry;
  });
  return entry;
}
function scanAnalysisForSheet(sport){
  if(sport!==state.sport||!canShowStatistics())return null;
  return ensureScanAnalysis();
}
function statisticsSignals(groups){
  const selections=new Map(),markets=new Map();
  for(const {event,markets:items} of groups)for(const {market,pattern} of items)for(const rec of pattern.recommendations||[]){
    selections.set(selectionSignalKey(event.id,market.id,rec.slot),{grade:rec.grade,code:rec.grade+'등급',label:'배당통계 추천 '+rec.grade,scopeSummary:[['sport','종목'],['league','리그'],['team','팀']].map(([key,label])=>({label,support:rec.evidence.some(e=>key==='team'?['homeTeam','awayTeam'].includes(e.scope):e.scope===key)})),supportGroups:rec.scopeCount});
    const k=marketSignalKey(event.id,market.id),item=markets.get(k)||{supportCount:0,selectionCount:0,priority:0,explore:0,review:0};
    item.supportCount+=rec.scopeCount;item.selectionCount++;item[{A:'priority',B:'explore',C:'review'}[rec.grade]]++;markets.set(k,item);
  }
  return {selections,markets};
}
function discoveryOptions(groups,extra={}){return {groups,filtersOpen:state.openDisclosures.has(`${state.route}:recommendation-filters`),focus:state.discoveryFocus,minimum:state.discoveryMinimum,grade:state.recommendationGrade,sort:state.discoverySort,limit:state.recommendationLimit,ready:freshness().kind==='live'&&!state.feedError&&!state.refreshStatus?.error&&!state.feedPreview,...extra};}
function liveControls(events){return `<div class="filters live-filters discovery-live-filters"><label>날짜<select id="live-date" aria-label="경기 날짜">${optionList(eventDates(events),state.liveDate,'모든 예정일')}</select></label><label>리그<select id="live-league" aria-label="리그">${optionList(liveLeagues(events),state.liveLeague,'모든 리그')}</select></label><label>시장<select id="live-market" aria-label="시장">${marketOptionList(liveMarkets(events),state.liveMarket,'모든 시장')}</select></label></div>`;}
function compactSource(){
  const status=freshness(),problem=state.refreshStatus?.error||state.feedError?.message,historyProblem=state.refreshStatus?.quoteHistoryError;
  return `<div class="compact-source ${status.kind}" data-scroll-key="source-status"><div><b>베트맨 공식 · 국내 배당</b><span>${esc(status.label)}${state.feed?.fetchedAt?' · '+esc(formatDateTime(state.feed.fetchedAt)):''}</span></div><button class="button" data-reload-feed ${state.refreshing?'disabled':''}>${state.refreshing?'갱신 중':'갱신'}</button></div>${problem?`<p class="source-alert" role="alert">${esc(problem)} · 이전 값 확인 중, 새 추천은 보류합니다.</p>`:''}${historyProblem?'<p class="source-alert" role="status">배당 이력 저장소를 확인하지 못했습니다. 현재 배당과 저장된 이력은 다를 수 있습니다.</p>':''}<details class="source-disclosure" data-disclosure="source"><summary>출처 상세</summary>${sourcePanel()}</details>`;
}
async function today(){
  const events=feedEvents().filter(event=>canonicalSport(event.sport)===state.sport),visible=filteredEvents();
  const analysis=events.length?ensureScanAnalysis():null,canRecommend=canShowStatistics();
  const groups=canRecommend&&analysis?.ready?visibleGroups(analysis.groups):[],loading=!!analysis?.loading;
  const patterns=new Map(groups.flatMap(g=>g.markets.map(({market,pattern})=>[market.id,pattern]))),signals=statisticsSignals(groups);
  let html=heading('MATCH WORKSPACE','오늘·예정 경기','배당을 눌러 상세 확인 · 관심 경기 비교');
  html+=compactSource()+scanControlsView(filteredEvents({focus:false,market:false}),{search:state.fixtureSearch,filter:state.fixtureFilter,market:state.liveMarket,league:state.liveLeague,date:state.liveDate,favorites:state.fixtureFavorites,reviewed:state.reviewed,density:state.fixtureView});
  html+=signalEntryView();
  html+=`<details class="fixture-recommendations" data-disclosure="today-recommendations" ${state.openDisclosures.has('today:today-recommendations')?'open':''}><summary>과거 통계에서 후보 찾기</summary>${discoveryPanel(discoveryOptions(groups,{loading,jump:true}))}</details>`;
  if(analysis?.error)html+='<p class="source-alert" role="status">과거 기록을 불러오지 못했습니다. <button class="button" data-retry-bench-analysis>통계 다시 불러오기</button></p>';
  if(!events.length)return html+empty('현재 경기 데이터가 없습니다.','공식 경기표 수집 후 표시됩니다.');
  const now=Date.now(),upcoming=visible.filter(event=>isFutureEvent(event,now)),started=visible.filter(event=>!isFutureEvent(event,now));
  state.renderedFixturePhase=fixturePhaseSignature(visible,now);
  if(!visible.length)return html+empty(state.fixtureFilter==='favorites'?'조건에 맞는 관심 경기가 없습니다.':state.fixtureFilter==='changed'?'기록된 배당 변경이 없습니다.':state.fixtureFilter==='unreviewed'?'선택한 조건의 경기를 모두 확인했습니다.':'조건에 맞는 경기가 없습니다.','날짜·리그·시장 또는 검색 조건을 바꿔보세요.','<button class="button" data-reset-fixtures>전체 경기 보기</button>');
  const card=event=>{
    if(state.fixtureView==='expanded')return fixtureCard(event,signals).replace('</article>',`<div class="bench-fixture-actions"><button data-open-bench-fixture data-event-id="${esc(event.id)}" data-market-id="${esc(chooseMarket(event,state.liveMarket)?.id||'')}">빠른 분석</button><button data-bench-compare="${esc(event.id)}" aria-pressed="${state.compareIds.includes(String(event.id))}">${state.compareIds.includes(String(event.id))?'✓ 비교 선택':'비교에 추가'}</button></div></article>`);
    const market=chooseMarket(state.fixtureFilter==='changed'?{markets:event.markets.filter(hasQuoteChanges)}:event,state.liveMarket);
    return scanFixtureView(event,{marketType:state.liveMarket,marketId:market?.id,pattern:patterns.get(market?.id),loading:analysis?.error?'error':loading&&canRecommend,favorite:state.fixtureFavorites.has(String(event.id)),compared:state.compareIds.includes(String(event.id)),reviewed:state.reviewed});
  };
  const list=(items,phase)=>{
    const shown=items.slice(0,state.fixtureLimit),batches=state.fixtureSort==='changes'?[{day:null,events:shown}]:eventDayGroups(shown);
    return batches.map(batch=>`${batch.day?`<h3 class="bench-day-heading">${esc(batch.day)} <span>KST</span></h3>`:''}<section class="${state.fixtureView==='scan'?'bench-list':'fixture-grid'}" data-fixture-group="${phase}">${batch.events.map(card).join('')}</section>`).join('')+(shown.length<items.length?`<button class="button bench-more" data-more-bench-fixtures>${Math.min(40,items.length-shown.length)}경기 더 보기 · ${shown.length}/${items.length}</button>`:'');
  };
  html+=`<div class="fixture-section-heading bench-section"><h2 id="upcoming-fixtures">시작 전 <span>${upcoming.length}경기</span></h2><p>${state.fixtureSort==='changes'?'최근 변경순':'시작시간순'} · 화살표는 최초 기록 대비 변동</p></div>`;
  html+=upcoming.length?list(upcoming,'upcoming'):'<p class="muted">선택한 조건에 시작 전 경기가 없습니다.</p>';
  if(started.length)html+=`<details class="bench-started" data-disclosure="started-fixtures"><summary>시작·종료 ${started.length}경기 · 참고용</summary>${list(started,'started')}</details>`;
  html+='<p class="bench-help">최초 기록은 앱이 처음 수집한 배당입니다. 경기 상세를 열면 확인함으로 표시하고, 배당·기준점·상태가 바뀌면 다시 미확인 대상에 포함합니다.</p>';
  return html;
}
const signalState={source:'domestic',sport:'all',market:'all',phase:'upcoming',payload:null,loading:false,error:'',filter:'all',search:'',date:'all',league:'all',limit:40,lastAttempt:0,calculatorValues:[],calculatorResult:null,calculatorError:''};
let signalRequest=null,signalSequence=0;
async function loadSignals({force=false}={}){
  if(signalRequest?.source===signalState.source)return signalRequest.promise;
  if(!force&&signalState.lastAttempt&&Date.now()-signalState.lastAttempt<60000)return;
  signalRequest?.controller.abort();
  const sequence=++signalSequence,source=signalState.source,controller=new AbortController();
  signalState.loading=true;signalState.error='';signalState.lastAttempt=Date.now();
  if(state.route==='signals')void render({preserveScroll:true});
  const promise=(async()=>{
    const timeout=setTimeout(()=>controller.abort(),25000);
    try{
      const endpoint=source==='domestic'?'api/signals/domestic':'api/signals';
      const payload=await json(`${endpoint}?${force?'refresh=1&':''}ts=${Date.now()}`,{signal:controller.signal});
      if(sequence!==signalSequence)return;
      signalState.payload=payload;
      if(signalState.date!=='all'&&!payload.dates.includes(signalState.date))signalState.date='all';
    }catch(error){if(sequence===signalSequence)signalState.error=error.name==='AbortError'?'연결이 지연되었습니다. 다시 연결해주세요.':error.message;}
    finally{clearTimeout(timeout);if(sequence===signalSequence){signalState.loading=false;signalRequest=null;if(state.route==='signals')void render({preserveScroll:true});}}
  })();
  signalRequest={source,controller,promise};return promise;
}

function findMarket(){
  if(!state.selected)return null;
  const event=feedEvents().find(item=>String(item.id)===String(state.selected.eventId));
  const market=event?.markets.find(item=>String(item.id)===String(state.selected.marketId));
  return event&&market?{event,market}:null;
}

const crossSportRow=(key,row)=>key==='soccer'&&row.league==='NPB'||key==='basketball'&&row.league==='축월드컵';

async function baseHistoryRows(key,manifest){
  if(state.historyBase[key])return state.historyBase[key];
  const years=Object.keys(manifest.years||{}).sort();
  const groups=await Promise.all(years.map(year=>json(`${dataRoot(manifest)}/${year}.json`).then(rows=>unpack(rows,manifest.fields))));
  state.historyBase[key]=groups.flat().filter(row=>!EXCLUDED_MARKETS.has(canonicalMarket(row.market))&&!crossSportRow(key,row));
  return state.historyBase[key];
}

function mergeHistoryRows(base,patch,key){
  const rows=new Map(base.map(row=>[row.id,row]));
  for(const row of patch)rows.set(row.id,row);
  return [...rows.values()].filter(row=>!crossSportRow(key,row)).sort((left,right)=>String(left.date).localeCompare(String(right.date))||String(left.id).localeCompare(String(right.id)));
}

async function historyRows({force=false}={}){
  const key=sportKey(),manifest=state.manifest;
  if(!manifest)throw Error('선택한 종목의 과거 원본 정보를 찾지 못했습니다.');
  const checkedAt=state.historyCheckedAt[key]||0;
  if(state.history[key]&&!force&&Date.now()-checkedAt<60000)return state.history[key];
  if(state.historyPromise[key])return state.historyPromise[key];
  state.historyPromise[key]=(async()=>{
    const basePromise=baseHistoryRows(key,manifest);
    let payload=null;
    try{
      payload=await json(`api/history/${key}/current.json?ts=${Date.now()}`);
      state.historyStatus[key]=payload.refreshState||null;
    }catch(error){
      state.historyStatus[key]={error:error.message};
    }
    const base=await basePromise;
    const patch=(Array.isArray(payload?.rows)?unpack(payload.rows,payload.fields||manifest.fields):[]).filter(row=>!EXCLUDED_MARKETS.has(canonicalMarket(row.market)));
    const version=payload?.refreshState?.sourceVersion||JSON.stringify(payload?.rows||[]);
    if(!state.history[key]||state.historyDataVersion[key]!==version){state.history[key]=mergeHistoryRows(base,patch,key);state.historyDataVersion[key]=version;delete state.patterns[key];}
    state.historyCheckedAt[key]=Date.now();
    return state.history[key];
  })();
  try{return await state.historyPromise[key];}finally{delete state.historyPromise[key];}
}

async function warmHistoricalSources(){
  if(historicalWarmRequest)return historicalWarmRequest;
  if(Date.now()<nextHistoryWarmAt)return false;
  nextHistoryWarmAt=Date.now()+HISTORY_WARM_INTERVAL_MS;
  historicalWarmRequest=(async()=>{
    const summaries=await Promise.all(Object.values(SPORT_DATA).map(async({key})=>{
      try{return [key,await json(`api/history/${key}/current.json?summary=1&ts=${Date.now()}`)];}
      catch(error){return [key,{sport:key,error:error.message}];}
    }));
    let sourceChanged=false;
    for(const [key,summary] of summaries){
      const previous=state.historyStatus[key];
      const changed=Boolean(state.history[key]&&summary?.sourceVersion&&(!previous?.sourceVersion||previous.sourceVersion!==summary.sourceVersion));
      state.historyStatus[key]=summary;
      if(changed){
        delete state.history[key];
        state.historyCheckedAt[key]=0;
        delete state.patterns[key];
        sourceChanged=true;
      }
    }
    if(summaries.every(([,summary])=>summary?.error))nextHistoryWarmAt=Date.now()+60000;
    return sourceChanged;
  })();
  try{return await historicalWarmRequest;}finally{historicalWarmRequest=null;}
}

function historicalLeagues(){
  return Object.keys(state.manifest?.leagues||{}).sort((a,b)=>a.localeCompare(b,'ko'));
}

function toleranceLabel(){
  return '소수점 둘째 자리 정확히 일치';
}

function outcomeResult(row,target){
  const index=resultIndex(row);
  if(index===null)return '결과 미확인';
  return target.selections.find(selection=>selection.slot===index)?.label||outcomeLabels(row.market)[index]||row.result;
}

function distributionView(summary){
  if(!summary.known)return `<div class="distribution-empty">정산 결과가 연결된 과거 사례가 없습니다.</div>`;
  return `<div class="distribution">${[0,1,2].map(index=>summary.counts[index]?`<div class="distribution-part part-${index}" style="flex:${summary.counts[index]}"><b>${esc(summary.labels[index])}</b><span>${pct(summary.rate[index])} · ${number(summary.counts[index])}건</span></div>`:'').join('')}</div>`;
}

function interval(stat){
  return stat?.wilson95?`${pct(stat.wilson95.lower)}–${pct(stat.wilson95.upper)}`:'—';
}

function historicCases(rows,target,limit=12){
  return `<div class="table-wrap cases"><table><thead><tr><th>날짜</th><th>경기</th><th>리그 · 시장</th><th>비교 배당</th><th>결과</th></tr></thead><tbody>${rows.slice(0,limit).map(row=>`<tr class="result-row-${resultIndex(row)??'unknown'}"><td>${esc(row.date)}</td><td><b>${esc(row.home)}</b> <span class="muted">vs</span> <b>${esc(row.away)}</b></td><td>${esc(row.league)}<small>${esc(row.market)}${!marketUsesLine(row.market)||row.line===null||row.line===undefined?'':` ${esc(row.line)}`}</small></td><td class="number">${row[state.stage].map(price).join(' / ')}</td><td><span class="chip outcome-${resultIndex(row)??'unknown'}">${esc(outcomeResult(row,target))}</span></td></tr>`).join('')}</tbody></table></div>`;
}

function teamPanel(team,profile,target,{totalMarket=false}={}){
  if(profile.reason)return `<section class="team-panel"><h3>${esc(team)}</h3><p class="muted">${esc(profile.reason)}</p></section>`;
  const stat=profile.stats;
  const cases=profile.rows.slice(0,4);
  const basis=totalMarket
    ?`${state.mode==='combo'?'같은 위치의 동일 기준값·배당 조합':'같은 위치의 기준값·선택 배당'} · 팀이 포함된 경기의 ${profile.selectionLabel||'언더/오버'} 결과`
    :`${state.mode==='combo'?'같은 위치의 동일 배당 조합':'같은 위치에서 팀이 받은 동일 가격'}`;
  const tally=(totalMarket||target.market==='승1패')?`${number(stat?.wins)}회 / ${number(stat?.losses)}회`:`${number(stat?.wins)}승 / ${number(stat?.losses)}패`;
  return `<section class="team-panel team-${profile.role}"><div class="card-head"><div><span class="eyebrow">${profile.role==='home'?'현재 홈팀':'현재 원정팀'}</span><h3>${esc(team)}</h3></div><span class="chip">자체 ${price(profile.currentOdds)}배</span></div>${stat?`<div class="team-stat"><strong>${number(stat.wins)}/${number(stat.n)}</strong><span>${tally} · ${number(stat.n)}건</span></div><p class="caption">Wilson 95% ${interval(stat)} · ${esc(basis)}</p>`:'<p class="muted">정산 결과가 확인된 일치 사례가 없습니다.</p>'}${cases.length?`<div class="team-cases">${cases.map(row=>`<div><b>${esc(row.date.slice(0,10))}</b><span>${esc(row.home)} vs ${esc(row.away)}</span><span class="chip outcome-${resultIndex(row)??'unknown'}">${resultIndex(row)===null?'미확인':esc(outcomeResult(row,target))}</span></div>`).join('')}</div>`:''}</section>`;
}

async function detail(){
  const selected=findMarket();
  if(!selected)return heading('PATTERN LOOKUP','동일 배당 과거 통계','예정 경기에서 배당 조합 또는 한 배당을 선택하세요.',`<button class="button" data-route="today">경기 목록으로</button>`)+empty('선택한 시장이 없습니다.','오늘·예정 경기에서 조합 전체 또는 배당 하나를 눌러주세요.');
  const target=makeTarget(selected.event,selected.market);
  const rows=await historyRows();
  const options={league:state.historyLeague,stage:state.stage,mode:state.mode,selectionSlot:state.selectionSlot,tolerance:state.tolerance};
  const matches=matchHistorical(rows,target,options);
  const summary=distribution(matches,target);
  const selectedItem=target.selections.find(item=>item.slot===state.selectionSlot)||target.selections[0];
  const stat=state.mode==='outcome'?selectedStats(matches,target,state.selectionSlot,{stage:state.stage}):null;
  const [exactPattern]=await analyzeExact(sportKey(),rows,[selected],{includeSequences:true});
  const totalMarket=['언오버','전반_언오버'].includes(canonicalMarket(target.market));
  const unverifiedTeam={reason:'공식 모바일 경로의 팀 이름이 과거 기록과 동일한지 확인되지 않아 팀별 대조를 보류합니다.'};
  const homeProfile=selected.event.teamNamesVerified===false?unverifiedTeam:totalMarket?teamUnderOverPattern(rows,target,target.home,state.selectionSlot,options):teamPattern(rows,target,target.home,options);
  const awayProfile=selected.event.teamNamesVerified===false?unverifiedTeam:totalMarket?teamUnderOverPattern(rows,target,target.away,state.selectionSlot,options):teamPattern(rows,target,target.away,options);
  const label=queryLabel(target,state.mode,state.selectionSlot);
  const scope=`${state.historyLeague==='all'?`모든 ${state.sport} 리그`:state.historyLeague} · ${target.marketLabel}${target.line===null?'':` ${target.line}`} · ${state.stage==='closing'?'최종':'초기'} 배당 · ${toleranceLabel()}`;
  const returnRoute='today';
  const returnLabel='← 경기 목록';
  let html=heading('SAME PRICE HISTORY','동일 배당 과거 통계',`${selected.event.home} vs ${selected.event.away} · ${formatDateTime(selected.event.startsAt)}`,`<button class="button" data-route="${returnRoute}">${returnLabel}</button>`);
  html+=`<section class="card analysis-scope"><div class="analysis-header"><div><span class="fixture-league">${esc(target.league)}</span><h2>${esc(target.home)} <span class="muted">vs</span> ${esc(target.away)}</h2><p>${esc(target.marketLabel)}${target.line===null?'':` · ${target.line}`} · 현재 관측 ${esc(formatDateTime(target.observedAt||target.startsAt))}</p></div><span class="chip ${freshness().kind==='live'?'green':'amber'}">${esc(freshness().label)}</span></div><div class="analysis-mode"><button class="mode-button ${state.mode==='combo'?'active':''}" data-mode="combo">동일 배당 조합 전체</button>${target.selections.map(selection=>`<button class="mode-button side-${selection.slot} ${state.mode==='outcome'&&state.selectionSlot===selection.slot?'active':''}" data-mode="outcome" data-slot="${selection.slot}"><span>${esc(selection.label)}</span><b>${price(selection.odds)}</b></button>`).join('')}</div><div class="filters analysis-filters"><select id="history-league" aria-label="과거 리그 범위">${optionList(historicalLeagues(),state.historyLeague,`모든 ${state.sport} 리그`)}</select><select id="history-stage" aria-label="과거 배당 단계"><option value="closing" ${state.stage==='closing'?'selected':''}>최종 배당</option><option value="opening" ${state.stage==='opening'?'selected':''}>초기 배당</option></select><span class="chip">정확한 배당만</span></div><p class="caption">${esc(scope)}. 같은 날짜와 이후 기록은 제외했습니다. ‘초기/최종’은 원본 열의 연구 단계이며 실제 배당 관측 시각이 아닙니다.</p></section>`;
  if(target.market==='승1패')html+='<p class="caption">승: 홈팀 2점차 이상 승리 · ①: 1점차 이내 승부(무승부 포함) · 패: 원정팀 2점차 이상 승리</p>';
  html+=patternDetailView(selected.event,selected.market,exactPattern,{mode:state.mode,slot:state.selectionSlot});

  html+=`<div class="metrics">${metric(state.mode==='combo'?'일치한 조합':'일치한 선택 가격',number(matches.length),label)}${metric('정산 결과 확인',number(summary.known),summary.unresolved?`결과 미확인 ${number(summary.unresolved)}건 제외`:'모든 일치 사례 정산 확인')}${metric('최신 일치 사례',matches[0]?shortDate(matches[0].date):'—',matches.length?`${matches[0].home} vs ${matches[0].away}`:'일치 사례 없음')}${metric('비교 기준',state.mode==='combo'?'전 배당 순서 포함':'선택한 한 배당만','리그·시장·기준값은 항상 포함')}</div>`;
  html+=historyTriggerView(selected.event,selected.market,{standalone:true});
  html+=`<div class="analysis-grid"><section class="card"><div class="card-head"><div><span class="eyebrow">${state.mode==='combo'?'FULL COMBINATION':'SINGLE PRICE'}</span><h2>${state.mode==='combo'?'동일 조합의 결과 분포':`${selectedItem.label} ${price(selectedItem.odds)}의 결과`}</h2></div><span class="chip">정산 ${number(summary.known)}건</span></div>${state.mode==='combo'?distributionView(summary):stat?`<div class="selected-stat side-${state.selectionSlot}"><strong>${number(stat.wins)}/${number(stat.n)}</strong><div><b>${esc(selectedItem.label)} 결과 ${number(stat.wins)}적중 / ${number(stat.losses)}미적중</b><p>Wilson 95% ${interval(stat)} · 같은 사례의 시장 정규화 평균 ${pct(stat.marketExpectedRate)}</p></div></div>`:'<p class="muted">선택한 결과가 정산된 일치 사례가 없습니다.</p>'}<p class="caption">무승부는 무 선택의 적중으로만 계산합니다. 과거 적중률은 이번 경기 예측확률이 아닙니다. Wilson 구간은 이 과거 집단의 불확실성이며 개별 경기의 예측구간이 아닙니다.</p></section><section class="card"><div class="card-head"><h2>현재 조합</h2><span class="chip">${state.mode==='combo'?'전체 비교':'한 배당 비교'}</span></div><div class="current-odds">${target.selections.map(selection=>`<div class="side-${selection.slot} ${state.mode==='outcome'&&state.selectionSlot===selection.slot?'focus':''}"><span>${esc(selection.label)}</span><b>${price(selection.odds)}</b></div>`).join('')}</div><p class="caption">전체 비교는 배당 순서와 모든 가격을 함께 맞춥니다. 배당을 누른 경우 다른 가격은 제한하지 않습니다.</p></section></div>`;
  html+=`<section class="card team-section"><div class="card-head"><div><span class="eyebrow">TEAM AT THIS PRICE</span><h2>${totalMarket?'각 팀의 동일 기준값·배당 언더오버 통계':'각 팀의 동일 배당 적중 통계'}</h2></div><span class="chip">홈·원정 위치 고정</span></div>${isTeamMarket(target.market)||totalMarket?`<div class="team-grid">${teamPanel(target.home,homeProfile,target,{totalMarket})}${teamPanel(target.away,awayProfile,target,{totalMarket})}</div>`:'<p class="muted">이 시장은 팀별 결과 패턴을 표시하지 않습니다.</p>'}<p class="caption">팀명 공백과 일부 표기 차이를 정리해 비교합니다. 홈·원정 위치를 유지하며, 언더오버는 팀 승패가 아닌 해당 팀이 포함된 경기의 언더·오버 결과를 셉니다.</p></section>`;
  html+=`<section class="card cases-section"><div class="card-head"><div><span class="eyebrow">HISTORICAL CASES</span><h2>일치한 실제 사례</h2></div><span class="chip">최근 ${Math.min(matches.length,12)}건</span></div>${matches.length?historicCases(matches,target):empty('일치한 과거 사례가 없습니다.','리그·배당 단계를 바꿔보세요. 다른 배당은 섞지 않습니다.')}</section>`;
  html+=patternReferenceView(selected.event,selected.market,exactPattern);
  return html;
}

async function patterns(){
  const report=await loadExactCatalog(sportKey(),await historyRows(),{scope:state.catalogScope,mode:state.catalogMode,league:state.catalogLeague,market:state.catalogMarket,minimum:state.catalogMinN,offset:state.catalogOffset,limit:50});
  return heading('EXACT PATTERN LIBRARY','참고 패턴 데이터센터','동일 배당의 순서를 참고용으로 살펴봅니다. 추천 선정과 등급에는 반영하지 않습니다.')+`<section class="card">${sequenceGradeGuide()}<div class="filters"><select id="catalog-scope" aria-label="패턴 범위">${[['league','같은 리그'],['team','같은 팀·같은 위치'],['sport','같은 종목']].map(([k,l])=>`<option value="${k}" ${state.catalogScope===k?'selected':''}>${l}</option>`).join('')}</select><select id="catalog-mode" aria-label="배당 일치 기준"><option value="combo" ${state.catalogMode==='combo'?'selected':''}>전체 배당 조합 일치</option><option value="single" ${state.catalogMode==='single'?'selected':''}>선택 배당 하나 일치</option></select><select id="catalog-league">${optionList(historicalLeagues(),state.catalogLeague,'모든 리그')}</select><select id="catalog-market">${optionList(['일반','핸디캡','언오버'],state.catalogMarket,'모든 시장')}</select><label>최소 반복 <select id="catalog-min-n">${[3,5,10,20,30].map(n=>`<option value="${n}" ${n===state.catalogMinN?'selected':''}>${n}회</option>`).join('')}</select></label></div><p>${number(report.total)}개 패턴 · A ${report.gradeCounts.A} / B ${report.gradeCounts.B} / C ${report.gradeCounts.C}</p><p class="caption">기준점·배당이 같은 경기만 시간순으로 비교합니다. ‘연속으로 나오지 않음’은 이 자료에서 관찰한 사실이며 앞으로 불가능하다는 뜻은 아닙니다.</p></section>${catalogView(report)}<div class="pick-actions">${state.catalogOffset?'<button class="button" data-catalog-prev>이전 50개</button>':''}${report.total>state.catalogOffset+50?'<button class="button" data-catalog-next>다음 50개</button>':''}</div>`;
}

async function data(){
  const manifest=state.manifest;
  const key=sportKey(),sync=state.historyStatus[key],reportState=state.patterns[key]?'준비됨':'조회 시 계산';
  const syncDetail=sync?.error?`동기화 오류 · ${sync.error}`:sync?.lastSuccess?`마지막 확인 ${formatDateTime(sync.lastSuccess)} · 원본 최신 ${sync.sourceLatestAt||'확인 중'} · 증분 ${number(sync.lastDeltaRows)}건`:'앱을 열면 공개 원본을 확인합니다.';
  const allSports=Object.entries(SPORT_DATA).map(([sport,{key}])=>{
    const item=state.historyStatus[key];
    const label=item?.error?'확인 오류':item?.lastSuccess?'확인됨':'확인 대기';
    const detail=item?.error?item.error:item?.lastSuccess?`원본 최신 ${shortDate(item.sourceLatestAt||item.lastSuccess)}`:'모바일 접속 시 자동 확인';
    return metric(`${sport} 과거 원본`,label,detail);
  }).join('');
  return heading('DATA CONNECTION','국내 프로토 데이터 연결',`${state.sport} 과거 배당을 공개 원본과 연결합니다.`)+sourcePanel()+`<div class="metrics">${metric(`${state.sport} 기준 이력`,number(manifest.rows),`${shortDate(manifest.dateRange[0])} ~ ${shortDate(manifest.dateRange[1])}`)}${metric('패턴 데이터센터',reportState,'정확한 배당 · 연속·교차 패턴')}</div><div class="metrics">${allSports}</div><section class="card"><div class="card-head"><div><span class="eyebrow">HISTORICAL SOURCE</span><h2>${esc(manifest.sourceTitle||`${state.sport} 과거 배당`)}</h2></div><button class="button ${state.historyRefreshing?'disabled':''}" data-reload-history ${state.historyRefreshing?'disabled':''}>${state.historyRefreshing?'과거 원본 동기화 중…':'지금 과거 원본 갱신'}</button></div><p>${esc(syncDetail)}</p><p>기준 이력은 종목별로 보관하고, 모바일 앱에 접속하면 네 종목 모두 마지막 반영 시각의 앞 14일을 다시 읽어 새 경기와 수정된 결과를 병합합니다. 원본이 응답하지 않으면 마지막 정상 기록을 유지합니다.</p><p><a href="${esc(manifest.catalogUrl||manifest.sourceUrl)}" target="_blank" rel="noopener">과거 배당 원본 확인 ↗</a></p><p class="caption">야구·축구·농구·배구 모두 같은 흐름으로 연결됩니다. SUM·승5패·모든 전반 시장은 분석에서 제외합니다. 과거 패턴은 미래 결과나 구매 가능성을 보장하지 않습니다.</p></section><section class="card"><h2>현재 국내 배당</h2><p>베트맨 공식 공개 조회에서 현재 발매 회차와 경기별 배당을 직접 읽습니다. 모바일 화면이 열려 있으면 30초 간격으로 갱신하고, 회차·경기번호·핸디캡 및 언더오버 기준값을 함께 보관합니다.</p><p><a href="https://www.betman.co.kr/" target="_blank" rel="noopener">베트맨 공식 원본 확인 ↗</a></p><p class="caption">베트맨 웹사이트의 공개 조회 기능을 사용합니다. 공식 조회가 실패하면 마지막 공식 조회값과 오류를 표시하고 새 예측을 보류합니다. 배당 변경 즉시 전송이 아닌 주기적 조회입니다.</p></section>`;

}

let evidenceState=null,evidenceSequence=0,evidenceOpener=null;
function closeEvidence(){const dialog=$('#evidence-drawer');if(dialog?.open)dialog.close();}
function renderEvidence(){
  if(!evidenceState)return;
  const dialog=$('#evidence-drawer'),scroll=dialog.querySelector('.evidence-drawer-body')?.scrollTop||0;
  dialog.innerHTML=evidenceDrawerView(evidenceState);const body=dialog.querySelector('.evidence-drawer-body');if(body)body.scrollTop=scroll;
  if(dialog.open&&!dialog.contains(document.activeElement))dialog.querySelector('[data-close-evidence]')?.focus({preventScroll:true});
}
async function openEvidence(data,opener){
  const event=feedEvents().find(e=>String(e.id)===data.eventId),market=event?.markets.find(m=>String(m.id)===data.marketId);if(!event||!market)return;
  evidenceOpener=opener;evidenceState={event,market,slot:Number(data.slot),item:{scope:data.evidenceScope,basis:data.evidenceBasis},report:null,loading:true,error:''};
  renderEvidence();$('#evidence-drawer').showModal();document.body.classList.add('evidence-open');await loadDrawerCases();
}
async function loadDrawerCases(offset=0){
  const current=evidenceState;if(!current)return;const sequence=++evidenceSequence;
  if(!offset){current.loading=true;current.error='';renderEvidence();}else{const more=$('#evidence-drawer [data-more-evidence]');if(more)more.disabled=true;}
  try{
    const key=sportKey(canonicalSport(current.event.sport)),rows=await historyRows();
    const report=await loadEvidenceCases(key,rows,current.event,current.market,{scope:current.item.scope,basis:current.item.basis,slot:current.slot,offset,limit:50});
    if(sequence!==evidenceSequence||evidenceState!==current)return;
    current.report=offset?{...report,cases:[...(current.report?.cases||[]),...report.cases]}:report;current.loading=false;current.error='';renderEvidence();
  }catch(error){if(sequence===evidenceSequence&&evidenceState===current){current.loading=false;current.error=error.message;renderEvidence();}}
}
$('#evidence-drawer').addEventListener('close',()=>{document.body.classList.remove('evidence-open');evidenceSequence++;evidenceState=null;evidenceOpener?.focus({preventScroll:true});});
$('#evidence-drawer').addEventListener('click',event=>{if(event.target!==event.currentTarget)return;const r=event.currentTarget.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeEvidence();});

let slipRequest=null,slipFollowup=null;
const slipPages=new Set(['']);
try{const draft=JSON.parse(localStorage.getItem('odds-lens-pick-draft-v1'));if(draft&&Array.isArray(draft.picks))state.draft=draft;}catch{}
function saveDraft(){try{localStorage.setItem('odds-lens-pick-draft-v1',JSON.stringify(state.draft));}catch{}updateChrome();}
let toastTimer;
function toast(message){const element=$('#toast');element.textContent=message;element.hidden=false;const inSheet=$('#workbench-drawer[open] .bench-dialog-message');if(inSheet){inSheet.textContent=message;inSheet.hidden=false;}clearTimeout(toastTimer);toastTimer=setTimeout(()=>{element.hidden=true;},3000);}
function addPick({eventId,marketId,slot,expectedOdds,expectedCondition}){
  if(state.slipSaving){toast('조합 저장이 끝나면 담을 수 있습니다.');return;}
  const event=feedEvents().find(e=>String(e.id)===eventId),market=event?.markets.find(m=>String(m.id)===marketId);
  if(!event||!market)return;
  if(expectedCondition&&expectedCondition!==pickConditionKey(market)){toast('시장·기준점이 변경됐습니다. 현재 조건을 확인한 뒤 담아주세요.');return;}
  if(!isFutureEvent(event)||market.pending||market.saleStatus==='suspended'){toast('시작 전의 발표된 배당만 담을 수 있습니다.');return;}
  const selection=makeTarget(event,market).selections.find(s=>s.slot===Number(slot));if(!selection)return;
  if(expectedOdds!=null&&Number(expectedOdds)!==Number(selection.odds)){toast('배당이 변경됐습니다. 현재 배당을 확인한 뒤 담아주세요.');return;}
  if(state.draft.picks.some(p=>p.eventId===eventId)){toast('이미 담은 경기입니다. 장바구니에서 기존 픽을 제거한 뒤 바꿔주세요.');return;}
  if(state.draft.picks.length>=20){toast('픽은 최대 20개까지 담을 수 있습니다.');return;}
  state.draft.picks.push({eventId,marketId,outcomeKey:selection.key,label:selection.label,odds:selection.odds,home:event.home,away:event.away,league:event.league,startsAt:event.startsAt,market:market.market,line:market.line,saleStatus:market.saleStatus,sport:event.sport,year:market.year,round:market.round,gameNumber:market.gameNumber,outcomeKeys:market.outcomeKeys||market.outcomes.map(o=>o.key),observedAt:market.observedAt});
  state.slipLoaded=false;
  saveDraft();toast(`${selection.label} ${selection.odds.toFixed(2)}배를 담았습니다. · ${state.draft.picks.length}개`);
}
async function loadSlips(cursor='',{force=false}={}){
  if(slipRequest)return slipRequest;
  clearTimeout(slipFollowup);
  state.slipLoading=true;
  slipRequest=(async()=>{
    try{
      const pages=cursor?[cursor]:[...slipPages],rounds=new Map();
      for(const page of pages){
        const payload=await json('api/slips'+(force?'/refresh':'')+(page?'?cursor='+encodeURIComponent(page):''),force?{method:'POST'}:{});
        const merged=new Map(state.slips.map(s=>[s.id,s]));for(const slip of payload.slips)merged.set(slip.id,slip);
        state.slips=[...merged.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
        state.slipSources={...state.slipSources,...payload.sources};slipPages.add(page);
        if(page===pages.at(-1))state.slipCursor=payload.nextCursor;
        for(const round of payload.resultSource?.rounds||[])rounds.set(round.round,round);
      }
      if(state.draft.picks.length){
        const draftId=state.draft.id;
        const payload=await json('api/slips/results'+(force?'?refresh=1':''),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({picks:state.draft.picks.map(normalizePick)})});
        if(state.draft.id===draftId){const results=new Map(payload.picks.map(p=>[pickKey(p),p]));state.draft.picks=state.draft.picks.map(p=>{const result=results.get(pickKey(p));return result&&Number(result.odds)===Number(p.odds)?{...p,...result}:p;});saveDraft();}
        for(const round of payload.resultSource?.rounds||[])rounds.set(round.round,round);
      }
      state.slipResultSource={rounds:[...rounds.values()],refreshing:[...rounds.values()].some(r=>r.refreshing)};
      state.slipError='';state.slipLoaded=true;
      if(state.slipResultSource.refreshing)slipFollowup=setTimeout(()=>{if(state.route==='cart'&&document.visibilityState==='visible')void loadSlips();},4000);
    }
    catch(error){state.slipError=error.message;state.slipLoaded=true;}
    finally{state.slipLoading=false;if(state.route==='cart'&&document.activeElement?.id!=='slip-stake')void render({preserveScroll:true});}
  })();try{await slipRequest;}finally{slipRequest=null;}
}
function cart(){
  if(!state.slipLoaded&&!slipRequest)void loadSlips();
  return cartSelectionNote(state.draft.picks.length)+slipsView({draft:state.draft,slips:state.slips,loading:state.slipLoading,error:state.slipError,saving:state.slipSaving,nextCursor:state.slipCursor,sources:state.slipSources,resultSource:state.slipResultSource});
}
async function saveSlip(){
  if(state.slipSaving)return;
  if(!validStake(state.draft.stake)){state.slipError='금액을 1원 이상 정수로 입력해주세요.';void render({preserveScroll:true});return;}
  state.slipSaving=true;state.slipError='';void render({preserveScroll:true});
  try{
    const response=await fetch('api/slips',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(state.draft)}),payload=await response.json();
    if(!response.ok)throw Error(payload.error||'저장하지 못했습니다.');
    state.draft={id:crypto.randomUUID(),stake:state.draft.stake,picks:[]};saveDraft();await loadSlips();toast('조합을 저장했습니다. 결과는 원본이 업데이트되면 반영됩니다.');
  }catch(error){state.slipError=error.message;}
  finally{state.slipSaving=false;void render({preserveScroll:true});}
}
async function refreshSlips(){
  if(state.slipLoading)return;
  const pending=loadSlips('',{force:true});void render({preserveScroll:true});await pending;
}
document.addEventListener('input',event=>{if(event.target.id==='slip-stake'){state.draft.stake=event.target.value;saveDraft();const totals=$('#draft-totals');if(totals)totals.innerHTML=draftSummary(state.draft);}});

function method(){
  return heading('READ THE EVIDENCE','분석 기준','같은 배당의 과거 기록과 이번 경기의 예측은 분리해서 봅니다.')+`<div class="method-grid">
    <section class="card"><span class="eyebrow">01 / OFFICIAL QUOTE</span><h2>현재 국내 배당</h2><p>베트맨 공개 경기표의 실제 경기, 시작 시각, 판매 상태, 시장별 배당과 기준값을 구분해 보관합니다. 공식 조회가 실패하면 마지막 확인값과 오류를 표시합니다.</p></section>
    <section class="card"><span class="eyebrow">02 / SAME PRICE</span><h2>동일 배당 결과 비교</h2><p>시장·기준점·전체 배당 조합이 같은 과거 결과를 종목·리그·홈팀·원정팀별로 보여줍니다. 한 배당만 같은 경우도 따로 조회합니다. 네 범위의 표본은 서로 겹칩니다.</p></section>
    <section class="card"><span class="eyebrow">03 / RESULT ORDER</span><h2>참고용 결과 흐름</h2><p>각 범위에서 최근 12건을 실제 시간순으로 색을 나눠 보여줍니다. 직전 결과와 같았던 과거 결과 뒤에 무엇이 나왔는지도 집계합니다. 경기 상세에서 펼쳐 볼 수 있으며 추천 선정·등급·정렬에는 반영하지 않습니다.</p></section>
    <section class="card"><span class="eyebrow">04 / GRADES</span><h2>배당통계 추천 등급</h2><p>동일 배당의 적중 횟수·표본 수·기간별 안정성을 A·B·C로 표시합니다. 팀·리그·종목에서 같은 결과를 가리키는 범위가 많을수록 먼저 보여줍니다. 작은 표본의 전승은 C로 표시합니다.</p></section>
  </div><section class="card method-note"><h2>자료의 한계</h2><p>과거의 초기·최종 배당은 실제 관측시각이 없는 원본 열입니다. 결과 확정시각도 없으므로 같은 날짜의 기록은 제외합니다. 배당 신호등은 별도 Nowgoal 자료에 Colab 원본 계산식을 적용합니다. 신호 색은 초기·현재 확률 변화의 조건 충족 여부이며 실전 적중률이나 예측확률 등급이 아닙니다.</p></section>`;
}

async function render({preserveScroll=false,restoreSnapshot=null,scrollToTop=false}={}){
  const sequence=++state.sequence,route=state.route;
  const transitionSnapshot=state.pendingRouteScroll?.route===route?state.pendingRouteScroll.snapshot:null;
  const snapshotForRender=()=>restoreSnapshot||transitionSnapshot||(preserveScroll?captureScrollSnapshot():scrollToTop?{x:0,y:0,anchor:null}:null);
  updateChrome();
  const activeRoute=state.route==='detail'?state.detailReturnRoute:state.route;
  document.querySelectorAll('nav [data-route],#secondary-navigation [data-route]').forEach(button=>{const active=button.dataset.route===activeRoute;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  const more=$('[data-open-menu]');if(more)more.classList.toggle('active',!primaryRoutes.has(activeRoute));
  document.body.dataset.route=state.route;
  $('#sports').querySelectorAll('button').forEach(button=>{const active=button.dataset.sport===state.sport;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
  try{
    let html;
    if(state.route==='today')html=await today();
    else if(state.route==='detail')html=await detail();
    else if(state.route==='patterns')html=await patterns();
    else if(state.route==='cart')html=cart();
    else if(state.route==='signals')html=signalsView(signalState);
    else if(state.route==='reading')html=marketReadingView(state.reading);
    else if(state.route==='validation'){
      const [validation,sequenceReport]=await Promise.all([
        json(`api/validation?cursor=${encodeURIComponent(state.validationCursor)}`),
        json('data/pattern-sequence-backtest.json').catch(()=>null)
      ]);
      html=validationView(validation,{sequenceReport});
    }
    else if(state.route==='prediction')html=evidenceView(await json(`api/predictions/${state.evidenceId}/evidence`));
    else if(state.route==='data')html=await data();
    else html=method();
    if(sequence===state.sequence){
      const scrollSnapshot=snapshotForRender();
      const focused=document.activeElement,keepFocus=app.contains(focused);
      const focusSelector=keepFocus?(focused.id?'#'+CSS.escape(focused.id):focused.tagName.toLowerCase()+focused.getAttributeNames().filter(name=>name.startsWith('data-')).map(name=>`[${name}="${CSS.escape(focused.getAttribute(name))}"]`).join('')):null;
      const caret=keepFocus&&typeof focused.selectionStart==='number'?focused.selectionStart:null;
      app.innerHTML=html;
      if(focusSelector){const next=app.querySelector(focusSelector);if(next){next.focus({preventScroll:true});if(caret!==null&&next.setSelectionRange)next.setSelectionRange(caret,caret);}}
      app.querySelectorAll('details[data-disclosure]').forEach(item=>{item.open=state.openDisclosures.has(`${route}:${item.dataset.disclosure}`);});
      updateChrome();
      state.renderedFreshnessKind=freshness().kind;state.renderedQuoteAt=state.feed?.fetchedAt;
      if(scrollSnapshot)restoreScrollSnapshot(scrollSnapshot,sequence,route);
      if(state.pendingRouteScroll?.route===route)state.pendingRouteScroll=null;
    }
  }catch(error){
    if(sequence===state.sequence){
      const scrollSnapshot=snapshotForRender();
      app.innerHTML=empty('화면을 준비하지 못했습니다.',error.message,'<button class="button" data-retry>다시 시도</button>');
      state.renderedFreshnessKind=freshness().kind;state.renderedQuoteAt=state.feed?.fetchedAt;
      if(scrollSnapshot)restoreScrollSnapshot(scrollSnapshot,sequence,route);
      if(state.pendingRouteScroll?.route===route)state.pendingRouteScroll=null;
    }
  }
}

function updateChrome(){
  const quick=$('#quick-cart'),hasDraft=state.draft.picks.length>0&&!['cart','today','signals'].includes(state.route);
  const dock=$('#workbench-dock'),showDock=(state.route==='today')&&(state.compareIds.length>0||state.draft.picks.length>0);
  dock.hidden=!showDock;dock.innerHTML=showDock?workbenchDockView({compareCount:state.compareIds.length,draftCount:state.draft.picks.length}):'';
  document.body.classList.toggle('has-bench-dock',showDock);
  if(quick){quick.hidden=!hasDraft;quick.innerHTML=`<div><b>담은 픽 ${state.draft.picks.length}개</b><span>조합 ${state.draft.picks.reduce((total,pick)=>total*Number(pick.odds),1).toFixed(3)}배</span></div><button class="button" data-route="cart">장바구니</button>`;}
  document.body.classList.toggle('has-draft',hasDraft);
  $('#notice').hidden=state.route==='signals'||!!state.feed;
  const cartCount=$('#navigation [data-route="cart"] .nav-count');if(cartCount){cartCount.textContent=state.draft.picks.length;cartCount.hidden=!state.draft.picks.length;}
  document.querySelectorAll('[data-add-pick]').forEach(button=>{const picked=state.draft.picks.some(pick=>String(pick.marketId)===button.dataset.marketId&&String(pick.outcomeKey)===button.dataset.outcomeKey);button.classList.toggle('is-picked',picked);button.textContent=picked?'✓ 담김':button.dataset.pickLabel;button.title=picked?'장바구니에 담은 픽':'';});
  const signalScreen=state.route==='signals';
  $('#health').toggleAttribute('data-show-signal-source',signalScreen);
  $('#health').setAttribute('aria-label',signalScreen?'신호등 원본 수집 상태 보기':'데이터 연결 상태 보기');
  if(signalScreen){
    const failed=signalState.error||signalState.payload?.error||signalState.payload?.stale||signalState.payload?.days?.some(d=>d.error);
    $('#health').textContent=signalState.loading?'원본 연결 중':failed?'수집 상태 확인':signalState.source==='domestic'?'전 종목 · 국내':'축구 · Nowgoal';
    $('#health').dataset.kind=failed?'stale':'live';$('#health').title=signalState.source==='domestic'?'베트맨 공식 전 종목 수집 상태':'Nowgoal · Colab 원본 수집 상태';
    return;
  }
  const status=freshness();
  $('#health').textContent=state.feed?status.label:'데이터 연결 중';
  $('#health').dataset.kind=status.kind;
  $('#health').title=state.feed?`${sourceName()} · ${status.label}`:'현재 경기 소스 대기';
  $('#notice').textContent=state.feed?'배당 옆에 최초 기록과 변화 폭을 표시합니다. 배당은 과거 사례, 변경 버튼은 이력을 엽니다.':'국내 프로토 경기·배당을 불러오는 중입니다. 과거 패턴 데이터센터는 바로 사용할 수 있습니다.';
}

function feedContentSignature(feed){
  const events=(Array.isArray(feed?.events)?feed.events:[]).map(event=>({
    id:String(event.id??''),sport:event.sport??null,league:event.league??null,leagueName:event.leagueName??null,
    home:event.home??null,away:event.away??null,teamNamesVerified:event.teamNamesVerified!==false,startsAt:event.startsAt??null,saleClosesAt:event.saleClosesAt??null,
    status:event.status??null,available:event.available!==false,
    markets:(Array.isArray(event.markets)?event.markets:[]).map(market=>({
      id:String(market.id??''),market:market.market??null,marketLabel:market.marketLabel??null,line:market.line??null,
      round:market.round??null,gameNumber:market.gameNumber??null,status:market.status??null,
      available:market.available!==false,pending:market.pending===true,prediction:market.prediction?.prediction_id||null,oddsHistory:market.oddsHistory?[market.oddsHistory.first?.id,market.oddsHistory.latest?.id,market.oddsHistory.changeCount]:null,
      outcomes:(Array.isArray(market.outcomes)?market.outcomes:[]).map(outcome=>[outcome.key??null,outcome.label??null,outcome.odds??null])
    })).sort((left,right)=>left.id.localeCompare(right.id)||String(left.market).localeCompare(String(right.market)))
  })).sort((left,right)=>left.id.localeCompare(right.id)||String(left.startsAt).localeCompare(String(right.startsAt)));
  return JSON.stringify({round:feed?.round??null,events});
}

function refreshStateSignature(){
  return JSON.stringify({
    feedError:String(state.feedError?.message||''),
    sourceError:String(state.refreshStatus?.error||''),
    ledgerError:String(state.refreshStatus?.ledgerError||''),
    quoteHistoryError:String(state.refreshStatus?.quoteHistoryError||''),
    ledgerVersion:state.refreshStatus?.ledgerVersion??null
  });
}

function navigate(route,{scrollToTop=false}={}){
  workbench.close();
  if(!routes.some(([id])=>id===route)||route===state.route)return;
  rememberRouteScroll();
  state.route=route;
  if(route==='signals')void loadSignals();else if(!state.feed)refreshAppSources();
  history.replaceState(null,'',`#${route}`);
  const restoreSnapshot=state.routeScroll[route]||{x:0,y:0,anchor:null};
  state.pendingRouteScroll={route,snapshot:restoreSnapshot};
  void render({restoreSnapshot,scrollToTop:scrollToTop||!state.routeScroll[route]});
}

function selectMarket(eventId,marketId,mode='combo',slot=0){
  const event=feedEvents().find(item=>String(item.id)===String(eventId));
  const market=event?.markets.find(item=>String(item.id)===String(marketId));
  if(!event||!market)return;
  workbench.close();
  markReviewed(event);
  const target=makeTarget(event,market);
  state.detailReturnRoute='today';
  state.selected={eventId:String(eventId),marketId:String(marketId)};
  state.mode=mode;
  state.selectionSlot=mode==='outcome'?Number(slot):target.selections[0].slot;
  state.historyLeague='all';
  rememberRouteScroll();
  state.route='detail';
  state.pendingRouteScroll={route:'detail',snapshot:{x:0,y:0,anchor:null}};
  history.replaceState(null,'','#detail');
  void render({scrollToTop:true});
}

function scheduleFeedRetry(){
  if(feedRetryTimer||state.feedPreview)return;
  const delay=Math.min(60000,3000*2**Math.min(feedRetryFailures++,4));
  feedRetryTimer=setTimeout(()=>{
    feedRetryTimer=null;
    if(state.feedPreview||state.refreshing||document.visibilityState==='hidden')return;
    void loadStoredFeed().then(outcome=>{
      updateChrome();
      if(outcome?.changed||outcome?.errorChanged||state.renderedFreshnessKind!==freshness().kind)void render({preserveScroll:true});
    }).catch(()=>{});
  },delay);
}

function clearFeedRetry(){
  feedRetryFailures=0;
  if(feedRetryTimer){clearTimeout(feedRetryTimer);feedRetryTimer=null;}
}

async function loadStoredFeed(){
  if(state.feedPreview)return {changed:false,errorChanged:false,loaded:false};
  if(feedRequest)return feedRequest;
  feedRequest=(async()=>{
    const previousSignature=state.feedSignature,previousState=refreshStateSignature();
    try{state.feed=normalizeFeed(await officialJson('data/live/current.json?ts='+Date.now()));}
    catch(error){
      // A browser connection failure does not establish that Betman failed.
      // Keep the last verified quote and let its observed time determine staleness.
      state.feedError=state.feed?.fetchedAt?null:new Error('연결이 지연되어 자동으로 다시 시도하고 있습니다.');
      scheduleFeedRetry();
      return {changed:false,errorChanged:previousState!==refreshStateSignature(),loaded:false};
    }
    clearFeedRetry();
    state.feedSignature=feedContentSignature(state.feed);
    workbench.signalUpdate();
    if(state.feedSignature!==previousSignature&&quoteDrawerState&&$('#odds-history-drawer').open)void loadQuoteHistory({quiet:true});
    state.feedError=null;
    if(state.feed?.refreshState)state.refreshStatus=state.feed.refreshState;
    else try{state.refreshStatus=await json('api/refresh-status');}catch{state.refreshStatus=null;}
    return {changed:state.feedSignature!==previousSignature,errorChanged:previousState!==refreshStateSignature(),loaded:true};
  })();
  try{return await feedRequest;}finally{feedRequest=null;}
}

async function refreshSource(){
  if(state.refreshing)return;
  const previousState=refreshStateSignature();
  const previousFetchedAt=state.feed?.fetchedAt;
  let outcome={changed:false,errorChanged:false};
  state.refreshing=true;
  try{
    // Finish an older automatic GET before forcing collection so it cannot
    // overwrite the result of this explicit refresh with a pre-refresh feed.
    if(feedRequest)await feedRequest;
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),75000);
    let response;
    try{response=await fetch('api/refresh',{method:'POST',cache:'no-store',signal:controller.signal});
      if(!response.ok)throw new Error('수집 서버 연결 실패. 잠시 후 다시 시도해주세요.');
      state.refreshStatus=await response.json();
    }finally{clearTimeout(timeout);}
    const completedAt=Number(state.refreshStatus?.lastSuccess)*1000;
    outcome=await loadStoredFeed();
    if(Number.isFinite(completedAt)&&completedAt>Date.parse(state.feed?.fetchedAt||'')+1000)scheduleFeedRetry();
  }catch{
    // The POST may have completed on the server after the mobile connection
    // dropped. Read the saved feed again before reporting a source failure.
    outcome=await loadStoredFeed();
    // A second read is useful only if reconciliation itself failed or the
    // server still returned the snapshot that preceded the POST.
    if(!outcome.loaded||!state.feed?.fetchedAt||state.feed.fetchedAt===previousFetchedAt)scheduleFeedRetry();
  }
  finally{
    state.refreshing=false;
    updateChrome();
    if(outcome.changed||outcome.errorChanged||previousState!==refreshStateSignature()||state.renderedFreshnessKind!==freshness().kind)void render({preserveScroll:true});
  }
}

async function refreshHistorySource(){
  if(state.historyRefreshing)return;
  const key=sportKey();
  state.historyRefreshing=true;
  try{
    const response=await fetch(`api/history/${key}/refresh`,{method:'POST',cache:'no-store'});
    if(!response.ok)throw new Error('과거 원본 동기화 서버에 연결하지 못했습니다.');
    state.historyStatus[key]=await response.json();
    delete state.history[key];
    state.historyCheckedAt[key]=0;
    delete state.patterns[key];
    await historyRows({force:true});
  }catch(error){state.historyStatus[key]={error:error.message};}
  finally{state.historyRefreshing=false;render({preserveScroll:true});}
}

async function readPreview(file){
  try{
    const payload=normalizeFeed(JSON.parse(await file.text()));
    state.feed=payload;
    state.feedPreview=true;
    state.feedError=null;
    state.feedSignature=null;
    state.liveDate='all';state.liveLeague='all';state.liveMarket='all';
    void render({scrollToTop:true});
  }catch(error){
    state.feedError=error;
    void render({preserveScroll:true});
  }
}

document.addEventListener('change',event=>{
  const input=event.target;
  if(workbench.change(input))return;
  if(input.id==='feed-file'&&input.files?.[0]){readPreview(input.files[0]);return;}
  const simple={
    'live-date':'liveDate','live-league':'liveLeague','live-market':'liveMarket',
    'history-league':'historyLeague','history-stage':'stage','fixture-sort':'fixtureSort'
  };
  if(simple[input.id]){state[simple[input.id]]=input.value;state.fixtureLimit=40;if(input.id==='fixture-sort')saveFixturePreferences();workbench.repaintFilters();void render({preserveScroll:true});return;}
  if(input.id==='discovery-minimum'||input.id==='discovery-sort'){state[input.id==='discovery-minimum'?'discoveryMinimum':'discoverySort']=input.id==='discovery-minimum'?Number(input.value):input.value;state.recommendationLimit=18;void render({preserveScroll:true});return;}
  if(input.id==='recommendation-grade'){state.recommendationGrade=input.value;state.recommendationLimit=18;void render({preserveScroll:true});return;}
  if(input.id==='catalog-scope'||input.id==='catalog-mode'){state[input.id==='catalog-scope'?'catalogScope':'catalogMode']=input.value;state.catalogOffset=0;void render({preserveScroll:true});return;}
  if(input.id.startsWith('catalog-'))state.catalogOffset=0;
  if(input.id==='high-closed'){state.highIncludeClosed=input.checked;void render({preserveScroll:true});return;}
  if(input.id==='catalog-family'){state.catalogFamily=input.value;state.catalogSelected=null;void render({preserveScroll:true});return;}
  if(input.id==='catalog-league'){state.catalogLeague=input.value;state.catalogSelected=null;void render({preserveScroll:true});return;}
  if(input.id==='catalog-market'){state.catalogMarket=input.value;state.catalogSelected=null;void render({preserveScroll:true});return;}
  if(input.id==='catalog-min-n'){state.catalogMinN=Number(input.value);state.catalogSelected=null;void render({preserveScroll:true});return;}
  if(input.id==='catalog-stable'){state.catalogStable=input.checked;state.catalogSelected=null;void render({preserveScroll:true});}
  if(input.id==='reading-preset'){
    const preset=MARKET_PRESETS[input.value];
    if(preset)state.reading={...state.reading,preset:input.value,reference:[...preset.reference],current:[...preset.current],shares:[...preset.shares],handle:state.reading.handle||100,outcome:0,estimate:'',lower:''};
    void render({preserveScroll:true});return;
  }
  if(input.id==='reading-outcome'){state.reading.outcome=Number(input.value);void render({preserveScroll:true});return;}
  if(input.id==='reading-estimate'){state.reading.estimate=input.value===''?'':Number(input.value)/100;void render({preserveScroll:true});return;}
  if(input.id==='reading-lower'){state.reading.lower=input.value===''?'':Number(input.value)/100;void render({preserveScroll:true});return;}
  if(input.dataset.readingOdds){state.reading[input.dataset.readingOdds][Number(input.dataset.index)]=Number(input.value);void render({preserveScroll:true});return;}
  if(input.dataset.readingShare!==undefined){state.reading.shares[Number(input.dataset.readingShare)]=Number(input.value);void render({preserveScroll:true});return;}
  if(input.id==='reading-handle'){state.reading.handle=Number(input.value);void render({preserveScroll:true});}
});

document.addEventListener('toggle',event=>{
  const details=event.target;
  if(!details.matches?.('details[data-disclosure]')||!details.isConnected)return;
  const key=`${state.route}:${details.dataset.disclosure}`;
  if(details.open)state.openDisclosures.add(key);else state.openDisclosures.delete(key);
},true);
const closeMenu=()=>{const drawer=$('#menu-drawer');if(drawer?.open)drawer.close();$('[data-open-menu]')?.setAttribute('aria-expanded','false');};
$('#menu-drawer').addEventListener('close',()=>{$('[data-open-menu]')?.setAttribute('aria-expanded','false');});
$('#menu-drawer').addEventListener('click',event=>{if(event.target===$('#menu-drawer')){const bounds=event.target.getBoundingClientRect();if(event.clientY<bounds.top||event.clientY>bounds.bottom||event.clientX<bounds.left||event.clientX>bounds.right)closeMenu();}});

document.addEventListener('click',event=>{
  const summary=event.target.closest('details[data-disclosure] > summary');
  if(summary){
    event.preventDefault();
    const details=summary.parentElement,key=`${state.route}:${details.dataset.disclosure}`;
    details.open=!details.open;
    if(details.open)state.openDisclosures.add(key);else state.openDisclosures.delete(key);
    return;
  }
  // body[data-route] describes the screen, not a navigation control. Matching
  // it would cancel native summary/link clicks anywhere in the workspace.
  const button=event.target.closest('button,a[data-route]');
  if(!button)return;
  if(workbench.click(button))return;
  if(button.hasAttribute('data-signal-source')){
    if(signalState.source===button.dataset.signalSource)return;
    Object.assign(signalState,{source:button.dataset.signalSource,payload:null,lastAttempt:0,error:'',filter:'all',sport:'all',market:'all',search:'',date:'all',league:'all',limit:40});
    void loadSignals({force:true});return;
  }
  if(button.hasAttribute('data-signal-sport')){Object.assign(signalState,{sport:button.dataset.signalSport,league:'all',market:'all',limit:40});void render({preserveScroll:true});return;}
  if(button.hasAttribute('data-refresh-signals')){void loadSignals({force:true});return;}
  if(button.hasAttribute('data-show-signal-source')){const item=app.querySelector('[data-disclosure="signal-source"]');if(item){state.openDisclosures.add('signals:signal-source');item.open=true;item.scrollIntoView({block:'start'});}return;}
  if(button.hasAttribute('data-signal-filter')){signalState.filter=button.dataset.signalFilter;signalState.limit=40;void render({preserveScroll:true});return;}
  if(button.hasAttribute('data-more-signals')){signalState.limit+=40;void render({preserveScroll:true});return;}
  if(button.hasAttribute('data-reset-signals')){Object.assign(signalState,{filter:'all',sport:'all',market:'all',phase:'upcoming',search:'',date:'all',league:'all',limit:40});void render({preserveScroll:true});return;}
  if(button.hasAttribute('data-signal-example')){signalState.calculatorValues=['40','30','30','46','27','27'];signalState.calculatorResult=null;signalState.calculatorError='예시 입력값입니다. 실제 경기 자료가 아닙니다.';void render({preserveScroll:true});return;}
  if(button.hasAttribute('data-retry-bench-analysis')){scanAnalysis=null;exactCache.delete(sportKey());void render({preserveScroll:true});return;}
  if(button.hasAttribute('data-bench-market')){state.liveMarket=button.dataset.benchMarket;state.fixtureLimit=40;void render({preserveScroll:true});return;}
  if(button.hasAttribute('data-bench-density')){state.fixtureView=button.dataset.benchDensity;saveFixturePreferences();void render({preserveScroll:true});return;}
  if(button.hasAttribute('data-more-bench-fixtures')){state.fixtureLimit+=40;void render({preserveScroll:true});return;}
  if(button.hasAttribute('data-bench-compare')){toggleComparison(button.dataset.benchCompare);return;}
  if(button.hasAttribute('data-clear-bench-compare')){state.compareIds=[];saveWorkbenchSession();void render({preserveScroll:true});return;}
  if(button.hasAttribute('data-bench-remove-compare')){const id=button.dataset.benchRemoveCompare;state.compareIds=state.compareIds.filter(value=>value!==id);saveWorkbenchSession();workbench.removeColumn(id);void render({preserveScroll:true});return;}
  if(button.hasAttribute('data-open-odds-history')){void openQuoteHistory(button.dataset,button);return;}
  if(button.hasAttribute('data-close-odds-history')){closeQuoteHistory();return;}
  if(button.hasAttribute('data-more-odds-history')){void loadQuoteHistory({more:true});return;}
  if(button.hasAttribute('data-retry-odds-history')){void loadQuoteHistory();return;}
  if(button.dataset.fixtureFilter){state.fixtureFilter=button.dataset.fixtureFilter;state.fixtureLimit=40;saveFixturePreferences();void render({preserveScroll:true});return;}
  if(button.hasAttribute('data-reset-fixtures')){state.fixtureSearch='';state.fixtureFilter='all';state.liveDate='all';state.liveLeague='all';state.liveMarket='all';state.fixtureLimit=40;saveFixturePreferences();workbench.repaintFilters();void render({preserveScroll:true});return;}
  if(button.hasAttribute('data-toggle-fixture-favorite')){const id=button.dataset.toggleFixtureFavorite;if(state.fixtureFavorites.has(id))state.fixtureFavorites.delete(id);else state.fixtureFavorites.add(id);saveFixturePreferences();void render({preserveScroll:true});return;}
  if(button.hasAttribute('data-open-menu')){$('#menu-drawer').showModal();button.setAttribute('aria-expanded','true');return;}
  if(button.hasAttribute('data-close-menu')){closeMenu();return;}
  if(button.hasAttribute('data-jump-fixtures')){$('#upcoming-fixtures')?.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});return;}
  if(button.hasAttribute('data-show-evidence')){if(workbench.actionIsStale(button))return;void openEvidence(button.dataset,button);return;}
  if(button.hasAttribute('data-close-evidence')){closeEvidence();return;}
  if(button.hasAttribute('data-more-evidence')){void loadDrawerCases(Number(button.dataset.moreEvidence));return;}
  if(button.hasAttribute('data-retry-evidence')){void loadDrawerCases();return;}
  if(button.hasAttribute('data-detail-evidence')){const item=evidenceState;if(item){closeEvidence();state.stage='closing';selectMarket(item.event.id,item.market.id,item.item.basis==='combo'?'combo':'outcome',item.slot);}return;}
  if(button.hasAttribute('data-discovery-focus')){state.discoveryFocus=button.dataset.discoveryFocus;state.recommendationLimit=18;void render({preserveScroll:true});return;}
  if(button.hasAttribute('data-reset-discovery')){state.discoveryFocus='all';state.discoveryMinimum=3;state.recommendationGrade='all';state.recommendationLimit=18;void render({preserveScroll:true});return;}
  if(button.hasAttribute('data-add-pick')){if(workbench.actionIsStale(button))return;const item=evidenceState,expectedOdds=item&&$('#evidence-drawer').open?makeTarget(item.event,item.market).selections.find(s=>s.slot===Number(button.dataset.slot))?.odds:button.dataset.expectedOdds;const expectedCondition=item&&$('#evidence-drawer').open?pickConditionKey(item.market):button.dataset.expectedCondition;closeEvidence();addPick({...button.dataset,expectedOdds,expectedCondition});return;}
  if(state.slipSaving&&(button.hasAttribute('data-remove-pick')||button.hasAttribute('data-clear-draft')))return;
  if(button.hasAttribute('data-remove-pick')){state.draft.picks=state.draft.picks.filter(p=>p.marketId!==button.dataset.removePick);saveDraft();void render({preserveScroll:true});return;}
  if(button.hasAttribute('data-clear-draft')){state.draft={id:crypto.randomUUID(),stake:state.draft.stake,picks:[]};saveDraft();void render({preserveScroll:true});return;}
  if(button.hasAttribute('data-save-slip')){void saveSlip();return;}
  if(button.hasAttribute('data-refresh-slips')){void refreshSlips();return;}
  if(button.dataset.moreSlips){void loadSlips(button.dataset.moreSlips);return;}
  if(button.hasAttribute('data-more-recommendations')){state.recommendationLimit+=18;void render({preserveScroll:true});return;}
  if(button.hasAttribute('data-catalog-next')||button.hasAttribute('data-catalog-prev')){state.catalogOffset=Math.max(0,state.catalogOffset+(button.hasAttribute('data-catalog-next')?50:-50));void render({scrollToTop:true});return;}
  if(button.dataset.predictionId){rememberRouteScroll();state.evidenceId=button.dataset.predictionId;state.route='prediction';void render({scrollToTop:true});return;}
  if(button.hasAttribute('data-validation-refresh')){state.validationCursor='';void render({preserveScroll:true});return;}
  if(button.dataset.ledgerCursor){state.validationCursor=button.dataset.ledgerCursor;void render({preserveScroll:true});return;}
  if(button.dataset.route){event.preventDefault();closeMenu();navigate(button.dataset.route);return;}
  if(button.dataset.sport){
    rememberRouteScroll();
    saveWorkbenchSession();
    state.sport=button.dataset.sport;
    state.compareIds=[...(state.compareBySport[state.sport]||[])];state.fixtureLimit=40;
    state.manifest=state.manifests[sportKey()]||null;
    state.route='today';state.liveDate='all';state.liveLeague='all';state.liveMarket='all';state.selected=null;state.historyLeague='all';state.catalogLeague='all';state.catalogMarket='all';state.catalogSelected=null;
    state.routeScroll={};
    state.pendingRouteScroll={route:'today',snapshot:{x:0,y:0,anchor:null}};
    history.replaceState(null,'',`#${state.route}`);void render({scrollToTop:true});return;
  }
  if(button.hasAttribute('data-recommendation')){state.stage='closing';state.tolerance=0;selectMarket(button.dataset.eventId,button.dataset.marketId,button.dataset.recMode,button.dataset.slot);return;}
  if(button.hasAttribute('data-select-market')){selectMarket(button.dataset.eventId,button.dataset.marketId,'combo');return;}
  if(button.hasAttribute('data-select-odds')){selectMarket(button.dataset.eventId,button.dataset.marketId,'outcome',button.dataset.slot);return;}
  if(button.dataset.mode){state.mode=button.dataset.mode;state.selectionSlot=button.dataset.mode==='outcome'?Number(button.dataset.slot):state.selectionSlot;void render({preserveScroll:true});return;}
  if(button.hasAttribute('data-reload-feed')){state.feedPreview=false;refreshSource();return;}
  if(button.hasAttribute('data-reload-history')){refreshHistorySource();return;}
  if(button.hasAttribute('data-clear-preview')){state.feedPreview=false;state.feed=null;state.feedSignature=null;loadStoredFeed().then(outcome=>{updateChrome();if(outcome?.changed||outcome?.errorChanged)return render({preserveScroll:true});});return;}
  if(button.dataset.catalogId){state.catalogSelected=button.dataset.catalogId;void render({preserveScroll:true});return;}
  if(button.hasAttribute('data-close-catalog')){state.catalogSelected=null;void render({preserveScroll:true});return;}
  if(button.hasAttribute('data-retry')){start();}
});

const FIXTURE_PREFS_KEY='odds-lens-fixture-preferences-v1';
function loadFixturePreferences(){
  loadWorkbenchSession();
  try{const p=JSON.parse(localStorage.getItem(FIXTURE_PREFS_KEY)||'{}');if(Array.isArray(p.favorites))state.fixtureFavorites=new Set(p.favorites.filter(v=>typeof v==='string').slice(-1000));if(['time','changes'].includes(p.sort))state.fixtureSort=p.sort;if(['scan','expanded'].includes(p.view))state.fixtureView=p.view;}catch{}
}
function saveFixturePreferences(){try{localStorage.setItem(FIXTURE_PREFS_KEY,JSON.stringify({favorites:[...state.fixtureFavorites],sort:state.fixtureSort,view:state.fixtureView}));}catch{toast('이 기기에 관심 경기를 저장하지 못했습니다.');}}
const WORKBENCH_SESSION_KEY='odds-lens-workbench-v1';
function loadWorkbenchSession(){
  try{
    const saved=JSON.parse(sessionStorage.getItem(WORKBENCH_SESSION_KEY)||'{}');
    if(saved.reviewed&&typeof saved.reviewed==='object')state.reviewed=Object.fromEntries(Object.entries(saved.reviewed).filter(([,v])=>typeof v==='string').slice(-1000));
    if(saved.labels&&typeof saved.labels==='object')state.compareLabels=saved.labels;
    for(const sport of Object.keys(SPORT_DATA))if(Array.isArray(saved.compare?.[sport]))state.compareBySport[sport]=[...new Set(saved.compare[sport].filter(id=>typeof id==='string'))].slice(0,4);
    state.compareIds=[...(state.compareBySport[state.sport]||[])];
  }catch{}
}
function saveWorkbenchSession(){
  state.compareBySport[state.sport]=[...state.compareIds];
  try{sessionStorage.setItem(WORKBENCH_SESSION_KEY,JSON.stringify({compare:state.compareBySport,labels:state.compareLabels,reviewed:state.reviewed}));}catch{}
}
function markReviewed(event){
  delete state.reviewed[event.id];state.reviewed[event.id]=reviewToken(event);
  state.reviewed=Object.fromEntries(Object.entries(state.reviewed).slice(-1000));saveWorkbenchSession();
}
function toggleComparison(id){
  const event=feedEvents().find(e=>String(e.id)===id);if(!event)return;
  const next=toggleCompare(state.compareIds,id);
  if(next.action==='limit'){toast('최대 4경기까지 비교할 수 있습니다. 선택한 경기를 먼저 해제해주세요.');return;}
  state.compareIds=next.ids;state.compareLabels[id]={home:event.home,away:event.away};
  state.compareLabels=Object.fromEntries(Object.entries(state.compareLabels).slice(-1000));
  saveWorkbenchSession();void render({preserveScroll:true});
}
function workbenchFilters(){
  const events=feedEvents().filter(e=>canonicalSport(e.sport)===state.sport&&shortDate(e.startsAt)>=shortDate(new Date().toISOString()));
  return `${liveControls(events)}<label class="bench-sort">정렬<select id="fixture-sort"><option value="time" ${state.fixtureSort==='time'?'selected':''}>경기 시작시간순</option><option value="changes" ${state.fixtureSort==='changes'?'selected':''}>최근 배당 변경순</option></select></label><p class="bench-explanation">관심 경기는 이 기기에 저장됩니다. 비교 후보와 확인 표시는 이 탭에서 유지되며, 종목별 비교 후보는 따로 보관합니다.</p><div class="bench-filter-actions"><button class="button" data-reset-fixtures>조건 초기화</button><button class="button primary" data-close-workbench>${filteredEvents().length}경기 보기</button></div>`;
}
const workbench=createWorkbench({
  dialog:$('#workbench-drawer'),state,events:feedEvents,analysis:scanAnalysisForSheet,
  marketHtml:(event,market)=>marketRow(event,market,null),filterHtml:workbenchFilters,
  onReview:markReviewed,onClose:()=>{if((state.route==='today'))void render({preserveScroll:true});},updateChrome,toast
});
let fixtureSearchTimer;
document.addEventListener('input',event=>{
  if(event.target.id!=='fixture-search')return;
  state.fixtureSearch=event.target.value;state.fixtureLimit=40;clearTimeout(fixtureSearchTimer);
  const caret=event.target.selectionStart;
  fixtureSearchTimer=setTimeout(async()=>{
    if(!(state.route==='today'))return;
    const hadFocus=document.activeElement?.id==='fixture-search';await render({preserveScroll:true});
    const input=$('#fixture-search');if(input&&hadFocus){input.focus({preventScroll:true});input.setSelectionRange(caret,caret);}
  },180);
});
let quoteDrawerState=null,quoteDrawerRequest=0,quoteDrawerFocus=null,quoteDrawerBodyOverflow='';
function paintQuoteHistory(){
  const dialog=$('#odds-history-drawer');if(!quoteDrawerState)return;
  const scroll=dialog.querySelector('.quote-history-body')?.scrollTop||0,active=document.activeElement,action=active?.closest('[data-more-odds-history],[data-retry-odds-history],[data-close-odds-history]');
  const focusAttribute=action?['data-more-odds-history','data-retry-odds-history','data-close-odds-history'].find(a=>action.hasAttribute(a)):null;
  dialog.innerHTML=quoteHistoryDrawerView(quoteDrawerState);dialog.querySelector('.quote-history-body').scrollTop=scroll;
  if(focusAttribute&&dialog.open)(dialog.querySelector(`[${focusAttribute}]`)||dialog.querySelector('[data-close-odds-history]')).focus({preventScroll:true});
}
async function openQuoteHistory(dataset,trigger){
  const event=feedEvents().find(e=>String(e.id)===String(dataset.eventId)),market=event?.markets.find(m=>String(m.id)===String(dataset.marketId));
  if(!market)return;
  quoteDrawerFocus=trigger;quoteDrawerState={event,market,payload:null,loading:true,error:'',moreLoading:false};paintQuoteHistory();
  const dialog=$('#odds-history-drawer');quoteDrawerBodyOverflow=document.body.style.overflow;document.body.style.overflow='hidden';dialog.showModal();await loadQuoteHistory();
}
function closeQuoteHistory(){const dialog=$('#odds-history-drawer');if(dialog.open)dialog.close();}
$('#odds-history-drawer').addEventListener('close',()=>{
  ++quoteDrawerRequest;quoteDrawerState=null;document.body.style.overflow=quoteDrawerBodyOverflow;
  if(quoteDrawerFocus?.isConnected)quoteDrawerFocus.focus({preventScroll:true});else $('[data-open-odds-history]')?.focus({preventScroll:true});quoteDrawerFocus=null;
});
$('#odds-history-drawer').addEventListener('click',event=>{if(event.target===$('#odds-history-drawer')){const bounds=event.target.getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)closeQuoteHistory();}});
async function loadQuoteHistory({more=false,quiet=false}={}){
  const item=quoteDrawerState;if(!item||item.moreLoading||more&&!item.payload?.nextCursor)return;
  const sequence=++quoteDrawerRequest,cursor=more?item.payload.nextCursor:'';
  item.error='';item.loading=!quiet&&!more;item.moreLoading=more;if(!quiet)paintQuoteHistory();
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
  try{
    const params=new URLSearchParams({event_id:item.event.canonicalEventId||item.event.id,...(cursor?{cursor}:{})});
    const response=await fetch(`api/odds-history/${encodeURIComponent(item.market.id)}?${params}`,{cache:'no-store',signal:controller.signal}),payload=await response.json();
    if(sequence!==quoteDrawerRequest||item!==quoteDrawerState)return;
    if(response.status===404){item.payload=null;item.market={...item.market,oddsHistory:null};}
    else if(!response.ok)throw Error('저장된 이력을 읽지 못했습니다. 잠시 후 다시 시도해주세요.');
    else if(more){const ids=new Set(item.payload.points.map(p=>p.id));item.payload={...payload,points:[...item.payload.points,...payload.points.filter(p=>!ids.has(p.id))]};}
    else if(quiet&&item.payload){const ids=new Set(payload.points.map(p=>p.id));item.payload={...payload,points:[...payload.points,...item.payload.points.filter(p=>!ids.has(p.id))].sort((a,b)=>b.observedAt.localeCompare(a.observedAt)||b.id.localeCompare(a.id)),nextCursor:item.payload.nextCursor};}
    else item.payload=payload;
  }catch(error){if(sequence===quoteDrawerRequest&&item===quoteDrawerState)item.error=error.name==='AbortError'?'이력 연결이 지연되었습니다. 다시 불러올 수 있습니다.':error.message;}
  finally{clearTimeout(timeout);if(sequence===quoteDrawerRequest&&item===quoteDrawerState){item.loading=false;item.moreLoading=false;paintQuoteHistory();}}
}

function buildChrome(){
  $('#navigation').innerHTML=routes.map(([id,icon,label])=>`<button data-route="${id}" class="nav-item ${primaryRoutes.has(id)?'nav-primary':'nav-extra'}">${navIcon(id)}<span class="nav-text">${label}</span>${id==='cart'?'<span class="nav-count" hidden></span>':''}</button>`).join('')+`<button class="nav-item nav-more" data-open-menu aria-haspopup="dialog" aria-controls="menu-drawer" aria-expanded="false">${navIcon('more')}<span class="nav-text">더보기</span></button>`;
  const descriptions={reading:'마진·확률 변화·결과별 지급위험',patterns:'연속·교차 패턴 참고',validation:'예측 기록과 검증 실적',data:'공식 배당과 과거 자료',method:'표본·적중률·등급 기준'};
  $('#secondary-navigation').innerHTML=routes.filter(([id])=>!primaryRoutes.has(id)).map(([id,icon,label])=>`<button data-route="${id}">${navIcon(id)}<span><b>${label}</b><small>${descriptions[id]}</small></span></button>`).join('');
  $('#sports').innerHTML=['야구','축구','농구','배구'].map(sport=>`<button data-sport="${sport}">${sport}</button>`).join('');
}

function normalizedRoute(){
  const hash=location.hash.slice(1);
  if(hash==='high-probability'){history.replaceState(null,'','#signals');return 'signals';}
  return routes.some(([id])=>id===hash)?hash:'today';
}
async function start(){
  try{
    loadFixturePreferences();
    buildChrome();
    state.route=normalizedRoute();
    if(state.route==='signals'){void render();void loadSignals();}
    const entries=await Promise.all(Object.entries(SPORT_DATA).map(async([sport,config])=>[config.key,await json(config.manifestUrl)]));
    state.manifests=Object.fromEntries(entries);
    state.manifest=state.manifests[sportKey()];
    if(state.route==='signals')return;
    await loadStoredFeed();
    await render();
    void warmHistoricalSources().then(changed=>{if(changed)return render({preserveScroll:true});}).catch(()=>{});
  }catch(error){
    if(state.route==='signals')return;
    $('#notice').textContent='원본 데이터 연결 오류';
    app.innerHTML=empty('데이터 연결을 확인해주세요.',error.message,'<button class="button" data-retry>다시 시도</button>');
  }
}

function refreshAppSources(){
  if(state.route==='signals'){void loadSignals();return;}
  if(state.route==='cart'&&state.slipLoaded)void loadSlips();
  const key=sportKey();
  if(state.history[key]&&Date.now()-(state.historyCheckedAt[key]||0)>60000){
    state.historyCheckedAt[key]=Date.now();
    void json(`api/history/${key}/current.json?summary=1`).then(async summary=>{
      if(summary.sourceVersion&&summary.sourceVersion!==state.historyDataVersion[key]&&key===sportKey()){
        await historyRows({force:true});void render({preserveScroll:true});
      }
    }).catch(()=>{});
  }
  if(state.feedPreview||state.refreshing)return;
  void loadStoredFeed().then(outcome=>{
    updateChrome();
    if(state.refreshing)return;
    if(outcome?.changed||outcome?.errorChanged||state.renderedFreshnessKind!==freshness().kind||((state.route==='today')&&state.renderedFixturePhase!==fixturePhaseSignature()))return render({preserveScroll:true});
  }).catch(()=>{});
  void warmHistoricalSources().then(changed=>{if(changed)return render({preserveScroll:true});}).catch(()=>{});
}

function syncRouteFromLocation(){
  workbench.close();
  const route=normalizedRoute();
  if(!routes.some(([id])=>id===route)||route===state.route)return;
  rememberRouteScroll();
  state.route=route;
  if(route==='signals')void loadSignals();else if(!state.feed)refreshAppSources();
  const restoreSnapshot=state.routeScroll[route]||{x:0,y:0,anchor:null};
  state.pendingRouteScroll={route,snapshot:restoreSnapshot};
  void render({restoreSnapshot,scrollToTop:!state.routeScroll[route]});
}

if(typeof history!=='undefined'&&'scrollRestoration' in history)history.scrollRestoration='manual';
start();
if(typeof setInterval==='function')setInterval(()=>{if(document.visibilityState==='visible')refreshAppSources();},30000);

if(typeof window!=='undefined')window.addEventListener('scroll',scheduleRouteScrollMemory,{passive:true});
if(typeof window!=='undefined')window.addEventListener('hashchange',syncRouteFromLocation);
if(typeof window!=='undefined')window.addEventListener('popstate',syncRouteFromLocation);
if(typeof window!=='undefined')window.addEventListener('pageshow',refreshAppSources);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshAppSources();});
if(typeof window!=='undefined')window.addEventListener('online',refreshAppSources);

let signalSearchTimer;
document.addEventListener('input',event=>{
  if(event.target.id==='signal-search'){
    signalState.search=event.target.value;signalState.limit=40;clearTimeout(signalSearchTimer);
    signalSearchTimer=setTimeout(()=>{if(state.route==='signals')void render({preserveScroll:true});},180);
  }
  if(event.target.closest('#signal-calculator')&&/^p[0-5]$/.test(event.target.name))signalState.calculatorValues[Number(event.target.name.slice(1))]=event.target.value;
});
document.addEventListener('change',event=>{
  if(['signal-date','signal-league','signal-market','signal-phase'].includes(event.target.id)){
    signalState[event.target.id.replace('signal-','')]=event.target.value;signalState.limit=40;void render({preserveScroll:true});
  }
});
document.addEventListener('submit',event=>{
  if(event.target.id!=='signal-calculator')return;
  event.preventDefault();const values=Array.from({length:6},(_,i)=>event.target.elements.namedItem('p'+i).value);
  signalState.calculatorValues=values;
  if(values.some(v=>v.trim()===''||!Number.isFinite(Number(v))||Number(v)<0||Number(v)>100)){signalState.calculatorError='확률 6개를 0~100 사이 숫자로 입력해주세요.';signalState.calculatorResult=null;}
  else{signalState.calculatorError='';signalState.calculatorResult=analyzeSignal(values.slice(0,3),values.slice(3));}
  void render({preserveScroll:true});
});
