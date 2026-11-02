import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ALL_FIELDS,hasMark,cellInfo,summarize,makeRoutes,limitDisplayRecords,unpackDocument,readDocument} from '../dist/model.js';
import {repeatedMarkerRule,projectRepeatedMarkerRecords,repeatMarkerCodeshareFlags} from '../dist/repeat-markers.js';
const catalog={regions:{유럽:[{code:'CDG',name:'파리'},{code:'FCO',name:'로마'}],미주:[{code:'JFK',name:'뉴욕',countryCode:'US'},{code:'YYZ',name:'토론토',countryCode:'CA'}],동북아시아:[{code:'NRT',name:'도쿄',countryCode:'JP'}]}};
const flags=(active=[])=>Object.fromEntries(ALL_FIELDS.map(f=>[f,active.includes(f)]));
const triple=['economyAward','prestigeAward','prestigeUpgrade'];
function record({month='2031-06',origin='ICN',destination='CDG',carrier='KE',wd=0}={}){
 const count=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).getUTCDate();
 return {carrier,origin,destination,month,success:1793577600000,sourceUpdatedAt:'2031-06-02T00:00:00Z',collectedAt:'2031-06-02T00:00:00Z',dates:Array.from({length:count},(_,i)=>{const date=month+'-'+String(i+1).padStart(2,'0');return {date,status:'OBSERVED',...flags(new Date(date+'T00:00:00Z').getUTCDay()===wd?triple:['economyAward','prestigeUpgrade'])};})};
}
const d=(r,date)=>r.dates.find(d=>d.date===date);
const project=(raw,view=raw)=>{const out=projectRepeatedMarkerRecords([raw],[view],catalog)[0];return out.repeatMarkerPolicy?limitDisplayRecords([out],catalog)[0]:out;};
test('all four Sundays qualify, preserve other weekdays, and never change original seat or operation facts',()=>{
 const raw=record({month:'2027-03'}),before=structuredClone(raw),out=project(raw);
 assert.deepEqual(out.repeatMarkerPolicy.weekdays,[0]);assert.deepEqual(out.repeatMarkerPolicy.excludedDates,['2027-03-07','2027-03-14','2027-03-21','2027-03-28']);
 assert.equal(d(out,'2027-03-15').repeatMarkerExclusion,undefined);assert.deepEqual(raw,before);assert.equal(d(out,'2027-03-07').status,'OBSERVED');assert.equal(d(out,'2027-03-07').prestigeAward,true);
});
test('five occurrences require all five; a single nonmatching date invalidates the weekday',()=>{
 const raw=record();assert.equal(repeatedMarkerRule(raw,catalog).evidence[0].dates.length,5);
 d(raw,'2031-06-29').prestigeUpgrade=false;assert.deepEqual(repeatedMarkerRule(raw,catalog).weekdays,[]);assert.ok(project(raw).dates.every(d=>!d.repeatMarkerExclusion));
});
test('one differing or unknown date marks every occurrence for review and records exact reasons without suppressing positive dates',()=>{
 for(const unknown of [false,true]){const raw=record();if(unknown){d(raw,'2031-06-29').status='UNKNOWN';Object.assign(d(raw,'2031-06-29'),flags());}else d(raw,'2031-06-29').prestigeUpgrade=false;
 const out=project(raw),policy=out.repeatMarkerPolicy,review=policy.reviews[0];assert.deepEqual(policy.weekdays,[]);assert.equal(review.dates.length,5);assert.equal(review.matchedDates.length,4);assert.deepEqual(review.checkDates,['2031-06-29']);assert.equal(review.issues[0].reason,unknown?'미확인':'세 표식이 모두 있지 않음');
 const route=makeRoutes([out],catalog,'ICN')[0];for(const date of review.dates){const info=cellInfo(route,'out',date,'KE');assert.equal(info.needsReview,true);assert.match(info.label,/확인필요/);assert.equal(info.repeatMarkerExclusion,undefined);}assert.equal(hasMark(d(out,'2031-06-08'),'KE'),true);assert.equal(summarize(route,{carrier:'KE',start:'2031-06-01',end:'2031-06-30'}).byType.prestigeAward,unknown?4:5);
 }
});
test('a missing occurrence remains review-needed in the full month calendar with its missing-date reason',()=>{
 const raw=record();raw.dates=raw.dates.filter(day=>day.date!=='2031-06-29');const out=project(raw),route=makeRoutes([out],catalog,'ICN')[0],info=cellInfo(route,'out','2031-06-29','KE');assert.equal(info.needsReview,true);assert.equal(info.kind,'unknown');assert.deepEqual(info.review.issues,[{date:'2031-06-29',reason:'날짜 누락'}]);
});
test('two adjacent weeks are insufficient, and individual triplets are not provisionally hidden',()=>{
 const raw=record();for(const date of ['2031-06-15','2031-06-22','2031-06-29'])d(raw,date).prestigeAward=false;
 assert.deepEqual(repeatedMarkerRule(raw,catalog).weekdays,[]);assert.equal(hasMark(d(project(raw),'2031-06-08'),'KE'),true);
});
test('unknown, missing, duplicate and invalid dates cannot establish a whole-month weekday rule',()=>{
 for(const change of [r=>d(r,'2031-06-29').status='UNKNOWN',r=>r.dates=r.dates.filter(d=>d.date!=='2031-06-29'),r=>r.dates.push({...d(r,'2031-06-29')}),r=>d(r,'2031-06-29').date='2031-06-99']){
  const raw=record();change(raw);assert.deepEqual(repeatedMarkerRule(raw,catalog).weekdays,[]);
 }
});
test('month boundaries and outbound/return directions are isolated',()=>{
 const a=record(),b=record({month:'2026-12'}),c=record({origin:'CDG',destination:'ICN'});d(b,'2026-12-27').prestigeUpgrade=false;d(c,'2031-06-29').prestigeAward=false;
 const out=projectRepeatedMarkerRecords([a,b,c],[a,b,c],catalog);assert.deepEqual(out.map(r=>r.repeatMarkerPolicy.weekdays),[[0],[],[]]);
});
test('Europe and Americas are in scope; Japan and Asiana remain unchanged',()=>{
 for(const [destination,carrier,expected] of [['CDG','KE',true],['JFK','KE',true],['YYZ','KE',true],['NRT','KE',false],['CDG','OZ',false]]){
  const raw=record({destination,carrier}),out=project(raw);assert.equal(Boolean(out.repeatMarkerPolicy),expected);if(!expected)assert.equal(out,raw);
 }
});
test('reopened Europe rule still reads the complete raw month rather than the selected first-half range',()=>{
 const raw=record({month:'2027-03'});d(raw,'2027-03-28').prestigeAward=false;
 const [out]=limitDisplayRecords([project(raw)]);assert.equal(out.dates.length,31);assert.equal(d(out,'2027-03-07').repeatMarkerExclusion,undefined);assert.equal(hasMark(d(out,'2027-03-07'),'KE'),true);
 d(raw,'2027-03-28').prestigeAward=true;const [matched]=limitDisplayRecords([project(raw)]);assert.equal(hasMark(d(matched,'2027-03-07'),'KE'),false);assert.equal(matched.repeatMarkerPolicy.evidence[0].dates.length,4);
});
test('calendar, filters and sums consistently exclude matched dates and expose an inference label',()=>{
 const raw=record(),out=project(raw),route=makeRoutes([out],catalog,'ICN')[0],info=cellInfo(route,'out','2031-06-08','KE'),summary=summarize(route,{carrier:'KE',start:'2031-06-01',end:'2031-06-30'});
 assert.equal(info.kind,'unknown');assert.match(info.label,/대한항공 비운항/);assert.deepEqual(info.marks,[]);assert.equal(hasMark(d(out,'2031-06-08'),'KE'),false);assert.equal(summary.byType.prestigeAward,0);assert.equal(summary.byType.prestigeUpgrade,25);assert.equal(summary.marked,25);
});
test('V2 projects raw observed calendar flags independently of a prior operation projection',()=>{
 const raw=record(),view=structuredClone(raw);for(const day of view.dates)Object.assign(day,{status:'UNKNOWN',...flags(),legacyAwardFlags:{status:'OBSERVED',...flags(triple)}});
 const out=project(raw,view);assert.deepEqual(out.repeatMarkerPolicy.weekdays,[0]);assert.equal(d(out,'2031-06-08').savedCalendar.status,'OBSERVED');assert.equal(raw.dates[7].prestigeAward,true);assert.equal(d(view,'2031-06-08').status,'UNKNOWN');
});
test('a full-month three-marker weekday suppresses the entire date including confirmed codeshare badges',()=>{
 const raw=record(),view=structuredClone(raw),partner={number:'KE5901',operatorCode:'AF',serviceKind:'CODESHARE',operationStatus:'OPERATING',awardDataStatus:'CAPTURED',...flags(['prestigeAward'])};
 d(view,'2031-06-08').flights=[{number:'KE901',operatorCode:'KE',serviceKind:'DIRECT',operationStatus:'OPERATING',awardDataStatus:'CAPTURED',...flags(triple)},partner];
 const out=project(raw,view),day=d(out,'2031-06-08'),route=makeRoutes([out],catalog,'ICN')[0],info=cellInfo(route,'out',day.date,'KE');
 assert.equal(hasMark(day,'KE'),false);assert.equal(repeatMarkerCodeshareFlags(day),null);assert.equal(info.kind,'unknown');assert.deepEqual(info.marks,[]);assert.match(info.label,/대한항공 비운항/);
 assert.equal(summarize(route,{carrier:'KE',start:'2031-06-01',end:'2031-06-30'}).byType.prestigeAward,0);assert.equal(out.repeatMarkerPolicy.source,'USER_ALL_WEEKDAYS_TRIPLET_V2');
});
test('calendar triplets establish the same weekday pattern regardless of codeshare-only or unknown flight identities',()=>{
 for(const operatorCode of ['AF',undefined]){
  const raw=record();raw.flightDetailPolicyVersion=1;
  for(const day of raw.dates){day.flightDetailStatus='CAPTURED';day.flights=[{number:'KE5901',departureTime:'12:00',operatorCode,...flags(triple)}];}
  assert.deepEqual(repeatedMarkerRule(raw,catalog).weekdays,[0]);
 }
});
test('changing direct-flight or partner detail never changes the raw three-marker calendar decision',()=>{
 const raw=record();raw.flightDetailPolicyVersion=1;
 for(const day of raw.dates){day.flightDetailStatus='CAPTURED';day.flights=[{number:'KE901',departureTime:'12:00',operatorCode:'KE',...Object.fromEntries(ALL_FIELDS.map(f=>[f,day[f]]))},{number:'KE5901',departureTime:'13:00',operatorCode:'AF',...flags(triple)}];}
 assert.deepEqual(repeatedMarkerRule(raw,catalog).weekdays,[0]);
 d(raw,'2031-06-29').flights[0].prestigeAward=false;assert.deepEqual(repeatedMarkerRule(raw,catalog).weekdays,[0]);
 d(raw,'2031-06-29').prestigeAward=false;assert.deepEqual(repeatedMarkerRule(raw,catalog).weekdays,[]);
});
test('refresh recomputes the rule without mutating cached inputs or retaining a former exclusion',()=>{
 const raw=record(),old=project(raw),newRaw=structuredClone(raw);d(newRaw,'2031-06-29').prestigeAward=false;
 const out=projectRepeatedMarkerRecords([newRaw],[old],catalog)[0];assert.ok(out.dates.every(d=>!d.repeatMarkerExclusion));assert.ok(d(old,'2031-06-08').repeatMarkerExclusion);
});
test('actual saved Paris March calendar matches the requested four-Sunday pattern',async()=>{
 const body=await unpackDocument(JSON.parse(await readFile(new URL('current-europe.json',import.meta.url)))),raw=readDocument(body,{carrier:'KE',origin:'ICN',region:'유럽'}),paris=raw.find(r=>r.origin==='ICN'&&r.destination==='CDG'&&r.month==='2027-03');
 const out=project(paris);assert.deepEqual(out.repeatMarkerPolicy.weekdays,[0]);assert.deepEqual(out.repeatMarkerPolicy.excludedDates,['2027-03-07','2027-03-14','2027-03-21','2027-03-28']);assert.equal(d(out,'2027-03-15').repeatMarkerExclusion,undefined);assert.equal(d(out,'2027-03-18').repeatMarkerExclusion,undefined);
});

