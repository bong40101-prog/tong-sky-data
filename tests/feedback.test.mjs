import test from 'node:test';import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';import{JSDOM}from'jsdom';import{setupFeedback}from'../dist/feedback.js';
test('feedback opens, submits privately and reports success only after server acceptance',async()=>{
 const dom=new JSDOM(await readFile(new URL('../dist/index.html',import.meta.url),'utf8'),{url:'https://bong40101-prog.github.io/tong-sky-data/'}),d=dom.window.document,dialog=d.getElementById('feedback-dialog');dialog.showModal=()=>dialog.setAttribute('open','');dialog.close=()=>dialog.removeAttribute('open');let requests=[];
 setupFeedback({document:d,getContext:()=>({carrier:'KE',destination:'ORD',month:'2027-02'}),fetcher:async(url,options)=>{requests.push({url,options});return Response.json({ok:true,id:JSON.parse(options.body).id},{status:202});}});
 d.getElementById('feedback-open').click();assert.ok(dialog.hasAttribute('open'));const form=d.getElementById('feedback-form');form.elements.title.value='시카고 확인 필요';form.elements.message.value='2월 일요일 표식을 확인해 주세요.';
 form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await new Promise(r=>setTimeout(r,0));assert.equal(requests.length,1);const req=requests[0],body=JSON.parse(req.options.body);assert.equal(body.context.destination,'ORD');assert.equal(req.options.credentials,'omit');assert.equal(req.options.referrerPolicy,'no-referrer');assert.equal(req.options.headers.Authorization,undefined);assert.match(d.getElementById('feedback-status').textContent,/접수되었습니다/);assert.equal(dom.window.localStorage.length,0);dom.window.close();
});
test('failed submission keeps text and retries the same request id without a false success',async()=>{
 const dom=new JSDOM(await readFile(new URL('../dist/index.html',import.meta.url),'utf8')),d=dom.window.document,ids=[];
 setupFeedback({document:d,fetcher:async(url,options)=>{ids.push(JSON.parse(options.body).id);return Response.json({error:'failed'},{status:503});}});const form=d.getElementById('feedback-form');form.elements.title.value='저장 오류';form.elements.message.value='작성 내용 보존 테스트';
 for(let n=0;n<2;n++){form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await new Promise(r=>setTimeout(r,0));}
 assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);assert.equal(form.elements.message.value,'작성 내용 보존 테스트');assert.match(d.getElementById('feedback-status').textContent,/접수하지 못했습니다/);assert.equal(d.getElementById('feedback-send').disabled,false);dom.window.close();
});
