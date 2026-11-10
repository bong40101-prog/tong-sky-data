import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {createNoticeController} from '../dist/notices.js';
const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
const NEW='daily-route-refresh',ASIANA='asiana-query-limit-20261109',IDS=[NEW,ASIANA,'operator','excluded-region','feedback','recommendations'];
function page(storage){
 const dom=new JSDOM(html);const d=dom.window.document;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const controller=createNoticeController({document:d,storage});controller.show();
 return {dom,d,controller,opened:()=>[...d.querySelectorAll('.announcement-dialog[open]')].map(x=>x.dataset.noticeId),click:(id,cls)=>d.querySelector(`#announcement-${id} .${cls}`).click()};
}
test('six independent notices appear in order with the daily update notice first',()=>{
 const p=page(null);try{
  assert.equal(p.d.querySelectorAll('main .operator-notice').length,0);
  assert.equal(p.d.querySelectorAll('.announcement-dialog').length,6);
  for(const [index,id] of IDS.entries()){
   assert.deepEqual(p.opened(),[id]);assert.equal(p.d.querySelector(`#announcement-${id} .announcement-count`).textContent,`공지 ${index+1} / ${IDS.length}`);p.click(id,'notice-close');
  }
  assert.deepEqual(p.opened(),[]);p.controller.show();assert.deepEqual(p.opened(),[]);
  assert.match(p.d.querySelector(`#announcement-${NEW} .announcement-body`).textContent,/매일 00시\(한국시간\)에 노선 정보가 자동으로 최신화됩니다/);
  const link=p.d.querySelector(`#announcement-${ASIANA} a`);
  assert.equal(new URL(link.href).hostname,'flyasiana.com');assert.equal(new URL(link.href).searchParams.get('id'),'CM202610140002530842');
 }finally{p.dom.window.close();}
});
test('never-show persists independently; ordinary close and saved calendar data are preserved',()=>{
 const values=new Map([['calendar','keep']]),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 let p=page(storage);try{for(const id of IDS)p.click(id,id==='excluded-region'?'notice-close':'notice-dismiss');assert.deepEqual(p.opened(),[]);}finally{p.dom.window.close();}
 p=page(storage);try{assert.deepEqual(p.opened(),['excluded-region']);p.click('excluded-region','notice-dismiss');assert.deepEqual(p.opened(),[]);}finally{p.dom.window.close();}
 p=page(storage);try{assert.deepEqual(p.opened(),[]);assert.equal(values.get('calendar'),'keep');assert.equal(values.size,IDS.length+1);}finally{p.dom.window.close();}
});
test('escape advances without saving a permanent dismissal',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},p=page(storage);try{
  const event=new p.dom.window.Event('cancel',{cancelable:true});p.d.getElementById('announcement-'+NEW).dispatchEvent(event);assert.equal(event.defaultPrevented,true);assert.deepEqual(p.opened(),[ASIANA]);assert.equal(values.size,0);
 }finally{p.dom.window.close();}
});
test('denied storage reports failed permanent dismissal and still allows ordinary close',()=>{
 const storage={getItem(){throw Error('denied');},setItem(){throw Error('quota');}},p=page(storage);try{
  p.click(NEW,'notice-dismiss');assert.deepEqual(p.opened(),[NEW]);assert.equal(p.d.querySelector(`#announcement-${NEW} .notice-save-status`).hidden,false);assert.match(p.d.querySelector(`#announcement-${NEW} .notice-save-status`).textContent,/저장하지 못했습니다/);
  p.click(NEW,'notice-close');assert.deepEqual(p.opened(),[ASIANA]);
 }finally{p.dom.window.close();}
});
test('old permanent dismissals stay hidden; only the new daily update notice appears',()=>{
 const ids=[ASIANA,'operator','ke-range','excluded-region','feedback','recommendations'];
 const values=new Map(ids.map(id=>['tongsky.notice.dismissed.v1.'+id,'1']));
 const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 let p=page(storage);try{assert.deepEqual(p.opened(),[NEW]);p.click(NEW,'notice-close');assert.deepEqual(p.opened(),[]);}finally{p.dom.window.close();}
 p=page(storage);try{assert.deepEqual(p.opened(),[NEW]);p.click(NEW,'notice-dismiss');assert.deepEqual(p.opened(),[]);}finally{p.dom.window.close();}
 p=page(storage);try{assert.deepEqual(p.opened(),[]);for(const id of ids)assert.equal(values.get('tongsky.notice.dismissed.v1.'+id),'1');}finally{p.dom.window.close();}
});
