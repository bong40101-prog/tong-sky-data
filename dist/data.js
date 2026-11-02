import {BASE,OZ_BASE,REGIONS,readDocument,unpackDocument,isExcludedRecord} from './model.js?v=158';
export function sourcesFor(catalogs,carriers){
 return carriers.flatMap(carrier=>carrier==='OZ'?[{carrier,id:'asiana',region:'아시아나'}]:REGIONS.filter(region=>catalogs.KE.ids[region]).map(region=>({carrier,id:catalogs.KE.ids[region],region})));
}
export function asianaLoadRegions(catalog){return [...REGIONS.filter(r=>catalog?.regions?.[r]?.length),'기타'];}
function asianaGroups(body,catalog,origin){
 if(body?.schema!==1||body.origin!==origin||body.region!=='아시아나'||!body.records||Array.isArray(body.records)||typeof body.records!=='object'||Object.keys(body.records).length>5000)throw new Error('아시아나 저장 자료 형식 오류');
 const names=asianaLoadRegions(catalog),groups=new Map(names.map(name=>[name,{}])),airports=new Map();
 for(const name of names)for(const city of catalog.regions[name]??[])airports.set(city.code,name);
 for(const [key,payload] of Object.entries(body.records)){const current=payload?.current;if(current&&isExcludedRecord(current,catalog,origin))continue;const code=current?.origin===origin?current?.destination:current?.origin;groups.get(airports.get(code)??'기타')[key]=payload;}
 return names.map(region=>({region,body:{...body,records:groups.get(region)}}));
}
export function retainUnavailableRegions(next,previous=[]){
 const failed=new Set(next.errors);
 const retained=previous.filter(record=>failed.has(record.sourceRegion));
 return {...next,records:[...next.records,...retained]};
}
async function readJSON(response,signal){
 if(Number(response.headers.get('content-length'))>48*1024*1024)throw new Error('자료 크기 초과');const reader=response.body.getReader(),decoder=new TextDecoder();let text='',size=0;
 try{while(true){if(signal?.aborted)throw signal.reason;const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>48*1024*1024)throw new Error('자료 크기 초과');text+=decoder.decode(value,{stream:true});}return JSON.parse(text+decoder.decode());}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function loadSavedDataset({catalogs,carriers,origin,signal,force=false,fetcher=fetch,onProgress=()=>{},now=Date.now()}){
 if(!/^[A-Z]{3}$/.test(origin)||!carriers.length||carriers.some(c=>!['KE','OZ'].includes(c)))throw new Error('자료 경로 오류');
 const sources=sourcesFor(catalogs,carriers);if(sources.some(s=>!/^[a-z_]+$/.test(s.id)))throw new Error('지역 경로 오류');
 const results=Object.fromEntries(carriers.map(c=>[c,{records:[],errors:[]}])),succeeded=new Set(),total=sources.length+(carriers.includes('OZ')?asianaLoadRegions(catalogs.OZ).length:0);let cursor=0,completed=0;
 const emit=(source,phase,extra={})=>onProgress({completed,total,source,phase,...extra});
 // A unique read URL avoids replaying the CDN's pre-upload (possibly empty) document.
 const requestVersion=Date.now();
 async function worker(){while(cursor<sources.length&&!signal?.aborted){const source=sources[cursor++],result=results[source.carrier];emit(source,'loading');
  try{const response=await fetcher(`${source.carrier==='OZ'?OZ_BASE:BASE}${origin}/${source.id}.json?refresh=${requestVersion}`,{signal,cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});
   let body=null;if(response.status!==404){if(!response.ok)throw new Error(`HTTP ${response.status}`);body=await unpackDocument(await readJSON(response,signal));if(signal?.aborted)throw signal.reason;}
   if(source.carrier==='OZ'){
    const groups=body?asianaGroups(body,catalogs.OZ,origin):asianaLoadRegions(catalogs.OZ).map(region=>({region,body:null})),staged=[];
    completed++;emit({...source,region:'전체 자료 다운로드'},'done');
    for(const group of groups){if(signal?.aborted)throw signal.reason;const stage={...source,region:group.region};emit(stage,'processing');
     const records=group.body?readDocument(group.body,{carrier:'OZ',origin,region:'아시아나',now}):[];
     staged.push(...records.map(record=>({...record,sourceRegion:'아시아나',loadRegion:group.region})));completed++;emit(stage,'done',{recordCount:records.length});
     // Yield after real region validation so the browser can paint completed work.
     await new Promise(resolve=>setTimeout(resolve,0));
    }
    if(signal?.aborted)throw signal.reason;result.records.push(...staged);
   }else{if(body)result.records.push(...readDocument(body,{carrier:source.carrier,origin,region:source.region,now}).map(record=>({...record,sourceRegion:source.region})));completed++;emit(source,'done');}
   succeeded.add(source.carrier+':'+source.id);
  }catch(error){result.errors.push(source.region);emit(source,'error');}
 }}
 await Promise.all(Array.from({length:Math.min(3,sources.length)},()=>worker()));
 if(signal?.aborted){for(const source of sources)if(!succeeded.has(source.carrier+':'+source.id)&&!results[source.carrier].errors.includes(source.region))results[source.carrier].errors.push(source.region);for(const result of Object.values(results))if(!result.errors.includes('연결 시간 초과'))result.errors.push('연결 시간 초과');}
 return {results,completed,total,aborted:signal?.aborted??false};
}

