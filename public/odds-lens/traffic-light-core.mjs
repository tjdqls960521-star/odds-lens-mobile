// Port of the user's Colab executable (modified 2026-02-19), not its prose.
export const COLAB_URL='https://colab.research.google.com/drive/1f09NvWMshW_6dFEa7-eiehfv6mDXLLe8?usp=sharing';
export const ORIGINAL_LEAGUES=Object.freeze(['ENG PR','SPA D1','ITA D1','GER D1','FRA D1','ENG LHC','HOL D1','KOR D1','KOR D2','JPN D1','JPN D2','MLS','ENG FAC','AUS D1','FRAC','HOLC','SPA CUP','UEFA CL','UEFA EL','UEFA ECL','JPN LC']);
export const SIGNAL_LABELS={green:'초록',yellow:'노랑',red:'빨강',none:'신호 없음',missing:'값 부족'};
export const OUTCOME_LABELS=['홈','무승부','원정'];

// Python round(float, 4): scale the exact IEEE-754 fraction, then ties-to-even.
// Avoid JS Math.round's different tie rule at the notebook's threshold edges.
export function pythonRound4(value){
  if(!Number.isFinite(value)||value===0)return value;
  const buffer=new ArrayBuffer(8),view=new DataView(buffer);
  view.setFloat64(0,Math.abs(value));const bits=view.getBigUint64(0);
  const exponent=Number((bits>>52n)&2047n),fraction=bits&((1n<<52n)-1n);
  let numerator=(exponent?fraction+(1n<<52n):fraction)*10000n;
  const shift=(exponent?exponent-1023:-1022)-52;
  let denominator=1n;
  if(shift>=0)numerator<<=BigInt(shift);else denominator<<=BigInt(-shift);
  let rounded=numerator/denominator;const remainder=numerator%denominator;
  if(remainder*2n>denominator||(remainder*2n===denominator&&rounded%2n===1n))rounded++;
  return Math.sign(value)*Number(rounded)/10000;
}

export function numericPercent(value){
  if(value===null||value===undefined||String(value).trim()==='')return null;
  const number=Number(value);return Number.isFinite(number)?number:null;
}

export function computeSignal(differences){
  let direction=null,color='none',supports=[];
  // Keep both independent ifs: when both qualify, away overwrites home.
  for(const slot of [0,2])if(differences[slot]<=-0.05){
    direction=slot;
    supports=[0,1,2].filter(i=>i!==slot&&differences[i]>=0.03);
    color=supports.length===2?'green':supports.length===1?'yellow':'red';
  }
  const signal=direction===null?'':`${{green:'🟢',yellow:'🟡',red:'🔴'}[color]} ${OUTCOME_LABELS[direction]}`;
  return {color,direction,supports,signal,bothMain: differences[0]<=-0.05&&differences[2]<=-0.05};
}

export function analyzeSignal(earlyValues,currentValues){
  const early=Array.from({length:3},(_,i)=>numericPercent(earlyValues?.[i]));
  const current=Array.from({length:3},(_,i)=>numericPercent(currentValues?.[i]));
  if([...early,...current].some(v=>v===null))return {early,current,color:'missing',direction:null,supports:[],signal:'',differences:null,changes:null,bothMain:false};
  const differences=early.map((value,i)=>pythonRound4(value*0.01-current[i]*0.01));
  return {early,current,differences,changes:differences.map(d=>-d*100),...computeSignal(differences)};
}

export function signalInterpretation(analysis){
  if(analysis.color==='missing')return '초기·현재 확률값 6개가 모두 있어야 판정할 수 있습니다.';
  if(analysis.color==='none')return '홈·원정 모두 확률 증가가 5%p 미만으로, 원본의 신호 조건에 해당하지 않습니다.';
  const direction=OUTCOME_LABELS[analysis.direction];
  const support=analysis.supports.map(i=>OUTCOME_LABELS[i]).join('·');
  return `${direction} 확률이 ${analysis.changes[analysis.direction].toFixed(2)}%p 증가했습니다. ${analysis.color==='green'?`${support} 모두 3%p 이상 감소해 두 보조 조건을 충족합니다.`:analysis.color==='yellow'?`${support}만 3%p 이상 감소해 보조 조건 하나를 충족합니다.`:'다른 두 결과는 3%p 감소 조건에 해당하지 않아 보조 조건이 없습니다.'}`;
}

export function filterSignals(events,{filter='all',search='',date='all',league='all'}={}){
  const query=search.trim().toLocaleLowerCase();
  return events.filter(e=>(filter==='all'||e.analysis.color===filter)&&(date==='all'||e.queryDate===date)&&(league==='all'||e.league===league)&&(!query||`${e.home} ${e.away} ${e.league}`.toLocaleLowerCase().includes(query)));
}
