const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require(process.env.JSDOM_MODULE||'jsdom');
const script=fs.readFileSync(path.join(__dirname,'../dist/blog.js'),'utf8');
const BLOG='https://blog.naver.com/mkj2449',LIVE='https://korea-futures-cloudflare.pages.dev/api/tongsky-blog';
const post=(id,day=id,title='글 '+id)=>({url:BLOG+'/'+id,title,publishedAt:`2026-11-${String(day).padStart(2,'0')}T00:00:00Z`});
const feed=posts=>({schema:1,blogUrl:BLOG,posts});
const pause=()=>new Promise(resolve=>setImmediate(resolve));
async function flush(){await pause();await pause();}
function harness(fetcher,{hiddenBoot=false}={}){
 const dom=new JSDOM(`<div id="app-screen" ${hiddenBoot?'hidden':''}></div><main class="page-columns"><div class="results-layout"><section class="routes-panel"></section><section class="calendar-panel"></section></div><aside id="developer-blog"><p data-blog-status>불러오는 중</p><ul data-blog-posts></ul></aside></main>`,{url:'https://example.test/',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,intervals=[],calls=[];let now=1000000;
 w.Date.now=()=>now;w.matchMedia=()=>({matches:false,addEventListener(){}});w.setInterval=(fn,ms)=>{intervals.push({fn,ms});return intervals.length;};
 w.fetch=async(url,options)=>{calls.push({url,options});return fetcher(url,options);};w.eval(script);
 return {w,calls,intervals,close:()=>w.close(),links:()=>[...w.document.querySelectorAll('.blog-post-link')],status:()=>w.document.querySelector('[data-blog-status]'),advance:ms=>{now+=ms;},tick:()=>intervals[0].fn()};
}
test('fetch starts once after calendar boot and uses a credential-free fresh endpoint',async()=>{
 const h=harness(async()=>Response.json(feed([post(3),post(2),post(1)])),{hiddenBoot:true});try{await flush();assert.equal(h.calls.length,0);h.w.document.getElementById('app-screen').hidden=false;await flush();assert.equal(h.calls.length,1);assert.equal(h.calls[0].url,LIVE);assert.equal(h.calls[0].options.credentials,'omit');assert.equal(h.calls[0].options.cache,'no-store');assert.equal(h.links().length,3);assert.equal(h.intervals[0].ms,300000);}finally{h.close();}
});
test('an open visible page refreshes the latest list on its five-minute timer',async()=>{
 let posts=[post(3),post(2),post(1)];const h=harness(async()=>Response.json(feed(posts)));try{await flush();posts=[post(4),post(3),post(2)];h.advance(300000);h.tick();await flush();assert.equal(h.calls.length,2);assert.equal(h.links()[0].href,BLOG+'/4');assert.equal(h.status().hidden,true);}finally{h.close();}
});
test('hidden pages skip polling and refresh on return, without duplicate focus requests',async()=>{
 const h=harness(async()=>Response.json(feed([post(3),post(2),post(1)])));try{await flush();Object.defineProperty(h.w.document,'hidden',{value:true,configurable:true});h.advance(300000);h.tick();await flush();assert.equal(h.calls.length,1);Object.defineProperty(h.w.document,'hidden',{value:false,configurable:true});h.w.document.dispatchEvent(new h.w.Event('visibilitychange'));h.w.dispatchEvent(new h.w.Event('focus'));await flush();assert.equal(h.calls.length,2);h.advance(10000);h.w.dispatchEvent(new h.w.Event('focus'));await flush();assert.equal(h.calls.length,2);}finally{h.close();}
});
test('a slow request cannot overlap timer and focus refreshes',async()=>{
 let release;const h=harness(()=>new Promise(resolve=>{release=resolve;}));try{h.advance(300000);h.tick();h.w.dispatchEvent(new h.w.Event('focus'));await flush();assert.equal(h.calls.length,1);release(Response.json(feed([post(3),post(2),post(1)])));await flush();assert.equal(h.links().length,3);}finally{h.close();}
});
test('upstream failure uses the saved list and makes its fallback status visible',async()=>{
 const h=harness(async url=>url===LIVE?new Response('',{status:503}):Response.json(feed([post(3),post(2),post(1)])));try{await flush();assert.equal(h.calls.length,2);assert.match(h.calls[1].url,/blog-feed\.json\?refresh=/);assert.equal(h.links().length,3);assert.equal(h.status().hidden,false);assert.match(h.status().textContent,/저장된 목록/);}finally{h.close();}
});
test('an older fallback never overwrites newer posts already displayed',async()=>{
 let outage=false;const h=harness(async url=>!outage?Response.json(feed([post(5),post(4),post(3)])):url===LIVE?new Response('',{status:503}):Response.json(feed([post(3),post(2),post(1)])));try{await flush();const oldNode=h.links()[0];outage=true;h.advance(300000);h.tick();await flush();assert.equal(h.links()[0],oldNode);assert.equal(h.links()[0].href,BLOG+'/5');assert.equal(h.status().hidden,false);}finally{h.close();}
});
test('failed live and saved sources preserve the last valid displayed list',async()=>{
 let outage=false;const h=harness(async()=>outage?new Response('',{status:503}):Response.json(feed([post(3),post(2),post(1)])));try{await flush();outage=true;h.advance(300000);h.tick();await flush();assert.equal(h.links().length,3);assert.match(h.status().textContent,/마지막으로 불러온/);}finally{h.close();}
});
test('initial feed failure remains isolated and reports a readable error',async()=>{
 const h=harness(async()=>new Response('',{status:503}));try{await flush();assert.equal(h.links().length,0);assert.equal(h.status().hidden,false);assert.match(h.status().textContent,/불러오지 못했어요/);assert.equal(h.w.document.getElementById('app-screen').hidden,false);}finally{h.close();}
});
test('invalid live payloads fall back instead of showing an empty success',async()=>{
 const h=harness(async url=>Response.json(url===LIVE?feed([]):feed([post(3),post(2),post(1)])));try{await flush();assert.equal(h.calls.length,2);assert.equal(h.links().length,3);}finally{h.close();}
});
test('posts are dated, sorted, deduplicated, account-restricted and rendered as text',async()=>{
 const posts=[post(1),post(3,3,'<img src=x onerror=alert(1)>'),post(3),post(2),{...post(9),url:'https://evil.example/9'},{...post(8),publishedAt:'bad'}];
 const h=harness(async()=>Response.json(feed(posts)));try{await flush();assert.deepEqual(h.links().map(a=>a.href),[3,2,1].map(n=>BLOG+'/'+n));assert.equal(h.w.document.querySelectorAll('img').length,0);assert.match(h.links()[0].textContent,/<img/);}finally{h.close();}
});
test('unchanged results retain the DOM links and keyboard focus',async()=>{
 const h=harness(async()=>Response.json(feed([post(3),post(2),post(1)])));try{await flush();const link=h.links()[0];link.focus();h.advance(300000);h.tick();await flush();assert.equal(h.links()[0],link);assert.equal(h.w.document.activeElement,link);}finally{h.close();}
});
