import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {parseFeed} from '../src/betman-feed.mjs';
import {assessPrediction,selectHighProbability} from '../public/odds-lens/prediction-core.mjs';
import {FEATURE_FLAGS,findApprovedModel} from '../src/model-registry.mjs';
const root='http://127.0.0.1:61872/odds-lens/';
const report=JSON.parse(readFileSync('src/validation-status.json'));
const fields=['id','event','date','league','market','home','away','opening','closing','openingLine','line','changes','score','result','venue'];
for(const width of [360,390,430])test(`AC12 mobile ${width}px: all leagues, quote/detail navigation, tabs, refresh and scroll`,async({page})=>{
 await page.setViewportSize({width,height:844});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const raw=JSON.parse(readFileSync('test/fixtures/betman-public.json'));
 const keys=raw.compSchedules.keys,game=keys.indexOf('gameDate'),end=keys.indexOf('endDate'),league=keys.indexOf('leagueShortName');
 const base=Math.min(...raw.compSchedules.datas.map(r=>Number(r[game]))),now=new Date();
 for(const r of raw.compSchedules.datas){r[game]=Date.now()+86400000+(Number(r[game])-base);r[end]=r[game]-300000;if(r[keys.indexOf('itemCode')]==='SC')r[league]='QA 전체리그';}
 let feed=parseFeed(raw,now);feed.refreshState={lastSuccess:now.getTime()/1000,ledgerVersion:3,error:null};
 let failLedger=false;
 const e=feed.events.find(e=>e.sport==='soccer'&&e.markets.some(m=>m.outcomes.length)),m=e.markets.find(m=>m.outcomes.length);
 m.saleStatus='selling';m.status='발매 중';m.saleClosesAt=new Date(Date.parse(e.startsAt)-300000).toISOString();m.available=true;
 const model=findApprovedModel(e,m,now.toISOString()),modelProbability=m.outcomes.length===3?[.85,.1,.05]:[.85,.15];
 const saved={schemaVersion:3,prediction_id:'f'.repeat(64),event_id:e.id,market_id:m.canonicalMarketId,offer_id:m.id,event:{...e,markets:undefined},market:{...m},source_observed_at:now.toISOString(),prediction_as_of:now.toISOString(),model_version:model.version,policy_version:model.policy.version,snapshot_id:'s'.repeat(64),input_snapshot_hash:'h'.repeat(64),policy:model.policy,evidence:{tier:model.evidenceTier,quoteStage:model.evidenceStage},samples:{trainingMarkets:model.trainMarketCount,independentEvents:model.independentEventCount},...assessPrediction({event:e,market:m,sourceObservedAt:now.toISOString(),asOf:now.toISOString(),model,policy:model.policy,pModel:modelProbability})};m.prediction=saved;
 const high=selectHighProbability([saved],{now:now.getTime()});
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url()),path=url.pathname;
  if(url.hostname!=='127.0.0.1')return route.abort();
  if(path.includes('/data/')&&path.endsWith('manifest.json')){
   const sport=path.includes('/v2/')?path.split('/v2/')[1].split('/')[0]:'baseball';
   return route.fulfill({json:{fields,years:{2026:0},dataRoot:`qa/${sport}`,rows:0,sourceTitle:'QA fixture only',dateRange:['2026-01-01','2026-09-01'],leagues:{},markets:{},sourceUrl:'https://example.invalid'}});
  }
  if(path.includes('/qa/'))return route.fulfill({json:[]});
  if(path.endsWith('/data/live/current.json'))return route.fulfill({json:feed});
  if(path.includes('/api/history/')&&path.endsWith('current.json'))return route.fulfill({json:{fields,rows:[],refreshState:{lastSuccess:now.toISOString(),sourceLatestAt:'2026-09-01'}}});
  if(path.endsWith('/api/refresh')){feed={...feed,fetchedAt:new Date().toISOString(),refreshState:{ledgerVersion:3,lastSuccess:Date.now()/1000,error:null,ledgerError:failLedger?'QA ledger failure':null}};return route.fulfill({json:feed.refreshState});}
  if(path.endsWith('/api/refresh-status'))return route.fulfill({json:feed.refreshState});
  if(path.endsWith('/api/high-probability'))return route.fulfill({json:{...high,flags:{...FEATURE_FLAGS,modelAvailable:true,policyAvailable:true,modelSport:'soccer',policyTiers:model.policy.tiers,policyValidationKind:model.policy.validationKind,policyIndependentValidated:false}}});
  if(path.endsWith('/api/validation'))return route.fulfill({json:{report,storageStatus:'ready',ledger:{counts:{events:1,snapshots:1,predictions:1,modelPredictions:0,resultRevisions:0,firstObservation:now.toISOString()},records:[saved]}}});
  if(path.endsWith('/evidence'))return route.fulfill({json:{prediction:saved,snapshot:{rawHash:'qa-only'},resultRevisions:[]}});
  return route.continue();
 });
 await page.goto(root+'#today');
 await expect(page.locator('.bench-fixture').first()).toBeVisible();
 await page.locator('[data-bench-density="expanded"]').click();
 const oneRun=page.locator('.fixture-card [data-select-odds][data-market-id$="-2767"][data-slot="1"]');
 await expect(oneRun).toBeVisible();
 await expect(oneRun).toContainText('① 1점차 이내');
 await oneRun.click();
 await expect(page.getByRole('heading',{name:'동일 배당 과거 통계',exact:true})).toBeVisible();
 await expect(page.locator('.analysis-mode [data-slot="1"]')).toContainText('3.30');
 await expect(page.locator('.analysis-mode')).not.toContainText('무승부');
 await page.getByRole('button',{name:'← 경기 목록',exact:true}).click();
 await page.getByRole('button',{name:'축구',exact:true}).click();
 await expect(page.locator('.fixture-card').first()).toBeVisible();
 await expect(page.locator('[data-open-menu]')).toBeVisible();
 await expect(page.locator('#navigation button:visible')).toHaveCount(4);
 await expect(page.locator('#navigation [data-route="today"]')).toHaveAttribute('aria-current','page');
 await page.screenshot({path:`reports/redesign-mobile-${width}-today.png`});
 await expect(page.locator('.model-probability')).toHaveCount(0);
 await expect(page.locator('.model-confidence')).toHaveCount(0);
 await page.locator('[data-open-bench-filters]').click();
 await expect(page.locator('#live-league')).toContainText('QA 전체리그');
 await page.locator('#workbench-drawer [data-close-workbench]').first().click();
 const noOverflow=async()=>{const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);if(overflow)console.log(await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>window.innerWidth+1).map(e=>({tag:e.tagName,cls:e.className,right:e.getBoundingClientRect().right,text:e.textContent.slice(0,60)})).slice(0,12)));expect(overflow).toBe(false);};
 await noOverflow();
 const quote=page.locator('.fixture-card .odds-pill').last();await quote.scrollIntoViewIfNeeded();
 const listY=await page.evaluate(()=>window.scrollY);expect(listY).toBeGreaterThan(200);
 await quote.click();await expect(page.getByRole('heading',{name:'동일 배당 과거 통계',exact:true})).toBeVisible();await noOverflow();
 await expect(page.getByRole('heading',{name:'종목·리그·팀별 배당통계'})).toBeVisible();
 await expect(page.locator('#history-tolerance')).toHaveCount(0);
 await expect(page.locator('.reference-patterns')).not.toHaveAttribute('open');
 const individualStats=page.locator('.pattern-board-detail-panel > .pattern-board-single');
 await individualStats.locator(':scope > summary').click();
 await expect(individualStats).toHaveAttribute('open');
 await expect(individualStats.locator(':scope > h3').first()).toBeVisible();
 await expect(individualStats.locator(':scope > .pattern-board-scope-grid')).toHaveCount(await page.locator('.current-odds > div').count());
 await individualStats.locator(':scope > summary').click();
 await expect(individualStats).not.toHaveAttribute('open');
 await individualStats.locator(':scope > summary').focus();
 await page.keyboard.press('Enter');
 await expect(individualStats).toHaveAttribute('open');
 await page.locator('#history-stage').selectOption('opening');
 await expect(page.locator('#history-stage')).toHaveValue('opening');
 await expect(individualStats).toHaveAttribute('open');
 await page.getByRole('button',{name:'동일 배당 조합 전체',exact:true}).click();
 await expect(individualStats).toHaveAttribute('open');
 const reference=page.locator('.reference-patterns');
 await reference.locator(':scope > summary').click();
 await expect(reference).toHaveAttribute('open');
 // A native, untracked summary must also work: body[data-route] is not a link.
 const referenceGuide=reference.locator(':scope > .grade-guide');
 await referenceGuide.locator(':scope > summary').click();
 await expect(referenceGuide).toHaveAttribute('open');
 const singlePatterns=reference.locator(':scope > .pattern-board-single');
 await singlePatterns.locator(':scope > summary').click();
 await expect(singlePatterns).toHaveAttribute('open');
 await page.locator('#history-stage').selectOption('closing');
 await expect(individualStats).toHaveAttribute('open');
 await expect(reference).toHaveAttribute('open');
 await expect(singlePatterns).toHaveAttribute('open');
 await page.getByRole('button',{name:'← 경기 목록',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThan(listY-20);
 const visibleAnchor=()=>page.evaluate(()=>{const ref=Math.min(Math.max(16,innerHeight*.18),180),items=[...document.querySelectorAll('[data-scroll-key]')].map(element=>({key:element.dataset.scrollKey,top:element.getBoundingClientRect().top,bottom:element.getBoundingClientRect().bottom})).filter(item=>item.bottom>=0&&item.top<=innerHeight).sort((a,b)=>Math.abs(a.top-ref)-Math.abs(b.top-ref));return items[0]||null;});
 const anchorBefore=await visibleAnchor();
 // Trigger the actual refresh listener without clicking a distant control
 // (clicking would itself scroll the browser to that control).
 failLedger=true;await page.locator('[data-reload-feed]').first().dispatchEvent('click');
 await expect(page.locator('[data-reload-feed]').first()).toBeEnabled();
 await page.waitForTimeout(150);
 const anchorAfter=await visibleAnchor();expect(anchorAfter?.key).toBe(anchorBefore?.key);expect(Math.abs((anchorAfter?.top||0)-(anchorBefore?.top||0))).toBeLessThan(3);expect(await page.evaluate(()=>window.scrollY)).toBeGreaterThan(100);
 await expect(page.locator('.model-confidence')).toHaveCount(0);await expect(page.locator('.model-probability')).toHaveCount(0);
 failLedger=false;await page.locator('[data-reload-feed]').first().dispatchEvent('click');
 await expect(page.locator('.model-probability')).toHaveCount(0);
 await page.route('**/api/signals?*',route=>route.fulfill({json:{dates:['2026-10-14','2026-10-15'],events:[],days:[{date:'2026-10-14',count:0,fetchedAt:new Date().toISOString(),error:null},{date:'2026-10-15',count:0,fetchedAt:new Date().toISOString(),error:null}]}}));
 await page.locator('#navigation [data-route="signals"]').click();
 await expect(page.locator('.tl-heading h1')).toContainText('배당 신호등');
 await expect(page.locator('#sports')).not.toBeVisible();
 await page.locator('[data-signal-source="colab"]').click();
 await page.locator('[data-disclosure="signal-calculator"] > summary').click();
 await page.locator('[data-signal-example]').click();
 await page.locator('#signal-calculator [type="submit"]').click();
 await expect(page.locator('.tl-calc-result')).toContainText('초록 · 홈');
 await expect(page.locator('.tl-calc-result')).toContainText('6.00%p');
 await noOverflow();
 await page.locator('[data-open-menu]').click();
 await expect(page.locator('#menu-drawer')).toBeVisible();
 await page.locator('#secondary-navigation [data-route="validation"]').click();
 await expect(page.locator('#menu-drawer')).not.toBeVisible();
 await expect(page.getByRole('heading',{name:'검증',exact:true})).toBeVisible();await noOverflow();
 await expect(page.getByRole('heading',{name:'직전 결과 패턴 검증'})).toBeVisible();
 await expect(page.locator('.sequence-validation tbody tr')).toHaveCount(4);
 await page.locator('.ledger-list button').first().click();await expect(page.getByRole('heading',{name:'당시 판단 원장'})).toBeVisible();await noOverflow();
 await page.getByRole('button',{name:'← 검증',exact:true}).click();
 await page.locator('#navigation [data-route="today"]').click();await expect(page.locator('.fixture-card').first()).toBeAttached();
 expect(errors).toEqual([]);
});

