import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {JSDOM} from 'jsdom';import {setupTripSearch} from '../dist/trip-ui.js';
const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
test('IN/OUT selectors default to all, filter separately, and clear unsupported cities on region or airline change',()=>{
 const dom=new JSDOM(html),d=dom.window.document;dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const catalogs={KE:{regions:{유럽:[{code:'AMS',name:'암스테르담'},{code:'FRA',name:'프랑크푸르트'}],미주:[{code:'JFK',name:'뉴욕'}]}},OZ:{regions:{유럽:[{code:'CDG',name:'파리'},{code:'FRA',name:'프랑크푸르트'}],미주:[{code:'JFK',name:'뉴욕'}]}}};
 const getData=carrier=>({catalog:catalogs[carrier],origin:'ICN',today:'2026-11-03',end:'2027-10-28',routes:Object.entries(catalogs[carrier].regions).flatMap(([region,cities])=>cities.map(city=>({...city,region,legs:Object.fromEntries(['out','back'].map(direction=>[direction,new Map([['2026-11',{carrier,month:'2026-11',success:1,dates:[{date:direction==='out'?'2026-11-10':'2026-11-16',status:'OBSERVED',prestigeAward:true,prestigeUpgrade:true}]}]])]))}))) });
 const choose=(id,value)=>{d.getElementById(id).value=value;d.getElementById(id).dispatchEvent(new dom.window.Event('change'));};const cards=()=>[...d.querySelectorAll('.trip-card')];
 try{
  setupTripSearch({document:d,getData});d.getElementById('recommend-ke').click();assert.equal(d.getElementById('trip-in').value,'');assert.equal(d.getElementById('trip-out').value,'');assert.equal(cards().length,12);
  choose('trip-in','FRA');assert.equal(cards().length,6);assert.ok(cards().every(c=>c.dataset.outCode==='FRA'));assert.equal(new Set(cards().map(c=>c.dataset.backCode)).size,2);
  choose('trip-out','AMS');assert.equal(cards().length,3);assert.ok(cards().every(c=>c.dataset.outCode==='FRA'&&c.dataset.backCode==='AMS'));
  choose('trip-in','');assert.equal(cards().length,6);assert.ok(cards().every(c=>c.dataset.backCode==='AMS'));
  choose('trip-region','미주');assert.equal(d.getElementById('trip-in').value,'');assert.equal(d.getElementById('trip-out').value,'');assert.equal(cards().length,3);assert.ok(cards().every(c=>c.dataset.outCode==='JFK'&&c.dataset.backCode==='JFK'));
  choose('trip-region','유럽');choose('trip-in','AMS');d.getElementById('trip-close').click();d.getElementById('recommend-oz').click();assert.equal(d.getElementById('trip-in').value,'');assert.equal(cards().length,12);assert.ok(![...d.getElementById('trip-in').options].some(o=>o.value==='AMS'));
  choose('trip-in','FRA');choose('trip-out','FRA');assert.equal(cards().length,3);assert.ok(cards().every(c=>c.dataset.outCode==='FRA'&&c.dataset.backCode==='FRA'));assert.match(d.querySelector('.trip-footnote').textContent,/좌석 수와 인원별 예약 가능 여부는 제공되지 않습니다/);
 }finally{dom.window.close();}
});
