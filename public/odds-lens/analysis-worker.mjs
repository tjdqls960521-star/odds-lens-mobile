import {analyzePatternEvent,exactPatternCatalog,exactEvidenceCases} from './pattern-board.mjs?v=20261005-3';
const datasets=new Map(),analyses=new Map(),catalogs=new Map();
self.onmessage=({data})=>{
  const {id,action,key}=data;
  try{
    if(action==='init'){datasets.set(key,data.rows);analyses.delete(key);catalogs.delete(key);self.postMessage({id,result:true});return;}
    const rows=datasets.get(key);if(!rows)throw Error('과거 자료를 준비하고 있습니다.');
    let result;
    if(action==='cases'){
      result=exactEvidenceCases(data.event,data.market,rows,data.options);
    }else if(action==='catalog'){
      const {offset=0,limit=50,...options}=data.options||{},signature=JSON.stringify(options);
      let cache=catalogs.get(key);
      if(!cache||cache.signature!==signature){cache={signature,value:exactPatternCatalog(rows,{...options,limit:100000})};catalogs.set(key,cache);}
      result={...cache.value,offset,items:cache.value.items.slice(offset,offset+limit)};
    }else{
      const cache=analyses.get(key)||new Map();analyses.set(key,cache);
      result=data.items.map(({event,market})=>{
        const signature=JSON.stringify([!!data.includeSequences,event.id,event.startsAt,event.league,event.home,event.away,event.teamNamesVerified,market.id,market.line,market.outcomes]);
        if(!cache.has(signature))cache.set(signature,analyzePatternEvent(event,market,rows,{includeSequences:!!data.includeSequences}));
        return cache.get(signature);
      });
      if(cache.size>2000)cache.clear();
    }
    self.postMessage({id,result});
  }catch(error){self.postMessage({id,error:error.message});}
};
