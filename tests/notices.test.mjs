import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {createNoticeController} from '../dist/notices.js';
const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
function page(storage){
 const dom=new JSDOM(html);const d=dom.window.document;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const controller=createNoticeController({document:d,storage});controller.show();
 return {dom,d,controller,opened:()=>[...d.querySelectorAll('.announcement-dialog[open]')].map(x=>x.dataset.noticeId),click:(id,cls)=>d.querySelector(`#announcement-${id} .${cls}`).click()};
}
test('four notices are separate dialogs outside main, shown one at a time in order',()=>{
 const p=page(null);try{
  assert.equal(p.d.querySelectorAll('main .operator-notice').length,0);assert.equal(p.d.querySelectorAll('.announcement-dialog').length,4);assert.deepEqual(p.opened(),['operator']);
  p.click('operator','notice-close');assert.deepEqual(p.opened(),['excluded-region']);p.click('excluded-region','notice-close');assert.deepEqual(p.opened(),['feedback']);p.click('feedback','notice-close');assert.deepEqual(p.opened(),['recommendations']);p.click('recommendations','notice-close');assert.deepEqual(p.opened(),[]);
  p.controller.show();assert.deepEqual(p.opened(),[]);
 }finally{p.dom.window.close();}
});
test('never-show persists each notice independently; ordinary close does not persist, and saved calendar keys stay untouched',()=>{
 const values=new Map([['calendar','keep']]),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 let p=page(storage);try{p.click('operator','notice-dismiss');p.click('excluded-region','notice-close');assert.deepEqual(p.opened(),['feedback']);p.click('feedback','notice-dismiss');assert.deepEqual(p.opened(),['recommendations']);p.click('recommendations','notice-dismiss');assert.deepEqual(p.opened(),[]);}finally{p.dom.window.close();}
 p=page(storage);try{assert.deepEqual(p.opened(),['excluded-region']);p.click('excluded-region','notice-dismiss');assert.deepEqual(p.opened(),[]);}finally{p.dom.window.close();}
 p=page(storage);try{assert.deepEqual(p.opened(),[]);assert.equal(values.get('calendar'),'keep');assert.equal(values.size,5);}finally{p.dom.window.close();}
});
test('escape advances without saving a permanent dismissal',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},p=page(storage);try{
  const event=new p.dom.window.Event('cancel',{cancelable:true});p.d.getElementById('announcement-operator').dispatchEvent(event);assert.equal(event.defaultPrevented,true);assert.deepEqual(p.opened(),['excluded-region']);assert.equal(values.size,0);
 }finally{p.dom.window.close();}
});
test('denied storage reports failed permanent dismissal and still allows ordinary close',()=>{
 const storage={getItem(){throw Error('denied');},setItem(){throw Error('quota');}},p=page(storage);try{
  p.click('operator','notice-dismiss');assert.deepEqual(p.opened(),['operator']);assert.equal(p.d.querySelector('#announcement-operator .notice-save-status').hidden,false);assert.match(p.d.querySelector('#announcement-operator .notice-save-status').textContent,/저장하지 못했습니다/);
  p.click('operator','notice-close');assert.deepEqual(p.opened(),['excluded-region']);
 }finally{p.dom.window.close();}
});

test('prior permanent dismissals survive removal and only the undismissed recommendations notice appears',()=>{
 const ids=['operator','ke-range','excluded-region','feedback'];
 const values=new Map(ids.map(id=>['tongsky.notice.dismissed.v1.'+id,'1']));
 const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 let p=page(storage);try{assert.deepEqual(p.opened(),['recommendations']);p.click('recommendations','notice-close');assert.deepEqual(p.opened(),[]);}finally{p.dom.window.close();}
 p=page(storage);try{assert.deepEqual(p.opened(),['recommendations']);p.click('recommendations','notice-dismiss');assert.deepEqual(p.opened(),[]);}finally{p.dom.window.close();}
 p=page(storage);try{assert.deepEqual(p.opened(),[]);for(const id of ids)assert.equal(values.get('tongsky.notice.dismissed.v1.'+id),'1');}finally{p.dom.window.close();}
});
