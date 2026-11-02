// A freshly loaded dataset has new leg maps; old entries are automatically reclaimable.
export function createSummaryCache(compute,limit=64){
 const datasets=new WeakMap();
 return (route,scope)=>{
  const owner=route.legs??route,key=JSON.stringify([scope.carrier,scope.seat??'all',scope.start,scope.end,scope.month??null,scope.direction??null]);
  let entries=datasets.get(owner);if(!entries){entries=new Map();datasets.set(owner,entries);}
  if(entries.has(key))return entries.get(key);
  const result=compute(route,scope);if(entries.size>=limit)entries.delete(entries.keys().next().value);entries.set(key,result);return result;
 };
}
