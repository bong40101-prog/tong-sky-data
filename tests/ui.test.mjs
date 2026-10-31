import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {JSDOM} from 'jsdom';
const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8'),catalog=JSON.parse(await readFile(new URL('../dist/catalog.json',import.meta.url))),ke=JSON.parse(await readFile(new URL('europe-packed.json',import.meta.url))),oz=JSON.parse(await readFile(new URL('asiana-packed.json',import.meta.url)));
let serial=0;const waitFor=async condition=>{for(let n=0;n<300;n++){if(condition())return;await new Promise(r=>setTimeout(r,5));}throw new Error('UI condition was not reached');};
async function page({holdAsiana=false,denyAsiana=false,keData=ke,denyKorean=false}={}){
 const dom=new JSDOM(html,{url:'https://example.test/',pretendToBeVisual:true}),d=dom.window.document,calls=[];let release,deny=denyAsiana;const gate=new Promise(r=>release=r);
 globalThis.document=d;globalThis.Option=dom.window.Option;globalThis.location={reload:()=>{}};dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 globalThis.fetch=async(url,options)=>{if(url.split('?')[0]==='./catalog.json')return Response.json(catalog);calls.push({url,options});if(options?.signal?.aborted)throw options.signal.reason;if(url.endsWith('/asiana.json')){if(holdAsiana)await gate;return deny?new Response('',{status:403}):Response.json(oz);}if(url.includes('/ICN/')&&url.endsWith('/europe.json'))return denyKorean?new Response('',{status:503}):Response.json(keData);return new Response('',{status:404});};
 await import(new URL('../dist/app.js?test='+serial++,import.meta.url));
 return {d,w:dom.window,calls,release,denyKorean:()=>denyKorean=true,allow:()=>deny=false,ready:()=>waitFor(()=>!d.getElementById('app-screen').hidden),close:()=>dom.window.close()};
}
test('entry keeps main hidden until both airlines complete, then shows real 100-percent progress',async()=>{const p=await page({holdAsiana:true});try{await waitFor(()=>p.calls.some(c=>c.url.endsWith('asiana.json')));assert.equal(p.d.getElementById('app-screen').hidden,true);assert.equal(p.d.getElementById('boot-screen').hidden,false);assert.ok(p.d.getElementById('boot-progress').value<100);p.release();await p.ready();assert.equal(p.d.getElementById('boot-progress').value,100);assert.equal(p.d.getElementById('boot-screen').hidden,true);assert.equal(p.calls.length,9);assert.ok(p.d.querySelectorAll('.route-card').length>0);}finally{p.release();p.close();}});
test('partial startup error waits for explicit continue and never invents a full load',async()=>{const p=await page({denyAsiana:true});try{await waitFor(()=>!p.d.getElementById('boot-actions').hidden);assert.equal(p.d.getElementById('app-screen').hidden,true);assert.ok(p.d.getElementById('boot-progress').value<100);p.d.getElementById('boot-continue').click();await p.ready();p.d.getElementById('tab-oz').click();await waitFor(()=>p.d.getElementById('load-status').textContent.includes('자료 없음'));assert.equal(p.d.querySelectorAll('.route-card').length,0);assert.equal(p.d.getElementById('notice').hidden,false);}finally{p.close();}});
test('manual startup retry loads both airlines once more and recovers the normal main screen',async()=>{const p=await page({denyAsiana:true});try{await waitFor(()=>!p.d.getElementById('boot-actions').hidden);p.allow();p.d.getElementById('boot-retry').click();await p.ready();assert.equal(p.calls.length,18);assert.equal(p.d.getElementById('boot-progress').value,100);}finally{p.close();}});
test('airline tabs use preloaded isolated data and update seat options without another request',async()=>{const p=await page();try{await p.ready();const count=p.calls.length;p.d.getElementById('tab-oz').click();await waitFor(()=>p.d.getElementById('load-status').textContent.includes('104개'));assert.equal(p.calls.length,count);assert.equal(p.d.getElementById('seat').options.length,3);assert.equal(p.d.getElementById('first-note').hidden,true);p.d.getElementById('tab-ke').click();await waitFor(()=>p.d.getElementById('load-status').textContent.includes('72개'));assert.equal(p.d.getElementById('seat').options.length,4);}finally{p.close();}});
test('city search, direction and monthly calendar controls reflect the selected actual route',async()=>{const p=await page();try{await p.ready();p.d.getElementById('destination').value='LHR';p.d.getElementById('search-form').dispatchEvent(new p.w.Event('submit',{bubbles:true,cancelable:true}));assert.equal(p.d.querySelectorAll('.route-card').length,1);assert.equal(p.d.getElementById('calendar-title').textContent,'런던');p.d.getElementById('direction-back').click();assert.match(p.d.getElementById('calendar-subtitle').textContent,/ICN ← LHR/);p.d.getElementById('month').value='2026-11';p.d.getElementById('month').dispatchEvent(new p.w.Event('change'));assert.equal(p.d.querySelectorAll('#calendar-grid button').length,30);p.d.querySelector('[data-date="2026-11-03"]').click();assert.equal(p.d.getElementById('day-dialog').open,true);assert.match(p.d.getElementById('day-route').textContent,/LHR → ICN/);assert.match(p.d.getElementById('day-times').textContent,/실제 수집/);}finally{p.close();}});
test('invalid date ranges do not alter results or fetch new data',async()=>{const p=await page();try{await p.ready();const count=p.calls.length;p.d.getElementById('start').value='2026-12-01';p.d.getElementById('end').value='2026-11-01';p.d.getElementById('search-form').dispatchEvent(new p.w.Event('submit',{bubbles:true,cancelable:true}));assert.equal(p.d.getElementById('form-error').hidden,false);assert.equal(p.calls.length,count);}finally{p.close();}});
test('refresh after changing origin makes exactly one region-read batch',async()=>{const p=await page();try{await p.ready();p.d.getElementById('origin').value='GMP';const before=p.calls.length;p.d.getElementById('refresh').click();await waitFor(()=>!p.d.getElementById('refresh').disabled&&p.d.getElementById('load-status').textContent.includes('자료 없음'));assert.equal(p.calls.length-before,8);assert.ok(p.calls.slice(before).every(c=>c.url.includes('/GMP/')));}finally{p.close();}});
test('top-right series download links to the existing series homepage, with no write or collector UI',async()=>{const p=await page();try{await p.ready();const a=p.d.querySelector('header .series-download');assert.equal(a.href,'https://bong40101-prog.github.io/tong-series/');assert.match(a.textContent,/통시리즈 앱 다운로드/);const radar=p.d.querySelector('header .radar-link');assert.equal(radar.href,'https://korea-futures-cloudflare.pages.dev/');assert.match(radar.textContent,/롱숏레이더 바로가기/);assert.equal(a.parentElement,radar.parentElement);assert.match(p.d.querySelector('.operator-notice').textContent,/개인 취미로 제작해 무료로 운영/);assert.match(p.d.querySelector('.operator-notice').textContent,/사전 안내 없이 변경·종료/);assert.ok(p.calls.every(c=>c.options.method===undefined&&c.options.credentials==='omit'));assert.equal(p.d.querySelector('input[type=password]'),null);}finally{p.close();}});

