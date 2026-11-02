import {projectRepeatedMarkerRecords} from './repeat-markers.js?v=146';
import {AIRLINES,BASE,FIELDS,REGIONS,todayKST,addDays,validDate,validMonth,unpackDocument,readDocument,makeRoutes,filterRoutes,summarize,cellInfo,monthStep,daysInMonth,countriesFor,airportsFor,KE_DISPLAY_END,limitDisplayRecords,isExtendedKeRoute,isExcludedRecord} from './model.js?v=146';
import {collectRepeatHistory,mergeRepeatHistory,readRepeatHistory,writeRepeatHistory,serializeRepeatHistory} from './repeat-history.js?v=146';
import {loadSavedDataset,retainUnavailableRegions} from './data.js?v=146';
import {loadOperationPolicy,applyOperationPolicy} from './operation.js?v=146';
import {projectLegacySavedRecords} from './legacy.js?v=146';
import {loadTimetableReference,projectTimetableRecords,timetableRouteSummary,lookupTimetableDay} from './timetable.js?v=146';
const $=id=>document.getElementById(id);
const node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
const today=todayKST();
const state={carrier:'KE',origin:'ICN',region:'전체',country:'전체',airport:'전체',query:'',seat:'all',start:today,end:addDays(today,359),month:today.slice(0,7),direction:'out',selected:null,records:[],routes:[],filtered:[],loading:false};
let catalogs,controller,generation=0,bootAttempt=0,operationPolicy={schema:1,weeks:[]},operationWarning='';const cache=new Map();
let timetableIndex=null,timetableWarning='',repeatRecords=[],repeatHistory=[],historySaved=true;
try{repeatHistory=readRepeatHistory(globalThis.localStorage);}catch{}
async function readTimetable(force,signal){const own=new AbortController(),abort=()=>own.abort(signal.reason);if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(()=>own.abort(new Error('참고표 연결 시간 초과')),6000);try{return {index:await loadTimetableReference({force,signal:own.signal}),warning:''};}catch{return {index:null,warning:'운항요일 참고표를 불러오지 못했습니다. 저장 좌석 자료와 기존 운항 대조 결과는 유지합니다.'};}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}}
function acceptTimetable(result){if(result.index)timetableIndex=result.index;timetableWarning=result.warning;}
async function readOperationPolicy(force,signal){try{return {policy:await loadOperationPolicy({force,signal}),warning:''};}catch{return {policy:null,warning:'운항 대조 자료에 연결하지 못했습니다. 마지막으로 확인된 제외 기준을 유지합니다. 편별 검증 표식은 보류하며 기존 저장 표식은 구분해 표시합니다.'};}}
function acceptOperationPolicy(result){if(result.policy)operationPolicy=result.policy;operationWarning=result.warning;}
const dateFormat=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const fullTime=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const displayDate=d=>d?`${Number(d.slice(5,7))}.${d.slice(8,10)}`:'—';
const monthLabel=m=>`${m.slice(0,4)}년 ${Number(m.slice(5,7))}월`;
function status(text,kind=''){const e=$('load-status');e.className='load-status '+kind;e.replaceChildren(node('span','status-dot'),document.createTextNode(text));}
function message(text){$('notice').textContent=text;$('notice').hidden=!text;}
function formError(text){$('form-error').textContent=text;$('form-error').hidden=!text;}
function currentRoute(){return state.routes.find(r=>r.code===state.selected);}
function setOptions(){
 $('seat').replaceChildren();const options=state.carrier==='OZ'?['비즈니스 전체','비즈니스 보너스','비즈니스 승급']:['프레스티지·퍼스트 전체','프레스티지 보너스','프레스티지 승급','퍼스트 보너스·승급 합산'];
 for(let i=0;i<options.length;i++){const option=node('option','',options[i]);option.value=i===0?'all':String(i-1);$('seat').append(option);}$('seat').value=state.seat;
 const regions=$('region');regions.replaceChildren(new Option('전체 대륙·지역','전체'));for(const region of REGIONS)if(catalogs[state.carrier].regions[region]?.length)regions.add(new Option(region,region));if(![...regions.options].some(o=>o.value===state.region)){state.region='전체';state.country='전체';state.airport='전체';}regions.value=state.region;setGeographyOptions();
 $('ke-range-notice').hidden=state.carrier!=='KE';$('ke-nonoperation-notice').hidden=state.carrier!=='KE';$('repeat-history').hidden=state.carrier!=='KE';
 $('first-note').hidden=state.carrier==='OZ';$('seat-help').replaceChildren(node('strong','','보너스'),document.createTextNode(' = 마일리지로 발권 · '),node('strong','','승급'),document.createTextNode(' = 좌석 업그레이드'),node('br'),document.createTextNode(state.carrier==='KE'?'프레스티지 = 비즈니스석 · 퍼스트 = 일등석':'아시아나는 비즈니스석의 보너스·승급을 구분합니다.'));$('official-link').href=AIRLINES[state.carrier].source;
 const legend=$('legend');legend.replaceChildren();AIRLINES[state.carrier].labels.forEach((label,i)=>{const item=node('span','legend-item');item.append(node('i','marker mark-'+i),document.createTextNode(label));legend.append(item);});const unknown=node('span','legend-item');unknown.append(node('i','marker unknown-dot'),document.createTextNode('미확인'));legend.append(unknown);
}
function setGeographyOptions(){
 const catalog=catalogs[state.carrier],countries=countriesFor(catalog,state.region),country=$('country');
 if(state.country!=='전체'&&!countries.some(c=>c.code===state.country)){state.country='전체';state.airport='전체';}
 country.replaceChildren(new Option('전체 국가·지역','전체'));for(const item of countries)country.add(new Option(item.name,item.code));country.value=state.country;
 const cities=airportsFor(catalog,{region:state.region,country:state.country,origin:state.origin}),destination=$('destination');
 if(state.airport!=='전체'&&!cities.some(c=>c.code===state.airport))state.airport='전체';
 destination.replaceChildren(new Option('전체 도시·공항','전체'));for(const city of cities)destination.add(new Option(city.name+' · '+city.code,city.code));destination.value=state.airport;
}
function bookingEnd(){return addDays(today,359);}
function setDateLimits(){for(const id of ['start','end']){$(id).min=today;$(id).max=bookingEnd();}}
function setMonths(){const select=$('month');select.replaceChildren();for(let month=state.start.slice(0,7);month<=state.end.slice(0,7);month=monthStep(month,1))select.add(new Option(monthLabel(month),month));if(state.month<state.start.slice(0,7)||state.month>state.end.slice(0,7))state.month=state.start.slice(0,7);select.value=state.month;}
function periodFilter(){return {...state,month:undefined,direction:undefined};}
function stats(){
 const all=filterRoutes(state.routes,periodFilter()).map(r=>r.summary),latest=all.reduce((max,s)=>Math.max(max,s.latest),0),nearest=all.map(s=>s.nearest).filter(Boolean).sort()[0];
 $('stat-routes').textContent=String(all.length);$('stat-nearest').textContent=nearest?displayDate(nearest):'표시일 없음';$('stat-latest').textContent=latest?dateFormat.format(latest):'수집 전';
}
function emptyList(title,copy){const wrap=node('div','empty-list');wrap.append(node('div','empty-symbol','✧'),node('strong','',title),node('p','',copy));return wrap;}
function typeCounts(summary,cls,compact=false){
 const counts=node('div','type-counts '+cls);
 AIRLINES[state.carrier].labels.forEach((label,i)=>{
  if(state.seat!=='all'&&state.seat!==String(i))return;
  const row=node('div','type-count-row type-'+i+(state.seat!=='all'&&state.seat!==String(i)?' other-type':''));
  row.dataset.field=FIELDS[i];const value=(summary.observed+summary.noFlight+(summary.savedAggregateDays??0))?`${summary.byType[FIELDS[i]]}일`:'미확인';
  const name=node('span','type-name',compact?['보너스','승급','퍼스트'][i]:label);name.title=label;row.append(name,node('strong',(summary.observed+summary.noFlight+(summary.savedAggregateDays??0))&&summary.byType[FIELDS[i]]?'type-positive':'',value));counts.append(row);
 });counts.dataset.count=String(counts.children.length);return counts;
}
function periodTotals(route){
 const grid=node('div','route-totals');
 const head=node('div','total-count-head');head.append(node('span','','전체 기간'),node('span','','가는 편 전체'),node('span','','오는 편 전체'));grid.append(head);
 const scope={carrier:state.carrier,seat:state.seat,start:state.start,end:state.end};
 const out=summarize(route,{...scope,direction:'out'}),back=summarize(route,{...scope,direction:'back'});
 AIRLINES[state.carrier].labels.forEach((label,i)=>{
  if(state.seat!=='all'&&state.seat!==String(i))return;
  const row=node('div','total-count-row type-'+i);row.dataset.totalField=FIELDS[i];row.append(node('span','type-name',label));
  for(const [direction,summary] of [['out',out],['back',back]]){
   const value=(summary.observed+summary.noFlight+(summary.savedAggregateDays??0))?`${summary.byType[FIELDS[i]]}일`:'미확인',count=node('strong',(summary.observed+summary.noFlight+(summary.savedAggregateDays??0))&&summary.byType[FIELDS[i]]?'type-positive':'',value);count.dataset.direction=direction;count.setAttribute('aria-label',`${direction==='out'?'가는 편':'오는 편'} 전체 ${label} ${value}`);row.append(count);
  }grid.append(row);
 });return grid;
}
function renderRoutes(){
 state.filtered=filterRoutes(state.routes,periodFilter()).map(route=>({...route,totalSummary:route.summary,summary:summarize(route,state)}));$('route-scope').textContent=`전체 기간: ${state.start} ~ ${state.end} · 방향별 합계`;$('route-count').textContent=String(state.filtered.length);const list=$('route-list');list.setAttribute('aria-busy',String(state.loading));list.replaceChildren();
 if(state.loading){for(let i=0;i<4;i++)list.append(node('div','skeleton'));return;}
 if(!state.filtered.some(r=>r.code===state.selected))state.selected=state.filtered[0]?.code??null;
 if(!state.filtered.length){const scoped=state.airport!=='전체'?'선택한 공항':state.country!=='전체'?'선택한 국가·지역':null;list.append(emptyList(scoped?scoped+'의 저장 자료가 없어요':state.records.length?'조건에 맞는 노선이 없어요':'아직 저장된 자료가 없어요',scoped?'저장 자료가 없다는 뜻이며, 실제 좌석 없음이나 비운항을 의미하지 않습니다.':state.records.length?'도시·날짜·좌석 조건을 바꿔보세요.':'다른 기준 공항이나 항공사를 선택해 보세요.'));return;}
 for(const route of state.filtered){const b=node('button','route-card'+(route.code===state.selected?' selected':''));b.type='button';b.dataset.code=route.code;b.setAttribute('aria-pressed',String(route.code===state.selected));
 const top=node('div','route-row');const city=node('div','city-name');city.append(node('strong','',route.name),node('span','airport-code',route.code));const arrow=node('span','route-arrow','↗');top.append(city,arrow);
 const middle=node('div','route-row');middle.append(node('span','route-location',`${state.origin} ↔ ${route.code}`),node('span','count-scope','가는 편 · 오는 편'));
 const bottom=node('div','route-row route-meta');bottom.append(node('span','',route.country||route.region.split('/')[0]),node('span','',route.totalSummary.nearest?`가장 가까운 날 ${displayDate(route.totalSummary.nearest)}`:`저장 ${route.totalSummary.months}개 노선·월`));const current=node('div','route-current-calendar');current.append(node('p','current-calendar-heading',`현재 달력 · ${Number(state.month.slice(5))}월 · ${state.direction==='out'?'가는 편':'오는 편'}`),typeCounts(route.summary,'route-type-counts',true));b.append(top,middle,periodTotals(route),current,bottom);b.addEventListener('click',()=>{state.selected=route.code;renderRoutes();renderCalendar();});list.append(b);}
}
function renderCalendar(){
 const route=currentRoute(),limited=state.carrier==='KE'&&route&&!isExtendedKeRoute(route),calendarEnd=limited&&state.end>KE_DISPLAY_END?KE_DISPLAY_END:state.end;
 if(route&&state.month>calendarEnd.slice(0,7))state.month=calendarEnd.slice(0,7);
 const grid=$('calendar-grid');grid.replaceChildren();for(const option of $('month').options)option.disabled=option.value>calendarEnd.slice(0,7);$('month').value=state.month;$('prev-month').disabled=state.month<=state.start.slice(0,7);$('next-month').disabled=state.month>=calendarEnd.slice(0,7);
 for(const button of $('directions').querySelectorAll('button')){const active=button.dataset.direction===state.direction;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}
 $('calendar-region').textContent=route?`${route.region.split('/')[0]}${route.country?' · '+route.country:''} · ${AIRLINES[state.carrier].name}`:'SAVED CALENDAR';$('calendar-title').textContent=route?route.name:state.loading?'저장된 달력을 불러오는 중':'노선을 선택해 주세요';
 $('calendar-subtitle').textContent=route?`${state.origin} ${state.direction==='out'?'→':'←'} ${route.code} · ${state.direction==='out'?'가는 편':'오는 편'}`:state.loading?'잠시만 기다려주세요.':'저장 자료가 있는 노선을 선택하면 날짜별 표식이 표시됩니다.';
 const record=route?.legs[state.direction].get(state.month);const basis=$('calendar-basis');basis.hidden=!record?.dates.some(d=>d.savedAggregate||d.savedCalendar);basis.textContent=basis.hidden?'':record?.dates.some(d=>d.savedCalendar)?'원본 저장 달력 · 월별 세 표식 반복 기준':'저장 표식 · 편별 운항 미대조';
 renderTimetableSummary(route);renderRepeatSummary(record);renderRepeatHistory(route);
 const summary=summarize(route??{legs:{}},state);$('calendar-counts').replaceChildren(typeCounts(summary,'month-type-counts'));
 $('calendar-count-scope').textContent=`${monthLabel(state.month)} · ${state.direction==='out'?'가는 편':'오는 편'} · 선택 기간 안의 표식 날짜 수`;
 const offset=new Date(state.month+'-01T00:00:00Z').getUTCDay();for(let i=0;i<offset;i++){const blank=node('div','day-blank');blank.setAttribute('aria-hidden','true');grid.append(blank);}
 for(let day=1;day<=(limited&&state.month===KE_DISPLAY_END.slice(0,7)?Number(KE_DISPLAY_END.slice(8)):daysInMonth(state.month));day++){const date=`${state.month}-${String(day).padStart(2,'0')}`,inRange=date>=state.start&&date<=calendarEnd,info=inRange?cellInfo(route,state.direction,date,state.carrier,state.seat):{kind:'outside',label:'선택 기간 밖',marks:[]},button=node('button','day day-'+info.kind),weekday=(offset+day-1)%7;button.type='button';button.dataset.date=date;if(info.needsReview)button.classList.add('day-review');
 if(weekday===0)button.classList.add('sunday');if(weekday===6)button.classList.add('saturday');if(date===today)button.classList.add('today');button.disabled=!route||!inRange;button.setAttribute('aria-label',`${date} · ${info.label}${date===today?' · 오늘':''}`);
 button.append(node('span','day-number',String(day)));const marks=node('span','day-marks');for(const mark of info.marks){const chip=node('span','day-type day-type-'+mark.index,['보너스','승급','퍼스트'][mark.index]);chip.title=mark.label;chip.setAttribute('aria-hidden','true');marks.append(chip);}if(info.kind==='unknown')marks.append(node('span','day-unknown',info.day?.repeatMarkerExclusion?'비운항 추정':info.day?.timetableConflict?'일정 불일치':info.day?.routeWeekdayExcluded?'비운항':info.day?.operationPending?'운항 대조 전':'—'));if(info.needsReview)marks.append(node('span','day-review-tag','확인필요'));if(info.kind==='noflight')marks.append(node('span','day-no-flight','비운항'));if(!inRange)marks.append(node('span','day-outside-note','기간 밖'));button.append(marks);button.addEventListener('click',()=>openDay(date,info));grid.append(button);}
 const badge=$('fresh-badge');badge.hidden=!record;
 if(record){$('calendar-source').textContent=`수집 ${fullTime.format(record.success)} · 한국시간`;const fresh=todayKST(new Date(record.success))===today;badge.textContent=fresh?'오늘 수집':'이전 수집 자료';badge.classList.toggle('old',!fresh);}
 else $('calendar-source').textContent=route?'이 방향·월은 저장 자료가 없습니다.':'노선을 선택하면 수집 시각을 볼 수 있습니다.';
}
function renderRepeatSummary(record){
 const target=$('repeat-marker-summary'),policy=record?.repeatMarkerPolicy;target.replaceChildren();target.hidden=!policy||(!policy.weekdays.length&&!policy.reviews.length);if(target.hidden)return;
 const labels=['일','월','화','수','목','금','토'];
 if(policy.evidence.length)target.append(node('strong','','반복 표식 기준 비운항 추정'),node('p','',policy.evidence.map(p=>`${labels[p.weekday]}요일 ${p.dates.length}/${p.dates.length}일`).join(' · ')+' — 같은 요일 전체에 원본 세 표식이 있어 해당 날짜를 제외합니다.'));
 if(policy.reviews.length)target.append(node('strong','repeat-review-title','확인필요'),node('p','repeat-review-copy',policy.reviews.map(p=>`${labels[p.weekday]}요일 ${p.matchedDates.length}/${p.dates.length}일 일치 · 확인 날짜 ${p.checkDates.map(d=>Number(d.slice(8))+'일').join(', ')}`).join(' / ')+' — 이 요일은 제외하지 않습니다.'));
}
function renderRepeatHistory(route){
 const body=$('repeat-history-body');body.replaceChildren();if(state.carrier!=='KE')return;
 const code=state.airport!=='전체'?state.airport:route?.code,labels=['일','월','화','수','목','금','토'];
 $('repeat-history-scope').textContent=(code?state.origin+' ↔ '+code:'전체 유럽·미국')+' · 저장된 전체 월 · 원본 달력 반복 기준 · 원본 수집 시각 기준 · '+(historySaved?'이 브라우저에 기록 저장':'현재 조회 기록');
 const records=repeatHistory.filter(r=>(r.origin===state.origin||r.destination===state.origin)&&(!code||r.origin===code||r.destination===code)).sort((a,b)=>a.month.localeCompare(b.month)||a.origin.localeCompare(b.origin)||a.destination.localeCompare(b.destination)||b.success-a.success||a.weekday-b.weekday);
 for(const entry of records){
  const tr=node('tr',entry.kind==='REVIEW'?'repeat-review-row':'repeat-excluded-row');tr.dataset.result=entry.kind;tr.dataset.month=entry.month;tr.dataset.origin=entry.origin;tr.dataset.destination=entry.destination;tr.dataset.weekday=String(entry.weekday);
  const reason=entry.kind==='REVIEW'?entry.issues.map(i=>Number(i.date.slice(8))+'일 '+i.reason).join(', '):entry.dates.map(d=>Number(d.slice(8))+'일').join(', ')+' 모두 일치';
  for(const text of [entry.month,entry.origin+' → '+entry.destination,labels[entry.weekday]+'요일',(entry.kind==='REVIEW'?'확인필요':'비운항 추정 · 제외')+(entry.source==='USER_ALL_WEEKDAYS_TRIPLET_V2'?'':' · 이전 기준'),entry.matchedDates.length+'/'+entry.dates.length,reason,entry.collectedAt?fullTime.format(new Date(entry.collectedAt)):'수집 시각 미확인'])tr.append(node('td','',text));body.append(tr);
 }
 $('repeat-history-count').textContent=String(records.length);$('repeat-history-empty').hidden=records.length>0;
}
function saveRepeatDecisions(){
 repeatHistory=mergeRepeatHistory(repeatHistory,collectRepeatHistory(repeatRecords));
 const result=writeRepeatHistory(repeatHistory);repeatHistory=result.events;historySaved=result.saved;
}
function downloadRepeatDecisions(event){
 if(typeof URL.createObjectURL!=='function')return;
 event.preventDefault();const url=URL.createObjectURL(new Blob([serializeRepeatHistory(repeatHistory)],{type:'application/json'})),link=node('a','');link.href=url;link.download='tongsky-repeat-history.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function updateView(){stats();renderRoutes();renderCalendar();}
function renderTimetableSummary(route){
 const target=$('timetable-summary');target.replaceChildren();target.hidden=state.carrier!=='KE'||!route||isExtendedKeRoute(route);if(target.hidden)return;const origin=state.direction==='out'?state.origin:route.code,destination=state.direction==='out'?route.code:state.origin,rows=timetableRouteSummary(timetableIndex,origin,destination,state.month).map(r=>({...r,displayStart:r.displayStart<state.start?state.start:r.displayStart,displayEnd:r.displayEnd>state.end?state.end:!isExtendedKeRoute(route)&&r.displayEnd>KE_DISPLAY_END?KE_DISPLAY_END:r.displayEnd})).filter(r=>r.displayStart<=r.displayEnd);target.append(node('strong','','운항요일 참고'));
 if(!rows.length){target.append(node('p','',timetableWarning?'운항요일 참고표 연결 미확인':'이 방향·월의 운항요일 참고 자료는 미확인입니다.'));return;}
 for(const r of rows){const period=r.displayStart.slice(5)+'~'+r.displayEnd.slice(5),basis=r.coverage==='WEEKDAYS'?(r.weekdayText?'운항 '+r.weekdayText:'운항 요일 미확인')+(r.noFlightText?' · 비운항 '+r.noFlightText:''):r.coverage==='DATES_ONLY'?'날짜별 일부 확인 · 나머지 미확인':'출처 간 불일치 · 미확인';target.append(node('p','timetable-summary-row',`${r.serviceKind==='DIRECT'?'직접운항':'공동운항'} · ${r.operatorName} · ${period} · ${basis}`));}
 target.append(node('p','timetable-caption',`${rows[0].sourceAsOf} 기준 참고표입니다. 좌석 표식은 항공편별 공식 조회 결과와 별도로 대조합니다.`));
}
function timetableDayDetails(date,info,target){
 if(state.carrier!=='KE')return;const route=currentRoute(),origin=state.direction==='out'?state.origin:route.code,destination=state.direction==='out'?route.code:state.origin,rows=info.day?.timetableReferences??lookupTimetableDay(timetableIndex,origin,destination,date);if(!rows.length)return;const section=node('section','timetable-day-reference');section.append(node('h3','','운항요일 참고'));
 for(const r of rows){const label=r.referenceConflict?'참고 자료 간 불일치 · 미확인':r.status==='NO_FLIGHT'?'비운항 요일 · 참고':r.status==='OPERATING'?'운항일 · 참고':'미확인';section.append(node('p','',`${r.serviceKind==='DIRECT'?'직접운항':'공동운항'} · ${r.operatorName} · ${label}`));if(r.note)section.append(node('p','timetable-caption',r.note));}
 section.append(node('p','timetable-caption',`${rows[0].sourceAsOf} 기준 · 참고 일정만으로 좌석 유무를 판단하지 않습니다.`));target.append(section);
}
function flightDetails(info,target){
 if(state.carrier!=='KE'||!Array.isArray(info.day?.flights)||!info.day.flights.length)return;
 const products=[['economyAward','일반석 보너스'],['premiumAward','프리미엄석 보너스'],['prestigeAward','프레스티지 보너스'],['premiumUpgrade','프리미엄석 승급'],['prestigeUpgrade','프레스티지 승급'],['firstCombined','퍼스트 보너스·승급']];
 for(const [kind,title] of [['DIRECT','대한항공 직접 운항'],['CODESHARE','공동운항편'],['UNKNOWN','운항사·운항 미확인']]){
  const flights=info.day.flights.filter(f=>f.serviceKind===kind);if(!flights.length)continue;const section=node('section','flight-group');section.dataset.serviceKind=kind;section.append(node('h3','',title));
  for(const f of flights){const row=node('div','flight-detail');row.dataset.flightNumber=f.number;row.dataset.operationStatus=f.operationStatus;row.append(node('strong','flight-heading',f.number+' · '+f.departureTime+(f.arrivalTime?' → '+f.arrivalTime:'')),node('span','flight-operator',f.operatorName||'운항사 미확인'));const repeated=Boolean(info.day.repeatMarkerExclusion);const label=repeated?'비운항 추정 · 월별 반복 표식 기준':f.timetableConflict?'운항 일정 불일치 · 표식 제외':f.weekdayExcluded?'비운항 · 지정 요일 기준':f.viewPending?'운항 대조 전':f.operationStatus==='NO_FLIGHT'?'비운항 · 좌석 표식 제외':f.operationStatus==='OPERATING'?(f.noSeat?'운항 · 공개 좌석 표식 없음':'운항'):'운항 미확인 · 좌석 표식 제외';row.append(node('span','flight-operation',label));const badges=node('div','flight-awards');if(!repeated&&f.operationStatus==='OPERATING'&&!f.weekdayExcluded&&!f.viewPending&&!f.timetableConflict)for(const [field,text] of products)if(f[field]){const badge=node('span','flight-award',text);badge.dataset.field=field;badges.append(badge);}if(!badges.children.length)badges.append(node('span','flight-empty',repeated||f.operationStatus==='NO_FLIGHT'||f.weekdayExcluded||f.viewPending||f.timetableConflict?'표식 합계에서 제외':f.awardDataStatus==='UNKNOWN'?'좌석 표식 미확인':'선택 항공편의 공개 표식 없음'));row.append(badges);section.append(row);}target.append(section);
 }
}
function openDay(date,info){
 const route=currentRoute();if(!route)return;$('day-title').textContent=new Intl.DateTimeFormat('ko-KR',{month:'long',day:'numeric',weekday:'long',timeZone:'UTC'}).format(new Date(date+'T00:00:00Z'));
 $('day-route').textContent=`${AIRLINES[state.carrier].name} · ${state.direction==='out'?state.origin:route.code} → ${state.direction==='out'?route.code:state.origin}`;const markers=$('day-markers');markers.replaceChildren();if(info.savedAggregate)markers.append(node('p','unknown-message','원본 저장 표식 · 실제 운항 확인과 구분한 마지막 수집 자료입니다.'));
 if(info.needsReview)markers.append(node('p','repeat-review-detail','확인필요 · 해당 월 '+['일','월','화','수','목','금','토'][info.review.weekday]+'요일 전체를 재확인해야 합니다. 세 표식 일치 '+info.review.matchedDates.length+'/'+info.review.dates.length+'일. '+info.review.issues.map(i=>i.date+' '+i.reason).join(' / ')+'. 이 요일은 비운항으로 제외하지 않았습니다.'));
 if(info.repeatMarkerExclusion)markers.append(node('p','unknown-message','해당 월 동일 요일 전체에서 원본 세 표식이 반복되어 해당 날짜의 표식을 제외했습니다. 판정 날짜: '+info.repeatMarkerExclusion.evidenceDates.join(', ')));
 if(info.kind==='unknown')markers.append(node('p','unknown-message',info.label+' · 좌석 여부를 판단할 수 없습니다.'));else if(info.kind==='noflight')markers.append(node('p','unknown-message',info.label+' · 좌석 표식과 합계에서 제외했습니다.'));else AIRLINES[state.carrier].labels.forEach((label,i)=>{if(state.seat!=='all'&&state.seat!==String(i))return;const row=node('div','day-marker-row'),name=node('span','');name.append(node('i','marker mark-'+i),document.createTextNode(label));row.append(name,node('strong',(info.flags??info.day)[FIELDS[i]]?'positive':'',(info.flags??info.day)[FIELDS[i]]?(info.savedAggregate?'저장 표식 있음':'표시 있음'):(info.savedAggregate?'저장 표식 없음':'공개 표식 없음')));markers.append(row);});
 if(!info.day?.savedCalendar){flightDetails(info,markers);timetableDayDetails(date,info,markers);}$('day-times').replaceChildren();if(info.record){$('day-times').append(node('p','',`항공사 기준 ${fullTime.format(new Date(info.record.sourceUpdatedAt))}`),node('p','',`실제 수집 ${fullTime.format(info.record.success)}`));}else $('day-times').append(node('p','','저장된 수집 시각 없음'));
 $('day-dialog').showModal();
}
function finishData(records,errors){records=records.filter(r=>!isExcludedRecord(r,catalogs[state.carrier],state.origin));const pattern=records.filter(r=>isExtendedKeRoute(r,catalogs.KE)),other=records.filter(r=>!isExtendedKeRoute(r,catalogs.KE)),masked=applyOperationPolicy(other,operationPolicy,{forcePending:Boolean(operationWarning)});const projected=[...pattern,...projectLegacySavedRecords(other,projectTimetableRecords(masked.records,timetableIndex),timetableIndex,{end:bookingEnd()})];repeatRecords=projectRepeatedMarkerRecords(records,projected,catalogs.KE);saveRepeatDecisions();state.records=limitDisplayRecords(repeatRecords,catalogs.KE);state.routes=makeRoutes(state.records,catalogs[state.carrier],state.origin);state.loading=false;$('refresh').disabled=false;status(state.records.length?`저장 ${state.records.length}개 노선·월 연결됨`:'저장된 자료 없음',state.records.length?'ready':'');message([errors.length?'일부 자료를 불러오지 못했습니다. 표시된 자료는 유지되며, 새 자료 불러오기로 다시 확인할 수 있습니다.':'',operationWarning,timetableWarning,masked.warnings.length?'운항 대조 자료가 올바르지 않은 일부 저장 결과는 표시에서 제외했습니다.':''].filter(Boolean).join(' '));stats();renderRoutes();renderCalendar();}
async function loadData(force=false){
 const id=++generation;controller?.abort();controller=new AbortController();const own=controller,carrier=state.carrier,origin=state.origin,key=`${carrier}:${origin}`;state.loading=true;state.selected=null;state.records=[];state.routes=[];message('');status('저장 자료 불러오는 중');$('refresh').disabled=true;stats();renderRoutes();renderCalendar();
 const cached=cache.get(key);if(!force&&cached&&Date.now()-cached.at<60000){finishData(cached.records,cached.errors);return;}
 const timer=setTimeout(()=>own.abort(new Error('연결 시간 초과')),25000);
 try{const [data,operation,timetable]=await Promise.all([loadSavedDataset({catalogs,carriers:[carrier],origin,signal:own.signal,force,onProgress:p=>{if(id===generation)status(`${AIRLINES[p.source.carrier].name} · ${p.source.region} · ${p.completed}/${p.total}구간`);}}),readOperationPolicy(force,own.signal),readTimetable(force,own.signal)]);if(id===generation){acceptOperationPolicy(operation);acceptTimetable(timetable);const result=retainUnavailableRegions(data.results[carrier],cached?.records);cache.set(key,{...result,at:Date.now()});finishData(result.records,result.errors);}}
 catch{if(id===generation)finishData(cached?.records??[],['저장 자료 연결 실패']);}finally{clearTimeout(timer);}
}
async function revealMain(){await loadData();$('boot-screen').hidden=true;$('app-screen').hidden=false;}
async function bootDatasets(force=false){
 const attempt=++bootAttempt;controller?.abort();controller=new AbortController();const own=controller;$('boot-actions').hidden=true;$('boot-progress').value=0;$('boot-percent').textContent='0%';$('boot-stage').textContent='저장 자료 연결 중';$('boot-detail').textContent='대한항공 · 아시아나 달력을 준비합니다.';
 const timer=setTimeout(()=>own.abort(new Error('연결 시간 초과')),25000);
 try{const [data,operation,timetable]=await Promise.all([loadSavedDataset({catalogs,carriers:['KE','OZ'],origin:state.origin,signal:own.signal,force,onProgress:p=>{if(attempt!==bootAttempt)return;const percent=Math.min(99,Math.floor(p.completed*100/p.total));$('boot-progress').value=percent;$('boot-percent').textContent=percent+'%';$('boot-stage').textContent=AIRLINES[p.source.carrier].name+' · '+p.source.region;$('boot-detail').textContent=`${p.completed}/${p.total}개 구간 처리 완료${p.recordCount!==undefined?' · 현재 지역 '+p.recordCount+'개 노선·월':''}`;}}),readOperationPolicy(force,own.signal),readTimetable(force,own.signal)]);
  if(attempt!==bootAttempt)return;acceptOperationPolicy(operation);acceptTimetable(timetable);
  for(const [carrier,result] of Object.entries(data.results)){const key=`${carrier}:${state.origin}`,merged=retainUnavailableRegions(result,cache.get(key)?.records);data.results[carrier]=merged;cache.set(key,{...merged,at:Date.now()});}
  const total=Object.values(data.results).reduce((n,r)=>n+limitDisplayRecords(r.records,catalogs.KE).length,0),failed=Object.values(data.results).some(r=>r.errors.length>0)||Boolean(operationWarning);
  if(failed){$('boot-stage').textContent=operationWarning?'운항 대조 자료 연결을 확인하지 못했습니다.':'일부 자료 연결을 확인하지 못했습니다.';$('boot-detail').textContent=`불러온 ${total}개 노선·월은 유지됩니다. 다시 시도하거나 불러온 자료로 볼 수 있습니다.`;$('boot-actions').hidden=false;}
  else{$('boot-progress').value=100;$('boot-percent').textContent='100%';$('boot-stage').textContent='저장 자료 불러오기 완료';$('boot-detail').textContent=`${total}개 노선·월 · 메인 화면으로 이동합니다.`;await revealMain();}
 }catch{$('boot-stage').textContent='저장 자료에 연결하지 못했습니다.';$('boot-detail').textContent='인터넷 연결 후 다시 불러오기를 눌러주세요.';$('boot-actions').hidden=false;}finally{clearTimeout(timer);}
}
function readForm({load=true}={}){
 const origin=$('origin').value.trim().toUpperCase(),start=$('start').value,end=$('end').value;if(!/^[A-Z]{3}$/.test(origin)){formError('기준 공항 코드는 영문 3자리로 입력해주세요.');return false;}if(!validDate(start)||!validDate(end)||start>end){formError('시작일과 종료일을 다시 선택해주세요.');return false;}if(start<today||end>bookingEnd()){formError('오늘부터 359일 뒤까지 선택할 수 있습니다.');return false;}
 const changed=state.origin!==origin;Object.assign(state,{origin,start,end,region:$('region').value,country:$('country').value,airport:$('destination').value,seat:$('seat').value,query:'',onlyMarked:$('only-marked').checked});$('origin').value=origin;setGeographyOptions();formError('');setMonths();if(changed&&load)loadData();else{stats();renderRoutes();renderCalendar();}return true;
}
async function selectCarrier(carrier){if(state.carrier===carrier)return;state.carrier=carrier;state.seat='all';document.body.dataset.carrier=carrier;
 for(const button of document.querySelectorAll('[data-carrier]')){const active=button.dataset.carrier===carrier;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;}
 state.end=bookingEnd();setDateLimits();$('end').value=state.end;if(state.start>state.end){state.start=today;$('start').value=today;}setOptions();setMonths();await loadData();}
async function init(){
 // Official lookup is independent of the saved KE/OZ dataset and never starts collection.
 $('repeat-audit-download').addEventListener('click',downloadRepeatDecisions);
 $('boot-retry').addEventListener('click',()=>catalogs?bootDatasets(true):location.reload());$('boot-continue').addEventListener('click',()=>revealMain());
 catalogs=await fetch('./catalog.json?v=2',{cache:'no-cache'}).then(response=>{if(!response.ok)throw new Error();return response.json();});
 const airports=new Map();for(const catalog of Object.values(catalogs))for(const cities of Object.values(catalog.regions))for(const city of cities)airports.set(city.code,city.name);for(const [code,name] of [...airports].sort()){const option=node('option','');option.value=code;option.label=name;$('airport-options').append(option);}
 setDateLimits();$('start').value=state.start;$('end').value=state.end;setOptions();setMonths();
 $('search-form').addEventListener('submit',e=>{e.preventDefault();readForm();});$('origin').addEventListener('input',()=>{$('origin').value=$('origin').value.replace(/[^a-z]/gi,'').toUpperCase();});
 $('region').addEventListener('change',()=>{state.region=$('region').value;state.country='전체';state.airport='전체';setGeographyOptions();readForm();});
 $('country').addEventListener('change',()=>{state.country=$('country').value;state.airport='전체';setGeographyOptions();readForm();});
 for(const id of ['seat','destination','only-marked'])$(id).addEventListener('change',()=>readForm());$('refresh').addEventListener('click',()=>{if(readForm({load:false}))loadData(true);});
 for(const button of document.querySelectorAll('[data-carrier]')){button.addEventListener('click',()=>selectCarrier(button.dataset.carrier));button.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const next=state.carrier==='KE'?'OZ':'KE';document.querySelector(`[data-carrier=${next}]`).focus();selectCarrier(next);}});}
 for(const button of document.querySelectorAll('[data-direction]'))button.addEventListener('click',()=>{state.direction=button.dataset.direction;updateView();});
 $('month').addEventListener('change',()=>{if(validMonth($('month').value)&&$('month').value>=state.start.slice(0,7)&&$('month').value<=bookingEnd().slice(0,7)&&$('month').value<=state.end.slice(0,7)){state.month=$('month').value;updateView();}else setMonths();});for(const [id,delta] of [['prev-month',-1],['next-month',1]])$(id).addEventListener('click',()=>{const next=monthStep(state.month,delta);if(next>=state.start.slice(0,7)&&next<=state.end.slice(0,7)){state.month=next;updateView();}});
 $('day-dialog').addEventListener('click',e=>{if(e.target===$('day-dialog')){const r=$('day-dialog').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('day-dialog').close();}});
 await bootDatasets();
}
init().catch(()=>{$('boot-stage').textContent='페이지 자료에 연결하지 못했습니다.';$('boot-detail').textContent='다시 불러오기를 눌러주세요.';$('boot-actions').hidden=false;$('boot-continue').hidden=true;});

