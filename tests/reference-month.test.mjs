import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ALL_FIELDS,unpackDocument,readDocument,makeRoutes,summarize} from '../dist/model.js';
import {projectRepeatedMarkerRecords} from '../dist/repeat-markers.js';
import {collectRepeatHistory,serializeRepeatHistory,readRepeatHistory} from '../dist/repeat-history.js';
const catalog=JSON.parse(await readFile(new URL('../dist/catalog.json',import.meta.url))).KE;
const triple=['economyAward','prestigeAward','prestigeUpgrade'];
const flags=active=>Object.fromEntries(ALL_FIELDS.map(f=>[f,active.includes(f)]));
function record(month,{origin='ICN',destination='FCO',off=[0,2,4,5],unknown=[]}={}){
 const count=new Date(Date.UTC(+month.slice(0,4),+month.slice(5,7),0)).getUTCDate();
 return {carrier:'KE',origin,destination,month,success:1793661000000,collectedAt:'2026-11-02T23:10:00Z',sourceUpdatedAt:'2026-11-02T23:00:00Z',collectionMethod:'MONTHLY_CALENDAR',dates:Array.from({length:count},(_,i)=>{const date=month+'-'+String(i+1).padStart(2,'0');return {date,status:unknown.includes(i+1)?'UNKNOWN':'OBSERVED',...flags(unknown.includes(i+1)?[]:off.includes(new Date(date+'T00:00:00Z').getUTCDay())?triple:[])};})};
}
const project=records=>projectRepeatedMarkerRecords(records,records,catalog);
const day=(r,date)=>r.dates.find(d=>d.date===date);
test('projection indexes are isolated by route and rebuilt after source or catalog edits',()=>{
 const september=record('2027-09'),october=record('2027-10',{unknown:[29,30,31]}),paris=record('2027-09',{destination:'CDG'}),raw=[september,october,paris];
 const first=project(raw);
 assert.ok(day(first[1],'2027-10-01').repeatMarkerExclusion);
 first[0].repeatMarkerPolicy.evidence[0].dates.length=0;
 assert.ok(first[2].repeatMarkerPolicy.evidence[0].dates.length>0);
 for(const d of september.dates)if(new Date(d.date+'T00:00:00Z').getUTCDay()===5)d.prestigeAward=false;
 const second=project(raw);assert.equal(day(second[1],'2027-10-01').repeatMarkerExclusion,undefined);assert.ok(day(second[1],'2027-10-01').repeatMarkerReview);
 const changedCatalog=structuredClone(catalog);for(const cities of Object.values(changedCatalog.regions))for(let i=cities.length-1;i>=0;i--)if(cities[i].code==='FCO')cities.splice(i,1);
 assert.equal(projectRepeatedMarkerRecords(raw,raw,changedCatalog)[1].repeatMarkerPolicy,undefined);
});
test('partial October uses September for all observed Sunday and Friday triplets, preserving unopened dates and inputs',()=>{
 const raw=[record('2027-09'),record('2027-10',{unknown:[29,30,31]})],before=structuredClone(raw),out=project(raw)[1];
 assert.deepEqual(out.repeatMarkerPolicy.weekdays,[0,2,4,5]);
 assert.equal(out.repeatMarkerPolicy.referenceMonth,'2027-09');
 assert.equal(out.repeatMarkerPolicy.reviews.length,0);
 assert.equal(out.repeatMarkerPolicy.excludedDates.length,16);
 for(const date of ['2027-10-01','2027-10-03','2027-10-08','2027-10-24'])assert.equal(day(out,date).repeatMarkerExclusion.referenceMonth,'2027-09');
 for(const date of ['2027-10-29','2027-10-30','2027-10-31']){assert.equal(day(out,date).status,'UNKNOWN');assert.equal(day(out,date).repeatMarkerExclusion,undefined);}
 assert.deepEqual(raw,before);
});
test('one observed contradiction prevents a previous month from hiding that entire weekday',()=>{
 const current=record('2027-10',{unknown:[29,30,31]});day(current,'2027-10-08').prestigeAward=false;
 const out=project([record('2027-09'),current])[1];
 assert.ok(!out.repeatMarkerPolicy.weekdays.includes(5));
 for(const date of ['2027-10-01','2027-10-08','2027-10-15','2027-10-22']){assert.equal(day(out,date).repeatMarkerExclusion,undefined);assert.ok(day(out,date).repeatMarkerReview);}
});
test('nearest complete previous month wins; incomplete months, different directions and routes cannot supply proof',()=>{
 const partial=record('2027-10',{unknown:[29,30,31]});
 const older=record('2027-08'),incomplete=record('2027-09',{unknown:[30]});
 let out=project([older,incomplete,partial])[2];assert.equal(out.repeatMarkerPolicy.referenceMonth,'2027-08');
 out=project([older,record('2027-09',{off:[]}),partial])[2];assert.ok(!out.repeatMarkerPolicy.weekdays.includes(5));assert.equal(out.repeatMarkerPolicy.referenceMonth,'2027-09');
 out=project([record('2027-09',{origin:'FCO',destination:'ICN'}),record('2027-09',{destination:'LHR'}),partial])[2];assert.ok(!out.repeatMarkerPolicy.weekdays.includes(5));
});
test('latest snapshot of a reference month wins, including a newer incomplete replacement',()=>{
 const old=record('2027-09'),newer=record('2027-09',{unknown:[30]});newer.success++;
 const current=record('2027-10',{unknown:[29,30,31]}),out=project([old,newer,current])[2];
 assert.ok(!out.repeatMarkerPolicy.weekdays.includes(5));
});
test('complete current months keep their own evidence and never borrow previous exclusions',()=>{
 const current=record('2027-10',{off:[]}),out=project([record('2027-09'),current])[1];
 assert.deepEqual(out.repeatMarkerPolicy.weekdays,[]);assert.equal(out.repeatMarkerPolicy.referenceMonth,undefined);
});
test('December18–31 uses next January in the same direction and never alters December1–17',()=>{
 const december=record('2026-12'),january=record('2027-01'),out=project([december,january])[0];
 assert.equal(out.repeatMarkerPolicy.referenceMonth,'2027-01');assert.equal(out.repeatMarkerPolicy.excludedDates.length,8);
 for(const d of out.dates.filter(d=>d.date<='2026-12-17')){assert.equal(d.repeatMarkerExclusion,undefined);assert.equal(d.repeatMarkerReview,undefined);assert.deepEqual(ALL_FIELDS.map(f=>d[f]),ALL_FIELDS.map(f=>day(december,d.date)[f]));}
 assert.ok(day(out,'2026-12-18').repeatMarkerExclusion);
});
test('missing or incomplete January keeps December tail triplets visible and records reference review even at 2/2 matches',()=>{
 for(const references of [[],[record('2027-01',{unknown:[31]})],[record('2027-01',{origin:'FCO',destination:'ICN'})]]){
  const out=project([record('2026-12'),...references])[0];
  assert.deepEqual(out.repeatMarkerPolicy.weekdays,[]);assert.equal(day(out,'2026-12-18').prestigeAward,true);assert.ok(day(out,'2026-12-18').repeatMarkerReview);
  const history=collectRepeatHistory([out]);assert.ok(history.some(e=>e.kind==='REVIEW'&&e.referenceMonth==='2027-01'&&e.matchedDates.length===e.dates.length));
 }
});
test('December reference cannot suppress a target weekday with a differing observed target date',()=>{
 const december=record('2026-12');day(december,'2026-12-25').prestigeAward=false;
 const out=project([december,record('2027-01')])[0];assert.equal(day(out,'2026-12-18').repeatMarkerExclusion,undefined);assert.ok(day(out,'2026-12-18').repeatMarkerReview);
});
test('Americas including Canada and Oceania use the same reference rules; other carriers do not',()=>{
 for(const destination of ['JFK','YYZ','SYD']){const out=project([record('2027-09',{destination}),record('2027-10',{destination,unknown:[29,30,31]})])[1];assert.equal(day(out,'2027-10-01').repeatMarkerExclusion.referenceMonth,'2027-09');}
 const raw=[record('2027-09'),record('2027-10',{unknown:[29,30,31]})].map(r=>({...r,carrier:'OZ'}));assert.deepEqual(project(raw),raw);
});
test('reference month, evidence dates and reference clock survive decision history serialization',()=>{
 const out=project([record('2027-09'),record('2027-10',{unknown:[29,30,31]})]);
 const history=collectRepeatHistory(out),encoded=serializeRepeatHistory(history),restored=readRepeatHistory({getItem:()=>encoded});
 assert.deepEqual(restored,history);const friday=restored.find(e=>e.month==='2027-10'&&e.weekday===5);
 assert.equal(friday.referenceMonth,'2027-09');assert.equal(friday.referenceDates.length,4);assert.equal(friday.referenceSuccess,1793661000000);
});
test('real phone Rome snapshots remove eight false badge dates in each December direction and all partial October weekday artifacts',async()=>{
 const body=await unpackDocument(JSON.parse(await readFile(new URL('fixtures/rome-reference-live.json',import.meta.url)))),raw=readDocument(body,{carrier:'KE',origin:'ICN',region:'유럽'}),before=structuredClone(raw),out=project(raw);
 for(const r of out.filter(r=>(r.destination==='FCO'||r.origin==='FCO')&&['2026-12','2027-10'].includes(r.month))){assert.equal(r.repeatMarkerPolicy.reviews.length,0);assert.equal(r.repeatMarkerPolicy.excludedDates.length,r.month==='2026-12'?8:16);}
 const route=makeRoutes(out,catalog,'ICN').find(r=>r.code==='FCO');const total=summarize(route,{carrier:'KE',start:'2027-10-01',end:'2027-10-28',month:'2027-10',direction:'out'});assert.equal(total.byType.prestigeAward,0);assert.equal(total.byType.prestigeUpgrade,2);
 for(const r of out.filter(r=>r.origin==='LHR'||r.destination==='LHR'))assert.deepEqual(r.repeatMarkerPolicy.weekdays,[]);
 assert.deepEqual(raw,before);
});
test('every KE route keeps original November and December1–17 without inferred review or exclusions',()=>{
 for(const destination of ['AMS','FCO','JFK','YYZ','SYD','BKK','DXB','SVO'])for(const reverse of [false,true])for(const month of ['2026-11','2026-12']){
  const raw=record(month,{origin:reverse?destination:'ICN',destination:reverse?'ICN':destination});
  const view=structuredClone(raw);for(const d of view.dates){d.status='UNKNOWN';for(const f of ALL_FIELDS)d[f]=false;d.routeWeekdayExcluded=true;d.repeatMarkerReview={weekday:0};d.repeatMarkerExclusion={weekday:0};}
  const out=projectRepeatedMarkerRecords([raw],[view],catalog)[0];
  for(const d of out.dates.filter(d=>d.date<='2026-12-17')){assert.equal(d.repeatMarkerReview,undefined);assert.equal(d.repeatMarkerExclusion,undefined);assert.equal(d.routeWeekdayExcluded,undefined);assert.equal(d.savedCalendar.status,'OBSERVED');assert.deepEqual(ALL_FIELDS.map(f=>d.savedCalendar[f]),ALL_FIELDS.map(f=>day(raw,d.date)[f]));}
 }
});
test('invalid December source cannot fall back to an unbounded monthly inference before December18',()=>{
 const raw=record('2026-12');raw.dates.push({...raw.dates[0]});const out=project([raw,record('2027-01')])[0];assert.deepEqual(out.repeatMarkerPolicy.evidence,[]);assert.deepEqual(out.repeatMarkerPolicy.reviews,[]);
});
test('live Amsterdam original November keeps all source marks and adds no review on either direction',async()=>{
 const body=await unpackDocument(JSON.parse(await readFile(new URL('fixtures/europe-original-live.json',import.meta.url))));const raw=readDocument(body,{carrier:'KE',origin:'ICN',region:'유럽'}),out=project(raw);
 const records=out.filter(r=>(r.origin==='AMS'||r.destination==='AMS')&&r.month==='2026-11');assert.equal(records.length,2);
 for(const r of records){assert.deepEqual(r.repeatMarkerPolicy.reviews,[]);assert.deepEqual(r.repeatMarkerPolicy.excludedDates,[]);for(const d of r.dates)assert.deepEqual(ALL_FIELDS.map(f=>d.savedCalendar[f]),ALL_FIELDS.map(f=>d[f]));}
});
test('every catalog destination and both directions share the December boundary, January comparison and partial-month reference',()=>{
 const cities=Object.entries(catalog.regions).filter(([region])=>!['동북아시아','대한민국'].includes(region)).flatMap(([,cities])=>cities);assert.ok(cities.length>50);
 for(const city of cities)for(const reverse of [false,true]){const route={origin:reverse?city.code:'ICN',destination:reverse?'ICN':city.code},raw=[record('2026-11',route),record('2026-12',route),record('2027-01',route),record('2027-09',route),record('2027-10',{...route,unknown:[29,30,31]})],out=project(raw);assert.deepEqual(out[0].repeatMarkerPolicy.reviews,[]);assert.deepEqual(out[0].repeatMarkerPolicy.excludedDates,[]);assert.equal(day(out[1],'2026-12-17').repeatMarkerExclusion,undefined);assert.equal(day(out[1],'2026-12-18').repeatMarkerExclusion.referenceMonth,'2027-01');assert.equal(day(out[4],'2027-10-01').repeatMarkerExclusion.referenceMonth,'2027-09');assert.equal(day(out[4],'2027-10-29').repeatMarkerExclusion,undefined);}
});