const choose=(p,id,value)=>{const el=p.d.getElementById(id);el.value=value;el.dispatchEvent(new p.w.Event('change',{bubbles:true}));};
test('region country and airport selectors cascade, and France shows only its actual saved route',async()=>{const p=await page();try{await p.ready();const before=p.calls.length;choose(p,'region','유럽');const countries=[...p.d.getElementById('country').options].map(o=>o.value);assert.ok(countries.includes('FR'));assert.ok(!countries.includes('JP'));choose(p,'country','FR');assert.deepEqual([...p.d.getElementById('destination').options].map(o=>o.value),['전체','CDG']);assert.equal(p.d.querySelectorAll('.route-card').length,1);assert.equal(p.d.getElementById('calendar-title').textContent,'파리');assert.equal(p.d.getElementById('stat-routes').textContent,'1');assert.equal(p.calls.length,before);}finally{p.close();}});
test('changing continent clears stale country and airport, then Japan lists its airports only',async()=>{const p=await page();try{await p.ready();choose(p,'region','유럽');choose(p,'country','GB');choose(p,'destination','LHR');choose(p,'region','동북아시아');assert.equal(p.d.getElementById('country').value,'전체');assert.equal(p.d.getElementById('destination').value,'전체');assert.ok(![...p.d.getElementById('country').options].some(o=>o.value==='GB'));choose(p,'country','JP');const airports=[...p.d.getElementById('destination').options].map(o=>o.value);assert.ok(airports.includes('NRT'));assert.ok(airports.includes('KIX'));assert.ok(!airports.includes('PVG'));assert.ok(!airports.includes('CDG'));}finally{p.close();}});
test('airline changes clear unsupported country and airport while keeping supported continent selection',async()=>{const p=await page();try{await p.ready();choose(p,'region','유럽');choose(p,'country','PT');choose(p,'destination','LIS');p.d.getElementById('tab-oz').click();await waitFor(()=>p.d.getElementById('load-status').textContent.includes('104개'));assert.equal(p.d.getElementById('region').value,'유럽');assert.equal(p.d.getElementById('country').value,'전체');assert.equal(p.d.getElementById('destination').value,'전체');assert.ok(![...p.d.getElementById('country').options].some(o=>o.value==='PT'));}finally{p.close();}});
test('a country without saved records has an explicit no-data state rather than a no-seat result',async()=>{const p=await page();try{await p.ready();choose(p,'region','유럽');choose(p,'country','CH');assert.ok([...p.d.getElementById('destination').options].some(o=>o.value==='ZRH'));assert.equal(p.d.querySelectorAll('.route-card').length,0);assert.match(p.d.getElementById('route-list').textContent,/저장 자료가 없어요/);assert.match(p.d.getElementById('route-list').textContent,/실제 좌석 없음이나 비운항을 의미하지 않습니다/);assert.equal(p.d.getElementById('stat-routes').textContent,'0');}finally{p.close();}});

