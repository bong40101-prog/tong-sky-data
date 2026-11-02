// Presentation compatibility for intact old calendars; never operation evidence.
import {TIMETABLE_FIELDS as FIELDS,referenceStatus} from './timetable.js?v=146';
import {KE_DISPLAY_END} from './model.js?v=146';
const sourceKey=r=>[r.carrier,r.origin,r.destination,r.month,r.success,r.sourceUpdatedAt,r.collectedAt].join('|');
const validSource=s=>s?.status==='OBSERVED'&&FIELDS.every(f=>typeof s[f]==='boolean');
export function projectLegacySavedRecords(rawRecords,records,index,{end,endForRecord}={}){
 const cleaned=records.map(r=>r.carrier!=='KE'?r:{...r,dates:r.dates.map(d=>{const next={...d};delete next.savedAggregate;delete next.savedAggregatePendingReason;return next;})});
 if(!index||typeof end!=='string')return cleaned;const defaultEnd=end>KE_DISPLAY_END?KE_DISPLAY_END:end,sources=new Map(rawRecords.map(r=>[sourceKey(r),r]));
 return cleaned.map(record=>{const raw=sources.get(sourceKey(record)),normalizedLegacy=raw?.operationPolicyVersion===2&&raw.flightAttributionStatus==='UNVERIFIED';if(record.carrier!=='KE'||!raw||raw.flightDetailPolicyVersion!==undefined||Number(raw.operationPolicyVersion)>=2&&!normalizedLegacy)return record;
  const displayEnd=endForRecord?.(record)??defaultEnd,originals=new Map(raw.dates.map(d=>[d.date,d])),rules=index.routes.get(record.origin+':'+record.destination)??[];
  return {...record,dates:record.dates.map(day=>{const original=originals.get(day.date);if(day.date>displayEnd||!original||original.flightDetailStatus!==undefined||original.flightObservations!==undefined&&!(normalizedLegacy&&original.legacyAwardFlags&&Array.isArray(original.flightObservations)&&original.flightObservations.length===0))return day;
   const source=original.legacyAwardFlags??original;if(!validSource(source)||original.status==='NO_FLIGHT')return day;
   const next={...day},applicable=rules.filter(r=>day.date>=r.start&&day.date<=r.end),officialOff=(record.operationWeeks??[]).some(w=>w.dates.some(d=>d.date===day.date&&(d.status==='NO_FLIGHT'||w.schema===2&&d.flights.some(f=>f.status==='NO_FLIGHT'))));
   let reason='';if(day.status==='NO_FLIGHT'||officialOff||day.flights?.some(f=>f.operationStatus==='NO_FLIGHT'||f.operationStatus==='UNKNOWN'))reason='공식 운항 대조에 비운항·미확인 편 포함 · 저장 합산 구분 불가';
   else if(!applicable.some(r=>r.operatorCode==='KE'&&r.serviceKind==='DIRECT'&&referenceStatus(r,day.date)==='OPERATING'))reason='대한항공 직접운항 일정 미확인 · 저장 합산 대기';
   else if(applicable.some(r=>referenceStatus(r,day.date)!=='OPERATING'))reason='직접운항·공동운항 일정 일부 미확인·비운항 · 저장 합산 구분 불가';
   if(reason){next.savedAggregatePendingReason=reason;return next;}
   next.savedAggregate={status:'OBSERVED',sourceKind:'SAVED_CALENDAR_AGGREGATE',sourceUpdatedAt:raw.sourceUpdatedAt,collectedAt:raw.collectedAt,...Object.fromEntries(FIELDS.map(f=>[f,source[f]]))};return next;
  })};
 });
}

