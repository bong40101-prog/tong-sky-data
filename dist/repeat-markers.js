// User-selected display heuristic, not airline operation evidence.
const RULE='USER_ALL_WEEKDAYS_TRIPLET_V2';
const REFERENCE_RULE='USER_REFERENCE_MONTH_TRIPLET_V3';
export const ORIGINAL_CALENDAR_END='2026-12-17';
const FIELDS=['economyAward','premiumAward','prestigeAward','premiumUpgrade','prestigeUpgrade','firstCombined'];
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const validDate=date=>typeof date==='string'&&DATE.test(date)&&Number.isFinite(Date.parse(date+'T00:00:00Z'))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date;
const weekday=date=>new Date(date+'T00:00:00Z').getUTCDay();
const recordKey=r=>[r.carrier,r.origin,r.destination,r.month,r.success,r.sourceUpdatedAt,r.collectedAt].join('|');
export function repeatedMarkerScope(record,catalog){
 if(record.carrier!=='KE')return null;
 for(const [region,cities] of Object.entries(catalog?.regions??{}))for(const city of cities){
  if(city.code!==record.origin&&city.code!==record.destination)continue;
  if(region==='유럽')return 'EUROPE';
  if(city.countryCode==='US')return 'US';
  if(region==='미주')return 'AMERICAS';
  if(region==='대양주/괌')return 'OCEANIA';
 }
 return null;
}
function observedFlags(day){
 const source=day?.awardCalendarFlags??day?.legacyAwardFlags??day;
 return source?.status==='OBSERVED'&&FIELDS.every(f=>typeof source[f]==='boolean')?source:null;
}
function storedCalendar(day){
 const source=day?.awardCalendarFlags??day?.legacyAwardFlags??day;
 const status=['OBSERVED','UNKNOWN','NO_FLIGHT'].includes(source?.status)?source.status:'UNKNOWN';
 return {sourceKind:'SAVED_CALENDAR',status:status==='OBSERVED'&&!FIELDS.every(f=>typeof source[f]==='boolean')?'UNKNOWN':status,...Object.fromEntries(FIELDS.map(f=>[f,status==='OBSERVED'&&source[f]===true]))};
}
export function savedCalendarFlags(day){const flags=day?.savedCalendar;return flags?.status==='OBSERVED'&&flags.sourceKind==='SAVED_CALENDAR'&&FIELDS.every(f=>typeof flags[f]==='boolean')?flags:null;}
function ownMonthRule(record,catalog,projectedRecord=record){
 const scope=repeatedMarkerScope(record,catalog);if(!scope||!validDate(record.month+'-01'))return null;
 // One snapshot, one direction, one month: no evidence is borrowed across any of them.
 const days=new Map(),duplicates=new Set();
 for(const day of record.dates??[]){if(!validDate(day.date)||day.date.slice(0,7)!==record.month)continue;if(days.has(day.date))duplicates.add(day.date);days.set(day.date,day);}
 const projectedDays=new Map((projectedRecord.dates??[]).map(d=>[d.date,d]));
 const candidateDates=[...days.values()].filter(day=>{const f=observedFlags(day,record,projectedDays.get(day.date));return !duplicates.has(day.date)&&f&&f.economyAward&&f.prestigeAward&&f.prestigeUpgrade;}).map(d=>d.date).sort();
 const candidates=new Set(candidateDates),evidence=[],reviews=[];
 const count=new Date(Date.UTC(Number(record.month.slice(0,4)),Number(record.month.slice(5,7)),0)).getUTCDate();
 for(let wd=0;wd<7;wd++){
  const dates=Array.from({length:count},(_,i)=>record.month+'-'+String(i+1).padStart(2,'0')).filter(date=>weekday(date)===wd);
  // Every occurrence in the calendar month must be observed with all three markers.
  // Missing, unknown, duplicate, or nonmatching dates invalidate the entire weekday.
  if(dates.every(date=>candidates.has(date)))evidence.push({weekday:wd,dates});
  else if(dates.some(date=>candidates.has(date))){
   const matchedDates=dates.filter(date=>candidates.has(date)),checkDates=dates.filter(date=>!candidates.has(date));
   const issues=checkDates.map(date=>({date,reason:duplicates.has(date)?'날짜 중복':!days.has(date)?'날짜 누락':!observedFlags(days.get(date),record,projectedDays.get(date))?'미확인':'세 표식이 모두 있지 않음'}));
   reviews.push({weekday:wd,dates,matchedDates,checkDates,issues});
  }
 }
 return {source:RULE,scope,month:record.month,origin:record.origin,destination:record.destination,candidateDates,weekdays:evidence.map(p=>p.weekday),evidence,reviews};
}
const monthDates=month=>Array.from({length:new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate()},(_,i)=>month+'-'+String(i+1).padStart(2,'0'));
const triplet=day=>{const f=observedFlags(day);return Boolean(f&&f.economyAward&&f.prestigeAward&&f.prestigeUpgrade);};
function inventory(record){
 const expected=monthDates(record.month),days=new Map(),duplicates=new Set();let invalid=false;
 for(const d of record.dates??[]){if(!validDate(d?.date)||d.date.slice(0,7)!==record.month){invalid=true;continue;}if(days.has(d.date))duplicates.add(d.date);days.set(d.date,d);}
 const known=d=>{const f=d?.awardCalendarFlags??d?.legacyAwardFlags??d;return f&&['OBSERVED','NO_FLIGHT'].includes(f.status)&&FIELDS.every(k=>typeof f[k]==='boolean')&&(f.status==='OBSERVED'||FIELDS.every(k=>!f[k]));};
 return {expected,days,duplicates,invalid,complete:!invalid&&!duplicates.size&&expected.every(date=>known(days.get(date))),known};
}
export function repeatedMarkerRule(record,catalog,projectedRecord=record,relatedRecords=[]){
 const scope=repeatedMarkerScope(record,catalog);
 if(scope&&validDate(record.month+'-01')&&record.month<'2026-12')return {source:RULE,scope,month:record.month,origin:record.origin,destination:record.destination,candidateDates:[],weekdays:[],evidence:[],reviews:[]};
 const base=ownMonthRule(record,catalog,projectedRecord);if(!base)return null;
 const current=inventory(record),december=record.month==='2026-12';
 if(current.invalid||current.duplicates.size)return december?{...base,candidateDates:[],weekdays:[],evidence:[],reviews:[]}:base;
 if(!december&&current.complete)return base;
 const latest=new Map();for(const r of relatedRecords){if(r.carrier!==record.carrier||r.origin!==record.origin||r.destination!==record.destination||!validDate(r.month+'-01'))continue;const old=latest.get(r.month);if(!old||(r.success??0)>(old.success??0))latest.set(r.month,r);}
 const reference=december?latest.get('2027-01'):[...latest.values()].filter(r=>r.month<record.month&&r.month!=='2026-12'&&inventory(r).complete).sort((a,b)=>b.month.localeCompare(a.month))[0];
 if(!december&&!reference)return base;
 const referenceComplete=reference&&inventory(reference).complete;
 const referencePolicy=referenceComplete?ownMonthRule(reference,catalog):null;
 const mode=december?'JANUARY_FOR_DECEMBER':'PREVIOUS_COMPLETE_MONTH',referenceMonth=december?'2027-01':reference.month;
 const targetDates=current.expected.filter(date=>!december||date>='2026-12-18');
 const evidence=december?[]:[...base.evidence],reviews=december?[]:[...base.reviews];
 for(let wd=0;wd<7;wd++){
  const dates=targetDates.filter(date=>weekday(date)===wd),matchedDates=dates.filter(date=>triplet(current.days.get(date)));
  const proof=referencePolicy?.evidence.find(row=>row.weekday===wd);
  if(!december&&evidence.some(row=>row.weekday===wd))continue;
  if(!matchedDates.length&&!(december&&proof))continue;
  const knownDates=dates.filter(date=>current.known(current.days.get(date))),conflicts=knownDates.filter(date=>!triplet(current.days.get(date)));
  const meta={referenceMode:mode,referenceMonth,referenceStatus:referenceComplete?'COMPLETE':reference?'INCOMPLETE':'MISSING',referenceDates:proof?[...proof.dates]:[],referenceSuccess:reference?.success??null};
  // Only matching observed dates are hidden. Unopened/unknown dates stay unknown.
  // One observed contradiction prevents a reference from overriding this weekday.
  const valid=Boolean(proof)&&matchedDates.length>0&&!conflicts.length&&(!december||matchedDates.length===dates.length);
  const oldReview=reviews.findIndex(row=>row.weekday===wd);if(oldReview>=0)reviews.splice(oldReview,1);
  if(valid)evidence.push({weekday:wd,dates:matchedDates,...meta});
  else{
   const checkDates=proof?dates.filter(date=>!triplet(current.days.get(date))):[...dates];
   const issues=checkDates.map(date=>({date,reason:!proof?(referenceComplete?'참고월에 같은 비운항 요일이 확인되지 않음':reference?'참고월 자료 미완성':'참고월 자료 없음'):!current.days.has(date)?'날짜 누락':!current.known(current.days.get(date))?'미확인':'세 표식이 모두 있지 않음'}));
   if(checkDates.length)reviews.push({weekday:wd,dates,matchedDates,checkDates,issues,...meta});
  }
 }
 evidence.sort((a,b)=>a.weekday-b.weekday);reviews.sort((a,b)=>a.weekday-b.weekday);
 return {...base,source:REFERENCE_RULE,referenceMode:mode,referenceMonth,candidateDates:targetDates.filter(date=>triplet(current.days.get(date))),weekdays:evidence.map(row=>row.weekday),evidence,reviews};
}
export function projectRepeatedMarkerRecords(rawRecords,records,catalog){
 const sources=new Map(rawRecords.map(r=>[recordKey(r),r]));
 return records.map(record=>{
  const raw=sources.get(recordKey(record)),rule=raw?repeatedMarkerRule(raw,catalog,record,rawRecords):null;
  const preserveOriginal=record.carrier==='KE'&&record.month<=ORIGINAL_CALENDAR_END.slice(0,7);
  if(!rule&&!record.repeatMarkerPolicy&&!preserveOriginal)return record;
  const next={...record};delete next.repeatMarkerPolicy;const rawDays=new Map((raw?.dates??[]).map(d=>[d.date,d]));
  next.dates=record.dates.map(day=>{
   const clean={...day};delete clean.repeatMarkerExclusion;delete clean.repeatMarkerReview;delete clean.repeatMarkerReviewFlags;delete clean.savedCalendar;
   if(preserveOriginal&&validDate(day.date)&&day.date<=ORIGINAL_CALENDAR_END){clean.savedCalendar=storedCalendar(rawDays.get(day.date)??day);for(const key of ['routeWeekdayExcluded','timetableConflict','operationPending'])delete clean[key];return clean;}
   if(!rule||!validDate(day.date)||day.date.slice(0,7)!==rule.month)return clean;
   const original=rawDays.get(day.date);clean.savedCalendar=storedCalendar(original??day);const wd=weekday(day.date);
   const proof=rule.evidence.find(p=>p.weekday===wd&&p.dates.includes(day.date));
   if(proof)clean.repeatMarkerExclusion={...proof,source:rule.source,kind:proof.referenceMonth?'REFERENCE_MONTH_WEEKDAY':'MONTH_WEEKDAY',month:rule.month,weekday:wd,evidenceDates:[...proof.dates]};
   const review=rule.reviews.find(p=>p.weekday===wd&&p.dates.includes(day.date));if(review){clean.repeatMarkerReview={source:rule.source,month:rule.month,...review};const flags=observedFlags(original??{});if(flags)clean.repeatMarkerReviewFlags={status:'OBSERVED',sourceKind:'REVIEW_STORED_CALENDAR',...Object.fromEntries(FIELDS.map(f=>[f,flags[f]]))};}
   return clean;
  });
  if(rule)next.repeatMarkerPolicy={...rule,excludedDates:next.dates.filter(d=>d.repeatMarkerExclusion).map(d=>d.date)};
  return next;
 });
}
// V2 excludes the entire inferred calendar date. Flight attribution cannot revive it.
export function repeatMarkerCodeshareFlags(){return null;}
export function repeatMarkerReviewFlags(day){const flags=day?.repeatMarkerReviewFlags;return day?.repeatMarkerReview&&day.status!=='NO_FLIGHT'&&flags?.status==='OBSERVED'&&flags.sourceKind==='REVIEW_STORED_CALENDAR'&&FIELDS.every(f=>typeof flags[f]==='boolean')?flags:null;}
