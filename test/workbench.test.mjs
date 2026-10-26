import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from 'cheerio';
import {chooseMarket,reviewToken,reviewState,toggleCompare,comparisonColumns,eventDayGroups,outcomeAtSlot} from '../public/odds-lens/workbench-core.mjs';
import {scanControlsView,scanFixtureView,comparisonView,quickEvidenceView,workbenchDockView} from '../public/odds-lens/workbench-ui.mjs';
import {createWorkbench} from '../public/odds-lens/workbench-controller.mjs';
import {analyzePatternEvent} from '../public/odds-lens/pattern-board.mjs';

const quote=(id,type='일반',patch={})=>({id,market:type,line:type==='일반'?null:8.5,period:'full',available:true,saleStatus:'selling',status:'발매 중',round:'260120',gameNumber:1,observedAt:'2026-10-13T01:00:00Z',outcomes:[{key:'home',label:'홈 승',odds:1.8},{key:'away',label:'원정 승',odds:2.1}],...patch});
const fixture=(id,markets=[quote(id+'-general')],patch={})=>({id,sport:'baseball',league:'KBO',home:'홈팀 '+id,away:'원정팀 '+id,startsAt:'2026-10-14T10:00:00Z',markets,...patch});

test('representative offer is deterministic, prefers a selling offer and never substitutes another market family',()=>{
 const old=quote('old','일반',{available:false,round:'260121'}),live=quote('live'),total=quote('total','언오버');
 const event=fixture('a',[total,old,live]);
 assert.equal(chooseMarket(event).id,'live');assert.equal(chooseMarket({...event,markets:[live,old,total]}).id,'live');
 assert.equal(chooseMarket(event,'일반','old').id,'old');assert.equal(chooseMarket(event,'핸디캡'),null);
 const newer=quote('new','일반',{round:'260121'});assert.equal(chooseMarket(fixture('b',[live,newer]),'일반').id,'new');
});
test('review markers survive unchanged collection and invalidate after prices, lines, status, availability or start time change',()=>{
 const event=fixture('a'),token=reviewToken(event),reviewed={a:token};
 assert.equal(reviewState(event,{}),'new');assert.equal(reviewState(event,reviewed),'reviewed');
 const collected=structuredClone(event);collected.markets[0].observedAt='2026-10-13T01:30:00Z';collected.markets[0].oddsHistory={changeCount:0};
 assert.equal(reviewToken(collected),token);
 for(const change of [e=>e.markets[0].outcomes[0].odds=1.7,e=>e.markets[0].line=-1.5,e=>e.markets[0].saleStatus='closed',e=>e.markets[0].available=false,e=>e.startsAt='2026-10-14T11:00:00Z']){
  const next=structuredClone(event);change(next);assert.equal(reviewState(next,reviewed),'updated');
 }
 const multiple=fixture('b',[quote('x'),quote('y','언오버')]);assert.equal(reviewToken(multiple),reviewToken({...multiple,markets:[...multiple.markets].reverse()}));
});
test('comparison permits four unique fixtures, removal and a replacement without silently dropping a candidate',()=>{
 let ids=[];for(const id of ['a','b','c','d'])ids=toggleCompare(ids,id).ids;
 assert.deepEqual(toggleCompare(ids,'e'),{ids:['a','b','c','d'],action:'limit'});
 ids=toggleCompare(ids,'b').ids;assert.deepEqual(toggleCompare(ids,'e').ids,['a','c','d','e']);
 assert.deepEqual(toggleCompare(['a','a','b'],'a').ids,['b']);
});
test('comparison keeps missing fixtures and missing markets explicit while allowing exact line selection',()=>{
 const a=fixture('a',[quote('total8','언오버'),quote('total9','언오버',{line:9.5})]),b=fixture('b');
 const columns=comparisonColumns(['a','b','gone'],[a,b],'언오버',{a:'total9'});
 assert.equal(columns[0].market.id,'total9');assert.equal(columns[1].market,null);assert.equal(columns[2].event,null);
 const $=load(comparisonView(['a','b','gone'],[a,b],{type:'언오버',preferred:{a:'total9'},labels:{gone:{home:'지난 홈',away:'지난 원정'}}}));
 assert.equal($('thead th').length,4);assert.match($('thead').text(),/지난 홈.*현재 경기표에 없음/s);
 assert.match($('tbody tr').eq(1).find('td').eq(0).text(),/9.5/);assert.equal($('tbody tr').eq(1).find('td').eq(1).text(),'미제공');
 assert.equal($('[data-bench-compare-offer="a"] option[selected]').attr('value'),'total9');
});
test('KST dates stay ordered across midnight and two-outcome markets leave the middle slot empty',()=>{
 const groups=eventDayGroups([fixture('a',[],{startsAt:'2026-10-13T14:59:00Z'}),fixture('b',[],{startsAt:'2026-10-13T15:00:00Z'}),fixture('c',[],{startsAt:'bad'})]);
 assert.deepEqual(groups.map(g=>g.day),['2026-10-13','2026-10-14','시각 미확인']);
 assert.equal(outcomeAtSlot(quote('a'),1),null);assert.equal(outcomeAtSlot(quote('a'),2).key,'away');
});
test('scan counts use the selected market while review status covers the complete fixture',()=>{
 const changed=quote('total','언오버',{oddsHistory:{changeCount:2}}),a=fixture('a',[quote('a-g'),changed]),b=fixture('b');
 const options={market:'일반',reviewed:{a:reviewToken(a)},favorites:new Set(['a'])};
 let $=load(scanControlsView([a,b],options));assert.equal($('[data-fixture-filter="changed"] b').text(),'0');assert.equal($('[data-fixture-filter="unreviewed"] b').text(),'1');
 assert.equal($('[data-fixture-filter="favorites"] b').text(),'1');
 $=load(scanControlsView([a,b],{...options,market:'all'}));assert.equal($('[data-fixture-filter="changed"] b').text(),'1');
});
test('compact rows show the requested changed offer, escape input, and never show a price arrow across a line change',()=>{
 const total=quote('total','언오버',{line:9.5});total.oddsHistory={first:quote('first','언오버'),changeCount:1};
 const event=fixture('a',[quote('normal'),total],{home:'<img src=x onerror=alert(1)>'});
 const html=scanFixtureView(event,{marketType:'all',marketId:'total',compared:true}),$=load(html);
 assert.equal($('img').length,0);assert.match($('.bench-home').text(),/<img/);
 assert.equal($('.bench-prices button').first().attr('data-market-id'),'total');
 assert.match($('.quote-delta').first().text(),/조건 변경/);assert.equal($('.quote-delta.up,.quote-delta.down').length,0);
 assert.equal($('[data-bench-compare]').attr('aria-pressed'),'true');
 const controls=load(scanControlsView([event],{search:'" onfocus="bad'}));assert.equal(controls('#fixture-search').attr('onfocus'),undefined);
});
test('evidence excerpts retain their own cohort, basis, sample and conflict grade',()=>{
 const event=fixture('a',[],{home:'Alpha',away:'Beta',startsAt:'2027-01-01T09:00:00Z',teamNamesVerified:true});
 const market=quote('total','언오버',{outcomes:[{key:'under',label:'언더',odds:1.7},{key:'over',label:'오버',odds:1.8}]});
 const rows=Array.from({length:60},(_,i)=>({id:'case-'+i,date:new Date(Date.UTC(2024,0,1+i)).toISOString().slice(0,10)+' 18:00',home:i<7?'Alpha':'Other',away:'Past'+i,league:'KBO',market:'언오버',line:8.5,closing:[1.7,null,1.8],result:i<7?'언더':'오버'}));
 const pattern=analyzePatternEvent(event,market,rows,{includeSequences:false});
 const $=load(quickEvidenceView(event,market,pattern)),under=pattern.recommendations.find(r=>r.slot===0),row=$('.bench-evidence-row').filter((_,el)=>$(el).find('b').text().startsWith('언더'));
 assert.match(row.text(),new RegExp(`${under.best.wins}/${under.best.n}건`));assert.match(row.text(),/C 근거/);
 assert.equal(row.find('[data-show-evidence]').attr('data-evidence-scope'),under.best.scope);assert.equal(row.find('[data-show-evidence]').attr('data-evidence-basis'),under.best.basis);
 assert.match($.text(),/이번 경기의 예측확률이 아닙니다/);
 assert.match(quickEvidenceView(event,market,null,{loading:'error'}),/불러오지 못했습니다/);
});
test('a single candidate cannot open comparison and the dock distinguishes fixture candidates from outcome picks',()=>{
 let $=load(workbenchDockView({compareCount:1,draftCount:2}));assert.ok($('[data-open-bench-compare]').is('[disabled]'));assert.match($('[data-route="cart"]').text(),/담은 픽 2개/);
 $=load(workbenchDockView({compareCount:4}));assert.equal($('[data-open-bench-compare]').is('[disabled]'),false);assert.equal($('[data-route="cart"]').length,0);
 assert.equal(workbenchDockView({}),'');
});

