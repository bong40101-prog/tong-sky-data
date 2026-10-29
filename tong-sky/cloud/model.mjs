import fs from 'node:fs';
import path from 'node:path';
export const DELAY_MS=10000;
export const fields=['economyAward','premiumAward','prestigeAward','premiumUpgrade','prestigeUpgrade','firstCombined'];
export const key=q=>`${q.origin}-${q.destination}-${q.month}`;
export function kstDay(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function plan(origin,airports,day=kstDay()){
 if(!/^[A-Z]{3}$/.test(origin))throw Error('Invalid origin');
 const start=new Date(day+'T00:00:00Z'),end=new Date(+start+359*86400000);let month=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth(),1));const months=[];
 while(month<=end){months.push(month.toISOString().slice(0,7));month=new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth()+1,1));}
 const codes=[...new Set(airports.map(a=>a.code))].filter(c=>c!==origin);if(codes.some(c=>!/^[A-Z]{3}$/.test(c)))throw Error('Invalid destination');
 return codes.flatMap(destination=>months.map(month=>({origin,destination,month})));
}
export function validate(q,v){
 if(key(q)!==key(v))throw Error('Route/month mismatch');
 for(const f of ['sourceUpdatedAt','collectedAt'])if(!Number.isFinite(Date.parse(v[f])))throw Error('Missing timestamp');
 const [y,m]=q.month.split('-').map(Number),count=new Date(Date.UTC(y,m,0)).getUTCDate();if(v.dates?.length!==count)throw Error('Incomplete month');
 const seen=new Set();for(const d of v.dates){if(!new RegExp('^'+q.month+'-\\d{2}$').test(d.date)||+d.date.slice(-2)<1||+d.date.slice(-2)>count||seen.has(d.date))throw Error('Invalid/duplicate date');seen.add(d.date);if(!['OBSERVED','UNKNOWN','NO_FLIGHT'].includes(d.status)||fields.some(f=>typeof d[f]!=='boolean'))throw Error('Invalid day');}
}
export function merge(old,q,next,now=new Date()){
 validate(q,next);let previous=old?.previous||null;
 if(old?.current){const diff=Date.parse(next.sourceUpdatedAt)-Date.parse(old.current.sourceUpdatedAt);if(diff<0)throw Error('Older source');if(diff===0&&JSON.stringify(old.current.dates)!==JSON.stringify(next.dates))throw Error('Same-source data changed');if(diff>0)previous=old.current;}
 return {current:next,previous,success:+now};
}
export function read(file,fallback=null){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
export function write(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value));fs.renameSync(tmp,file);}
export function progress(s){return s.total?Math.min(100,Math.floor(s.completed*100/s.total)):0;}
