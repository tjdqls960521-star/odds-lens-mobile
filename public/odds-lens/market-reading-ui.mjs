import { MARKET_PRESETS, marketMetrics, movementRows, outcomeExposure, evaluatePriceDecision } from './market-reading-core.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const percent=value=>`${(value*100).toFixed(2)}%`;
const signed=value=>`${value>=0?'+':''}${(value*100).toFixed(2)} pp`;
const signedReturn=value=>`${value>=0?'+':''}${(value*100).toFixed(2)}%`;
const payout=value=>`${(value*100).toFixed(1)}%`;
const number=value=>Number(value).toFixed(2);
const amount=value=>Number(value).toLocaleString('ko-KR',{maximumFractionDigits:1});

export function marketReadingView(data){
  const preset=MARKET_PRESETS[data.preset]||MARKET_PRESETS['1X2'];
  const reference=data.reference.map(Number),current=data.current.map(Number),shares=data.shares.map(Number);
  const start=marketMetrics(reference),now=marketMetrics(current),moves=movementRows(reference,current);
  if(!start||!now||!moves)return `<div class="page-heading"><div><span class="eyebrow">ODDS STRUCTURE</span><h1>배당 해석</h1><p>배당은 1보다 큰 숫자로 입력해 주세요.</p></div></div>`;
  const exposures=outcomeExposure(current,shares,Number(data.handle)||100);
  const shareTotal=shares.reduce((sum,value)=>sum+(Number.isFinite(value)?value:0),0);
  const shareProvided=shares.some(value=>Number.isFinite(value)&&value>0);
  const selected=Math.max(0,Math.min(preset.outcomes.length-1,Number(data.outcome)||0));
  const decision=evaluatePriceDecision(current[selected],data.estimate,data.lower);
  const rows=preset.outcomes.map((name,index)=>`<tr>
    <th scope="row">${esc(name)}</th>
    <td><input aria-label="${esc(name)} 기준 배당" data-reading-odds="reference" data-index="${index}" type="number" min="1.01" step="0.01" value="${number(reference[index])}"></td>
    <td><input aria-label="${esc(name)} 현재 배당" data-reading-odds="current" data-index="${index}" type="number" min="1.01" step="0.01" value="${number(current[index])}"></td>
    <td class="reading-prob-cell">${signed(moves[index].delta)}<small>${percent(moves[index].referenceProbability)} → ${percent(moves[index].currentProbability)}</small></td>
    <td><label class="sr-only" for="reading-share-${index}">${esc(name)} 구매 비중</label><div class="reading-share-input"><input id="reading-share-${index}" aria-label="${esc(name)} 구매 비중 퍼센트" data-reading-share="${index}" type="number" min="0" step="0.1" value="${Number(shares[index]).toFixed(1)}"><span>%</span></div></td>
  </tr>`).join('');
  const liabilityRows=shareProvided?preset.outcomes.map((name,index)=>{
    const item=exposures[index];
    if(!item)return '';
    return `<div class="reading-liability-row"><span>${esc(name)} 적중 시</span><b>${payout(item.payout)}</b><small>지급 ${amount(item.payout*(Number(data.handle)||100))} / ${amount(Number(data.handle)||100)}</small><em>${item.profit>=0?'손익 +':'손익 '}${amount(item.profit)}</em></div>`;
  }).join(''):'';
  const probabilities=now.probabilities.map((value,index)=>`<div class="reading-probability"><span>${esc(preset.outcomes[index])}</span><b>${percent(value)}</b><small>단순 역수 ${percent(now.implied[index])}</small></div>`).join('');
  const sameMargin=Math.abs(now.theoreticalPayout-start.theoreticalPayout)<0.01;
  return `<div class="page-heading reading-heading"><div><span class="eyebrow">PRICE · PROBABILITY · EXPOSURE</span><h1>배당 해석</h1><p>배당 변동을 확률 변화·마진 변화·결과별 지급위험으로 나눠 봅니다.</p></div><select id="reading-preset" aria-label="예시 시장 선택"><option value="1X2" ${data.preset==='1X2'?'selected':''}>FMKorea 예시 · 일반 승무패</option><option value="handicap" ${data.preset==='handicap'?'selected':''}>FMKorea 예시 · 핸디캡</option></select></div>
  <section class="reading-callout"><b>핵심 구분</b><span>시장 환급률은 배당으로 계산합니다. 결과별 liability는 실제 구매 비중이 있어야 계산할 수 있습니다.</span></section>
  <section class="card reading-table-card"><div class="card-head"><div><h2>${esc(preset.title)} · 기준 배당과 현재 배당</h2><p class="caption">${esc(preset.note)}</p></div></div><div class="reading-table-wrap"><table class="reading-table"><thead><tr><th>결과</th><th>기준</th><th>현재</th><th>무마진 확률 변화</th><th>판돈 비중</th></tr></thead><tbody>${rows}</tbody></table></div><p class="reading-edit-note">배당·판돈 비중을 바꿔 직접 계산할 수 있습니다. 구매 비중은 게시글 수치에서 역산한 참고 입력값이며 공식 판매 데이터가 아닙니다.</p></section>
  <section class="card reading-decision-card"><div class="card-head"><div><span class="eyebrow">BET OR PASS · DECISION GATE</span><h2>실전 배팅 판단</h2><p class="caption">배당 하락이나 과거 적중률만으로 베팅하지 않습니다. 현재 가격에서 독립적으로 검증된 확률이 손익분기점을 넘는지 확인합니다.</p></div><span class="reading-locked-badge">실전 추천 잠금</span></div>
    <div class="reading-decision-inputs"><label>검토할 결과<select id="reading-outcome">${preset.outcomes.map((name,index)=>`<option value="${index}" ${index===selected?'selected':''}>${esc(name)} · ${number(current[index])}배</option>`).join('')}</select></label><label>독립 모델 예상 확률 (%)<input id="reading-estimate" type="number" min="0" max="100" step="0.1" placeholder="검증된 값만" value="${data.estimate===''?'':(Number(data.estimate)*100).toFixed(1)}"></label><label>보수 확률 하한 (%)<input id="reading-lower" type="number" min="0" max="100" step="0.1" placeholder="불확실성 반영" value="${data.lower===''?'':(Number(data.lower)*100).toFixed(1)}"></label></div>
    <div class="reading-decision-metrics"><div><span>손익분기 확률</span><b>${percent(decision.breakEven??1/current[selected])}</b><small>세금·비용 전 · 1 ÷ ${number(current[selected])}</small></div><div><span>시장 대비 확률 차이</span><b>${data.estimate===''?'—':signed(Number(data.estimate)-now.probabilities[selected])}</b><small>독립 입력 확률 − 무마진 시장 확률</small></div><div><span>예상 수익률 · 입력 확률 기준</span><b>${decision.pointEv===undefined?'—':signedReturn(decision.pointEv)}</b><small>확률 × 배당 − 1</small></div><div><span>보수 수익률 · 하한 기준</span><b>${decision.conservativeEv===undefined?'—':signedReturn(decision.conservativeEv)}</b><small>확률 하한 × 배당 − 1</small></div></div>
    <div class="reading-decision-verdict verdict-${decision.status}"><strong>${decision.status==='paper'?'모의 검토 후보':decision.status==='pass'?'패스':'근거 부족 · 보류'}</strong><span>${esc(decision.reason)}</span><small>ODDS LENS 판정: 실제 베팅 실행 권고 아님</small></div>
    <div class="reading-gates"><div><b>배당 계산</b><span>손익분기 확률·기대수익률 계산</span></div><div class="gate-wait"><b>실제 시세 확인</b><span>예시 배당 · 원천·기준점·조회시각 확인 안 됨</span></div><div class="gate-wait"><b>확률 근거</b><span>${data.lower!==''&&data.lower!==undefined?'사용자 입력 · 출처와 검증 범위 확인 필요':'독립 검증된 보수 확률 하한 미입력'}</span></div><div class="gate-fail"><b>전략 수익성 검증</b><span>실제 발매 가격 기준의 미래 표본 ROI 검증이 없어 실전 추천 잠금</span></div></div>
    <p class="reading-decision-note"><b>판정 규칙</b> 보수 확률 하한이 손익분기 확률 이하이면 패스합니다. 초과해도 우선 모의 검토만 표시합니다. 지금 표에 든 배당은 FMKorea 예시값입니다. 실제 검토 때는 정확한 기준점·판매상태·시각의 발매 배당을 입력해야 합니다. 한 업체의 배당 절삭은 확률 정보로 단정하지 않고, 선발 정보·시장 전체 움직임·교차시장·구매 비중을 확인합니다. ODDS LENS의 현재 모델 검증은 경기 확률·분류 중심이며, 종목·시장별 실제 수익성과 세금·비용을 포함한 미래 검증은 승인되지 않았습니다. 사용자가 입력한 확률은 검증된 모델 값으로 간주하지 않습니다.</p>
  </section>
  <div class="reading-metric-grid"><section class="card reading-metric"><span>기준 시장 환급률</span><strong>${percent(start.theoreticalPayout)}</strong><small>오버라운드 ${(start.overround*100).toFixed(2)}%</small></section><section class="card reading-metric"><span>현재 시장 환급률</span><strong>${percent(now.theoreticalPayout)}</strong><small>오버라운드 ${(now.overround*100).toFixed(2)}%</small></section><section class="card reading-metric"><span>현재 오버라운드</span><strong>${(now.overround*100).toFixed(2)}%</strong><small>배당 역수 합계 ${(now.bookSum*100).toFixed(2)}%</small></section></div>
  <div class="reading-columns"><section class="card"><div class="card-head"><div><span class="eyebrow">NO-VIG</span><h2>마진 제거 후 확률</h2></div></div><div class="reading-probability-list">${probabilities}</div><p class="reading-footnote">무마진 확률 = 각 배당의 역수 ÷ 전체 역수 합계. 단순 비례 정규화 방식입니다. 실제 사건의 정답 확률을 보장하지 않습니다.</p></section>
  <section class="card"><div class="card-head"><div><span class="eyebrow">WHAT MOVED?</span><h2>움직임 읽기</h2></div></div><div class="reading-interpretation"><b>${sameMargin?'확률 분포 중심의 변화':'확률 변화와 마진 변화가 함께 있음'}</b><p>무마진 확률 변화는 ${moves.map((m,i)=>`${esc(preset.outcomes[i])} ${signed(m.delta)}`).join(' · ')}입니다.</p><p>시장 환급률은 ${percent(start.theoreticalPayout)}에서 ${percent(now.theoreticalPayout)}로 바뀌었습니다. 배당 인하만으로 자금 쏠림이나 업체의 승률 판단을 단정할 수 없습니다.</p></div><ul class="reading-checklist"><li>다른 주요 북메이커·거래소도 같은 시점에 움직였나?</li><li>선발·부상 등 새 정보가 발표됐나?</li><li>핸디캡·언더오버도 같은 방향을 보이나?</li><li>실제 구매 비중·liability를 확인할 수 있나?</li></ul></section></div>
  <section class="card reading-liability-card"><div class="card-head"><div><span class="eyebrow">OPTIONAL · STAKE SHARE REQUIRED</span><h2>결과별 지급액과 손익</h2><p class="caption">이 계산은 사용자가 입력한 판돈 비중을 기준으로 합니다. 지표명은 “시장 환급률”이 아니라 “전체 판돈 대비 결과별 지급액”입니다.</p></div><label class="reading-handle">전체 판돈 단위<input id="reading-handle" type="number" min="1" step="1" value="${Number(data.handle)||100}"></label></div><div class="reading-share-total ${Math.abs(shareTotal-100)>1?'warn':''}">입력 비중 합계 <b>${shareTotal.toFixed(1)}%</b>${Math.abs(shareTotal-100)>1?'<span>100%에 가깝게 맞춰야 결과 비교가 자연스럽습니다.</span>':'<span>전체 판돈 기준 손익 계산 가능</span>'}</div><div class="reading-liability-grid">${liabilityRows}</div><div class="reading-definition"><b>공식</b><code>결과별 지급 비율 = 판돈 비중 × 해당 배당</code><code>단순 손익 = 전체 판돈 − 결과별 총 지급액</code></div><p class="reading-caution"><strong>204%의 뜻:</strong> 핸무에 전체 판돈의 약 51.6%가 들어오고 배당이 3.95라면, 핸무 적중 시 지급액은 전체 판돈의 약 204%입니다. 이는 환급률 204%를 뜻하지 않습니다. 이 예시의 판돈 비중은 게시글 수치로부터 역산한 값이며 실제 Betman 자료로 확인되지 않았습니다.</p></section>
  <section class="reading-endnote"><b>ODDS LENS 해석 원칙</b><p>배당 이동 → 무마진 확률 변화 → 판돈 흐름·liability → 교차시장 확인 → 과거 자료 검증 순서로 봅니다. 판돈 비중이나 업체별 liability가 없으면 노출관리라는 설명은 가설로만 표시합니다.</p><span>현재 화면은 교육용 계산기입니다. 경기 추천·승률 예측 기능으로 사용하지 않습니다.</span></section>`;
}
