import test from 'node:test';
import assert from 'node:assert/strict';
import {collectRepeatHistory, mergeRepeatHistory, readRepeatHistory, writeRepeatHistory, serializeRepeatHistory, REPEAT_HISTORY_KEY} from '../dist/repeat-history.js';

const sundays = ['2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22', '2026-11-29'];
function record() {
  return {carrier:'KE', origin:'ICN', destination:'CDG', month:'2026-11', collectedAt:'2026-11-02T00:00:00Z', sourceUpdatedAt:'2026-11-02T01:00:00Z', success:1793577600000, dates:[{economyAward:true}], repeatMarkerPolicy:{source:'USER_ALL_WEEKDAYS_TRIPLET_V1', scope:'EUROPE', evidence:[], reviews:[{weekday:0, dates:sundays, matchedDates:sundays.slice(0,4), checkDates:[sundays[4]], issues:[{date:sundays[4], reason:'미확인'}]}]}};
}
const memory = () => {const values = new Map(); return {getItem:key=>values.get(key) ?? null, setItem:(key,value)=>values.set(key,value)};};

test('audit snapshots retain original clocks, route, direction and review reasons without raw seat data', () => {
  const raw=record(), before=structuredClone(raw), [event]=collectRepeatHistory([raw]);
  assert.equal(event.kind,'REVIEW'); assert.deepEqual(event.checkDates,['2026-11-29']); assert.deepEqual(event.issues,[{date:'2026-11-29',reason:'미확인'}]);
  assert.equal(event.collectedAt,raw.collectedAt); assert.equal(event.sourceUpdatedAt,raw.sourceUpdatedAt); assert.equal(event.success,raw.success);
  assert.equal(event.economyAward,undefined); assert.equal(event.repeatMarkerPolicy,undefined); assert.deepEqual(raw,before);
  const reverse={...raw,origin:'CDG',destination:'ICN'};
  assert.equal(collectRepeatHistory([raw,reverse]).length,2);
});
test('identical refresh snapshots dedupe while a changed decision and collection remain in history', () => {
  const first=collectRepeatHistory([record()]), changed=record();
  changed.repeatMarkerPolicy.reviews=[];changed.repeatMarkerPolicy.evidence=[{weekday:0,dates:sundays}];
  const merged=mergeRepeatHistory(first,[...first,...collectRepeatHistory([changed])]);
  assert.equal(merged.length,2);assert.deepEqual(new Set(merged.map(e=>e.kind)),new Set(['REVIEW','EXCLUDED']));
  const newer=record(); newer.collectedAt='2026-11-03T00:00:00Z';newer.success++;
  assert.equal(mergeRepeatHistory(merged,collectRepeatHistory([newer])).length,3);
});
test('safe storage persists normalized snapshots, dedupes after reload and exports JSON without a fake fetch clock', () => {
  const storage=memory(), events=collectRepeatHistory([record()]);
  assert.equal(writeRepeatHistory(events,storage).saved,true);
  assert.deepEqual(readRepeatHistory(storage),events);assert.equal(mergeRepeatHistory(readRepeatHistory(storage),events).length,1);
  const exported=JSON.parse(serializeRepeatHistory(events));assert.equal(exported.schema,1);assert.equal(exported.scope,'browser-local');assert.equal(exported.generatedAt,undefined);assert.deepEqual(exported.events,events);
});
test('history bounds retain newest source observations and zero limit is empty', () => {
  const events=Array.from({length:8},(_,i)=>({...collectRepeatHistory([record()])[0],success:i}));
  assert.deepEqual(mergeRepeatHistory([],events,3).map(e=>e.success),[5,6,7]);assert.deepEqual(mergeRepeatHistory([],events,0),[]);
});
test('malformed, oversized and unsupported stored history never blocks loading or invents valid decisions', () => {
  for(const raw of ['not JSON',JSON.stringify({schema:9,events:collectRepeatHistory([record()])}),' '.repeat(3*1024*1024+1)])assert.deepEqual(readRepeatHistory({getItem:()=>raw}),[]);
  const good=collectRepeatHistory([record()])[0],bad={...good,weekday:9};
  assert.deepEqual(readRepeatHistory({getItem:()=>JSON.stringify({schema:1,events:[bad,good]})}),[good]);
  assert.deepEqual(mergeRepeatHistory([],[{...good,origin:'../'}]),[]);
  assert.deepEqual(mergeRepeatHistory([],[{...good,dates:['2026-11-99']}]),[]);
  assert.deepEqual(mergeRepeatHistory([],[{...good,carrier:'OZ'}]),[]);
});
test('privacy-denied and quota-exceeded storage failures retain current in-memory events', () => {
  const events=collectRepeatHistory([record()]), denied={getItem(){throw new Error('denied');},setItem(){throw Object.assign(new Error('quota'),{name:'QuotaExceededError'});}};
  assert.deepEqual(readRepeatHistory(denied),[]);const result=writeRepeatHistory(events,denied);assert.equal(result.saved,false);assert.equal(result.error,'QuotaExceededError');assert.deepEqual(result.events,events);
  let called=false;writeRepeatHistory(events,{setItem(key){called=key===REPEAT_HISTORY_KEY;}});assert.equal(called,true);
});

test('reset removes old Korean Air decisions once without erasing new decisions', () => {
 const values=new Map([['tongsky.repeat-marker-history.v1',serializeRepeatHistory(collectRepeatHistory([record()]))]]);
 const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 assert.deepEqual(readRepeatHistory(storage),[]);
 assert.equal(values.has('tongsky.repeat-marker-history.v1'),false);
 const current=collectRepeatHistory([record()]);
 writeRepeatHistory(current,storage);
 assert.deepEqual(readRepeatHistory(storage),current);
 assert.deepEqual(readRepeatHistory(storage),current);
});