test('route cards label and count every Korean Air type as dates instead of an ambiguous total',async()=>{
 const p=await page();try{await p.ready();const {unpackDocument}=await import('../dist/model.js'),raw=await unpackDocument(ke),start=p.d.getElementById('start').value,end=p.d.getElementById('end').value;
 for(const card of p.d.querySelectorAll('.route-card')){
  const code=card.dataset.code;assert.doesNotMatch(card.textContent,/표시 \d+일/);assert.match(card.textContent,/10월 · 가는 편/);
  for(const [field,label] of [['prestigeAward','프레스티지 보너스'],['prestigeUpgrade','프레스티지 승급'],['firstCombined','퍼스트 보너스·승급 합산']]){
   const observed=Object.values(raw.records).filter(payload=>payload.current.origin==='ICN'&&payload.current.destination===code&&payload.current.month===p.d.getElementById('month').value).flatMap(payload=>payload.current.dates).filter(d=>d.status==='OBSERVED'&&d.date>=start&&d.date<=end);const expected=observed.filter(d=>d[field]).length;
   const row=card.querySelector(`[data-field="${field}"]`);assert.equal(row.querySelector('.type-name').title,label);assert.match(card.querySelector(`[data-total-field="${field}"]`).textContent,new RegExp(label));assert.equal(row.querySelector('strong').textContent,observed.length?`${expected}일`:'미확인');
  }
 }
 assert.match(p.d.querySelector('.list-note').textContent,/좌석 수가 아닌/);
 }finally{p.close();}
});
test('calendar uses readable type chips and month-direction counts that change with direction',async()=>{
 const p=await page();try{await p.ready();choose(p,'destination','LHR');choose(p,'month','2026-11');
 const {unpackDocument}=await import('../dist/model.js'),raw=await unpackDocument(ke);
 for(const [id,origin,destination] of [['direction-out','ICN','LHR'],['direction-back','LHR','ICN']]){
  p.d.getElementById(id).click();const record=raw.records[`${origin}-${destination}-2026-11`].current;
  for(const field of ['prestigeAward','prestigeUpgrade','firstCombined'])assert.equal(p.d.querySelector(`#calendar-counts [data-field="${field}"] strong`).textContent,record.dates.filter(d=>d.status==='OBSERVED'&&d[field]).length+'일');
  assert.match(p.d.getElementById('calendar-count-scope').textContent,id==='direction-out'?/가는 편/:/오는 편/);
  for(const d of record.dates){const button=p.d.querySelector(`[data-date="${d.date}"]`);const expected=d.status==='OBSERVED'?['prestigeAward','prestigeUpgrade','firstCombined'].map((f,i)=>d[f]?['보너스','승급','퍼스트'][i]:null).filter(Boolean):[];assert.deepEqual([...button.querySelectorAll('.day-type')].map(e=>e.textContent),expected);}
 }
 assert.match(p.d.querySelector('.seat-help').textContent,/좌석 업그레이드/);
 }finally{p.close();}
});
test('Asiana cards and month counts show business award and upgrade without first',async()=>{
 const p=await page();try{await p.ready();p.d.getElementById('tab-oz').click();await waitFor(()=>p.d.getElementById('load-status').textContent.includes('104개'));
 for(const card of p.d.querySelectorAll('.route-card')){assert.match(card.textContent,/비즈니스 보너스/);assert.match(card.textContent,/비즈니스 승급/);assert.equal(card.querySelectorAll('.type-count-row').length,2);assert.doesNotMatch(card.textContent,/퍼스트/);}
 assert.equal(p.d.querySelectorAll('#calendar-counts .type-count-row').length,2);
 }finally{p.close();}
});
test('fully unknown saved route displays unconfirmed rather than zero available dates',async()=>{
 const {unpackDocument}=await import('../dist/model.js'),raw=await unpackDocument(ke);
 for(const payload of Object.values(raw.records))for(const d of payload.current.dates){d.status='UNKNOWN';d.prestigeAward=true;}
 const p=await page({keData:raw});try{await p.ready();for(const row of p.d.querySelectorAll('.route-type-counts strong'))assert.equal(row.textContent,'미확인');for(const row of p.d.querySelectorAll('#calendar-counts strong'))assert.equal(row.textContent,'미확인');assert.equal(p.d.querySelectorAll('.day-type').length,0);}finally{p.close();}
});

