import {BASE,REGIONS,readDocument,unpackDocument} from './model.js';
export function sourcesFor(catalogs,carriers){
 return carriers.flatMap(carrier=>carrier==='OZ'?[{carrier,id:'asiana',region:'아시아나'}]:REGIONS.filter(region=>catalogs.KE.ids[region]).map(region=>({carrier,id:catalogs.KE.ids[region],region})));
}
async function readJSON(response,signal){
 if(Number(response.headers.get('content-length'))>48*1024*1024)throw new Error('자료 크기 초과');const reader=response.body.getReader(),decoder=new TextDecoder();let text='',size=0;
 try{while(true){if(signal?.aborted)throw signal.reason;const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>48*1024*1024)throw new Error('자료 크기 초과');text+=decoder.decode(value,{stream:true});}return JSON.parse(text+decoder.decode());}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function loadSavedDataset({catalogs,carriers,origin,signal,force=false,fetcher=fetch,onProgress=()=>{},now=Date.now()}){
 if(!/^[A-Z]{3}$/.test(origin)||!carriers.length||carriers.some(c=>!['KE','OZ'].includes(c)))throw new Error('자료 경로 오류');
 const sources=sourcesFor(catalogs,carriers);if(sources.some(s=>!/^[a-z_]+$/.test(s.id)))throw new Error('지역 경로 오류');
 const results=Object.fromEntries(carriers.map(c=>[c,{records:[],errors:[]}]));let cursor=0,completed=0;
 async function worker(){while(cursor<sources.length&&!signal?.aborted){const source=sources[cursor++],result=results[source.carrier];onProgress({completed,total:sources.length,source,phase:'loading'});
  try{const response=await fetcher(`${BASE}${origin}/${source.id}.json`,{signal,cache:force?'reload':'default',credentials:'omit',referrerPolicy:'no-referrer'});
   if(response.status!==404){if(!response.ok)throw new Error(`HTTP ${response.status}`);const body=await unpackDocument(await readJSON(response,signal));if(signal?.aborted)throw signal.reason;result.records.push(...readDocument(body,{carrier:source.carrier,origin,region:source.region,now}));}
   completed++;onProgress({completed,total:sources.length,source,phase:'done'});
  }catch(error){result.errors.push(source.region);onProgress({completed,total:sources.length,source,phase:'error'});}
 }}
 await Promise.all(Array.from({length:Math.min(3,sources.length)},()=>worker()));
 if(signal?.aborted)for(const result of Object.values(results))if(!result.errors.includes('연결 시간 초과'))result.errors.push('연결 시간 초과');
 return {results,completed,total:sources.length,aborted:signal?.aborted??false};
}
