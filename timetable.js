// User-supplied operating weekdays are a bounded reference, never seat evidence.
export const TIMETABLE_FIELDS=['economyAward','premiumAward','prestigeAward','premiumUpgrade','prestigeUpgrade','firstCombined'];
const FIELDS=TIMETABLE_FIELDS,DAY_NAMES=['일','월','화','수','목','금','토'];
const dateOK=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const boundedText=(s,max=2000)=>typeof s==='string'&&s.length<=max;
export class TimetableError extends Error{}
const fail=message=>{throw new TimetableError(message);};
function days(values){if(!Array.isArray(values)||values.length>7||values.some(v=>!Number.isInteger(v)||v<0||v>6)||new Set(values).size!==values.length)fail('운항요일 참고 자료의 요일이 올바르지 않습니다.');return [...values].sort((a,b)=>a-b);}
function sourceUrl(value){let u;try{u=new URL(value);}catch{fail('운항요일 참고 자료의 출처가 올바르지 않습니다.');}if(!boundedText(value,4096)||u.protocol!=='https:'||u.username||u.password||u.port)fail('운항요일 참고 자료의 출처가 올바르지 않습니다.');return value;}
export function validateTimetableReference(value){
 if(!value||value.schema!==1||value.sourceKind!=='USER_SUPPLIED_TIMETABLE'||value.completeOperators!==false||!dateOK(value.sourceAsOf)||!dateOK(value.validFrom)||!dateOK(value.validThrough)||value.validFrom>value.validThrough||!Array.isArray(value.records)||value.records.length>10000)fail('운항요일 참고 자료 형식이 다릅니다.');
 const records=value.records.map((r,index)=>{
  if(!r||!/^[A-Z]{3}$/.test(r.origin)||!/^[A-Z]{3}$/.test(r.destination)||r.origin===r.destination||typeof r.operatorCode!=='string'||!/^[A-Z0-9]{2,3}$/.test(r.operatorCode)||!boundedText(r.operatorName,100)||!r.operatorName.trim()||!['DIRECT','CODESHARE'].includes(r.serviceKind)||(r.serviceKind==='DIRECT')!==(r.operatorCode==='KE')||!dateOK(r.start)||!dateOK(r.end)||r.start>r.end||r.start<value.validFrom||r.end>value.validThrough||!['WEEKDAYS','DATES_ONLY','UNRESOLVED'].includes(r.coverage))fail('운항요일 참고 자료의 노선·운항사·기간이 올바르지 않습니다.');
  const weekdays=days(r.weekdays),noFlightWeekdays=days(r.noFlightWeekdays);if(weekdays.some(d=>noFlightWeekdays.includes(d)))fail('같은 요일의 운항·비운항 참고가 서로 다릅니다.');
  if(!Array.isArray(r.confirmedDates)||r.confirmedDates.length>3660||new Set(r.confirmedDates).size!==r.confirmedDates.length||r.confirmedDates.some(d=>!dateOK(d)||d<r.start||d>r.end)||r.coverage!=='WEEKDAYS'&&noFlightWeekdays.length||r.coverage==='WEEKDAYS'&&r.confirmedDates.some(d=>noFlightWeekdays.includes(new Date(d+'T00:00:00Z').getUTCDay()))||!boundedText(r.note??'')||!Array.isArray(r.sourceUrls)||r.sourceUrls.length>100||!Array.isArray(r.sourceRows)||r.sourceRows.length>1000)fail('운항요일 참고 자료의 적용 범위가 올바르지 않습니다.');
  return {...r,referenceIndex:index,weekdays,noFlightWeekdays,confirmedDates:[...r.confirmedDates].sort(),note:r.note??'',sourceUrls:r.sourceUrls.map(sourceUrl),sourceRows:structuredClone(r.sourceRows)};
 });
 return {...value,records};
}
export function buildTimetableIndex(value){
 const reference=validateTimetableReference(value),routes=new Map();for(const r of reference.records){const key=r.origin+':'+r.destination;if(!routes.has(key))routes.set(key,[]);routes.get(key).push(r);}return {reference,routes};
}
function referenceStatus(row,date){
 if(date<row.start||date>row.end||row.coverage==='UNRESOLVED')return 'UNKNOWN';
 if(row.confirmedDates.includes(date))return 'OPERATING';
 if(row.coverage==='DATES_ONLY')return 'UNKNOWN';
 const weekday=new Date(date+'T00:00:00Z').getUTCDay();return row.weekdays.includes(weekday)?'OPERATING':row.noFlightWeekdays.includes(weekday)?'NO_FLIGHT':'UNKNOWN';
}
export function lookupTimetableDay(index,origin,destination,date){
 if(!index||!dateOK(date))return [];const operators=new Map();for(const row of index.routes.get(origin+':'+destination)??[]){const key=row.operatorCode+':'+row.serviceKind;if(!operators.has(key))operators.set(key,[]);operators.get(key).push(row);}
 return [...operators.values()].map(all=>{const active=all.filter(r=>date>=r.start&&date<=r.end),states=active.map(r=>referenceStatus(r,date)),unique=new Set(states),first=active[0]??all[0];return {operatorCode:first.operatorCode,operatorName:first.operatorName,serviceKind:first.serviceKind,status:unique.has('OPERATING')?'OPERATING':states.length&&states.every(s=>s==='NO_FLIGHT')?'NO_FLIGHT':'UNKNOWN',inPeriod:active.length>0,coverage:active.length===1?first.coverage:'UNRESOLVED',referencePartial:unique.has('UNKNOWN'),sourceAsOf:index.reference.sourceAsOf,sourceKind:index.reference.sourceKind,referenceIndexes:active.map(r=>r.referenceIndex),sourceRows:active.flatMap(r=>r.sourceRows),sourceUrls:[...new Set(active.flatMap(r=>r.sourceUrls))],note:active.length?[...new Set(active.map(r=>r.note).filter(Boolean))].join(' / '):'해당 날짜에 적용할 수 있는 운항요일 참고 자료가 없습니다.'};});
}
export function timetableRouteSummary(index,origin,destination,month){
 if(!index||!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month))return [];const first=month+'-01',last=month+'-'+String(new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate()).padStart(2,'0');
 return (index.routes.get(origin+':'+destination)??[]).filter(r=>r.start<=last&&r.end>=first).map(r=>({...r,displayStart:r.start>first?r.start:first,displayEnd:r.end<last?r.end:last,weekdayText:r.weekdays.map(d=>DAY_NAMES[d]).join('·'),noFlightText:r.noFlightWeekdays.map(d=>DAY_NAMES[d]).join('·'),sourceAsOf:index.reference.sourceAsOf}));
}
export function projectTimetableRecord(record,index){
 if(record.carrier!=='KE'||!index)return record;const routeRows=index.routes.get(record.origin+':'+record.destination)??[];if(!routeRows.length)return record;
 let conflictCount=0;const dates=record.dates.map(day=>{
  const references=lookupTimetableDay(index,record.origin,record.destination,day.date),flights=(day.flights??[]).map(f=>{
   const next={...f};delete next.timetableConflict;delete next.timetableReference;delete next.timetableDifference;
   // A KE marketing number alone never identifies the actual operating airline.
   if(!f.operatorCode||!['DIRECT','CODESHARE'].includes(f.serviceKind))return next;
   const matches=references.filter(r=>r.operatorCode===f.operatorCode&&r.serviceKind===f.serviceKind&&r.status!=='UNKNOWN');if(!matches.length)return next;
   next.timetableReference=matches.map(r=>({referenceIndexes:r.referenceIndexes,status:r.status,sourceAsOf:r.sourceAsOf}));
   if(f.operationStatus==='OPERATING'&&matches.some(r=>r.status==='NO_FLIGHT')){next.timetableConflict=true;conflictCount++;for(const field of FIELDS)next[field]=false;}
   if(f.operationStatus==='NO_FLIGHT'&&matches.some(r=>r.status==='OPERATING'))next.timetableDifference=true;
   return next;
  }),conflict=flights.some(f=>f.timetableConflict),next={...day,flights,timetableReferences:references};
  if(conflict){for(const field of FIELDS)next[field]=flights.some(f=>f.operationStatus==='OPERATING'&&!f.weekdayExcluded&&!f.viewPending&&!f.timetableConflict&&f[field]===true);next.timetableConflict=true;next.operationPartial=true;next.operationRequiresRequery=true;if(!FIELDS.some(f=>next[f])){next.status='UNKNOWN';next.operationPending=true;}}
  return next;
 });
 return {...record,dates,timetableSourceAsOf:index.reference.sourceAsOf,timetableConflictCount:conflictCount};
}
export function projectTimetableRecords(records,index){return records.map(r=>projectTimetableRecord(r,index));}
export async function loadTimetableReference({signal,force=false,fetcher=fetch}={}){
 const response=await fetcher('./timetable-reference.json',{signal,cache:force?'reload':'no-cache',credentials:'omit',referrerPolicy:'no-referrer'});if(!response.ok)fail('운항요일 참고 자료 연결 실패');if(Number(response.headers.get('content-length'))>8*1024*1024)fail('운항요일 참고 자료 크기 초과');
 const reader=response.body.getReader(),decoder=new TextDecoder();let text='',size=0;try{while(true){if(signal?.aborted)throw signal.reason;const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8*1024*1024)fail('운항요일 참고 자료 크기 초과');text+=decoder.decode(value,{stream:true});}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}return buildTimetableIndex(JSON.parse(text+decoder.decode()));
}