test('temporary mobile connection failures recover without a false official source warning',async({page})=>{
 const raw=JSON.parse(readFileSync('test/fixtures/betman-public.json'));
 const keys=raw.compSchedules.keys,game=keys.indexOf('gameDate'),end=keys.indexOf('endDate');
 const base=Math.min(...raw.compSchedules.datas.map(row=>Number(row[game])));
 for(const row of raw.compSchedules.datas){row[game]=Date.now()+86400000+(Number(row[game])-base);row[end]=row[game]-300000;}
 let feed=parseFeed(raw,new Date());
 feed.refreshState={lastSuccess:Date.now()/1000,ledgerVersion:3,error:null};
 let getCount=0,historySummaryCount=0,failNextGets=0,failNextPost=false,lagNextPost=false,staleNextGet=null;
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url()),path=url.pathname;
  if(url.hostname!=='127.0.0.1')return route.abort();
  if(path.includes('/data/')&&path.endsWith('manifest.json')){
   const sport=path.includes('/v2/')?path.split('/v2/')[1].split('/')[0]:'baseball';
   return route.fulfill({json:{fields,years:{2026:0},dataRoot:`qa/${sport}`,rows:0,sourceTitle:'QA fixture only',dateRange:['2026-01-01','2026-09-01'],leagues:{},markets:{},sourceUrl:'https://example.invalid'}});
  }
  if(path.includes('/qa/'))return route.fulfill({json:[]});
  if(path.endsWith('/data/live/current.json')){
   getCount++;
   if(failNextGets>0){failNextGets--;return route.abort('failed');}
   if(staleNextGet){const stale=staleNextGet;staleNextGet=null;return route.fulfill({json:stale});}
   return route.fulfill({json:feed});
  }
  if(path.includes('/api/history/')&&path.endsWith('current.json')){
   if(url.searchParams.has('summary'))historySummaryCount++;
   return route.fulfill({json:{fields,rows:[],refreshState:{lastSuccess:new Date().toISOString(),sourceLatestAt:'2026-09-01'}}});
  }
  if(path.endsWith('/api/refresh')){
   if(failNextPost){failNextPost=false;feed.round='QA POST 확인';feed.fetchedAt=new Date().toISOString();return route.abort('failed');}
   if(lagNextPost){lagNextPost=false;staleNextGet={...feed};feed={...feed,round:'QA 저장 반영',fetchedAt:new Date().toISOString(),refreshState:{...feed.refreshState,lastSuccess:Date.now()/1000}};}
   return route.fulfill({json:feed.refreshState});
  }
  if(path.endsWith('/api/refresh-status'))return route.fulfill({json:feed.refreshState});
  return route.continue();
 });
 await page.goto(root+'#today');
 await expect(page.locator('.compact-source')).toBeVisible();
 await expect.poll(()=>historySummaryCount).toBe(4);
 failNextGets=2;
 feed.round='QA 재연결';feed.fetchedAt=new Date().toISOString();
 await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect.poll(()=>getCount).toBeGreaterThanOrEqual(3);
 await expect(page.locator('.source-state')).not.toContainText('공식 조회 실패');
 await expect(page.locator('.source-state')).not.toContainText('Failed to fetch');
 await expect(page.locator('.source-state')).toContainText('QA 재연결',{timeout:10000});
 failNextPost=true;
 await page.locator('[data-reload-feed]').first().dispatchEvent('click');
 await expect(page.locator('.source-state')).toContainText('QA POST 확인');
 await expect(page.locator('.source-state')).not.toContainText('공식 조회 실패');
 await expect(page.locator('.source-state')).not.toContainText('Failed to fetch');
 const reconciledGetCount=getCount;
 await page.waitForTimeout(3200);
 expect(getCount).toBe(reconciledGetCount);
 lagNextPost=true;
 await page.locator('[data-reload-feed]').first().dispatchEvent('click');
 await expect(page.locator('.source-state')).toContainText('QA 저장 반영',{timeout:10000});
 feed.refreshState={...feed.refreshState,error:'원본 재수집 실패: 공식 응답 503'};
 await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect(page.locator('.source-state')).toContainText('공식 조회 실패 · 이전 값');
 feed.refreshState={...feed.refreshState,error:null};
 await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect(page.locator('.source-state')).not.toContainText('공식 조회 실패');
 expect(historySummaryCount).toBe(4);
 expect(errors).toEqual([]);
});

