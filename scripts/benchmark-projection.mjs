// Usage: node scripts/benchmark-projection.mjs /absolute/path/to/baseline.mjs
// Compares calculation only. It does not measure network, UI, or collection time.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {projectRepeatedMarkerRecords as optimized} from '../dist/repeat-markers.js';
import {ALL_FIELDS,unpackDocument,readDocument} from '../dist/model.js';
const {projectRepeatedMarkerRecords:baseline}=await import(pathToFileURL(process.argv[2]));
const catalog=JSON.parse(await readFile(new URL('../dist/catalog.json',import.meta.url))).KE;
const body=await unpackDocument(JSON.parse(await readFile(new URL('../tests/fixtures/europe-original-live.json',import.meta.url))));
const live=readDocument(body,{carrier:'KE',origin:'ICN',region:'유럽'});
const destinations=[...new Set(Object.entries(catalog.regions).filter(([region])=>!['동북아시아','대한민국'].includes(region)).flatMap(([,cities])=>cities.map(c=>c.code)))];
const months=['2026-11','2026-12',...Array.from({length:10},(_,i)=>'2027-'+String(i+1).padStart(2,'0'))];
const allRoutes=destinations.flatMap(destination=>['out','back'].flatMap(direction=>months.map(month=>({
 carrier:'KE',origin:direction==='out'?'ICN':destination,destination:direction==='out'?destination:'ICN',month,success:1793661000000,
 dates:Array.from({length:new Date(Date.UTC(+month.slice(0,4),+month.slice(5,7),0)).getUTCDate()},(_,i)=>{
  const date=month+'-'+String(i+1).padStart(2,'0'),known=month!=='2027-10'||i<28,off=[0,2,4,5].includes(new Date(date+'T00:00:00Z').getUTCDay());
  return {date,status:known?'OBSERVED':'UNKNOWN',...Object.fromEntries(ALL_FIELDS.map(f=>[f,known&&off&&['economyAward','prestigeAward','prestigeUpgrade'].includes(f)]))};
 })
}))));
const results=[];
for(const [name,raw] of [['saved live fixture',live],['all catalog routes, both directions, 12 months',allRoutes]]){
 const original=structuredClone(raw);assert.deepEqual(optimized(raw,raw,catalog),baseline(raw,raw,catalog));assert.deepEqual(raw,original);
 const measure=run=>{const times=[];for(let i=0;i<7;i++){const start=performance.now();run(raw,raw,catalog);const ms=performance.now()-start;if(i>1)times.push(ms);}return times.sort((a,b)=>a-b)[2];};
 const baselineMs=measure(baseline),optimizedMs=measure(optimized);
 results.push({name,records:raw.length,baselineMs,optimizedMs,speedup:baselineMs/optimizedMs,identicalOutput:true,inputsPreserved:true});
}
console.log(JSON.stringify({kind:'local projection calculation, median of 5 runs after 2 warmups',results},null,2));
