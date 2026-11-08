import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {createNoticeController} from '../dist/notices.js';
const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
const NEW='asiana-query-limit-20261109',IDS=[NEW,'operator','excluded-region','feedback','recommendations'];
function page(storage){
 const dom=new JSDOM(html);const d=dom.window.document;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const controller=createNoticeController({document:d,storage});controller.show();
 return {dom,d,controller,opened:()=>[...d.querySelectorAll('.announcement-dialog[open]')].map(x=>x.dataset.noticeId),click:(id,cls)=>d.querySelector(`#announcement-${id} .${cls}`).click()};
}
test('five independent notices appear in order with the new advisory first',()=>{
 const p=page(null);try{
  assert.equal(p.d.querySelectorAll('main .operator-notice').length,0);
  assert.equal(p.d.querySelectorAll('.announcement-dialog').length,5);
  for(const [index,id] of IDS.entries()){
   assert.deepEqual(p.opened(),[id]);assert.equal(p.d.querySelector(`#announcement-${id} .announcement-count`).textContent,`공지 ${index+1} / 5`);p.click(id,'notice-close');
  }
  assert.deepEqual(p.opened(),[]);p.controller.show();assert.deepEqual(p.opened(),[]);
  const link=p.d.querySelector(`#announcement-${NEW} a`);
  assert.equal(new URL(link.href).hostname,'flyasiana.com');assert.equal(new URL(link.href).searchParams.get('id'),'CM202610140002530842');
 }finally{p.dom.window.close();}
});
test('never-show persists independently; ordinary close and saved calendar data are preserved',()=>{
 const values=new Map([['calendar','keep']]),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 let p=page(storage);try{for(const id of IDS)p.click(id,id==='excluded-region'?'notice-close':'notice-dismiss');assert.deepEqual(p.opened(),[]);}finally{p.dom.window.close();}
 p=page(storage);try{assert.deepEqual(p.opened(),['excluded-region']);p.click('excluded-region','notice-dismiss');assert.deepEqual(p.opened(),[]);}finally{p.dom.window.close();}
 p=page(storage);try{assert.deepEqual(p.opened(),[]);assert.equal(values.get('calendar'),'keep');assert.equal(values.size,6);}finally{p.dom.window.close();}
});
test('escape advances without saving a permanent dismissal',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},p=page(storage);try{
  const event=new p.dom.window.Event('cancel',{cancelable:true});p.d.getElementById('announcement-'+NEW).dispatchEvent(event);assert.equal(event.defaultPrevented,true);assert.deepEqual(p.opened(),['operator']);assert.equal(values.size,0);
 }finally{p.dom.window.close();}
});
test('denied storage reports failed permanent dismissal and still allows ordinary close',()=>{
 const storage={getItem(){throw Error('denied');},setItem(){throw Error('quota');}},p=page(storage);try{
  p.click(NEW,'notice-dismiss');assert.deepEqual(p.opened(),[NEW]);assert.equal(p.d.querySelector(`#announcement-${NEW} .notice-save-status`).hidden,false);assert.match(p.d.querySelector(`#announcement-${NEW} .notice-save-status`).textContent,/저장하지 못했습니다/);
  p.click(NEW,'notice-close');assert.deepEqual(p.opened(),['operator']);
 }finally{p.dom.window.close();}
});
test('old permanent dismissals stay hidden; only the new Asiana advisory appears',()=>{
 const ids=['operator','ke-range','excluded-region','feedback','recommendations'];
 const values=new Map(ids.map(id=>['tongsky.notice.dismissed.v1.'+id,'1']));
 const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 let p=page(storage);try{assert.deepEqual(p.opened(),[NEW]);p.click(NEW,'notice-close');assert.deepEqual(p.opened(),[]);}finally{p.dom.window.close();}
 p=page(storage);try{assert.deepEqual(p.opened(),[NEW]);p.click(NEW,'notice-dismiss');assert.deepEqual(p.opened(),[]);}finally{p.dom.window.close();}
 p=page(storage);try{assert.deepEqual(p.opened(),[]);for(const id of ids)assert.equal(values.get('tongsky.notice.dismissed.v1.'+id),'1');}finally{p.dom.window.close();}
});
