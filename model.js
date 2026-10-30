export const BASE='https://raw.githubusercontent.com/bong40101-prog/tong-sky-data/tong-sky-data/data/mobile/v101/';
export const FIELDS=['prestigeAward','prestigeUpgrade','firstCombined'];
export const ALL_FIELDS=['economyAward','premiumAward','prestigeAward','premiumUpgrade','prestigeUpgrade','firstCombined'];
export const AIRLINES={KE:{name:'대한항공',cabin:'프레스티지',labels:['프레스티지 보너스','프레스티지 승급','퍼스트 보너스·승급 합산'],source:'https://www.koreanair.com/booking/book-and-manage/award-seat-availability'},OZ:{name:'아시아나',cabin:'비즈니스',labels:['비즈니스 보너스','비즈니스 승급'],source:'https://flyasiana.com/I/KR/KO/MileageSeatSearch.do'}};
export const REGIONS=['유럽','미주','동남아시아/서남아시아','동북아시아','대양주/괌','러시아/몽골/중앙아시아','중동/아프리카','대한민국'];
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
export function hasMark(day,carrier,seat='all'){return day?.status==='OBSERVED'&&selectedFields(carrier,seat).some(field=>day[field]===true);}
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
 const seen=new Set();for(const d of c.dates){if(!validDate(d?.date)||d.date.slice(0,7)!==c.month||seen.has(d.date)||!['OBSERVED','UNKNOWN','NO_FLIGHT'].includes(d.status)||ALL_FIELDS.some(field=>typeof d[field]!=='boolean'))throw new DataError('확인되지 않은 날짜 자료입니다.');seen.add(d.date);}
 return {...c,carrier,success:payload.success,dates:c.dates.map(d=>({...d})).sort((a,b)=>a.date.localeCompare(b.date))};
}
export function readDocument(body,{carrier,origin,region,now=Date.now()}){
 if(body?.schema!==1||body.origin!==origin||body.region!==region||!body.records||Array.isArray(body.records)||typeof body.records!=='object'||Object.keys(body.records).length>5000)throw new DataError('출발지·지역이 다른 저장 자료입니다.');
 return Object.entries(body.records).map(([key,payload])=>validateRecord(key,payload,{carrier,origin,now}));
}
export function cityIndex(catalog){const cities=new Map();for(const [region,items] of Object.entries(catalog.regions))for(const city of items)cities.set(city.code,{...city,region});return cities;}
export function countriesFor(catalog,region='전체'){
 const countries=new Map();for(const city of cityIndex(catalog).values())if((region==='전체'||city.region===region)&&city.countryCode)countries.set(city.countryCode,city.country);
 return [...countries].map(([code,name])=>({code,name})).sort((a,b)=>a.name.localeCompare(b.name,'ko'));
}
export function airportsFor(catalog,{region='전체',country='전체',origin}={}){
 return [...cityIndex(catalog).values()].filter(city=>city.code!==origin&&(region==='전체'||city.region===region)&&(country==='전체'||city.countryCode===country)).sort((a,b)=>a.name.localeCompare(b.name,'ko')||a.code.localeCompare(b.code));
}
export function makeRoutes(records,catalog,origin){
 const cities=cityIndex(catalog),routes=new Map();
 for(const record of records){const code=record.origin===origin?record.destination:record.origin,city=cities.get(code);if(!routes.has(code))routes.set(code,{code,name:city?.name??code,region:city?.region??'기타',countryCode:city?.countryCode??'',country:city?.country??'',legs:{out:new Map(),back:new Map()}});const leg=record.origin===origin?'out':'back',months=routes.get(code).legs[leg],old=months.get(record.month);if(!old||old.success<record.success)months.set(record.month,record);}
 return [...routes.values()];
}
export function summarize(route,{carrier,seat='all',start,end,month:chosenMonth,direction}){
 const fields=selectedFields(carrier),byType=Object.fromEntries(fields.map(field=>[field,0]));
 let marked=0,observed=0,months=0,latest=0,nearest=null;
 for(const [legName,leg] of Object.entries(route.legs))for(const [month,record] of leg){
  if(direction&&legName!==direction||chosenMonth&&month!==chosenMonth)continue;
  if(month<start.slice(0,7)||month>end.slice(0,7))continue;
  months++;latest=Math.max(latest,record.success);
  for(const day of record.dates)if(day.date>=start&&day.date<=end){
   if(day.status==='OBSERVED'){observed++;for(const field of fields)if(day[field]===true)byType[field]++;}
   if(hasMark(day,carrier,seat)){marked++;if(nearest===null||day.date<nearest)nearest=day.date;}
  }
 }
 return {marked,observed,months,latest,nearest,byType};
}
export function filterRoutes(routes,filter){
 const q=(filter.query??'').trim().toLocaleLowerCase();return routes.filter(route=>(filter.region==='전체'||route.region===filter.region)&&(!filter.country||filter.country==='전체'||route.countryCode===filter.country)&&(!filter.airport||filter.airport==='전체'||route.code===filter.airport)&&(!q||`${route.code} ${route.name}`.toLocaleLowerCase().includes(q))).map(route=>({...route,summary:summarize(route,filter)})).filter(route=>route.summary.months>0&&(!filter.onlyMarked||route.summary.marked>0)).sort((a,b)=>(a.summary.nearest??'9999').localeCompare(b.summary.nearest??'9999')||b.summary.marked-a.summary.marked||a.name.localeCompare(b.name,'ko'));
}
export function cellInfo(route,direction,date,carrier,seat='all'){
 const record=route?.legs[direction]?.get(date.slice(0,7));const day=record?.dates.find(x=>x.date===date);if(!day||day.status==='UNKNOWN')return {kind:'unknown',label:'미조회·미확인',day,record,marks:[]};
 if(day.status==='NO_FLIGHT')return {kind:'unknown',label:'운항편 없음 · 저장 자료 기준',day,record,marks:[]};
 const marks=FIELDS.slice(0,carrier==='OZ'?2:3).map((field,i)=>({field,index:i,label:AIRLINES[carrier].labels[i]})).filter(m=>selectedFields(carrier,seat).includes(m.field)&&day[m.field]===true);
 return {kind:marks.length?'available':'empty',label:marks.length?marks.map(m=>m.label+' 표시').join(', '):'선택 항목의 공개 표식 없음',day,record,marks};
}
export function monthStep(month,delta){const d=new Date(month+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+delta);return d.toISOString().slice(0,7);}