test('mobile exact patterns and pick cart: strict odds, combination amount, durable record and result updates',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const startsAt=new Date(Date.now()+86400000).toISOString(),observedAt=new Date().toISOString();
 const event=(id,home,under,over)=>({id,sport:'baseball',league:'QA KBO',home,away:'상대'+id,startsAt,status:'발매 중',available:true,markets:[{id:'market-'+id,market:'언오버',line:8.5,period:'full',year:'2026',round:'260120',gameNumber:Number(id),saleStatus:'selling',status:'발매 중',available:true,observedAt,outcomes:[{key:'under',label:'언더',odds:under},{key:'over',label:'오버',odds:over}]}]});
 const feed={sourceId:'betman-official-proto',provider:'베트맨 공식',oddsBasis:'domestic-betman',fetchedAt:observedAt,events:[event('1','팀 A',1.7,1.8),event('2','팀 B',1.8,1.9)],refreshState:{ledgerVersion:3,lastSuccess:Date.now()/1000,error:null}};
 const sequence=[...Array.from({length:12},()=>[2,2,2,0]).flat(),2,2,2];
 const history=sequence.map((slot,i)=>({id:'qa-'+i,date:new Date(Date.now()-(sequence.length-i+2)*86400000).toISOString().slice(0,10)+' 18:00',league:'QA KBO',market:'언오버',line:8.5,home:'팀 A',away:'과거 상대'+i,closing:[1.7,null,1.8],opening:[1.7,null,1.8],result:['언더','무','오버'][slot]}));
 history.push(...Array.from({length:7},(_,i)=>({id:'qa-team-b-'+i,date:new Date(Date.now()-(12-i)*86400000).toISOString().slice(0,10)+' 18:00',league:'QA KBO',market:'언오버',line:8.5,home:'팀 B',away:'옛 상대 B'+i,closing:[1.8,null,1.9],opening:[1.8,null,1.9],result:'언더'})));
 let saved=[],settled=false;
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url()),path=url.pathname;
  if(url.hostname!=='127.0.0.1')return route.abort();
  if(path.includes('/data/')&&path.endsWith('manifest.json'))return route.fulfill({json:{fields,years:{2026:history.length},dataRoot:'qa/baseball',rows:history.length,sourceTitle:'QA only',dateRange:['2026-01-01','2026-10-01'],leagues:{'QA KBO':history.length},markets:{}}});
  if(path.includes('/qa/'))return route.fulfill({json:history.map(row=>fields.map(f=>row[f]??null))});
  if(path.endsWith('/data/live/current.json'))return route.fulfill({json:feed});
  if(path.includes('/api/history/'))return route.fulfill({json:{fields,rows:[],refreshState:{sourceVersion:'test'}}});
  if(path.endsWith('/api/slips/results'))return route.fulfill({json:{picks:route.request().postDataJSON().picks.map(p=>({...p,result:{status:'pending',reason:'QA result pending'}})),resultSource:{rounds:[]}}});
  if(path.endsWith('/api/slips')||path.endsWith('/api/slips/refresh')){
   if(path.endsWith('/api/slips')&&route.request().method()==='POST'){const body=route.request().postDataJSON();saved=[{...body,createdAt:new Date().toISOString(),picks:body.picks.map(p=>({...p,sport:'baseball'}))}];return route.fulfill({json:saved[0]});}
   return route.fulfill({json:{slips:saved.map(s=>({...s,picks:s.picks.map((p,i)=>({...p,result:{status:settled?(i===0?'won':'lost'):'pending',sourceResult:settled?(i===0?'언더':'오버'):''}}))})),sources:{},nextCursor:null}});
  }
  return route.continue();
 });
 await page.goto(root+'#today');
 await expect(page.locator('.bench-fixture')).toHaveCount(2);
 await page.locator('[data-disclosure="today-recommendations"] > summary').click();
 await expect(page.locator('.sequence-pick').first()).toBeVisible();
 await expect(page.locator('.sequence-pick').first()).toContainText('오버');
 await expect(page.locator('.sequence-pick').first()).toContainText('39/51건 적중');
 await page.locator('.discovery-stat').first().scrollIntoViewIfNeeded();
 const firstResult=await page.evaluate(()=>({stat:document.querySelector('.discovery-stat').getBoundingClientRect().top,nav:document.querySelector('#navigation').getBoundingClientRect().top}));
 expect(firstResult.stat).toBeLessThan(firstResult.nav);
 await page.screenshot({path:'reports/redesign-mobile-first-view.png'});
 await expect(page.locator('.sequence-pick').first()).toContainText('과거 적중률');
 await expect(page.locator('.sequence-pick .pick-pattern')).toHaveCount(0);
 await page.locator('[data-discovery-focus="perfect"]').click();
 await expect(page.locator('.discovery-card')).toHaveCount(1);
 await expect(page.locator('.discovery-card')).toContainText('7/7건 적중');
 await expect(page.locator('.discovery-card')).toContainText('C등급');
 await expect(page.locator('.discovery-card')).toContainText('소표본');
 await page.locator('.discovery-filter-options > summary').click();
 await page.selectOption('#discovery-minimum','10');
 await expect(page.locator('.discovery-filter-options')).toHaveAttribute('open');
 await expect(page.locator('.discovery-card')).toHaveCount(0);
 await page.getByRole('button',{name:'전체 기록 보기',exact:true}).click();
 await expect(page.locator('.discovery-card')).toHaveCount(2);
 await page.locator('[data-discovery-focus="perfect"]').click();
 await page.locator('.discovery-filter-options > summary').click();
 await page.screenshot({path:'reports/redesign-mobile-discovery.png',fullPage:true});
 const caseButton=page.getByRole('button',{name:'실제 사례 7건',exact:true});await caseButton.scrollIntoViewIfNeeded();
 const returnY=await page.evaluate(()=>window.scrollY);
 await caseButton.click();
 await expect(page.locator('#evidence-drawer')).toBeVisible();
 await expect(page.locator('#evidence-drawer .drawer-record')).toContainText('7/7건 적중');
 await expect(page.locator('#evidence-drawer .evidence-cases li')).toHaveCount(7);
 await page.screenshot({path:'reports/redesign-mobile-evidence.png'});
 await page.keyboard.press('Escape');
 await expect(page.locator('#evidence-drawer')).not.toBeVisible();
 expect(Math.abs(await page.evaluate(()=>window.scrollY)-returnY)).toBeLessThan(4);
 await caseButton.click();
 await page.getByRole('button',{name:'이 픽 담기',exact:true}).click();
 await expect(page.locator('#evidence-drawer')).not.toBeVisible();
 await expect(page.locator('#workbench-dock')).toContainText('담은 픽 1개');
 await expect(page.locator('#quick-cart')).not.toBeVisible();
 await expect(page.locator('.discovery-card .add-pick')).toHaveText('✓ 담김');
 const bars=await page.evaluate(()=>({quick:document.querySelector('#workbench-dock').getBoundingClientRect().bottom,nav:document.querySelector('#navigation').getBoundingClientRect().top}));
 expect(bars.quick).toBeLessThanOrEqual(bars.nav);
 await page.locator('.bench-fixture').nth(0).locator('.bench-prices button').first().click();
 await page.locator('#workbench-drawer [data-add-pick]').first().click();
 await page.locator('#workbench-drawer [data-close-workbench]').first().click();
 await expect(page.locator('#workbench-dock')).toContainText('담은 픽 2개');
 await page.locator('#navigation [data-route="cart"]').click();
 await expect(page.getByRole('heading',{name:'담은 픽 2개'})).toBeVisible();
 await page.locator('#slip-stake').fill('10000');
 await expect(page.locator('#draft-totals')).toContainText('3.060배');
 await expect(page.locator('#draft-totals')).toContainText('30,600원');
 await page.getByRole('button',{name:'조합 기록 저장'}).click();
 await expect(page.locator('.saved-slip')).toHaveCount(1);
 await expect(page.locator('.saved-slip')).toContainText('결과 대기');
 await page.reload();
 await expect(page.locator('.saved-slip')).toHaveCount(1);
 await expect(page.getByRole('heading',{name:'담은 픽 0개'})).toBeVisible();
 settled=true;
 await page.getByRole('button',{name:'결과 새로 확인'}).click();
 await expect(page.locator('.saved-slip')).toContainText('미적중');
 await expect(page.locator('.saved-slip .slip-totals')).toContainText('0원');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 await page.screenshot({path:'reports/redesign-mobile-cart.png',fullPage:true});
 expect(errors).toEqual([]);
});

