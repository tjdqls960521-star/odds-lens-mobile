/*
 * Shared historical-source contract.
 *
 * The public catalog is a link directory.  The actual four sheets use the
 * same columns, so this module keeps the network and CSV details out of the
 * UI and of the build importer.
 */

export const HISTORY_FIELDS=['id','event','date','league','market','home','away','opening','closing','openingLine','line','changes','score','result','venue'];

export const HISTORY_SOURCES={
  baseball:{key:'baseball',sport:'야구',sheetId:'13R4pbGHjbP4tDf8ME-q2kJQM83DrauF3BFvgg7d78Ic',gid:'1018157675',title:'배트맨 야구 · 공개 Google 시트',baselineMax:'2026-09-11 18:30'},
  soccer:{key:'soccer',sport:'축구',sheetId:'1XpILlPV8W0f_S4DE0WdOHmqtz1-4H1GJQFOlL_hTieg',gid:'1288875395',title:'배트맨 축구 · 공개 Google 시트',baselineMax:'2026-09-11 19:00'},
  basketball:{key:'basketball',sport:'농구',sheetId:'1ta4sZCDovEOmSLOTkYoZnnwWGkU8I0N3Qtp3ovl8FZY',gid:'0',title:'배트맨 농구 · 공개 Google 시트',baselineMax:'2026-09-11 19:00'},
  volleyball:{key:'volleyball',sport:'배구',sheetId:'1AbniwFvkPNCrddW_9upvhAXYzo1rXcdh8i5oInuXT0M',gid:'0',title:'배트맨 배구 · 공개 Google 시트',baselineMax:'2026-09-10 19:30'}
};

const columns=['A','B','C','E','F','H','I','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z','AA','AB'];
const expected=['연도','회차','번호','리그','유형','시간','경기장','홈','원정','초기승배당','초기무배당','초기패배당','초기핸디값','최종승배당','최종무배당','최종패배당','최종핸디값','배변여부','배당변경횟수','승배당변화','무배당변화','패배당변화','홈점수','원정점수','결과'];

export function sourceUrl(source,where=''){
  const query=`select ${columns.join(',')}${where?` ${where}`:''}`;
  return `https://docs.google.com/spreadsheets/d/${source.sheetId}/gviz/tq?gid=${encodeURIComponent(source.gid)}&tqx=out:csv&tq=${encodeURIComponent(query)}`;
}

export function parseCsv(text){
  const rows=[];
  let row=[],field='',quoted=false;
  for(let index=0;index<text.length;index++){
    const char=text[index];
    if(quoted){
      if(char==='"'){
        if(text[index+1]==='"'){field+='"';index++;}
        else quoted=false;
      }else field+=char;
      continue;
    }
    if(char==='"'){quoted=true;continue;}
    if(char===','){row.push(field);field='';continue;}
    if(char==='\n'){
      if(field.endsWith('\r'))field=field.slice(0,-1);
      row.push(field);rows.push(row);row=[];field='';continue;
    }
    field+=char;
  }
  if(field.length||row.length){if(field.endsWith('\r'))field=field.slice(0,-1);row.push(field);rows.push(row);}
  return rows;
}

function numberOrNull(value){
  const parsed=Number(String(value??'').trim().replaceAll(',',''));
  return Number.isFinite(parsed)&&parsed!==0?parsed:null;
}

function preservedNumber(value){
  if(value==null||String(value).trim()==='')return null;
  const n=Number(String(value).trim().replaceAll(',',''));
  return Number.isFinite(n)?n:null;
}

function numberOrZero(value){
  const parsed=Number(String(value??'').trim().replaceAll(',',''));
  return Number.isFinite(parsed)?parsed:0;
}

function canonicalHistoricalMarket(value){
  const raw=String(value??'').trim();
  const compact=raw.replace(/[\s_-]/g,'');
  if(compact==='전반핸디캡')return '전반_핸디캡';
  if(compact==='전반언오버')return '전반_언오버';
  if(compact==='전반')return '전반';
  return raw;
}

export function excludedHistoricalMarket(value,sport){
  const market=canonicalHistoricalMarket(value);
  return market==='SUM'||(market==='승1패'&&sport!=='baseball')||market==='승5패'||market==='전반'||market==='전반_핸디캡'||market==='전반_언오버';
}

export function normalizeHistoricalCsv(text,source){
  const parsed=parseCsv(text);
  const header=parsed.shift()||[];
  if(expected.some((name,index)=>header[index]!==name))throw Error('과거 원본 열 구조가 변경되었습니다. 이전 정상 데이터를 유지합니다.');
  const rows=new Map();
  for(const values of parsed){
    if(values.length<header.length)continue;
    const [year,round,number,league,type,date,venue,home,away,openWin,openDraw,openLose,openLine,closeWin,closeDraw,closeLose,closeLine,changed,changeCount,_winChange,_drawChange,_loseChange,homeScore,awayScore,result]=values;
    const market=canonicalHistoricalMarket(type);
    if(!year||!round||!number||!date||!league||!market||excludedHistoricalMarket(market,source.key))continue;
    const id=`${year}-${round}-${number}`;
    // 회차와 번호는 원본의 정산 라인 식별자다. 간헐적으로 같은 행이
    // 중복되어 올라오므로, 원본에서 나중에 나온 값을 그 라인의 최신값으로 쓴다.
    rows.set(id,{
      id,
      event:`${source.key}:${id}`,
      date:String(date).trim(),
      league:String(league).trim(),
      market,
      home:String(home??'').trim(),
      away:String(away??'').trim(),
      opening:[numberOrNull(openWin),numberOrNull(openDraw),numberOrNull(openLose)],
      closing:[numberOrNull(closeWin),numberOrNull(closeDraw),numberOrNull(closeLose)],
      openingLine:preservedNumber(openLine),
      line:preservedNumber(closeLine),
      changes:preservedNumber(changeCount)??(String(changed??'').trim()==='O'?1:0),
      score:[preservedNumber(homeScore),preservedNumber(awayScore)],
      result:String(result??'').trim(),
      venue:String(venue??'').trim()
    });
  }
  return [...rows.values()];
}

export function packHistoricalRows(rows){
  return rows.map(row=>HISTORY_FIELDS.map(field=>row[field]));
}

export function unpackHistoricalRows(rows){
  return rows.map(row=>Object.fromEntries(HISTORY_FIELDS.map((field,index)=>[field,row[index]])));
}

export function latestHistoricalDate(rows,fallback=''){
  return rows.reduce((latest,row)=>String(row.date??'')>latest?String(row.date):latest,String(fallback??''));
}

export function overlapStart(value,days=14){
  const match=String(value??'').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if(!match)return '';
  const date=Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3]),Number(match[4]||0),Number(match[5]||0))-days*86400000;
  return new Date(date).toISOString().slice(0,19).replace('T',' ');
}
