import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {unpackDocument,readDocument,validateRecord,todayKST,makeRoutes,filterRoutes,cellInfo,validDate,monthStep,hasMark} from '../dist/model.js';
const catalog=JSON.parse(await readFile(new URL('../dist/catalog.json',import.meta.url)));
const packed=JSON.parse(await readFile(new URL('europe-packed.json',import.meta.url))),ozPacked=JSON.parse(await readFile(new URL('asiana-packed.json',import.meta.url)));
const ke=await unpackDocument(packed),oz=await unpackDocument(ozPacked),now=Date.now();
const records=readDocument(ke,{carrier:'KE',origin:'ICN',region:'유럽',now});
const clone=value=>structuredClone(value),key=Object.keys(ke.records)[0];
test('actual shared Korean Air and Asiana gzip documents retain original clocks and isolated carriers',()=>{assert.equal(records.length,72);assert.equal(readDocument(oz,{carrier:'OZ',origin:'ICN',region:'아시아나',now}).length,104);assert.equal(records[0].success,ke.records[key].success);assert.throws(()=>readDocument(oz,{carrier:'KE',origin:'ICN',region:'아시아나',now}),/항공사/);});
test('wrong origin, region and schema cannot produce calendar data',()=>{for(const patch of [{origin:'GMP'},{region:'미주'},{schema:2}])assert.throws(()=>readDocument({...ke,...patch},{carrier:'KE',origin:'ICN',region:'유럽',now}));});
test('route key mismatch and duplicate calendar days are rejected',()=>{const p=clone(ke.records[key]);assert.throws(()=>validateRecord('ICN-CDG-2000-01',p,{carrier:'KE',origin:'ICN',now}));p.current.dates[1].date=p.current.dates[0].date;assert.throws(()=>validateRecord(key,p,{carrier:'KE',origin:'ICN',now}),/날짜/);});
test('missing dates and nonboolean seat fields never become no-seat results',()=>{for(const modify of [p=>p.current.dates.pop(),p=>p.current.dates[0].prestigeAward='false',p=>p.current.dates[0].status='PENDING']){const p=clone(ke.records[key]);modify(p);assert.throws(()=>validateRecord(key,p,{carrier:'KE',origin:'ICN',now}));}});
test('a future success clock and a clock preceding observation are rejected',()=>{for(const success of [now+300001,Date.parse(ke.records[key].current.collectedAt)-1])assert.throws(()=>validateRecord(key,{...ke.records[key],success},{carrier:'KE',origin:'ICN',now}),/시각/);});
test('Korean midnight uses Korea date regardless of UTC date',()=>{assert.equal(todayKST(new Date('2026-10-30T14:59:59Z')),'2026-10-30');assert.equal(todayKST(new Date('2026-10-30T15:00:00Z')),'2026-10-31');});
test('unknown and no-flight days do not count as availability even if a stale marker exists',()=>{for(const status of ['UNKNOWN','NO_FLIGHT'])assert.equal(hasMark({status,prestigeAward:true},'KE'),false);assert.equal(hasMark({status:'OBSERVED',firstCombined:true},'OZ'),false);});
test('only actually saved routes are grouped, and both directions retain independent monthly records',()=>{const routes=makeRoutes(records,catalog.KE,'ICN');assert.equal(routes.length,12);const lhr=routes.find(r=>r.code==='LHR');assert.ok(lhr.legs.out.get('2026-11'));assert.ok(lhr.legs.back.get('2026-11'));assert.equal(cellInfo(lhr,'out','2027-02-01','KE').kind,'unknown');});
test('city, region, dates and cabin filtering agree with the underlying saved day markers',()=>{const routes=makeRoutes(records,catalog.KE,'ICN'),filter={carrier:'KE',seat:'0',start:'2026-11-02',end:'2026-11-10',region:'유럽',query:'lhr'};const out=filterRoutes(routes,filter);assert.equal(out.length,1);let expected=0;for(const leg of Object.values(out[0].legs)){const r=leg.get('2026-11');expected+=r.dates.filter(d=>d.date>=filter.start&&d.date<=filter.end&&d.status==='OBSERVED'&&d.prestigeAward).length;}assert.equal(out[0].summary.marked,expected);assert.equal(filterRoutes(routes,{...filter,region:'미주'}).length,0);});
test('newer duplicate records win without merging seat data from another observation',()=>{const a=records[0],b={...a,success:a.success+1};const route=makeRoutes([a,b],catalog.KE,'ICN')[0];assert.equal(route.legs.out.get(a.month).success,b.success);});
test('malformed and oversized compressed data fail before any records are rendered',async()=>{await assert.rejects(()=>unpackDocument({encoding:'gzip-base64',data:'!!!'}));await assert.rejects(()=>unpackDocument({encoding:'brotli',data:''}));const encoded=gzipSync(' '.repeat(2048)).toString('base64');await assert.rejects(()=>unpackDocument({encoding:'gzip-base64',data:encoded},{maxBytes:1024}),/크기/);});
test('calendar boundaries reject impossible dates and advance across years correctly',()=>{assert.equal(validDate('2026-02-30'),false);assert.equal(validDate('2028-02-29'),true);assert.equal(monthStep('2026-12',1),'2027-01');assert.equal(monthStep('2027-01',-1),'2026-12');});

