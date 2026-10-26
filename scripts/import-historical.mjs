import {mkdir,rm,writeFile} from 'node:fs/promises';
import {HISTORY_FIELDS,HISTORY_SOURCES,latestHistoricalDate,normalizeHistoricalCsv,packHistoricalRows,sourceUrl} from '../src/history-core.mjs';

const selected=(process.argv.find(arg=>arg.startsWith('--sports='))?.slice('--sports='.length)||'soccer,basketball,volleyball').split(',').map(value=>value.trim()).filter(Boolean);
const destination=new URL('../public/odds-lens/data/v2/',import.meta.url);

async function fetchText(url){
  const response=await fetch(url,{signal:AbortSignal.timeout(180000)});
  if(!response.ok)throw Error(`원본 응답 ${response.status}`);
  const text=await response.text();
  if(text.length>90000000)throw Error('원본 응답이 허용 크기를 넘었습니다.');
  return text;
}

function count(rows,field){
  return rows.reduce((result,row)=>{const key=String(row[field]??'').trim();if(key)result[key]=(result[key]||0)+1;return result;},{});
}

for(const key of selected){
  const source=HISTORY_SOURCES[key];
  if(!source)throw Error(`알 수 없는 종목: ${key}`);
  console.log(`${source.sport} 원본 다운로드 중…`);
  const text=await fetchText(sourceUrl(source));
  const rows=normalizeHistoricalCsv(text,source).sort((left,right)=>left.date.localeCompare(right.date)||left.id.localeCompare(right.id));
  if(!rows.length)throw Error(`${source.sport} 원본에서 정규화할 기록이 없습니다.`);
  const root=new URL(`${key}/`,destination);
  await rm(root,{recursive:true,force:true});
  await mkdir(root,{recursive:true});
  const byYear=new Map();
  for(const row of rows){const year=row.date.slice(0,4);if(!byYear.has(year))byYear.set(year,[]);byYear.get(year).push(row);}
  const years={};
  for(const [year,items] of byYear){years[year]=items.length;await writeFile(new URL(`${year}.json`,root),JSON.stringify(packHistoricalRows(items)));}
  const manifest={
    schemaVersion:2,
    sport:key,
    sourceUrl:sourceUrl(source),
    sourceTitle:source.title,
    catalogUrl:'https://docs.google.com/spreadsheets/d/1M6SECnFJEHPjCJQ0RYMSGb2w0Zd1-wkyNSUuzGAgBg0/edit?gid=1518263841',
    dataRoot:`data/v2/${key}`,
    fetchedAt:new Date().toISOString(),
    sourceRows:rows.length,
    rows:rows.length,
    fields:HISTORY_FIELDS,
    years,
    dateRange:[rows[0].date,latestHistoricalDate(rows)],
    leagues:count(rows,'league'),
    markets:count(rows,'market'),
    excludedMarkets:['SUM','승1패','승5패'],
    quoteTimestampsAvailable:false,
    timezone:'원본 시간대 미표기',
    live:false
  };
  await writeFile(new URL('manifest.json',root),JSON.stringify(manifest));
  console.log(`${source.sport} ${rows.length.toLocaleString('ko-KR')}건 · ${manifest.dateRange.join(' ~ ')}`);
}
