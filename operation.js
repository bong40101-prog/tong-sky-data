// Flight-level award observations and complete all-operator schedule proof are independent.
export const FLIGHT_FIELDS=['economyAward','premiumAward','prestigeAward','premiumUpgrade','prestigeUpgrade','firstCombined'];
const FIELDS=FLIGHT_FIELDS,DATE=/^\d{4}-\d{2}-\d{2}$/,TIME=/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/;
const SOURCE='KE_WEEKLY_SCHEDULE_ALL_OPERATORS',NAME={KE:'대한항공',OZ:'아시아나항공',AF:'에어프랑스'};
const dateOK=d=>typeof d==='string'&&DATE.test(d)&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const timeOK=t=>typeof t==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t);
const atOK=(t,now)=>typeof t==='string'&&TIME.test(t)&&Number.isFinite(Date.parse(t))&&Date.parse(t)>0&&Date.parse(t)<=now+300000;
const dayAt=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const numberOK=n=>typeof n==='string'&&/^[A-Z0-9]{2}\d{1,4}$/.test(n)&&/[A-Z]/.test(n.slice(0,2))&&Number(n.slice(2))>0;
const numberKey=n=>n.slice(0,2)+Number(n.slice(2));
const flightKey=f=>[numberKey(f.number),f.operatorCode,f.departureTime,f.arrivalTime].join('|'),joinKey=f=>[numberKey(f.number),f.departureTime].join('|'),rawKey=f=>[numberKey(f.number),f.departureTime,f.operatorCode??''].join('|');
const clear=(value,extra={})=>({...value,...Object.fromEntries(FIELDS.map(f=>[f,false])),...extra});
const flags=value=>Object.fromEntries(FIELDS.map(f=>[f,value[f]===true]));
const any=value=>FIELDS.some(f=>value[f]===true);
const aggregate=rows=>Object.fromEntries(FIELDS.map(f=>[f,rows.some(r=>r.operationStatus==='OPERATING'&&!r.weekdayExcluded&&!r.viewPending&&r[f]===true)]));
export class OperationError extends Error{}
const fail=message=>{throw new OperationError(message);};
function operator(f){
 if(typeof f.operatorCode!=='string'||!(/^[A-Z0-9]{2,3}$/).test(f.operatorCode)||typeof f.operatorName!=='string'||!(/^[\p{L}\p{N}][\p{L}\p{N} .&'’()·-]{1,79}$/u).test(f.operatorName)||/미확인|알 수 없|확인 중|unknown|undefined|null|조회|공동운항/i.test(f.operatorName))fail('운항 항공사 정보를 확인하지 못했습니다.');
 const aliases={KE:['대한항공','koreanair'],OZ:['아시아나','아시아나항공','asianaairlines'],AF:['에어프랑스','airfrance']},normalized=f.operatorName.toLowerCase().replace(/\s+/g,'');if(aliases[f.operatorCode]&&!aliases[f.operatorCode].includes(normalized)||Object.entries(aliases).some(([code,names])=>names.includes(normalized)&&code!==f.operatorCode)||f.serviceKind!==(f.operatorCode==='KE'?'DIRECT':'CODESHARE'))fail('실제 운항사와 직접·공동운항 구분이 다릅니다.');
}
function facts(w){return JSON.stringify(w.dates.map(d=>[d.date,d.status,d.flights.map(f=>w.schema===2?[f.number,f.operatorCode,f.operatorName,f.serviceKind,f.departureTime,f.arrivalTime,f.status]:[f.number]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]));}
export function validateOperationWeek(w,{now=Date.now()}={}){
 if(!w||![1,2].includes(w.schema)||w.carrier!=='KE'||typeof w.origin!=='string'||typeof w.destination!=='string'||!/^[A-Z]{3}$/.test(w.origin)||!/^[A-Z]{3}$/.test(w.destination)||w.origin===w.destination)fail('운항 대조 노선이 올바르지 않습니다.');
 if(!dateOK(w.queriedDate)||!dateOK(w.weekStart)||new Date(w.weekStart+'T00:00:00Z').getUTCDay()!==1||w.queriedDate<w.weekStart||w.queriedDate>dayAt(w.weekStart,6)||!atOK(w.observedAt,now))fail('운항 대조 날짜·시각이 올바르지 않습니다.');
 let url;try{url=new URL(w.sourceUrl);}catch{fail('운항 대조 출처를 확인하지 못했습니다.');}
 if(typeof w.sourceUrl!=='string'||w.sourceUrl.length>4096||url.protocol!=='https:'||!['koreanair.com','www.koreanair.com'].includes(url.hostname)||!/^\/(?:[a-zA-Z]{2}\/[a-zA-Z]{2}\/)?flight-status\/?$/.test(url.pathname)||url.username||url.password||url.port)fail('공식 운항 스케줄 출처가 아닙니다.');
 if(!Number.isSafeInteger(w.ownFlightRows)||w.ownFlightRows<(w.schema===1?1:0)||w.ownFlightRows>128||!Array.isArray(w.dates)||w.dates.length!==7)fail('운항 대조 결과가 완전하지 않습니다.');
 if(w.schema===2&&(w.completeOperators!==true||!Number.isSafeInteger(w.partnerFlightRows)||w.partnerFlightRows<0||w.partnerFlightRows>128||w.ownFlightRows+w.partnerFlightRows<1||w.ownFlightRows+w.partnerFlightRows>128))fail('전체 운항사 대조가 완료되지 않았습니다.');
 let firstRows;const seen=new Set(),dates=w.dates.map(d=>{
  if(!dateOK(d?.date)||d.date<w.weekStart||d.date>dayAt(w.weekStart,6)||seen.has(d.date)||!['OPERATING','NO_FLIGHT'].includes(d.status)||!Array.isArray(d.flights)||d.flights.length>128)fail('운항 대조 날짜가 완전하지 않습니다.');seen.add(d.date);
  const keys=new Set(),flights=d.flights.map(f=>{
   if(!numberOK(f?.number))fail('운항 대조 편명을 확인하지 못했습니다.');
   if(w.schema===1){if(!f.number.startsWith('KE')||keys.has(f.number))fail('자체 편명 근거가 다릅니다.');keys.add(f.number);return {number:numberKey(f.number)};}
   operator(f);if(!timeOK(f.departureTime)||!timeOK(f.arrivalTime)||!['OPERATING','NO_FLIGHT'].includes(f.status)||keys.has(flightKey(f)))fail('운항 항공편 정보가 불명확합니다.');keys.add(flightKey(f));return {...f,number:numberKey(f.number)};
  });
  if(w.schema===1){if((d.status==='OPERATING')!==(flights.length>0))fail('운항 대조 상태와 편명이 다릅니다.');}
  else{
   if(flights.length!==w.ownFlightRows+w.partnerFlightRows||flights.filter(f=>f.serviceKind==='DIRECT').length!==w.ownFlightRows||flights.filter(f=>f.serviceKind==='CODESHARE').length!==w.partnerFlightRows||(d.status==='OPERATING')!==flights.some(f=>f.status==='OPERATING'))fail('항공편별 상태와 전체 운항 상태가 다릅니다.');
   const identities=flights.map(f=>[flightKey(f),f.operatorName,f.arrivalTime].join('|')).sort();if(firstRows&&JSON.stringify(identities)!==JSON.stringify(firstRows))fail('주간 운항사 행이 날짜마다 다릅니다.');firstRows??=identities;
  }
  return {...d,flights};
 }).sort((a,b)=>a.date.localeCompare(b.date));
 return {...w,dates};
}
function chooseWeeks(weeks,options){
 const latest=new Map();for(const value of weeks){const w=validateOperationWeek(value,options),key=[w.origin,w.destination,w.weekStart,w.schema].join(':'),old=latest.get(key);if(old){const order=Date.parse(w.observedAt)-Date.parse(old.observedAt);if(order===0&&facts(w)!==facts(old))fail('같은 시각의 운항 대조 결과가 서로 다릅니다.');if(order<=0)continue;}latest.set(key,w);}return [...latest.values()];
}
export function validateOperationPolicy(policy,options){if(!policy||policy.schema!==1||!Array.isArray(policy.weeks)||policy.weeks.length>20000)fail('운항 대조 자료 형식이 다릅니다.');return {schema:1,weeks:chooseWeeks(policy.weeks,options)};}
export async function loadOperationPolicy({signal,force=false,fetcher=fetch,now=Date.now()}={}){
 const response=await fetcher('./operation-schedules.json',{signal,cache:force?'reload':'no-cache',credentials:'omit',referrerPolicy:'no-referrer'});if(!response.ok)fail('운항 대조 자료 연결 실패');if(Number(response.headers.get('content-length'))>16*1024*1024)fail('운항 대조 자료 크기 초과');const reader=response.body.getReader(),decoder=new TextDecoder();let text='',size=0;
 try{while(true){if(signal?.aborted)throw signal.reason;const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16*1024*1024)fail('운항 대조 자료 크기 초과');text+=decoder.decode(value,{stream:true});}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}return validateOperationPolicy(JSON.parse(text+decoder.decode()),{now});
}
function observations(record,day,{now}){
 const modern=record.flightDetailPolicyVersion===1,status=day.flightDetailStatus;
 if(!modern||!['CAPTURED','NO_MARKS','UNKNOWN'].includes(status))return {status:'LEGACY',rows:[]};
 const enriched=Array.isArray(day.flights)&&day.flights.some(f=>f?.operationStatus!==undefined||f?.operationSchema!==undefined);
 const values=day.flightObservations??(!enriched?day.flights:undefined);if(!Array.isArray(values)||values.length>128)fail('원본 항공편 좌석 근거가 빠졌습니다.');
 if(status==='CAPTURED'&&(day.flightDetailDate!==day.date||!atOK(day.flightDetailObservedAt,now)||values.length===0))fail('항공편 좌석 상세 날짜·시각이 다릅니다.');
 if(status!=='CAPTURED'&&values.length)fail('미확인·표식 없음 상태에 상세 항공편이 있습니다.');
 const keys=new Set(),rows=values.map(f=>{if(!numberOK(f?.number)||!timeOK(f.departureTime)||FIELDS.some(k=>typeof f[k]!=='boolean')||keys.has(rawKey(f)))fail('원본 항공편 좌석 정보가 올바르지 않습니다.');keys.add(rawKey(f));if(f.operatorCode!==undefined&&(!/^[A-Z0-9]{2,3}$/.test(f.operatorCode)))fail('원본 운항사 코드가 다릅니다.');if(f.operatorName!==undefined&&typeof f.operatorName!=='string')fail('원본 운항사 이름이 다릅니다.');if(f.noSeat!==undefined&&(typeof f.noSeat!=='boolean'||f.noSeat&&any(f)))fail('좌석 없음 표식과 원본 좌석 정보가 다릅니다.');return {number:f.number,departureTime:f.departureTime,...flags(f),...(f.operatorCode!==undefined?{operatorCode:f.operatorCode}:{}),...(f.operatorName!==undefined?{operatorName:f.operatorName}:{}),...(f.noSeat!==undefined?{noSeat:f.noSeat}:{})};});
 const expected=record.operationPolicyVersion===2?day.awardCalendarFlags:day;if(!expected||FIELDS.some(f=>typeof expected[f]!=='boolean'||expected[f]!==rows.some(r=>r[f])))fail('원본 항공편과 달력 표식 합계가 다릅니다.');
 return {status,rows};
}
function summary(rows){const on=rows.filter(f=>f.operationStatus==='OPERATING'),direct=on.some(f=>f.serviceKind==='DIRECT'),partner=on.some(f=>f.serviceKind==='CODESHARE');return direct&&partner?'DIRECT_AND_CODESHARE':direct?'DIRECT_ONLY':partner?'CODESHARE_ONLY':'UNVERIFIED';}
function deriveDay(record,day,evidence,{now,forcePending,viewRules}){
 const raw=observations(record,day,{now}),proof=evidence?.day,known=!!proof&&evidence.week.schema===2,base=clear(day);delete base.routeWeekdayExcluded;delete base.routeWeekdayAllowed;delete base.routeWeekdaySource;
 const rows=[],matched=new Set(),rawMatches=new Map(),matches=[];for(const r of raw.rows){let candidates=known?proof.flights.filter(f=>numberKey(f.number)===numberKey(r.number)&&(r.operatorCode===undefined||r.operatorCode===f.operatorCode)):[];if(candidates.length>1)candidates=candidates.filter(f=>f.departureTime===r.departureTime);if(candidates.length===1)matches.push({r,flight:candidates[0]});}for(const m of matches)if(matches.filter(x=>flightKey(x.flight)===flightKey(m.flight)).length===1){rawMatches.set(flightKey(m.flight),m.r);matched.add(rawKey(m.r));}
 if(known)for(const flight of proof.flights){const observation=rawMatches.get(flightKey(flight)),awardDataStatus=observation?'CAPTURED':raw.status==='NO_MARKS'?'NO_MARKS':'UNKNOWN';const derived=clear({...flight,operationStatus:flight.status,operationSchema:2,operationSource:SOURCE,operationObservedAt:evidence.week.observedAt,awardDataStatus});delete derived.status;if(observation?.noSeat===true)derived.noSeat=true;if(flight.status==='OPERATING'&&observation)Object.assign(derived,flags(observation));rows.push(derived);}
 for(const observation of raw.rows)if(!matched.has(rawKey(observation)))rows.push(clear({number:observation.number,departureTime:observation.departureTime,...(observation.operatorCode?{operatorCode:observation.operatorCode}:{})},{operationStatus:'UNKNOWN',operationSchema:2,operationSource:SOURCE,serviceKind:'UNKNOWN',awardDataStatus:'UNKNOWN',operationReason:'NO_UNIQUE_EXACT_FLIGHT'}));
 const legacy=raw.status==='LEGACY';if(!legacy)base.awardCalendarFlags=day.awardCalendarFlags??{status:day.status,...flags(day)};if(legacy){base.legacyAwardFlags=day.legacyAwardFlags??{status:day.status,...flags(day)};base.operationRequiresRequery=true;}
 const unmatched=rows.some(r=>r.operationStatus==='UNKNOWN'),unknownAward=raw.status==='UNKNOWN'||legacy,partial=!known||unmatched||unknownAward||rows.some(r=>r.operationStatus==='OPERATING'&&r.awardDataStatus==='UNKNOWN');
 const allOff=known&&!unmatched&&!unknownAward&&rows.length>0&&rows.every(f=>f.operationStatus==='NO_FLIGHT');
 const isFra=record.origin==='ICN'&&record.destination==='FRA'||record.origin==='FRA'&&record.destination==='ICN',allowed=[0,3,5].includes(new Date(day.date+'T00:00:00Z').getUTCDay());
 if(viewRules)for(const row of rows){if(isFra&&!allowed&&row.serviceKind==='DIRECT'){row.weekdayExcluded=true;row.weekdaySource='USER_SELECTED';for(const f of FIELDS)row[f]=false;}if(forcePending){row.viewPending=true;for(const f of FIELDS)row[f]=false;}}
 const combined=aggregate(rows),positive=any(combined),operationSummary=allOff?'NO_FLIGHT':summary(rows),status=allOff?'NO_FLIGHT':positive||known&&!partial&&rows.some(r=>r.operationStatus==='OPERATING')&&!forcePending?'OBSERVED':'UNKNOWN';
 Object.assign(base,combined,{status,flightObservations:raw.rows.map(r=>({...r})),flights:rows,operationSummary,operationPartial:partial,operationPending:status==='UNKNOWN',operationSchema:2,operationSource:SOURCE,operationCompleteOperators:known,operationStatus:allOff?'NO_FLIGHT':known&&rows.some(r=>r.operationStatus==='OPERATING')?'OPERATING':'UNKNOWN'});
 if(viewRules&&rows.some(r=>r.weekdayExcluded)&&!rows.some(r=>r.operationStatus==='OPERATING'&&!r.weekdayExcluded))base.routeWeekdayExcluded=true;if(partial||unknownAward)base.operationRequiresRequery=true;else delete base.operationRequiresRequery;if(known)base.operationObservedAt=evidence.week.observedAt;if(isFra&&viewRules)base.routeWeekdayRule={source:'USER_SELECTED',weekdays:[0,3,5],appliesTo:'DIRECT'};
 return base;
}
export function deriveFlightRecord(record,weeks,{now=Date.now(),forcePending=false,viewRules=true}={}){
 const embedded=record.operationWeeks??[];if(!Array.isArray(embedded))fail('저장 운항 대조 자료 형식이 다릅니다.');for(const w of embedded)if(w?.carrier!=='KE'||w.origin!==record.origin||w.destination!==record.destination)fail('다른 노선의 운항 대조 자료입니다.');
 const selected=chooseWeeks([...weeks,...embedded],{now}).filter(w=>w.origin===record.origin&&w.destination===record.destination&&w.dates.some(d=>d.date.slice(0,7)===record.month)),byDate=new Map();for(const w of selected)if(w.schema===2)for(const d of w.dates)byDate.set(d.date,{week:w,day:d});
 const dates=record.dates.map(day=>deriveDay(record,day,byDate.get(day.date),{now,forcePending,viewRules})),verified=dates.filter(d=>d.operationCompleteOperators&&!d.operationRequiresRequery).length;return {...record,dates,operationWeeks:selected,operationPolicyVersion:2,flightAttributionStatus:verified===dates.length?'VERIFIED':verified?'PARTIAL':'UNVERIFIED'};
}
export function validateClaimedOperationSnapshot(record,{now=Date.now()}={}){
 if(record.carrier!=='KE'||record.operationPolicyVersion!==2)return record;const expected=deriveFlightRecord(record,[],{now,viewRules:false});
 for(let i=0;i<record.dates.length;i++){const actual=record.dates[i],next=expected.dates[i];if(actual.status!==next.status||FIELDS.some(f=>actual[f]!==next[f])||!Array.isArray(actual.flightObservations)||!Array.isArray(actual.flights))fail('항공편 운항 근거와 저장된 달력 표식이 다릅니다.');
  const rows=new Map(next.flights.map(f=>[[f.number,f.operatorCode??'',f.departureTime].join('|'),f]));if(actual.flights.length!==rows.size)fail('저장된 항공편 행이 근거와 다릅니다.');for(const f of actual.flights){const n=rows.get([f.number,f.operatorCode??'',f.departureTime].join('|'));if(!n||f.operationStatus!==n.operationStatus||FIELDS.some(k=>f[k]!==n[k])||(f.serviceKind??'UNKNOWN')!==n.serviceKind||f.operatorName!==n.operatorName)fail('저장된 항공편별 좌석·운항 정보가 근거와 다릅니다.');}
 }return expected;
}
export function applyOperationPolicy(records,policy,{now=Date.now(),forcePending=false}={}){
 const verified=validateOperationPolicy(policy,{now}),out=[],warnings=[];let maskedDays=0,coveredDays=0,pendingDays=0,ruleExcludedDays=0;
 const routes=new Map();for(const w of verified.weeks){const key=w.origin+':'+w.destination;if(!routes.has(key))routes.set(key,[]);routes.get(key).push(w);}
 for(const record of records){if(record.carrier!=='KE'){out.push(record);continue;}try{const next=deriveFlightRecord(record,routes.get(record.origin+':'+record.destination)??[],{now,forcePending});out.push(next);for(const d of next.dates){if(d.status==='NO_FLIGHT')maskedDays++;if(d.operationCompleteOperators)coveredDays++;if(d.operationPending)pendingDays++;if(d.flights.some(f=>f.weekdayExcluded))ruleExcludedDays++;}}catch{warnings.push(`${record.origin} → ${record.destination} ${record.month} 운항 대조 자료 오류로 제외`);}}
 return {records:out,warnings,maskedDays,coveredDays,pendingDays,ruleExcludedDays};
}
