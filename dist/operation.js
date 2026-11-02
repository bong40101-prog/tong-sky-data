// Independent operating schedules only. Empty award results never establish nonoperation.
const FIELDS=['economyAward','premiumAward','prestigeAward','premiumUpgrade','prestigeUpgrade','firstCombined'];
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const TIME=/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/;
const dateOK=d=>typeof d==='string'&&DATE.test(d)&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const dayAt=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const routeKey=w=>`${w.carrier}:${w.origin}:${w.destination}:${w.weekStart}`;
const facts=w=>JSON.stringify(w.dates.map(d=>[d.date,d.status,d.flights.map(f=>f.number).sort()]));
export class OperationError extends Error{}
export function validateOperationWeek(w,{now=Date.now()}={}){
 if(!w||w.schema!==1||w.carrier!=='KE'||!/^[A-Z]{3}$/.test(w.origin)||!/^[A-Z]{3}$/.test(w.destination)||w.origin===w.destination)throw new OperationError('운항 대조 노선이 올바르지 않습니다.');
 if(!dateOK(w.queriedDate)||!dateOK(w.weekStart)||new Date(w.weekStart+'T00:00:00Z').getUTCDay()!==1||w.queriedDate<w.weekStart||w.queriedDate>dayAt(w.weekStart,6))throw new OperationError('운항 대조 주간이 올바르지 않습니다.');
 if(typeof w.observedAt!=='string'||!TIME.test(w.observedAt)||!Number.isFinite(Date.parse(w.observedAt))||Date.parse(w.observedAt)>now+300000)throw new OperationError('운항 대조 시각이 올바르지 않습니다.');
 let url;try{url=new URL(w.sourceUrl);}catch{throw new OperationError('운항 대조 출처를 확인하지 못했습니다.');}
 if(url.protocol!=='https:'||!['koreanair.com','www.koreanair.com'].includes(url.hostname)||url.pathname!=='/flight-status'||url.username||url.password||url.port)throw new OperationError('공식 운항 스케줄 출처가 아닙니다.');
 if(!Number.isSafeInteger(w.ownFlightRows)||w.ownFlightRows<1||w.ownFlightRows>1000||!Array.isArray(w.dates)||w.dates.length!==7)throw new OperationError('운항 대조 결과가 완전하지 않습니다.');
 const seen=new Set();for(const d of w.dates){
  if(!dateOK(d?.date)||d.date<w.weekStart||d.date>dayAt(w.weekStart,6)||seen.has(d.date)||!['OPERATING','NO_FLIGHT'].includes(d.status)||!Array.isArray(d.flights)||d.flights.length>1000)throw new OperationError('운항 대조 날짜가 완전하지 않습니다.');
  seen.add(d.date);const flights=new Set();for(const f of d.flights){if(typeof f?.number!=='string'||!/^KE\d{1,4}$/.test(f.number)||flights.has(f.number))throw new OperationError('운항 대조 편명을 확인하지 못했습니다.');flights.add(f.number);}
  if((d.status==='OPERATING')!==(flights.size>0))throw new OperationError('운항 대조 상태와 편명이 다릅니다.');
 }
 return {...w,dates:w.dates.map(d=>({...d,flights:d.flights.map(f=>({...f}))})).sort((a,b)=>a.date.localeCompare(b.date))};
}
function chooseWeeks(weeks,options){
 const latest=new Map();for(const input of weeks){const w=validateOperationWeek(input,options),key=routeKey(w),old=latest.get(key);if(old){const order=Date.parse(w.observedAt)-Date.parse(old.observedAt);if(order===0&&facts(w)!==facts(old))throw new OperationError('같은 시각의 운항 대조 결과가 서로 다릅니다.');if(order<=0)continue;}latest.set(key,w);}return [...latest.values()];
}
export function validateOperationPolicy(policy,options){
 if(!policy||policy.schema!==1||!Array.isArray(policy.weeks)||policy.weeks.length>20000)throw new OperationError('운항 대조 자료 형식이 다릅니다.');
 return {schema:1,weeks:chooseWeeks(policy.weeks,options)};
}
export async function loadOperationPolicy({signal,force=false,fetcher=fetch,now=Date.now()}={}){
 const response=await fetcher('./operation-schedules.json',{signal,cache:force?'reload':'no-cache',credentials:'omit',referrerPolicy:'no-referrer'});
 if(!response.ok)throw new OperationError('운항 대조 자료 연결 실패');
 if(Number(response.headers.get('content-length'))>16*1024*1024)throw new OperationError('운항 대조 자료 크기 초과');
 const reader=response.body.getReader(),decoder=new TextDecoder();let text='',size=0;
 try{while(true){if(signal?.aborted)throw signal.reason;const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16*1024*1024)throw new OperationError('운항 대조 자료 크기 초과');text+=decoder.decode(value,{stream:true});}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 return validateOperationPolicy(JSON.parse(text+decoder.decode()),{now});
}
export function applyOperationPolicy(records,policy,{now=Date.now(),forcePending=false}={}){
 const verified=validateOperationPolicy(policy,{now}),out=[],warnings=[],routes=new Map();let maskedDays=0,coveredDays=0,pendingDays=0,ruleExcludedDays=0;for(const w of verified.weeks){const key=w.origin+':'+w.destination;if(!routes.has(key))routes.set(key,[]);routes.get(key).push(w);}
 for(const record of records){
  if(record.carrier!=='KE'){out.push(record);continue;}
  try{
   const embedded=record.operationWeeks??[];if(!Array.isArray(embedded))throw new OperationError('저장 운항 대조 자료 형식이 다릅니다.');
   for(const w of embedded)if(w?.carrier!=='KE'||w.origin!==record.origin||w.destination!==record.destination)throw new OperationError('다른 노선의 운항 대조 자료입니다.');
   const weeks=chooseWeeks([...(routes.get(record.origin+':'+record.destination)??[]),...embedded],{now}).filter(w=>w.dates.some(d=>d.date.slice(0,7)===record.month)),byDate=new Map();for(const w of weeks)for(const d of w.dates)byDate.set(d.date,{...d,observedAt:w.observedAt});
   const userRule=record.origin==='ICN'&&record.destination==='FRA'||record.origin==='FRA'&&record.destination==='ICN';
   const clear=(day,status,extra={})=>{const next={...day,status,...extra};for(const f of FIELDS)next[f]=false;if(Array.isArray(next.flights))next.flights=[];return next;};
   const dates=record.dates.map(day=>{const op=byDate.get(day.date),allowed=[0,3,5].includes(new Date(day.date+'T00:00:00Z').getUTCDay());
    if(userRule&&!allowed){ruleExcludedDays++;if(op)coveredDays++;const noFlight=op?.status==='NO_FLIGHT'||day.status==='NO_FLIGHT';if(noFlight)maskedDays++;const next=clear(day,noFlight?'NO_FLIGHT':'UNKNOWN',{routeWeekdayExcluded:true,routeWeekdaySource:'USER_SELECTED'});delete next.operationPending;if(op?.status==='NO_FLIGHT'){next.operationSource='KE_WEEKLY_SCHEDULE';next.operationObservedAt=op.observedAt;}return next;}
    if(op?.status==='NO_FLIGHT'){coveredDays++;maskedDays++;const next=clear(day,'NO_FLIGHT',{operationSource:'KE_WEEKLY_SCHEDULE',operationObservedAt:op.observedAt});delete next.operationPending;return next;}
    if(userRule&&allowed){if(op)coveredDays++;const next=day.status==='NO_FLIGHT'?clear(day,'NO_FLIGHT'):{...day};next.routeWeekdayAllowed=true;next.routeWeekdaySource='USER_SELECTED';delete next.operationPending;delete next.routeWeekdayExcluded;return next;}
    if(!op||forcePending){pendingDays++;return clear(day,'UNKNOWN',{operationPending:true});}coveredDays++;const next={...day};delete next.operationPending;return next;
   });
   const next=weeks.length?{...record,dates,operationWeeks:weeks,operationPolicyVersion:1}:{...record,dates};if(userRule)next.routeWeekdayRule={source:'USER_SELECTED',weekdays:[0,3,5],dateBasis:'DEPARTURE_DATE',scope:'ICN_FRA_BOTH_DIRECTIONS'};out.push(next);
  }catch{warnings.push(`${record.origin} → ${record.destination} ${record.month} 운항 대조 자료 오류로 제외`);}
 }
 return {records:out,warnings,maskedDays,coveredDays,pendingDays,ruleExcludedDays};
}
