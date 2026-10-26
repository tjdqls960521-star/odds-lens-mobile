const worker=new Worker(new URL('./analysis-worker.mjs?v=20261005-3',import.meta.url),{type:'module'});
const pending=new Map(),loaded=new Map();let sequence=0;
worker.onmessage=({data})=>{const item=pending.get(data.id);if(!item)return;pending.delete(data.id);data.error?item.reject(Error(data.error)):item.resolve(data.result);};
worker.onerror=()=>{for(const item of pending.values())item.reject(Error('배당 분석을 다시 시도해주세요.'));pending.clear();loaded.clear();};
function call(message){return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});worker.postMessage({id,...message});});}
async function ensure(key,rows){
  if(loaded.get(key)?.rows===rows)return loaded.get(key).promise;
  const promise=call({action:'init',key,rows});loaded.set(key,{rows,promise});
  try{await promise;}catch(error){loaded.delete(key);throw error;}
}
export async function analyzeExact(key,rows,items,{includeSequences=false}={}){await ensure(key,rows);return call({action:'analyze',key,items,includeSequences});}
export async function loadExactCatalog(key,rows,options){await ensure(key,rows);return call({action:'catalog',key,options});}
export async function loadEvidenceCases(key,rows,event,market,options){await ensure(key,rows);return call({action:'cases',key,event,market,options});}
