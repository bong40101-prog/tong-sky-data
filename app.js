import {AIRLINES,BASE,FIELDS,REGIONS,todayKST,addDays,validDate,validMonth,unpackDocument,readDocument,makeRoutes,filterRoutes,summarize,cellInfo,monthStep,daysInMonth,countriesFor,airportsFor} from './model.js';
import {loadSavedDataset,retainUnavailableRegions} from './data.js';
const $=id=>document.getElementById(id);
const node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
const today=todayKST();
const state={carrier:'KE',origin:'ICN',region:'전체',country:'전체',airport:'전체',query:'',seat:'all',start:today,end:today<='2026-12-17'?'2026-12-17':addDays(today,359),month:today.slice(0,7),direction:'out',selected:null,records:[],routes:[],filtered:[],loading:false};
let catalogs,controller,generation=0,bootAttempt=0;const cache=new Map();
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
  row.dataset.field=FIELDS[i];const value=summary.observed?`${summary.byType[FIELDS[i]]}일`:'미확인';
  const name=node('span','type-name',compact?['보너스','승급','퍼스트'][i]:label);name.title=label;row.append(name,node('strong',summary.observed&&summary.byType[FIELDS[i]]?'type-positive':'',value));counts.append(row);
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
   const value=summary.observed?`${summary.byType[FIELDS[i]]}일`:'미확인',count=node('strong',summary.observed&&summary.byType[FIELDS[i]]?'type-positive':'',value);count.dataset.direction=direction;count.setAttribute('aria-label',`${direction==='out'?'가는 편':'오는 편'} 전체 ${label} ${value}`);row.append(count);
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
 const route=currentRoute(),grid=$('calendar-grid');grid.replaceChildren();$('month').value=state.month;$('prev-month').disabled=state.month<=state.start.slice(0,7);$('next-month').disabled=state.month>=state.end.slice(0,7);
 for(const button of $('directions').querySelectorAll('button')){const active=button.dataset.direction===state.direction;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}
 $('calendar-region').textContent=route?`${route.region.split('/')[0]}${route.country?' · '+route.country:''} · ${AIRLINES[state.carrier].name}`:'SAVED CALENDAR';$('calendar-title').textContent=route?route.name:state.loading?'저장된 달력을 불러오는 중':'노선을 선택해 주세요';
 $('calendar-subtitle').textContent=route?`${state.origin} ${state.direction==='out'?'→':'←'} ${route.code} · ${state.direction==='out'?'가는 편':'오는 편'}`:state.loading?'잠시만 기다려주세요.':'저장 자료가 있는 노선을 선택하면 날짜별 표식이 표시됩니다.';
 const record=route?.legs[state.direction].get(state.month);
 const summary=summarize(route??{legs:{}},state);$('calendar-counts').replaceChildren(typeCounts(summary,'month-type-counts'));
 $('calendar-count-scope').textContent=`${monthLabel(state.month)} · ${state.direction==='out'?'가는 편':'오는 편'} · 선택 기간 안의 표식 날짜 수`;
 const offset=new Date(state.month+'-01T00:00:00Z').getUTCDay();for(let i=0;i<offset;i++){const blank=node('div','day-blank');blank.setAttribute('aria-hidden','true');grid.append(blank);}
 for(let day=1;day<=daysInMonth(state.month);day++){const date=`${state.month}-${String(day).padStart(2,'0')}`,inRange=date>=state.start&&date<=state.end,info=inRange?cellInfo(route,state.direction,date,state.carrier,state.seat):{kind:'outside',label:'선택 기간 밖',marks:[]},button=node('button','day day-'+info.kind),weekday=(offset+day-1)%7;button.type='button';button.dataset.date=date;
 if(weekday===0)button.classList.add('sunday');if(weekday===6)button.classList.add('saturday');if(date===today)button.classList.add('today');button.disabled=!route||!inRange;button.setAttribute('aria-label',`${date} · ${info.label}${date===today?' · 오늘':''}`);
 button.append(node('span','day-number',String(day)));const marks=node('span','day-marks');for(const mark of info.marks){const chip=node('span','day-type day-type-'+mark.index,['보너스','승급','퍼스트'][mark.index]);chip.title=mark.label;chip.setAttribute('aria-hidden','true');marks.append(chip);}if(info.kind==='unknown')marks.append(node('span','day-unknown','—'));if(!inRange)marks.append(node('span','day-outside-note','기간 밖'));button.append(marks);button.addEventListener('click',()=>openDay(date,info));grid.append(button);}
 const badge=$('fresh-badge');badge.hidden=!record;
 if(record){$('calendar-source').textContent=`수집 ${fullTime.format(record.success)} · 한국시간`;const fresh=todayKST(new Date(record.success))===today;badge.textContent=fresh?'오늘 수집':'이전 수집 자료';badge.classList.toggle('old',!fresh);}
 else $('calendar-source').textContent=route?'이 방향·월은 저장 자료가 없습니다.':'노선을 선택하면 수집 시각을 볼 수 있습니다.';
}
function updateView(){stats();renderRoutes();renderCalendar();}
function openDay(date,info){
 const route=currentRoute();if(!route)return;$('day-title').textContent=new Intl.DateTimeFormat('ko-KR',{month:'long',day:'numeric',weekday:'long',timeZone:'UTC'}).format(new Date(date+'T00:00:00Z'));
 $('day-route').textContent=`${AIRLINES[state.carrier].name} · ${state.direction==='out'?state.origin:route.code} → ${state.direction==='out'?route.code:state.origin}`;const markers=$('day-markers');markers.replaceChildren();
 if(info.kind==='unknown')markers.append(node('p','unknown-message',info.label+' · 좌석 여부를 판단할 수 없습니다.'));else AIRLINES[state.carrier].labels.forEach((label,i)=>{if(state.seat!=='all'&&state.seat!==String(i))return;const row=node('div','day-marker-row'),name=node('span','');name.append(node('i','marker mark-'+i),document.createTextNode(label));row.append(name,node('strong',info.day[FIELDS[i]]?'positive':'',info.day[FIELDS[i]]?'표시 있음':'공개 표식 없음'));markers.append(row);});
 $('day-times').replaceChildren();if(info.record){$('day-times').append(node('p','',`항공사 기준 ${fullTime.format(new Date(info.record.sourceUpdatedAt))}`),node('p','',`실제 수집 ${fullTime.format(info.record.success)}`));}else $('day-times').append(node('p','','저장된 수집 시각 없음'));
 $('day-dialog').showModal();
}
function finishData(records,errors){state.records=records;state.routes=makeRoutes(records,catalogs[state.carrier],state.origin);state.loading=false;$('refresh').disabled=false;status(records.length?`저장 ${records.length}개 노선·월 연결됨`:'저장된 자료 없음',records.length?'ready':'');message(errors.length?'일부 자료를 불러오지 못했습니다. 표시된 자료는 유지되며, 새 자료 불러오기로 다시 확인할 수 있습니다.':'');stats();renderRoutes();renderCalendar();}
async function loadData(force=false){
 const id=++generation;controller?.abort();controller=new AbortController();const own=controller,carrier=state.carrier,origin=state.origin,key=`${carrier}:${origin}`;state.loading=true;state.selected=null;state.records=[];state.routes=[];message('');status('저장 자료 불러오는 중');$('refresh').disabled=true;stats();renderRoutes();renderCalendar();
 const cached=cache.get(key);if(!force&&cached&&Date.now()-cached.at<60000){finishData(cached.records,cached.errors);return;}
 const timer=setTimeout(()=>own.abort(new Error('연결 시간 초과')),25000);
 try{const data=await loadSavedDataset({catalogs,carriers:[carrier],origin,signal:own.signal,force,onProgress:p=>{if(id===generation)status(`저장 자료 ${p.completed}/${p.total} 불러오는 중`);}});if(id===generation){const result=retainUnavailableRegions(data.results[carrier],cached?.records);cache.set(key,{...result,at:Date.now()});finishData(result.records,result.errors);}}
 catch{if(id===generation)finishData(cached?.records??[],['저장 자료 연결 실패']);}finally{clearTimeout(timer);}
}
async function revealMain(){await loadData();$('boot-screen').hidden=true;$('app-screen').hidden=false;}
async function bootDatasets(force=false){
 const attempt=++bootAttempt;controller?.abort();controller=new AbortController();const own=controller;$('boot-actions').hidden=true;$('boot-progress').value=0;$('boot-percent').textContent='0%';$('boot-stage').textContent='저장 자료 연결 중';$('boot-detail').textContent='대한항공 · 아시아나 달력을 준비합니다.';
 const timer=setTimeout(()=>own.abort(new Error('연결 시간 초과')),25000);
 try{const data=await loadSavedDataset({catalogs,carriers:['KE','OZ'],origin:state.origin,signal:own.signal,force,onProgress:p=>{if(attempt!==bootAttempt)return;const percent=Math.floor(p.completed*100/p.total);$('boot-progress').value=percent;$('boot-percent').textContent=percent+'%';$('boot-stage').textContent=AIRLINES[p.source.carrier].name+' · '+p.source.region;$('boot-detail').textContent=`${p.completed}/${p.total}개 저장 자료 불러오기 완료`;}});
  if(attempt!==bootAttempt)return;
  for(const [carrier,result] of Object.entries(data.results)){const key=`${carrier}:${state.origin}`,merged=retainUnavailableRegions(result,cache.get(key)?.records);data.results[carrier]=merged;cache.set(key,{...merged,at:Date.now()});}
  const total=Object.values(data.results).reduce((n,r)=>n+r.records.length,0),failed=Object.values(data.results).some(r=>r.errors.length>0);
  if(failed){$('boot-stage').textContent='일부 자료 연결을 확인하지 못했습니다.';$('boot-detail').textContent=`불러온 ${total}개 노선·월은 유지됩니다. 다시 시도하거나 불러온 자료로 볼 수 있습니다.`;$('boot-actions').hidden=false;}
  else{$('boot-progress').value=100;$('boot-percent').textContent='100%';$('boot-stage').textContent='저장 자료 불러오기 완료';$('boot-detail').textContent=`${total}개 노선·월 · 메인 화면으로 이동합니다.`;await revealMain();}
 }catch{$('boot-stage').textContent='저장 자료에 연결하지 못했습니다.';$('boot-detail').textContent='인터넷 연결 후 다시 불러오기를 눌러주세요.';$('boot-actions').hidden=false;}finally{clearTimeout(timer);}
}
function readForm({load=true}={}){
 const origin=$('origin').value.trim().toUpperCase(),start=$('start').value,end=$('end').value;if(!/^[A-Z]{3}$/.test(origin)){formError('기준 공항 코드는 영문 3자리로 입력해주세요.');return false;}if(!validDate(start)||!validDate(end)||start>end){formError('시작일과 종료일을 다시 선택해주세요.');return false;}if(start<today||end>addDays(today,359)){formError('오늘부터 360일 안의 날짜를 선택해주세요.');return false;}
 const changed=state.origin!==origin;Object.assign(state,{origin,start,end,region:$('region').value,country:$('country').value,airport:$('destination').value,seat:$('seat').value,query:'',onlyMarked:$('only-marked').checked});$('origin').value=origin;setGeographyOptions();formError('');setMonths();if(changed&&load)loadData();else{stats();renderRoutes();renderCalendar();}return true;
}
async function selectCarrier(carrier){if(state.carrier===carrier)return;state.carrier=carrier;state.seat='all';document.body.dataset.carrier=carrier;
 for(const button of document.querySelectorAll('[data-carrier]')){const active=button.dataset.carrier===carrier;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;}
 state.end=carrier==='KE'&&today<='2026-12-17'?'2026-12-17':addDays(today,359);$('end').value=state.end;if(state.start>state.end){state.start=today;$('start').value=today;}setOptions();setMonths();await loadData();}
