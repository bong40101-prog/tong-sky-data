import {addDays,validDate,cellInfo} from './model.js?v=159';

export const TRIP_REGIONS=['유럽','미주'];
export const TRIP_TYPES=[
 {id:'award-award',label:'보너스 왕복',out:'prestigeAward',back:'prestigeAward'},
 {id:'award-upgrade',label:'보너스＋승급',out:'prestigeAward',back:'prestigeUpgrade'},
 {id:'upgrade-award',label:'승급＋보너스',out:'prestigeUpgrade',back:'prestigeAward'}
];

// Index each direction by date once. Keep Cartesian products as blocks instead
// of allocating every city pair; counts and pagination include all matches.
export function findTrips(routes,{carrier,region,days,today,end,inCode='',outCode=''}){
 if(!['KE','OZ'].includes(carrier)||!TRIP_REGIONS.includes(region)||!Number.isInteger(days)||days<1||days>360||!validDate(today)||!validDate(end)||today>end)throw new Error('지역과 여행 일수(1~360일)를 선택해 주세요.');
 if(typeof inCode!=='string'||typeof outCode!=='string')throw new Error('IN·OUT 도시를 선택해 주세요.');
 const indexes={out:new Map(),back:new Map()};let months=0,latest=0;
 for(const route of [...routes].filter(r=>r.region===region).sort((a,b)=>a.code.localeCompare(b.code))){
  for(const direction of ['out','back'])for(const [month,record] of route.legs[direction]){
   if(direction==='out'&&inCode&&route.code!==inCode||direction==='back'&&outCode&&route.code!==outCode)continue;
   if(record.carrier!==carrier||month<today.slice(0,7)||month>end.slice(0,7))continue;
   months++;latest=Math.max(latest,record.success??0);
   for(const day of record.dates){
    if(day.date<today||day.date>end)continue;
    const info=cellInfo(route,direction,day.date,carrier);
    if(info.kind!=='available'||info.needsReview||info.repeatMarkerExclusion)continue;
    const flags=Object.fromEntries(info.marks.map(m=>[m.field,true]));
    if(!flags.prestigeAward&&!flags.prestigeUpgrade)continue;
    const list=indexes[direction].get(day.date)??[];
    // Duplicates cannot create extra combinations even if a malformed caller
    // repeats a route; the displayed month selected by makeRoutes is canonical.
    if(!list.some(x=>x.code===route.code))list.push({code:route.code,name:route.name,country:route.country??'',date:day.date,flags,sourceUpdatedAt:record.sourceUpdatedAt,success:record.success});
    indexes[direction].set(day.date,list);
   }
  }
 }
 const groups=TRIP_TYPES.map(type=>({...type,total:0,blocks:[]}));
 for(const date of [...indexes.out.keys()].sort()){
  const backDate=addDays(date,days-1);if(backDate>end)continue;
  const outgoing=indexes.out.get(date),incoming=indexes.back.get(backDate)??[];
  for(const group of groups){const out=outgoing.filter(x=>x.flags[group.out]),back=incoming.filter(x=>x.flags[group.back]);if(!out.length||!back.length)continue;const count=out.length*back.length;group.blocks.push({out,back,start:group.total,count});group.total+=count;}
 }
 return {carrier,region,days,today,end,inCode,outCode,months,latest,groups};
}

export function tripPage(group,offset=0,limit=20){
 if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>100)throw new Error('잘못된 결과 범위입니다.');
 const rows=[],stop=Math.min(group.total,offset+limit);
 for(const block of group.blocks){if(block.start+block.count<=offset)continue;if(block.start>=stop)break;for(let at=Math.max(offset,block.start);at<Math.min(stop,block.start+block.count);at++){const i=at-block.start;rows.push({out:block.out[Math.floor(i/block.back.length)],back:block.back[i%block.back.length],type:group.id});}}
 return rows;
}
