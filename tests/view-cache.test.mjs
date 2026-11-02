import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {createSummaryCache} from '../dist/view-cache.js';
import {unpackDocument,readDocument,makeRoutes,summarize,filterRoutes} from '../dist/model.js';
import {projectRepeatedMarkerRecords} from '../dist/repeat-markers.js';
const catalog=JSON.parse(await readFile(new URL('../dist/catalog.json',import.meta.url))).KE;
const body=await unpackDocument(JSON.parse(await readFile(new URL('fixtures/europe-original-live.json',import.meta.url))));
const raw=readDocument(body,{carrier:'KE',origin:'ICN',region:'유럽'}),routes=makeRoutes(projectRepeatedMarkerRecords(raw,raw,catalog),catalog,'ICN');
const base={carrier:'KE',seat:'all',start:'2026-11-03',end:'2027-10-28',region:'전체'};
test('cached date totals exactly match uncached results across routes, months, directions, seat filters and clipped ranges',()=>{
 const cached=createSummaryCache(summarize);
 for(const route of routes)for(const month of [undefined,'2026-11','2026-12','2027-10'])for(const direction of [undefined,'out','back'])for(const seat of ['all','0','1','2'])for(const start of ['2026-11-03','2026-12-10']){
  const scope={...base,start,month,direction,seat};assert.deepEqual(cached(route,scope),summarize(route,scope));assert.deepEqual(cached({...route},scope),summarize(route,scope));
 }
 for(const onlyMarked of [false,true])assert.deepEqual(filterRoutes(routes,{...base,onlyMarked},cached),filterRoutes(routes,{...base,onlyMarked}));
});
test('newly loaded leg maps invalidate cached results even for the same route code',()=>{
 let calls=0;const cached=createSummaryCache((...args)=>{calls++;return summarize(...args);}),route=routes[0];cached(route,base);cached({...route},base);assert.equal(calls,1);
 const changed={...route,legs:structuredClone(route.legs)};for(const leg of Object.values(changed.legs))for(const r of leg.values())for(const d of r.dates){d.status='UNKNOWN';delete d.savedCalendar;delete d.savedAggregate;delete d.repeatMarkerReviewFlags;for(const key of ['prestigeAward','prestigeUpgrade','firstCombined'])d[key]=false;}
 assert.deepEqual(cached(changed,base),summarize(changed,base));assert.equal(calls,2);
});
test('per-route cache remains bounded during repeated date edits',()=>{
 let calls=0;const cached=createSummaryCache(()=>++calls,2),route={legs:{}};cached(route,{...base,seat:'all'});cached(route,{...base,seat:'0'});cached(route,{...base,seat:'1'});assert.equal(cached(route,{...base,seat:'0'}),2);assert.equal(cached(route,{...base,seat:'all'}),4);
});
