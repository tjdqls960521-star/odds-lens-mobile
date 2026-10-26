import {pickConditionKey} from './pick-policy.mjs?v=20261013-3';
import {chooseMarket,outcomeAtSlot,reviewToken} from './workbench-core.mjs';
import {workbenchDialogView,peekBodyView,comparisonView} from './workbench-ui.mjs';

// Keep the sheet's quote snapshot independent of periodic feed rendering.
export function createWorkbench({dialog,state,events,analysis,marketHtml,filterHtml,onReview,onClose,updateChrome,toast}){
 let current=null,opener=null;
 const patternMap=groups=>new Map(groups.flatMap(g=>g.markets.map(({market,pattern})=>[market.id,pattern])));
 function rememberFocus(){
  const active=document.activeElement;
  if(!dialog.contains(active))return null;
  if(active.id)return '#'+CSS.escape(active.id);
  const attr=active.getAttributeNames().find(name=>name.startsWith('data-'));
  return attr?`[${attr}="${CSS.escape(active.getAttribute(attr))}"]`:null;
 }
 function updated(){
  if(!current||current.kind==='filters')return false;
  const latest=new Map(events().map(e=>[String(e.id),e]));
  return current.ids.some(id=>{
   const before=current.events.find(e=>String(e.id)===id),after=latest.get(id);
   return (!before)!==(!after)||before&&after&&(reviewToken(before)!==reviewToken(after)||before.startsAt!==after.startsAt);
  });
 }
 function signalUpdate(){const notice=dialog.querySelector('.bench-update-notice');if(notice)notice.hidden=!updated();}
 function paint({resetScroll=false}={}){
  if(!current)return;
  const focus=rememberFocus(),scroll=resetScroll?0:dialog.querySelector('.bench-dialog-body')?.scrollTop||0;
  const tableScroll=resetScroll?0:dialog.querySelector('.bench-table-scroll')?.scrollLeft||0;
  let title,context,body;
  if(current.kind==='filters'){
   title='경기 찾기';context='목록 조건';body=filterHtml();
  }else if(current.kind==='compare'){
   title=`${current.ids.length}경기 나란히 비교`;context='비교 후보 · 최대 4경기';
   body=comparisonView(current.ids,current.events,{type:current.type,preferred:current.preferred,patterns:current.patterns,labels:state.compareLabels,loading:current.loading});
  }else{
   const event=current.events.find(e=>String(e.id)===current.eventId),market=chooseMarket(event,'all',current.marketId);
   title='경기 빠른 분석';context='목록의 위치는 그대로 유지됩니다';
   body=current.parent?'<button class="button bench-return" data-return-bench-compare>← 비교표로 돌아가기</button>':'';
   body+=event?peekBodyView(event,market,{marketHtml:market?marketHtml(event,market):'',pattern:current.patterns.get(market?.id),loading:current.loading}):'<p class="bench-explanation">이 경기는 현재 경기표에 없습니다. 비교표에서 다른 경기를 확인해주세요.</p>';
  }
  dialog.dataset.kind=current.kind;
  dialog.innerHTML=workbenchDialogView({title,context,body,kind:current.kind});
  dialog.querySelector('.bench-dialog-body').scrollTop=scroll;
  const table=dialog.querySelector('.bench-table-scroll');if(table)table.scrollLeft=tableScroll;
  // A frozen quote must not silently add a different price to the cart.
  dialog.querySelectorAll('[data-add-pick]').forEach(button=>{
   const event=current.events?.find(e=>String(e.id)===button.dataset.eventId),market=event?.markets.find(m=>String(m.id)===button.dataset.marketId);
   const outcome=outcomeAtSlot(market,Number(button.dataset.slot));
   if(outcome){button.dataset.expectedOdds=String(outcome.odds);button.dataset.expectedCondition=pickConditionKey(market);}
  });
  signalUpdate();updateChrome();
  if(dialog.open&&focus)(dialog.querySelector(focus)||dialog.querySelector('[data-close-workbench]'))?.focus({preventScroll:true});
 }
 function fillPatterns(snapshot){
  const value=analysis(snapshot.sport);
  if(!value||value.signature!==snapshot.signature)return;
  snapshot.patterns=patternMap(value.groups);snapshot.loading=value.error?'error':value.loading;
  if(value.promise)value.promise.then(result=>{
   if(!result)return;
   snapshot.patterns=patternMap(result.groups);snapshot.loading=result.error?'error':false;
   if(snapshot.parent){snapshot.parent.patterns=snapshot.patterns;snapshot.parent.loading=snapshot.loading;}
   if(current===snapshot)paint();
   else if(current?.parent===snapshot){current.patterns=snapshot.patterns;current.loading=snapshot.loading;paint();}
  });
 }
 function snapshot(){
  const value={events:structuredClone(events()),signature:state.feedSignature,sport:state.sport,patterns:new Map(),loading:false,preferred:{}};
  fillPatterns(value);return value;
 }
 function show(value,trigger){
  if(!dialog.open)opener=trigger||document.activeElement;
  current=value;paint({resetScroll:true});
  if(!dialog.open){dialog.showModal();document.body.classList.add('workbench-open');}
  dialog.querySelector('[data-close-workbench]')?.focus({preventScroll:true});
 }
 function openFixture(id,marketId,trigger){
  const source=current?.kind==='compare'?current:null;
  const value=source?{...source,parent:source,preferred:{...source.preferred}}:snapshot();
  const event=value.events.find(e=>String(e.id)===String(id));
  if(!event){toast('현재 경기표에서 이 경기를 찾지 못했습니다.');return;}
  value.kind='peek';value.eventId=String(id);value.ids=[String(id)];
  value.marketId=chooseMarket(event,'all',marketId)?.id;
  onReview(event);show(value,trigger);
 }
 function openCompare(trigger){
  if(state.compareIds.length<2){toast('비교할 경기를 두 개 이상 선택해주세요.');return;}
  const value=snapshot();value.kind='compare';value.ids=[...state.compareIds];
  value.type=state.liveMarket==='all'?'일반':state.liveMarket;
  // Prefer a market actually offered by one of the selected fixtures.
  if(!value.events.some(e=>value.ids.includes(String(e.id))&&chooseMarket(e,value.type)))value.type=value.events.find(e=>value.ids.includes(String(e.id)))?.markets[0]?.market||'일반';
  show(value,trigger);
 }
 function close(){if(dialog.open)dialog.close();}
 function refresh(){
  if(!current||current.kind==='filters')return;
  const previous=current,value=snapshot();
  Object.assign(value,{kind:previous.kind,ids:[...previous.ids],type:previous.type,preferred:previous.preferred,eventId:previous.eventId,marketId:previous.marketId});
  if(previous.parent)value.parent={...previous.parent,events:value.events,signature:value.signature,patterns:value.patterns,loading:value.loading};
  const event=value.events.find(e=>String(e.id)===value.eventId);if(event)onReview(event);
  current=value;paint();
 }
 function change(input){
  if(!current)return false;
  if(input.id==='bench-offer'){
   current.marketId=input.value;paint();return true;
  }
  if(input.hasAttribute('data-bench-compare-offer')){
   current.preferred[input.dataset.benchCompareOffer]=input.value;paint();return true;
  }
  return false;
 }
 function click(button){
  if(button.hasAttribute('data-close-workbench')){close();return true;}
  if(button.hasAttribute('data-refresh-workbench')){refresh();return true;}
  if(button.hasAttribute('data-open-bench-fixture')){openFixture(button.dataset.eventId,button.dataset.marketId,button);return true;}
  if(button.hasAttribute('data-open-bench-compare')){openCompare(button);return true;}
  if(button.hasAttribute('data-open-bench-filters')){show({kind:'filters'},button);return true;}
  if(button.hasAttribute('data-return-bench-compare')){if(current?.parent){current=current.parent;paint({resetScroll:true});}return true;}
  if(button.hasAttribute('data-bench-compare-market')){current.type=button.dataset.benchCompareMarket;paint();return true;}
  return false;
 }
 function removeColumn(id){
  if(current?.kind!=='compare')return;
  current.ids=current.ids.filter(value=>value!==id);
  if(current.ids.length)paint();else close();
 }
 // Block actions whose evidence or market conditions no longer match the sheet.
 function actionIsStale(button){
  if(dialog.contains(button)&&updated()){
   toast('배당·상태가 변경되었습니다. 새 값으로 갱신한 뒤 확인해주세요.');
   dialog.querySelector('[data-refresh-workbench]')?.focus({preventScroll:true});
   return true;
  }
  return false;
 }
 dialog.addEventListener('close',()=>{
  current=null;document.body.classList.remove('workbench-open');
  onClose();
  // The scan list can replace the original trigger while a sheet is open.
  requestAnimationFrame(()=>{if(opener?.isConnected)opener.focus({preventScroll:true});else document.querySelector('#fixture-search')?.focus({preventScroll:true});opener=null;});
 });
 dialog.addEventListener('click',event=>{
  if(event.target!==dialog)return;
  const bounds=dialog.getBoundingClientRect();
  if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)close();
 });
 return {click,change,close,signalUpdate,removeColumn,actionIsStale,repaintFilters:()=>{if(current?.kind==='filters')paint();}};
}
