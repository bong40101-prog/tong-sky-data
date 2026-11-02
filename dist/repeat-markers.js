// User-selected display heuristic, not airline operation evidence.
const RULE='USER_ALL_WEEKDAYS_TRIPLET_V2';
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
export function repeatedMarkerRule(record,catalog,projectedRecord=record){
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
export function projectRepeatedMarkerRecords(rawRecords,records,catalog){
 const sources=new Map(rawRecords.map(r=>[recordKey(r),r]));
 return records.map(record=>{
  const raw=sources.get(recordKey(record)),rule=raw?repeatedMarkerRule(raw,catalog,record):null;
  if(!rule&&!record.repeatMarkerPolicy)return record;
  const next={...record};delete next.repeatMarkerPolicy;const rawDays=new Map((raw?.dates??[]).map(d=>[d.date,d]));
  const weekdays=new Set(rule?.weekdays??[]);
  next.dates=record.dates.map(day=>{
   const clean={...day};delete clean.repeatMarkerExclusion;delete clean.repeatMarkerReview;delete clean.repeatMarkerReviewFlags;delete clean.savedCalendar;
   if(!rule||!validDate(day.date)||day.date.slice(0,7)!==rule.month)return clean;
   const original=rawDays.get(day.date);clean.savedCalendar=storedCalendar(original??day);const wd=weekday(day.date);
   if(weekdays.has(wd))clean.repeatMarkerExclusion={source:RULE,kind:'MONTH_WEEKDAY',month:rule.month,weekday:wd,evidenceDates:[...rule.evidence.find(p=>p.weekday===wd).dates]};
   const review=rule.reviews.find(p=>p.weekday===wd);if(review){clean.repeatMarkerReview={source:RULE,month:rule.month,...review};const flags=observedFlags(original??{});if(flags)clean.repeatMarkerReviewFlags={status:'OBSERVED',sourceKind:'REVIEW_STORED_CALENDAR',...Object.fromEntries(FIELDS.map(f=>[f,flags[f]]))};}
   return clean;
  });
  if(rule)next.repeatMarkerPolicy={...rule,excludedDates:next.dates.filter(d=>d.repeatMarkerExclusion).map(d=>d.date)};
  return next;
 });
}
// V2 excludes the entire inferred calendar date. Flight attribution cannot revive it.
export function repeatMarkerCodeshareFlags(){return null;}
export function repeatMarkerReviewFlags(day){const flags=day?.repeatMarkerReviewFlags;return day?.repeatMarkerReview&&day.status!=='NO_FLIGHT'&&flags?.status==='OBSERVED'&&flags.sourceKind==='REVIEW_STORED_CALENDAR'&&FIELDS.every(f=>typeof flags[f]==='boolean')?flags:null;}
