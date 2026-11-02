import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadSavedDataset} from '../dist/data.js';
import {unpackDocument,makeRoutes,limitDisplayRecords,cellInfo} from '../dist/model.js';
import {projectRepeatedMarkerRecords} from '../dist/repeat-markers.js';
const catalogs=JSON.parse(await readFile(new URL('../dist/catalog.json',import.meta.url)));
const packed=JSON.parse(await readFile(new URL('london-live-packed.json',import.meta.url)));
const live=await unpackDocument(packed);
test('reload and manual refresh bypass a cached empty document and render the actual monthly London marks',async()=>{
 const calls=[];
 const edge=new Map();
 const canonical='https://raw.githubusercontent.com/bong40101-prog/tong-sky-data/tong-sky-data/data/mobile/v103/ICN/europe.json';
 edge.set(canonical,{schema:1,origin:'ICN',region:'유럽',records:{}});
 const fetcher=async(url,options)=>{
  calls.push({url,options});
  if(new URL(url).pathname.endsWith('/europe.json')){
   if(!edge.has(url))edge.set(url,packed);
   return Response.json(edge.get(url));
  }
  return new Response('',{status:404});
 };
 for(const force of [false,true]){
  const loaded=await loadSavedDataset({catalogs,carriers:['KE'],origin:'ICN',force,fetcher,now:live.updatedAt+300000});
  assert.deepEqual(loaded.results.KE.errors,[]);
  assert.equal(loaded.results.KE.records.length,Object.keys(live.records).length);
  const raw=loaded.results.KE.records;
  const projected=limitDisplayRecords(projectRepeatedMarkerRecords(raw,raw,catalogs.KE),catalogs.KE);
  const london=makeRoutes(projected,catalogs.KE,'ICN').find(r=>r.code==='LHR');
  assert.ok(london);
  assert.equal(london.legs.out.size,12);
  assert.equal(london.legs.back.size,12);
  assert.equal(cellInfo(london,'out','2026-11-05','KE').marks[0].field,'prestigeUpgrade');
 }
 assert.ok(calls.every(c=>c.options.cache==='no-store'&&new URL(c.url).searchParams.has('refresh')));
 const requests=calls.filter(c=>new URL(c.url).pathname.endsWith('/europe.json'));
 assert.notEqual(requests[0].url,requests[1].url);
});