const assertCountsMatchCells=(p,expected)=>{
 const card=p.d.querySelector('.route-card.selected');assert.ok(card);
 for(const [field,count] of Object.entries(expected)){
  assert.equal(card.querySelector(`[data-field="${field}"] strong`).textContent,count+'일');
  assert.equal(p.d.querySelector(`#calendar-counts [data-field="${field}"] strong`).textContent,count+'일');
  const index=['prestigeAward','prestigeUpgrade','firstCombined'].indexOf(field);
  assert.equal(p.d.querySelectorAll(`#calendar-grid button:not(:disabled) .day-type-${index}`).length,count);
 }
};
test('Rome regression: every displayed monthly and directional count equals its actual calendar markers',async()=>{
 const p=await page();try{await p.ready();choose(p,'destination','FCO');
 const cases=[['2026-10','out',0,1],['2026-11','out',0,0],['2026-12','out',1,1],['2026-10','back',0,0],['2026-11','back',0,2],['2026-12','back',1,2]];
 for(const [month,direction,bonus,upgrade] of cases){choose(p,'month',month);p.d.getElementById('direction-'+direction).click();assertCountsMatchCells(p,{prestigeAward:bonus,prestigeUpgrade:upgrade,firstCombined:0});assert.match(p.d.querySelector('.current-calendar-heading').textContent,new RegExp(Number(month.slice(5))+'월'));assert.match(p.d.querySelector('.current-calendar-heading').textContent,direction==='out'?/가는 편/:/오는 편/);}
 }finally{p.close();}
});
test('month arrows and seat filters update list, matching routes and calendar together',async()=>{
 const p=await page();try{await p.ready();choose(p,'destination','FCO');choose(p,'seat','1');
 assert.equal(p.d.querySelectorAll('.route-card.selected .type-count-row').length,1);assert.equal(p.d.querySelectorAll('#calendar-counts .type-count-row').length,1);
 assertCountsMatchCells(p,{prestigeUpgrade:1});p.d.getElementById('next-month').click();assertCountsMatchCells(p,{prestigeUpgrade:0});p.d.getElementById('next-month').click();assertCountsMatchCells(p,{prestigeUpgrade:1});p.d.getElementById('prev-month').click();
 p.d.getElementById('only-marked').checked=true;p.d.getElementById('only-marked').dispatchEvent(new p.w.Event('change',{bubbles:true}));assert.equal(p.d.querySelectorAll('.route-card').length,1);assertCountsMatchCells(p,{prestigeUpgrade:0});
 p.d.getElementById('direction-back').click();assert.equal(p.d.querySelectorAll('.route-card').length,1);assertCountsMatchCells(p,{prestigeUpgrade:2});assert.equal(p.d.querySelectorAll('#calendar-grid .day-type-0').length,0);
 }finally{p.close();}
});
test('partial date ranges hide out-of-range markers and use the same clipped counts everywhere',async()=>{
 const p=await page();try{await p.ready();choose(p,'destination','FCO');p.d.getElementById('start').value='2026-11-26';p.d.getElementById('end').value='2026-12-02';p.d.getElementById('search-form').dispatchEvent(new p.w.Event('submit',{bubbles:true,cancelable:true}));p.d.getElementById('direction-back').click();
 assertCountsMatchCells(p,{prestigeAward:0,prestigeUpgrade:1,firstCombined:0});assert.equal(p.d.querySelector('[data-date="2026-11-25"] .day-type'),null);assert.match(p.d.querySelector('[data-date="2026-11-25"]').textContent,/기간 밖/);
 p.d.getElementById('next-month').click();assertCountsMatchCells(p,{prestigeAward:0,prestigeUpgrade:1,firstCombined:0});assert.equal(p.d.querySelector('[data-date="2026-12-17"] .day-type'),null);
 }finally{p.close();}
});

