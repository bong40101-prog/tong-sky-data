import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {loadSavedDataset,sourcesFor,retainUnavailableRegions} from '../dist/data.js';
const catalogs=JSON.parse(await readFile(new URL('../dist/catalog.json',import.meta.url)));
const packed=JSON.parse(await readFile(new URL('europe-packed.json',import.meta.url)));
test('startup plans six retained Korean Air regions and one Asiana document without excluded region downloads',()=>{const s=sourcesFor(catalogs,['KE','OZ']);assert.equal(s.length,7);assert.ok(s.every(x=>!['동북아시아','대한민국'].includes(x.region)));assert.ok(s.every(x=>!['east_asia','korea'].includes(x.id)));assert.equal(s.filter(x=>x.carrier==='OZ').length,1);assert.equal(s[0].id,'europe');});
test('progress reaches all-complete only after both airlines finish and every URL is read-only',async()=>{let release,arrived;const gate=new Promise(r=>release=r),seen=new Promise(r=>arrived=r),progress=[],calls=[];let result;
 const run=loadSavedDataset({catalogs,carriers:['KE','OZ'],origin:'ICN',onProgress:p=>progress.push(p.completed),fetcher:async(url,options)=>{calls.push({url,options});if(url.endsWith('/asiana.json')){arrived();await gate;}return new Response('',{status:404});}}).then(r=>{result=r;return r;});
 await seen;await new Promise(r=>setTimeout(r,5));assert.equal(result,undefined);assert.ok(Math.max(...progress)<13);release();const r=await run;assert.equal(r.completed,13);assert.equal(progress.at(-1),13);assert.equal(calls.length,7);for(const c of calls){assert.match(c.url,/^https:\/\/raw\.githubusercontent\.com\//);assert.equal(c.options.credentials,'omit');assert.equal(c.options.method,undefined);assert.equal(c.options.headers,undefined);}});
test('HTTP denials are not retried and cannot report 100 percent loaded',async()=>{let calls=0;const r=await loadSavedDataset({catalogs,carriers:['OZ'],origin:'ICN',fetcher:async()=>{calls++;return new Response('',{status:403});}});assert.equal(calls,1);assert.equal(r.completed,0);assert.equal(r.results.OZ.errors.length,1);assert.equal(r.results.OZ.records.length,0);});
test('one damaged region leaves verified regions intact while reporting a partial load',async()=>{const r=await loadSavedDataset({catalogs,carriers:['KE'],origin:'ICN',fetcher:async url=>url.endsWith('/europe.json')?Response.json(packed):url.endsWith('/americas.json')?Response.json({schema:1}):new Response('',{status:404})});assert.equal(r.results.KE.records.length,72);assert.deepEqual(r.results.KE.errors,['미주']);assert.equal(r.completed,5);});
test('abort stops new work and retains a non-complete progress state',async()=>{const c=new AbortController();let calls=0;const r=await loadSavedDataset({catalogs,carriers:['KE','OZ'],origin:'ICN',signal:c.signal,fetcher:async()=>{calls++;c.abort(new Error('timeout'));throw new Error('timeout');}});assert.equal(r.aborted,true);assert.ok(calls<=3);assert.ok(r.completed<r.total);assert.ok(r.results.KE.errors.length);});
test('invalid airport and unexpected region paths are rejected before requesting data',async()=>{let calls=0;const fetcher=async()=>{calls++;return new Response('',{status:404});};await assert.rejects(()=>loadSavedDataset({catalogs,carriers:['KE'],origin:'../',fetcher}));const changed=structuredClone(catalogs);changed.KE.ids['유럽']='../../secret';await assert.rejects(()=>loadSavedDataset({catalogs:changed,carriers:['KE'],origin:'ICN',fetcher}));assert.equal(calls,0);});
test('refresh fallback retains only failed source regions and never revives successfully emptied regions',()=>{const old=[{sourceRegion:'유럽',value:1},{sourceRegion:'미주',value:2}],next={records:[],errors:['유럽']};assert.deepEqual(retainUnavailableRegions(next,old).records,[old[0]]);assert.deepEqual(retainUnavailableRegions({records:[],errors:[]},old).records,[]);});
test('aborted loading identifies regions that were never started as unavailable',async()=>{const c=new AbortController();const r=await loadSavedDataset({catalogs,carriers:['KE'],origin:'ICN',signal:c.signal,fetcher:async()=>{c.abort();throw Error('aborted');}});for(const source of sourcesFor(catalogs,['KE']))assert.ok(r.results.KE.errors.includes(source.region));});

test('KE schema2 data uses v102 while OZ remains on the compatible v101 namespace',async()=>{const calls=[];await loadSavedDataset({catalogs,carriers:['KE','OZ'],origin:'ICN',fetcher:async(url)=>{calls.push(url);return new Response('',{status:404});}});assert.equal(calls.filter(url=>url.includes('/v102/ICN/')).length,6);assert.equal(calls.filter(url=>url.includes('/v101/ICN/asiana.json')).length,1);assert.equal(calls.some(url=>url.includes('/v102/ICN/asiana.json')),false);});


test('Asiana uses one download then distinct actual regional stages without losing routes or original clocks',async()=>{
 const {unpackDocument,readDocument}=await import('../dist/model.js'),{asianaLoadRegions}=await import('../dist/data.js');
 const source=JSON.parse(await readFile(new URL('asiana-packed.json',import.meta.url))),events=[],calls=[];
 const expected=readDocument(await unpackDocument(source),{carrier:'OZ',origin:'ICN',region:'아시아나'});
 const loaded=await loadSavedDataset({catalogs,carriers:['OZ'],origin:'ICN',fetcher:async url=>{calls.push(url);return Response.json(source);},onProgress:p=>events.push(p)});
 assert.equal(calls.length,1);assert.equal(loaded.results.OZ.errors.length,0);assert.equal(loaded.completed,loaded.total);
 const stages=events.filter(p=>p.phase==='done'&&p.recordCount!==undefined);
 assert.deepEqual(stages.map(p=>p.source.region),asianaLoadRegions(catalogs.OZ));
 assert.equal(stages.reduce((n,p)=>n+p.recordCount,0),expected.length);
 assert.equal(new Set(stages.map(p=>p.completed)).size,stages.length);
 assert.deepEqual(loaded.results.OZ.records.map(({sourceRegion,loadRegion,...record})=>record).sort((a,b)=>(a.origin+a.destination+a.month).localeCompare(b.origin+b.destination+b.month)),expected.sort((a,b)=>(a.origin+a.destination+a.month).localeCompare(b.origin+b.destination+b.month)));
 assert.ok(loaded.results.OZ.records.every(r=>r.sourceRegion==='아시아나'&&typeof r.loadRegion==='string'));
});
test('Asiana cancel during a regional stage never commits a partial document or reports completed work',async()=>{
 const source=JSON.parse(await readFile(new URL('asiana-packed.json',import.meta.url))),controller=new AbortController(),events=[];
 const loaded=await loadSavedDataset({catalogs,carriers:['OZ'],origin:'ICN',signal:controller.signal,fetcher:async()=>Response.json(source),onProgress:p=>{events.push(p);if(p.phase==='done'&&p.recordCount!==undefined)controller.abort();}});
 assert.equal(loaded.aborted,true);assert.equal(loaded.results.OZ.records.length,0);assert.ok(loaded.completed<loaded.total);assert.ok(loaded.results.OZ.errors.includes('아시아나'));
});