const day=(date,status='OBSERVED',flags={})=>({date,status,prestigeAward:false,prestigeUpgrade:false,firstCombined:false,...flags});
const countRoute=(out,back=[])=>({legs:{out:new Map([['2026-11',{success:1,dates:out}]]),back:new Map([['2026-11',{success:2,dates:back}]])}});
const range={carrier:'KE',start:'2026-11-02',end:'2026-11-03'};
const {summarize}=await import('../dist/model.js');
test('type counts include overlapping types separately and both directions, within the selected range',()=>{
 const route=countRoute([day('2026-11-01','OBSERVED',{prestigeAward:true}),day('2026-11-02','OBSERVED',{prestigeAward:true,prestigeUpgrade:true}),day('2026-11-03','OBSERVED',{firstCombined:true})],[day('2026-11-02','OBSERVED',{prestigeAward:true,firstCombined:true})]);
 const summary=summarize(route,range);assert.deepEqual(summary.byType,{prestigeAward:2,prestigeUpgrade:1,firstCombined:2});assert.equal(summary.marked,3);assert.equal(summary.observed,3);
});
test('unknown and no-flight stale flags never count, and no observations are distinguishable from an observed zero',()=>{
 const unknown=summarize(countRoute([day('2026-11-02','UNKNOWN',{prestigeAward:true}),day('2026-11-03','NO_FLIGHT',{firstCombined:true})]),range);
 assert.deepEqual(unknown.byType,{prestigeAward:0,prestigeUpgrade:0,firstCombined:0});assert.equal(unknown.observed,0);
 const empty=summarize(countRoute([day('2026-11-02')]),range);assert.equal(empty.observed,1);assert.equal(empty.byType.prestigeAward,0);
});
test('Asiana supports only business award and upgrade counts even with a stale first flag',()=>{
 const result=summarize(countRoute([day('2026-11-02','OBSERVED',{prestigeAward:true,firstCombined:true}),day('2026-11-03','OBSERVED',{prestigeUpgrade:true})]),{...range,carrier:'OZ'});
 assert.deepEqual(result.byType,{prestigeAward:1,prestigeUpgrade:1});assert.equal(result.marked,2);
});
test('seat filtering changes matching dates without hiding the other category counts',()=>{
 const route=countRoute([day('2026-11-02','OBSERVED',{prestigeAward:true}),day('2026-11-03','OBSERVED',{prestigeUpgrade:true,firstCombined:true})]);
 const summary=summarize(route,{...range,seat:'0'});assert.equal(summary.marked,1);assert.deepEqual(summary.byType,{prestigeAward:1,prestigeUpgrade:1,firstCombined:1});
});