test('cart automatically settles saved and legacy unsaved picks and preserves scroll during result refresh',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 const {parseOfficialResults}=await import('../src/betman-results.mjs');const {attachSlipResults}=await import('../src/slips.mjs');
 const fixture=JSON.parse(readFileSync('test/fixtures/betman-results-260117.json'));
 const record=parseOfficialResults(fixture,fixture.capturedAt),r=record.rows.find(r=>r.gameNumber===6204);
 const draftPick={eventId:r.eventId,marketId:r.marketId,home:r.home,away:r.away,league:r.league,startsAt:r.startsAt,market:r.market,line:r.line,outcomeKey:'under',label:'언더',odds:1.7};
 const draft={id:'qa-legacy-draft',stake:'10000',picks:[draftPick]};
 await page.addInitScript(d=>localStorage.setItem('odds-lens-pick-draft-v1',JSON.stringify(d)),draft);
 const saved=Array.from({length:8},(_,i)=>({id:'qa-saved-'+i,createdAt:new Date(Date.parse(fixture.capturedAt)-i*60000).toISOString(),stake:10000,picks:[{...draftPick,outcomeKey:i===0?'over':'under',label:i===0?'오버':'언더',sport:'baseball',round:r.round,year:'2026',gameNumber:r.gameNumber,outcomeKeys:r.outcomeKeys}]}));
 const settled=attachSlipResults(saved,{}, {'260117':record},Date.parse('2026-10-06T00:00:00Z'));
 const results=attachSlipResults([draft],{}, {'260117':record},Date.parse('2026-10-06T00:00:00Z'))[0].picks;
 let reads=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url()),path=url.pathname;
  if(url.hostname!=='127.0.0.1')return route.abort();
  if(path.includes('/data/')&&path.endsWith('manifest.json'))return route.fulfill({json:{fields,years:{},rows:0,sourceTitle:'QA',dateRange:[],leagues:{},markets:{}}});
  if(path.endsWith('/data/live/current.json'))return route.fulfill({json:{sourceId:'betman-official-v1',events:[],fetchedAt:fixture.capturedAt}});
  if(path.includes('/api/history/'))return route.fulfill({json:{fields,rows:[],refreshState:{}}});
  if(path.endsWith('/api/slips/results'))return route.fulfill({json:{picks:reads>1?results:draft.picks,resultSource:{rounds:[{round:r.round,lastSuccess:reads>1?fixture.capturedAt:null,refreshing:reads<=1}]}}});
  if(path.endsWith('/api/slips')||path.endsWith('/api/slips/refresh')){reads++;return route.fulfill({json:{slips:reads>1?settled:saved,sources:{},nextCursor:null,resultSource:{rounds:[{round:r.round,lastSuccess:reads>1?fixture.capturedAt:null,refreshing:reads<=1}]}}});}
  return route.continue();
 });
 await page.goto(root+'#cart');await expect(page.locator('.saved-slip')).toHaveCount(8);
 await expect(page.locator('.saved-slip').first()).toContainText('미적중',{timeout:12000});
 await expect(page.locator('.slip-pick').first()).toContainText('적중');
 await expect(page.locator('.slip-pick').first()).toContainText('최종 5 : 3 · 총점 8');
 await expect(page.locator('.saved-slip').first()).toContainText('0원');
 await expect(page.locator('.saved-slip').nth(1)).toContainText('17,000원');
 await page.locator('.saved-slip').nth(4).scrollIntoViewIfNeeded();
 const before=await page.evaluate(()=>scrollY);
 await page.locator('[data-refresh-slips]').dispatchEvent('click');await expect(page.locator('[data-refresh-slips]')).toBeEnabled();
 expect(Math.abs(await page.evaluate(()=>scrollY)-before)).toBeLessThan(5);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 await page.screenshot({path:'reports/redesign-mobile-results.png',fullPage:true});
 expect(errors).toEqual([]);
});