const readTotals=p=>Object.fromEntries([...p.d.querySelectorAll('.route-card.selected [data-total-field]')].map(row=>[row.dataset.totalField,{out:row.querySelector('[data-direction="out"]').textContent,back:row.querySelector('[data-direction="back"]').textContent}]));
test('Rome shows full-period outbound and inbound totals separately while monthly calendar counts still match',async()=>{
 const p=await page();try{await p.ready();choose(p,'destination','FCO');
 const expected={prestigeAward:{out:'1일',back:'1일'},prestigeUpgrade:{out:'2일',back:'4일'},firstCombined:{out:'0일',back:'0일'}};
 assert.deepEqual(readTotals(p),expected);assert.match(p.d.getElementById('route-scope').textContent,/전체 기간/);assert.match(p.d.getElementById('route-scope').textContent,/2026-12-17/);
 for(const month of ['2026-11','2026-12'])for(const direction of ['out','back']){choose(p,'month',month);p.d.getElementById('direction-'+direction).click();assert.deepEqual(readTotals(p),expected);}
 assertCountsMatchCells(p,{prestigeAward:1,prestigeUpgrade:2,firstCombined:0});
 p.d.getElementById('start').value='2026-11-26';p.d.getElementById('end').value='2026-12-02';p.d.getElementById('search-form').dispatchEvent(new p.w.Event('submit',{bubbles:true,cancelable:true}));
 assert.deepEqual(readTotals(p),{prestigeAward:{out:'0일',back:'0일'},prestigeUpgrade:{out:'0일',back:'2일'},firstCombined:{out:'0일',back:'0일'}});
 choose(p,'seat','1');assert.deepEqual(readTotals(p),{prestigeUpgrade:{out:'0일',back:'2일'}});
 }finally{p.close();}
});
test('a missing inbound direction stays unconfirmed without erasing verified outbound totals',async()=>{
 const {unpackDocument}=await import('../dist/model.js'),raw=await unpackDocument(ke);for(const key of Object.keys(raw.records))if(key.startsWith('FCO-ICN-'))delete raw.records[key];
 const p=await page({keData:raw});try{await p.ready();choose(p,'destination','FCO');assert.deepEqual(readTotals(p),{prestigeAward:{out:'1일',back:'미확인'},prestigeUpgrade:{out:'2일',back:'미확인'},firstCombined:{out:'0일',back:'미확인'}});}finally{p.close();}
});
test('Asiana full-period columns count business award and upgrade independently in both directions',async()=>{
 const p=await page();try{await p.ready();p.d.getElementById('tab-oz').click();await waitFor(()=>p.d.getElementById('load-status').textContent.includes('104개'));
 const {unpackDocument}=await import('../dist/model.js'),raw=await unpackDocument(oz),start=p.d.getElementById('start').value,end=p.d.getElementById('end').value;
 for(const card of p.d.querySelectorAll('.route-card')){assert.equal(card.querySelectorAll('[data-total-field]').length,2);assert.equal(card.querySelector('[data-total-field="firstCombined"]'),null);
  for(const field of ['prestigeAward','prestigeUpgrade'])for(const direction of ['out','back']){const observed=Object.values(raw.records).filter(x=>direction==='out'?x.current.origin==='ICN'&&x.current.destination===card.dataset.code:x.current.origin===card.dataset.code&&x.current.destination==='ICN').flatMap(x=>x.current.dates).filter(d=>d.status==='OBSERVED'&&d.date>=start&&d.date<=end);assert.equal(card.querySelector(`[data-total-field="${field}"] [data-direction="${direction}"]`).textContent,observed.length?observed.filter(d=>d[field]).length+'일':'미확인');}
 }
 }finally{p.close();}
});

