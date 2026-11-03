import {AIRLINES} from './model.js?v=159';
import {findTrips,tripPage,TRIP_REGIONS} from './trip-search.js?v=164';

export function setupTripSearch({getData,document:doc=document}){
 const $=id=>doc.getElementById(id),dialog=$('trip-dialog');let carrier='KE',lastFocus=null;
 const el=(tag,cls,text)=>{const n=doc.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const label=field=>field==='prestigeAward'?'보너스':'승급';
 const stamp=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 function cities(){
  const data=getData(carrier),region=$('trip-region').value;
  const choices=[...(data.catalog?.regions?.[region]??[])].filter(c=>c.code!==data.origin).sort((a,b)=>(a.name??a.code).localeCompare(b.name??b.code,'ko'));
  for(const id of ['trip-in','trip-out']){const select=$(id),before=select.value,all=el('option','','선택 안 함 · 전체');all.value='';select.replaceChildren(all,...choices.map(c=>{const option=el('option','',`${c.name} · ${c.code}`);option.value=c.code;return option;}));select.value=choices.some(c=>c.code===before)?before:'';}
 }
 function search(){
  const target=$('trip-results');target.replaceChildren();$('trip-status').textContent='';
  try{
   const data=getData(carrier),region=$('trip-region').value,days=Number($('trip-days').value);
   if(data.loading){$('trip-status').textContent='저장 자료를 불러오는 중입니다.';return;}
   const result=findTrips(data.routes,{carrier,region,days,today:data.today,end:data.end,inCode:$('trip-in').value,outCode:$('trip-out').value});
   $('trip-context').textContent=`${AIRLINES[carrier].name} · ${data.origin} 출발·귀국 · 저장된 전체 기간`;
   $('trip-status').textContent=`${region} · ${days}일 · ${result.groups.reduce((n,g)=>n+g.total,0).toLocaleString('ko-KR')}개 조합${data.partial?' · 일부 지역 자료 연결 미확인':''}`;
   for(const group of result.groups){
    const section=el('section','trip-group');section.dataset.tripType=group.id;
    const heading=el('div','trip-group-heading');heading.append(el('h3','',group.label),el('strong','trip-total',group.total.toLocaleString('ko-KR')+'개'));
    section.append(heading,el('p','trip-cabins',`${AIRLINES[carrier].cabin} ${label(group.out)} → ${AIRLINES[carrier].cabin} ${label(group.back)}`));
    if(!group.total)section.append(el('p','trip-empty',result.months?'조건에 맞는 저장 일정 조합이 없습니다.':'이 지역에 저장된 자료가 없습니다.'));
    const list=el('div','trip-list');section.append(list);let offset=0;
    const more=el('button','trip-more','더 보기');more.type='button';more.setAttribute('aria-label',group.label+' 결과 더 보기');
    function append(){for(const row of tripPage(group,offset,20)){
     const card=el('article','trip-card');card.dataset.outCode=row.out.code;card.dataset.backCode=row.back.code;card.dataset.departure=row.out.date;card.dataset.return=row.back.date;
     card.append(el('p','trip-dates',`${row.out.date} → ${row.back.date}`),el('strong','trip-cities',`${row.out.name} IN · ${row.back.name} OUT`));
     card.append(el('p','trip-airports',`${data.origin} → ${row.out.code} / ${row.back.code} → ${data.origin}`));
     const countries=[...new Set([row.out.country,row.back.country].filter(Boolean))].join(' · ');card.append(el('span','trip-kind',(row.out.code===row.back.code?'같은 도시 왕복':'다른 도시 인아웃')+(countries?' · '+countries:'')));
     const oldest=Math.min(row.out.success??0,row.back.success??0);if(oldest>0)card.append(el('p','trip-collected','양방향 중 오래된 수집: '+stamp.format(oldest)));
     list.append(card);
    }offset=Math.min(offset+20,group.total);more.hidden=offset>=group.total;more.textContent=`더 보기 · ${offset.toLocaleString('ko-KR')} / ${group.total.toLocaleString('ko-KR')}개`;}
    more.addEventListener('click',append);section.append(more);append();target.append(section);
   }
  }catch(e){$('trip-status').textContent=e.message||'추천 일정을 불러오지 못했습니다.';}
 }
 function open(selected,button){carrier=selected;lastFocus=button;dialog.dataset.tripCarrier=carrier;$('trip-title').textContent=AIRLINES[carrier].name+' 추천일정';const data=getData(carrier),before=$('trip-region').value;const options=TRIP_REGIONS.filter(r=>data.catalog?.regions?.[r]?.length);$('trip-region').replaceChildren(...options.map(r=>{const o=el('option','',r);o.value=r;return o;}));$('trip-region').value=options.includes(before)?before:options.includes('유럽')?'유럽':options[0]??'';cities();dialog.showModal();search();}
 for(const [id,code] of [['recommend-ke','KE'],['recommend-oz','OZ']])$(id).addEventListener('click',e=>open(code,e.currentTarget));
 $('trip-form').addEventListener('submit',e=>{e.preventDefault();search();});$('trip-region').addEventListener('change',()=>{cities();search();});for(const id of ['trip-in','trip-out'])$(id).addEventListener('change',search);$('trip-days').addEventListener('change',search);
 $('trip-close').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>lastFocus?.focus());
 return {refresh(){if(dialog.open){cities();search();}}};
}
