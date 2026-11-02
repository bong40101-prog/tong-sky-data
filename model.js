import {repeatMarkerCodeshareFlags,repeatMarkerReviewFlags,savedCalendarFlags,repeatedMarkerScope} from './repeat-markers.js?v=146';
import {validateClaimedOperationSnapshot} from './operation.js?v=146';
export const BASE='https://raw.githubusercontent.com/bong40101-prog/tong-sky-data/tong-sky-data/data/mobile/v103/';
export const OZ_BASE='https://raw.githubusercontent.com/bong40101-prog/tong-sky-data/tong-sky-data/data/mobile/v101/';
export const FIELDS=['prestigeAward','prestigeUpgrade','firstCombined'];
export const ALL_FIELDS=['economyAward','premiumAward','prestigeAward','premiumUpgrade','prestigeUpgrade','firstCombined'];
export const KE_DISPLAY_END='2026-12-17';
export function isExtendedKeRoute(record,catalog){return record?.carrier!=='OZ'&&Boolean(catalog?repeatedMarkerScope({...record,carrier:'KE'},catalog):record?.keFutureVisible||record?.region==='유럽'||record?.countryCode==='US'||['EUROPE','US'].includes(record?.repeatMarkerPolicy?.scope));}
export function limitDisplayRecords(records,catalog){return records.flatMap(r=>{if(r.carrier!=='KE')return [r];const extended=isExtendedKeRoute(r,catalog);if(!extended&&r.month>KE_DISPLAY_END.slice(0,7))return [];return [{...r,keFutureVisible:extended,dates:r.dates.filter(d=>extended||d.date<=KE_DISPLAY_END).map(d=>({...d,keFutureVisible:extended}))}];});}
export const AIRLINES={KE:{name:'대한항공',cabin:'프레스티지',labels:['프레스티지 보너스','프레스티지 승급','퍼스트 보너스·승급 합산'],source:'https://www.koreanair.com/booking/book-and-manage/award-seat-availability'},OZ:{name:'아시아나',cabin:'비즈니스',labels:['비즈니스 보너스','비즈니스 승급'],source:'https://flyasiana.com/I/KR/KO/MileageSeatSearch.do'}};
export const EXCLUDED_REGIONS=['동북아시아','대한민국'];
export const REGIONS=['유럽','미주','동남아시아/서남아시아','대양주/괌','러시아/몽골/중앙아시아','중동/아프리카'];
export function isExcludedRecord(record,catalog,origin){const code=record.origin===origin?record.destination:record.origin;return EXCLUDED_REGIONS.some(region=>(catalog?.regions?.[region]??[]).some(city=>city.code===code));}
export class DataError extends Error{}
export function todayKST(now=new Date()){
 const p=new Intl.DateTimeFormat('en',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const get=type=>p.find(x=>x.type===type).value;return `${get('year')}-${get('month')}-${get('day')}`;
}
export function addDays(date,n){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
export function daysInMonth(month){return new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate();}
export function validDate(value){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
export function validMonth(value){return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);}
export function selectedFields(carrier,seat='all'){const count=carrier==='OZ'?2:3;return FIELDS.slice(0,count).filter((field,i)=>seat==='all'||seat===String(i));}
export function savedAggregateFlags(day){const s=day?.savedAggregate;return !day?.repeatMarkerExclusion&&day?.status==='UNKNOWN'&&day.operationStatus!=='NO_FLIGHT'&&!day.timetableConflict&&day.flightDetailStatus===undefined&&!day.flights?.some(f=>f.operationStatus==='NO_FLIGHT'||f.operationStatus==='UNKNOWN')&&(day.date<=KE_DISPLAY_END||day.keFutureVisible===true)&&s?.status==='OBSERVED'&&s.sourceKind==='SAVED_CALENDAR_AGGREGATE'&&ALL_FIELDS.every(f=>typeof s[f]==='boolean')?s:null;}
export function hasMark(day,carrier,seat='all'){const source=day?.repeatMarkerExclusion?repeatMarkerCodeshareFlags(day):day?.savedCalendar?savedCalendarFlags(day):repeatMarkerReviewFlags(day)??(day?.status==='OBSERVED'?day:carrier==='KE'?savedAggregateFlags(day):null);return (carrier!=='KE'||day?.date<=KE_DISPLAY_END||day?.keFutureVisible===true)&&!!source&&selectedFields(carrier,seat).some(field=>source[field]===true);}
const timestamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value));
export async function unpackDocument(input,{maxBytes=32*1024*1024}={}){
 if(!input||typeof input!=='object')throw new DataError('저장 자료 형식을 확인하지 못했습니다.');
 if(input.encoding===undefined)return input;
 if(input.encoding!=='gzip-base64'||typeof input.data!=='string'||input.data.length>48*1024*1024)throw new DataError('저장 자료 압축 형식이 다릅니다.');
 if(typeof DecompressionStream==='undefined')throw new DataError('최신 크롬·삼성 인터넷·사파리에서 열어주세요.');
 let bytes;try{bytes=Uint8Array.from(atob(input.data),c=>c.charCodeAt(0));}catch{throw new DataError('저장 자료를 해석하지 못했습니다.');}
 const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();let size=0;const chunks=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes)throw new DataError('저장 자료 크기가 너무 큽니다.');chunks.push(value);}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 const all=new Uint8Array(size);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.byteLength;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all));}catch{throw new DataError('저장 자료 내용을 확인하지 못했습니다.');}
}
export function validateRecord(key,payload,{carrier,origin,now=Date.now()}){
 const c=payload?.current;if(!c||!AIRLINES[carrier]||(c.carrier??'KE')!==carrier)throw new DataError('항공사가 다른 자료입니다.');
 if(!/^[A-Z]{3}$/.test(c.origin)||!/^[A-Z]{3}$/.test(c.destination)||c.origin===c.destination||!validMonth(c.month)||key!==`${c.origin}-${c.destination}-${c.month}`||c.origin!==origin&&c.destination!==origin)throw new DataError('저장 노선이 일치하지 않습니다.');
 if(!timestamp(c.sourceUpdatedAt)||!timestamp(c.collectedAt)||!Number.isSafeInteger(payload.success)||payload.success<=0||payload.success<Date.parse(c.collectedAt)||payload.success>now+300000)throw new DataError('자료 수집 시각이 올바르지 않습니다.');
 if(!Array.isArray(c.dates)||c.dates.length!==daysInMonth(c.month))throw new DataError('날짜가 빠진 달력입니다.');
 const seen=new Set();for(const d of c.dates){if(!validDate(d?.date)||d.date.slice(0,7)!==c.month||seen.has(d.date)||!['OBSERVED','UNKNOWN','NO_FLIGHT'].includes(d.status)||ALL_FIELDS.some(field=>typeof d[field]!=='boolean'))throw new DataError('확인되지 않은 날짜 자료입니다.');if(d.status!=='OBSERVED'&&ALL_FIELDS.some(field=>d[field]))throw new DataError('미확인·비운항 날짜에 좌석 표식이 있습니다.');seen.add(d.date);}
 return validateClaimedOperationSnapshot({...c,carrier,success:payload.success,dates:c.dates.map(d=>({...d})).sort((a,b)=>a.date.localeCompare(b.date))},{now});
}
export function readDocument(body,{carrier,origin,region,now=Date.now()}){
 if(body?.schema!==1||body.origin!==origin||body.region!==region||!body.records||Array.isArray(body.records)||typeof body.records!=='object'||Object.keys(body.records).length>5000)throw new DataError('출발지·지역이 다른 저장 자료입니다.');
 return Object.entries(body.records).map(([key,payload])=>validateRecord(key,payload,{carrier,origin,now}));
}
export function cityIndex(catalog){const cities=new Map();for(const [region,items] of Object.entries(catalog.regions))if(!EXCLUDED_REGIONS.includes(region))for(const city of items)cities.set(city.code,{...city,region});return cities;}
export function countriesFor(catalog,region='전체'){
 const countries=new Map();for(const city of cityIndex(catalog).values())if((region==='전체'||city.region===region)&&city.countryCode)countries.set(city.countryCode,city.country);
 return [...countries].map(([code,name])=>({code,name})).sort((a,b)=>a.name.localeCompare(b.name,'ko'));
}
export function airportsFor(catalog,{region='전체',country='전체',origin}={}){
 return [...cityIndex(catalog).values()].filter(city=>city.code!==origin&&(region==='전체'||city.region===region)&&(country==='전체'||city.countryCode===country)).sort((a,b)=>a.name.localeCompare(b.name,'ko')||a.code.localeCompare(b.code));
}
export function makeRoutes(records,catalog,origin){
 const cities=cityIndex(catalog),routes=new Map();
 for(const raw of records){if(isExcludedRecord(raw,catalog,origin))continue;const record=raw.carrier==='KE'?limitDisplayRecords([raw],catalog)[0]:raw;if(!record)continue;const code=record.origin===origin?record.destination:record.origin,city=cities.get(code);if(!routes.has(code))routes.set(code,{code,name:city?.name??code,region:city?.region??'기타',countryCode:city?.countryCode??'',country:city?.country??'',keFutureVisible:record.keFutureVisible??false,legs:{out:new Map(),back:new Map()}});const leg=record.origin===origin?'out':'back',months=routes.get(code).legs[leg],old=months.get(record.month);if(!old||old.success<record.success)months.set(record.month,record);}
 return [...routes.values()];
}
export function summarize(route,{carrier,seat='all',start,end,month:chosenMonth,direction}){
 if(carrier==='KE'&&!isExtendedKeRoute(route)&&end>KE_DISPLAY_END)end=KE_DISPLAY_END;
 const fields=selectedFields(carrier),byType=Object.fromEntries(fields.map(field=>[field,0]));
 let marked=0,observed=0,savedAggregateDays=0,noFlight=0,months=0,latest=0,nearest=null;
 for(const [legName,leg] of Object.entries(route.legs))for(const [month,record] of leg){
  if(direction&&legName!==direction||chosenMonth&&month!==chosenMonth)continue;
  if(month<start.slice(0,7)||month>end.slice(0,7))continue;
  months++;latest=Math.max(latest,record.success);
  for(const day of record.dates)if(day.date>=start&&day.date<=end){
   const saved=carrier==='KE'?savedAggregateFlags(day):null,source=day.repeatMarkerExclusion?repeatMarkerCodeshareFlags(day):day.savedCalendar?savedCalendarFlags(day):repeatMarkerReviewFlags(day)??(day.status==='OBSERVED'?day:saved);if(source){if(day.status==='OBSERVED'||day.repeatMarkerExclusion)observed++;else savedAggregateDays++;for(const field of fields)if(source[field]===true)byType[field]++;}else if(day.savedCalendar?.status==='NO_FLIGHT'||!day.savedCalendar&&day.status==='NO_FLIGHT')noFlight++;
   if(hasMark(day,carrier,seat)){marked++;if(nearest===null||day.date<nearest)nearest=day.date;}
  }
 }
 return {marked,observed,savedAggregateDays,noFlight,months,latest,nearest,byType};
}
export function filterRoutes(routes,filter){
 const q=(filter.query??'').trim().toLocaleLowerCase();return routes.filter(route=>(filter.region==='전체'||route.region===filter.region)&&(!filter.country||filter.country==='전체'||route.countryCode===filter.country)&&(!filter.airport||filter.airport==='전체'||route.code===filter.airport)&&(!q||`${route.code} ${route.name}`.toLocaleLowerCase().includes(q))).map(route=>({...route,summary:summarize(route,filter)})).filter(route=>route.summary.months>0&&(!filter.onlyMarked||route.summary.marked>0)).sort((a,b)=>(a.summary.nearest??'9999').localeCompare(b.summary.nearest??'9999')||b.summary.marked-a.summary.marked||a.name.localeCompare(b.name,'ko'));
}
function baseCellInfo(route,direction,date,carrier,seat='all'){
 if(carrier==='KE'&&!isExtendedKeRoute(route)&&date>KE_DISPLAY_END)return {kind:'outside',label:'대한항공 해당 지역의 임시 조회 범위 밖',marks:[]};
 const sourceRecord=route?.legs[direction]?.get(date.slice(0,7)),sourceDay=sourceRecord?.dates.find(x=>x.date===date),saved=carrier==='KE'?savedAggregateFlags(sourceDay):null;
 if(sourceDay?.repeatMarkerExclusion)return {kind:'unknown',label:'비운항 추정 · 해당 월 동일 요일 전체 세 표식 · 날짜 표식 제외',day:sourceDay,record:sourceRecord,marks:[],repeatMarkerExclusion:sourceDay.repeatMarkerExclusion};
 if(sourceDay?.savedCalendar){const source=sourceDay.savedCalendar;if(source.status==='UNKNOWN')return {kind:'unknown',label:'미조회·미확인 · 원본 저장 달력 기준',day:sourceDay,record:sourceRecord,marks:[]};if(source.status==='NO_FLIGHT')return {kind:'noflight',label:'비운항 · 원본 저장 달력 기준',day:sourceDay,record:sourceRecord,marks:[]};const flags=savedCalendarFlags(sourceDay),marks=flags?FIELDS.map((field,index)=>({field,index,label:AIRLINES.KE.labels[index]})).filter(m=>selectedFields(carrier,seat).includes(m.field)&&flags[m.field]):[];return {kind:marks.length?'available':'empty',label:'원본 저장 표식'+(marks.length?' · '+marks.map(m=>m.label).join(', '):' · 선택 등급의 표식 없음'),day:sourceDay,record:sourceRecord,marks,savedAggregate:true,flags};}
 const reviewFlags=repeatMarkerReviewFlags(sourceDay);if(reviewFlags){const marks=FIELDS.map((field,index)=>({field,index,label:AIRLINES.KE.labels[index]})).filter(m=>selectedFields(carrier,seat).includes(m.field)&&reviewFlags[m.field]);return {kind:marks.length?'available':'empty',label:'확인필요 · 저장 표식 유지'+(marks.length?' · '+marks.map(m=>m.label).join(', '):' · 선택 등급의 저장 표식 없음'),day:sourceDay,record:sourceRecord,marks,savedAggregate:true,flags:reviewFlags};}
 if(saved){const marks=FIELDS.map((field,index)=>({field,index,label:AIRLINES.KE.labels[index]})).filter(m=>selectedFields(carrier,seat).includes(m.field)&&saved[m.field]);return {kind:marks.length?'available':'empty',label:'저장 표식 · 편별 운항 미대조'+(marks.length?' · '+marks.map(m=>m.label+' 저장').join(', '):' · 저장 표식 없음'),day:sourceDay,record:sourceRecord,marks,savedAggregate:true,flags:saved};}
 if(sourceDay?.savedAggregatePendingReason)return {kind:'unknown',label:sourceDay.savedAggregatePendingReason,day:sourceDay,record:sourceRecord,marks:[]};
 const record=route?.legs[direction]?.get(date.slice(0,7));const day=record?.dates.find(x=>x.date===date);if(day?.timetableConflict&&day.status==='UNKNOWN')return {kind:'unknown',label:'운항 일정 불일치 · 표식 제외',day,record,marks:[]};if(day?.routeWeekdayExcluded)return {kind:'unknown',label:'비운항 · 지정 요일 기준',day,record,marks:[]};if(!day||day.status==='UNKNOWN')return {kind:'unknown',label:day?.legacyAwardFlags?'항공편별 재조회 필요':day?.operationPending?'항공편 운항 대조 전':'미조회·미확인',day,record,marks:[]};
 if(day.status==='NO_FLIGHT')return {kind:'noflight',label:day.operationSource==='KE_WEEKLY_SCHEDULE_ALL_OPERATORS'?'전체 운항편 없음 · 항공편별 스케줄 대조':'운항편 없음 · 저장 자료 기준',day,record,marks:[]};
 const marks=FIELDS.slice(0,carrier==='OZ'?2:3).map((field,i)=>({field,index:i,label:AIRLINES[carrier].labels[i]})).filter(m=>selectedFields(carrier,seat).includes(m.field)&&day[m.field]===true);
 return {kind:marks.length?'available':'empty',label:marks.length?marks.map(m=>m.label+' 표시').join(', '):'선택 항목의 공개 표식 없음',day,record,marks};
}
export function monthStep(month,delta){const d=new Date(month+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+delta);return d.toISOString().slice(0,7);}


export function cellInfo(route,direction,date,carrier,seat='all'){
 const info=baseCellInfo(route,direction,date,carrier,seat),record=info.record??route?.legs[direction]?.get(date.slice(0,7)),review=info.day?.repeatMarkerReview??record?.repeatMarkerPolicy?.reviews.find(r=>r.dates.includes(date));
 return review?{...info,needsReview:true,review,label:info.label+' · 확인필요 · 같은 달 동일 요일의 표식이 서로 다릅니다.'}:info;
}