// A small DOM port verifies controller behavior, without a browser or layout assertions.
class DialogPort{
 open=false;listeners={};dataset={};nodes=new Map();html='';
 set innerHTML(value){this.html=value;this.$=load(value);this.nodes.clear();}
 get innerHTML(){return this.html;}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 querySelectorAll(selector){return this.$(selector).toArray().map(el=>{
  if(this.nodes.has(el))return this.nodes.get(el);
  const node={owner:this,hidden:el.attribs.hidden!==undefined,scrollTop:0,scrollLeft:0,id:el.attribs.id||'',dataset:Object.fromEntries(Object.entries(el.attribs).filter(([key])=>key.startsWith('data-')).map(([key,v])=>[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),v])),getAttributeNames:()=>Object.keys(el.attribs),getAttribute:key=>el.attribs[key],focus(){globalThis.document.activeElement=this;}};
  this.nodes.set(el,node);return node;
 });}
 contains(node){return node?.owner===this;}
 addEventListener(name,fn){this.listeners[name]=fn;}
 showModal(){this.open=true;}
 close(){this.open=false;this.listeners.close?.();}
}
const action=(name,dataset={})=>({dataset,hasAttribute:key=>key===name});
test('open sheets freeze quotes, explicitly refresh them, validate stale actions and return to the original comparison snapshot',async t=>{
 const globals={document:globalThis.document,CSS:globalThis.CSS,requestAnimationFrame:globalThis.requestAnimationFrame};
 globalThis.document={activeElement:null,body:{classList:{add(){},remove(){}}},querySelector:()=>null};globalThis.CSS={escape:String};globalThis.requestAnimationFrame=fn=>fn();
 t.after(()=>{for(const [key,value]of Object.entries(globals)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
 let source=[fixture('a'),fixture('b')];const dialog=new DialogPort(),state={sport:'야구',feedSignature:'first',liveMarket:'일반',compareIds:['a','b'],compareLabels:{}},reviewed=[],messages=[];
 const controller=createWorkbench({dialog,state,events:()=>source,analysis:()=>null,marketHtml:(event,market)=>`<button data-add-pick data-event-id="${event.id}" data-market-id="${market.id}" data-slot="0">담기</button>`,filterHtml:()=>'',onReview:event=>reviewed.push(reviewToken(event)),onClose:()=>{},updateChrome:()=>{},toast:text=>messages.push(text)});
 controller.click(action('data-open-bench-compare'));assert.equal(dialog.open,true);assert.match(dialog.innerHTML,/1.80/);
 source=structuredClone(source);source[0].markets[0].outcomes[0].odds=1.65;state.feedSignature='second';controller.signalUpdate();
 assert.equal(dialog.querySelector('.bench-update-notice').hidden,false);assert.match(dialog.innerHTML,/1.80/);assert.doesNotMatch(dialog.innerHTML,/1.65/);
 controller.click(action('data-open-bench-fixture',{eventId:'a',marketId:'a-general'}));
 const pick=dialog.querySelector('[data-add-pick]');assert.equal(pick.dataset.expectedOdds,'1.8');assert.equal(controller.actionIsStale(pick),true);assert.match(messages.at(-1),/새 값으로 갱신/);
 controller.click(action('data-return-bench-compare'));assert.match(dialog.innerHTML,/1.80/);assert.doesNotMatch(dialog.innerHTML,/1.65/);
 controller.click(action('data-refresh-workbench'));assert.match(dialog.innerHTML,/1.65/);assert.equal(dialog.querySelector('.bench-update-notice').hidden,true);
 controller.click(action('data-open-bench-fixture',{eventId:'a',marketId:'a-general'}));assert.equal(dialog.querySelector('[data-add-pick]').dataset.expectedOdds,'1.65');assert.equal(controller.actionIsStale(dialog.querySelector('[data-add-pick]')),false);
 source[0].markets[0].line=-1.5;controller.signalUpdate();assert.equal(dialog.querySelector('.bench-update-notice').hidden,false);
 assert.equal(reviewed.length,2);controller.close();assert.equal(dialog.open,false);
});