test('refresh failure retains previously verified route calendars instead of clearing them',async()=>{
 const p=await page();try{await p.ready();const count=p.d.querySelectorAll('.route-card').length;assert.ok(count>0);p.denyKorean();p.d.getElementById('refresh').click();await waitFor(()=>!p.d.getElementById('refresh').disabled);assert.equal(p.d.querySelectorAll('.route-card').length,count);assert.equal(p.d.getElementById('notice').hidden,false);assert.ok(p.d.querySelectorAll('#calendar-grid button').length>0);}finally{p.close();}
});

test('Vietnam Airlines official lookup preserves the selected saved calendar and makes no requests',async()=>{
 const p=await page();try{
  await p.ready();choose(p,'destination','FCO');choose(p,'month','2026-11');p.d.getElementById('direction-back').click();
  const before={calls:p.calls.length,title:p.d.getElementById('calendar-title').textContent,grid:p.d.getElementById('calendar-grid').innerHTML,cards:p.d.getElementById('route-list').innerHTML,month:p.d.getElementById('month').value};
  const button=p.d.getElementById('vn-lookup');assert.equal(button.closest('[role="tablist"]'),null);assert.equal(button.getAttribute('role'),null);assert.equal(button.dataset.carrier,undefined);assert.equal(button.getAttribute('aria-haspopup'),'dialog');
  button.click();const dialog=p.d.getElementById('vn-dialog');assert.equal(dialog.open,true);assert.equal(dialog.getAttribute('aria-labelledby'),'vn-title');assert.match(dialog.textContent,/Lotusmiles 로그인/);assert.match(dialog.textContent,/자동 수집·저장 달력은 현재 지원하지 않습니다/);
  assert.match(dialog.querySelector('#vn-award-link').textContent,/보너스 항공권.*마일리지로 새 항공권 발권/s);assert.match(dialog.querySelector('#vn-upgrade-link').textContent,/좌석 승급.*보유 항공권을 상위 좌석/s);
  const expected={
   'vn-award-link':'https://www.vietnamairlines.com/kr/ko/lotusmiles/redeem-mile/ticket-awards/how-to-redeem-miles',
   'vn-upgrade-link':'https://www.vietnamairlines.com/kr/ko/lotusmiles/redeem-mile/upgrade-awards',
   'vn-home-link':'https://www.vietnamairlines.com/kr/ko/home'
  };
  for(const [id,url] of Object.entries(expected)){const a=p.d.getElementById(id);assert.equal(a.href,url);assert.equal(a.target,'_blank');assert.ok(a.relList.contains('noopener'));assert.ok(a.relList.contains('noreferrer'));}
  assert.equal(dialog.querySelector('input'),null);assert.equal(dialog.querySelector('form').getAttribute('method'),'dialog');assert.equal(dialog.querySelector('.dialog-close').getAttribute('aria-label'),'베트남항공 안내 닫기');
  // Escape uses the browser's native cancel default action; the app must not prevent it.
  const cancel=new p.w.Event('cancel',{cancelable:true});dialog.dispatchEvent(cancel);assert.equal(cancel.defaultPrevented,false);
  dialog.close();dialog.dispatchEvent(new p.w.Event('close'));assert.equal(dialog.open,false);assert.equal(p.d.activeElement,button);
  assert.equal(p.calls.length,before.calls);assert.equal(p.d.getElementById('calendar-title').textContent,before.title);assert.equal(p.d.getElementById('calendar-grid').innerHTML,before.grid);assert.equal(p.d.getElementById('route-list').innerHTML,before.cards);assert.equal(p.d.getElementById('month').value,before.month);assert.equal(p.d.getElementById('tab-ke').getAttribute('aria-selected'),'true');
 }finally{p.close();}
});
test('Vietnam Airlines guide leaves Asiana active without fetching a VN dataset',async()=>{
 const p=await page();try{await p.ready();p.d.getElementById('tab-oz').click();await waitFor(()=>p.d.getElementById('load-status').textContent.includes('104개'));const before=p.calls.length,calendar=p.d.getElementById('calendar-grid').innerHTML;p.d.getElementById('vn-lookup').click();assert.equal(p.d.getElementById('tab-oz').getAttribute('aria-selected'),'true');assert.equal(p.d.getElementById('tab-ke').getAttribute('aria-selected'),'false');assert.equal(p.d.querySelector('[data-carrier="VN"]'),null);assert.equal(p.calls.length,before);assert.equal(p.d.getElementById('calendar-grid').innerHTML,calendar);}finally{p.close();}
});
