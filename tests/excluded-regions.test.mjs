import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {EXCLUDED_REGIONS,REGIONS,cityIndex,countriesFor,airportsFor,makeRoutes,readDocument,unpackDocument} from '../dist/model.js';
import {sourcesFor,asianaLoadRegions,loadSavedDataset} from '../dist/data.js';
const catalogs=JSON.parse(await readFile(new URL('../dist/catalog.json',import.meta.url)));
const oldAsiana=await unpackDocument(JSON.parse(await readFile(new URL('asiana-packed.json',import.meta.url))));
const excludedCodes=carrier=>new Set(['동북아시아','대한민국'].flatMap(region=>(catalogs[carrier].regions[region]??[]).map(city=>city.code)));

test('both airlines remove Northeast Asian and Korean region, country and destination options while retaining other geography',()=>{
 assert.deepEqual(EXCLUDED_REGIONS,['동북아시아','대한민국']);
 assert.ok(REGIONS.every(region=>!EXCLUDED_REGIONS.includes(region)));
 for(const carrier of ['KE','OZ']){
  const index=cityIndex(catalogs[carrier]),excluded=excludedCodes(carrier),airports=airportsFor(catalogs[carrier],{origin:'ICN'}),countries=countriesFor(catalogs[carrier]);
  for(const code of excluded){assert.equal(index.has(code),false);assert.ok(!airports.some(city=>city.code===code));}
  for(const code of ['JP','CN','KR'])assert.ok(!countries.some(country=>country.code===code));
  assert.ok(index.has('CDG'));assert.ok(index.has('BKK'));assert.ok(index.has('JFK'));assert.ok(countries.some(country=>country.code==='TH'));
  assert.deepEqual(airportsFor(catalogs[carrier],{region:'동북아시아'}),[]);assert.deepEqual(airportsFor(catalogs[carrier],{region:'대한민국'}),[]);
 }
 const sources=sourcesFor(catalogs,['KE','OZ']);assert.equal(sources.length,7);
 assert.ok(sources.every(source=>!['east_asia','korea'].includes(source.id)));
 assert.ok(asianaLoadRegions(catalogs.OZ).every(region=>!EXCLUDED_REGIONS.includes(region)));
});

test('old cached excluded routes disappear in both directions without dropping all ICN anchored retained routes',()=>{
 for(const carrier of ['KE','OZ']){
  const records=['NRT','CAN','GMP','CJU','CDG','BKK','JFK'].flatMap(code=>[
   {carrier,origin:'ICN',destination:code,month:'2026-11',success:1,dates:[]},
   {carrier,origin:code,destination:'ICN',month:'2026-11',success:1,dates:[]}
  ]),before=structuredClone(records),routes=makeRoutes(records,catalogs[carrier],'ICN');
  assert.deepEqual(routes.map(route=>route.code).sort(),['BKK','CDG','JFK']);
  for(const route of routes){assert.ok(route.legs.out.has('2026-11'));assert.ok(route.legs.back.has('2026-11'));}
  assert.deepEqual(records,before);
 }
});

test('combined old Asiana document drops excluded destinations before region grouping and preserves retained or unknown counterparts',async()=>{
 const body=structuredClone(oldAsiana),template=Object.values(body.records)[0];
 for(const [origin,destination] of [['ICN','NRT'],['NRT','ICN'],['ICN','CAN'],['ICN','GMP'],['GMP','ICN'],['ICN','BKK'],['BKK','ICN'],['ICN','ZZZ']]){
  const value=structuredClone(template);Object.assign(value.current,{carrier:'OZ',origin,destination});body.records[`${origin}-${destination}-${value.current.month}`]=value;
 }
 const before=structuredClone(body),excluded=excludedCodes('OZ'),expected=readDocument(body,{carrier:'OZ',origin:'ICN',region:'아시아나'}).filter(record=>!excluded.has(record.origin==='ICN'?record.destination:record.origin));
 const calls=[],events=[],loaded=await loadSavedDataset({catalogs,carriers:['OZ'],origin:'ICN',fetcher:async url=>{calls.push(url);return Response.json(body);},onProgress:event=>events.push(event)});
 assert.equal(calls.length,1);assert.deepEqual(loaded.results.OZ.errors,[]);assert.equal(loaded.completed,loaded.total);
 const actual=loaded.results.OZ.records,byKey=records=>records.map(record=>`${record.origin}-${record.destination}-${record.month}`).sort();
 assert.deepEqual(byKey(actual),byKey(expected));assert.ok(actual.some(record=>record.origin==='ICN'&&record.destination==='BKK'));assert.ok(actual.some(record=>record.origin==='BKK'&&record.destination==='ICN'));
 assert.ok(actual.some(record=>record.destination==='ZZZ'&&record.loadRegion==='기타'));
 assert.ok(actual.every(record=>!excluded.has(record.origin==='ICN'?record.destination:record.origin)));
 assert.ok(events.every(event=>!EXCLUDED_REGIONS.includes(event.source.region)));
 assert.equal(events.filter(event=>event.recordCount!==undefined&&event.phase==='done').reduce((total,event)=>total+event.recordCount,0),expected.length);
 assert.deepEqual(body,before);
});

test('excluded Korean Air documents are never fetched while successful retained regional reads still finish',async()=>{
 const calls=[],loaded=await loadSavedDataset({catalogs,carriers:['KE','OZ'],origin:'ICN',fetcher:async url=>{calls.push(url);return new Response('',{status:404});}});
 assert.equal(loaded.completed,13);assert.equal(loaded.total,13);assert.equal(calls.length,7);
 assert.ok(calls.every(url=>!url.endsWith('/east_asia.json')&&!url.endsWith('/korea.json')));
 assert.ok(calls.some(url=>url.endsWith('/europe.json')));assert.ok(calls.some(url=>url.endsWith('/americas.json')));assert.ok(calls.some(url=>url.endsWith('/se_asia.json')));assert.ok(calls.some(url=>url.endsWith('/asiana.json')));
});