test('actual Paris December keeps20and27 orange with saved positive badges while13 remains unknown',async()=>{
 const body=await unpackDocument(JSON.parse(await readFile(new URL('fixtures/paris-v2-current-records.json',import.meta.url)))),raw=readDocument(body,{carrier:'KE',origin:'ICN',region:'유럽'}).find(r=>r.origin==='ICN'&&r.destination==='CDG'&&r.month==='2026-12'),before=structuredClone(raw),view=structuredClone(raw);
 for(const day of view.dates)Object.assign(day,{status:'NO_FLIGHT',...flags(),operationStatus:'NO_FLIGHT',timetableConflict:true});
 const out=limitDisplayRecords([project(raw,view)],catalog)[0],route=makeRoutes([out],catalog,'ICN')[0];assert.deepEqual(out.repeatMarkerPolicy.weekdays,[]);assert.equal(out.repeatMarkerPolicy.reviews.find(r=>r.weekday===0).matchedDates.length,2);
 for(const date of ['2026-12-20','2026-12-27']){const info=cellInfo(route,'out',date,'KE');assert.equal(info.needsReview,true);assert.equal(info.kind,'available');assert.deepEqual(info.marks.map(mark=>mark.field),['prestigeAward','prestigeUpgrade']);assert.equal(hasMark(d(out,date),'KE'),true);}
 const unknown=cellInfo(route,'out','2026-12-13','KE');assert.equal(unknown.needsReview,undefined);assert.equal(unknown.kind,'unknown');assert.deepEqual(unknown.marks,[]);assert.equal(hasMark(d(out,'2026-12-13'),'KE'),false);assert.deepEqual(raw,before);
});
test('actual Paris February excludes all four Sundays and never revives a codeshare or first badge',async()=>{
 const body=await unpackDocument(JSON.parse(await readFile(new URL('fixtures/paris-v2-current-records.json',import.meta.url)))),raw=readDocument(body,{carrier:'KE',origin:'ICN',region:'유럽'}).find(r=>r.origin==='ICN'&&r.destination==='CDG'&&r.month==='2027-02'),view=structuredClone(raw);
 for(const day of view.dates){day.firstCombined=true;day.flights=[{number:'KE5901',operatorCode:'AF',serviceKind:'CODESHARE',operationStatus:'OPERATING',awardDataStatus:'CAPTURED',...flags(['prestigeAward','prestigeUpgrade','firstCombined'])}];}
 const out=limitDisplayRecords([project(raw,view)],catalog)[0],route=makeRoutes([out],catalog,'ICN')[0];assert.deepEqual(out.repeatMarkerPolicy.evidence.find(row=>row.weekday===0).dates,['2027-02-07','2027-02-14','2027-02-21','2027-02-28']);
 for(const date of ['2027-02-07','2027-02-14','2027-02-21','2027-02-28']){const info=cellInfo(route,'out',date,'KE');assert.equal(info.kind,'unknown');assert.deepEqual(info.marks,[]);assert.equal(hasMark(d(out,date),'KE'),false);assert.equal(repeatMarkerCodeshareFlags(d(out,date)),null);}
});