async function init(){
 // Official lookup is independent of the saved KE/OZ dataset and never starts collection.
 $('vn-lookup').addEventListener('click',()=>$('vn-dialog').showModal());
 $('vn-dialog').addEventListener('close',()=>$('vn-lookup').focus());
 $('vn-dialog').addEventListener('click',e=>{if(e.target===$('vn-dialog')){const r=$('vn-dialog').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('vn-dialog').close();}});
 $('boot-retry').addEventListener('click',()=>catalogs?bootDatasets(true):location.reload());$('boot-continue').addEventListener('click',()=>revealMain());
 catalogs=await fetch('./catalog.json?v=2',{cache:'no-cache'}).then(response=>{if(!response.ok)throw new Error();return response.json();});
 const airports=new Map();for(const catalog of Object.values(catalogs))for(const cities of Object.values(catalog.regions))for(const city of cities)airports.set(city.code,city.name);for(const [code,name] of [...airports].sort()){const option=node('option','');option.value=code;option.label=name;$('airport-options').append(option);}
 for(const id of ['start','end']){$(id).min=today;$(id).max=addDays(today,359);} $('start').value=state.start;$('end').value=state.end;setOptions();setMonths();
 $('search-form').addEventListener('submit',e=>{e.preventDefault();readForm();});$('origin').addEventListener('input',()=>{$('origin').value=$('origin').value.replace(/[^a-z]/gi,'').toUpperCase();});
 $('region').addEventListener('change',()=>{state.region=$('region').value;state.country='전체';state.airport='전체';setGeographyOptions();readForm();});
 $('country').addEventListener('change',()=>{state.country=$('country').value;state.airport='전체';setGeographyOptions();readForm();});
 for(const id of ['seat','destination','only-marked'])$(id).addEventListener('change',()=>readForm());$('refresh').addEventListener('click',()=>{if(readForm({load:false}))loadData(true);});
 for(const button of document.querySelectorAll('[data-carrier]')){button.addEventListener('click',()=>selectCarrier(button.dataset.carrier));button.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const next=state.carrier==='KE'?'OZ':'KE';document.querySelector(`[data-carrier=${next}]`).focus();selectCarrier(next);}});}
 for(const button of document.querySelectorAll('[data-direction]'))button.addEventListener('click',()=>{state.direction=button.dataset.direction;updateView();});
 $('month').addEventListener('change',()=>{if(validMonth($('month').value)){state.month=$('month').value;updateView();}});for(const [id,delta] of [['prev-month',-1],['next-month',1]])$(id).addEventListener('click',()=>{const next=monthStep(state.month,delta);if(next>=state.start.slice(0,7)&&next<=state.end.slice(0,7)){state.month=next;updateView();}});
 $('day-dialog').addEventListener('click',e=>{if(e.target===$('day-dialog')){const r=$('day-dialog').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('day-dialog').close();}});
 await bootDatasets();
}
init().catch(()=>{$('boot-stage').textContent='페이지 자료에 연결하지 못했습니다.';$('boot-detail').textContent='다시 불러오기를 눌러주세요.';$('boot-actions').hidden=false;$('boot-continue').hidden=true;});
