const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),evidence=path.join(root,'test-evidence');fs.mkdirSync(evidence,{recursive:true});
const server=spawn('python3',['-m','http.server','8148','--bind','127.0.0.1','--directory',path.join(root,'dist')],{stdio:'ignore'});
const BLOG='https://m.blog.naver.com/mkj2449/224469201430';
const results=[];
async function setup(page,{mockBlog=true,failedBlog=false}={}){
 await page.addInitScript(()=>{for(const id of ['operator','excluded-region','feedback','recommendations'])localStorage.setItem('tongsky.notice.dismissed.v1.'+id,'1');});
 await page.route('https://korea-futures-cloudflare.pages.dev/**',r=>r.abort());
 await page.route('https://raw.githubusercontent.com/**',route=>{
  const u=new URL(route.request().url());
  if(u.pathname.endsWith('/europe.json'))return route.fulfill({contentType:'application/json',body:fs.readFileSync(path.join(root,'tests/current-europe.json'))});
  if(u.pathname.endsWith('/asiana.json'))return route.fulfill({contentType:'application/json',body:fs.readFileSync(path.join(root,'tests/asiana-packed.json'))});
  return route.fulfill({status:404,contentType:'application/json',body:'{}'});
 });
 if(mockBlog)await page.route('https://m.blog.naver.com/**',r=>failedBlog?r.abort():r.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><title>ENYA · 블로그 화면 테스트</title><body style="font:14px sans-serif;padding:16px;color:#333"><p>네이버 블로그 원본 화면</p><h2>ENYA</h2><p>블로그 영역 레이아웃 확인용 화면</p></body></html>'}));
 await page.goto('http://127.0.0.1:8148/',{waitUntil:'domcontentloaded'});
 await page.locator('#app-screen').waitFor({state:'visible'});
 for(const dialog of await page.locator('.announcement-dialog[open]').all())await dialog.locator('.notice-close').click();
}
(async()=>{
 let browser;
 try{
  for(let i=0;i<50;i++){try{const r=await fetch('http://127.0.0.1:8148/');if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({headless:true});
  for(const [width,height] of [[1920,1080],[1728,900],[1440,720],[1280,900],[761,900],[760,900],[420,850],[390,844],[320,740]]){
   const page=await browser.newPage({viewport:{width,height},locale:'ko-KR'}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));await setup(page);
   const geometry=await page.evaluate(()=>{const a=document.querySelector('.calendar-content').getBoundingClientRect(),b=document.getElementById('developer-blog').getBoundingClientRect(),r=document.querySelector('.routes-panel').getBoundingClientRect(),c=document.querySelector('.calendar-panel').getBoundingClientRect();return {main:{x:a.x,y:a.y,width:a.width,bottom:a.bottom},blog:{x:b.x,y:b.y,width:b.width,bottom:b.bottom},routesBottom:r.bottom,calendarTop:c.top,pageWidth:document.documentElement.scrollWidth,viewport:innerWidth,routeCount:document.getElementById('route-count').textContent};});
   assert(geometry.pageWidth<=width+1,'horizontal overflow');
   if(width>=1440)assert(geometry.blog.x>=geometry.main.x+geometry.main.width,'blog must be on right');
   else if(width<=760){assert(geometry.blog.y>=geometry.routesBottom,'mobile blog must follow the full route panel');assert(geometry.blog.bottom<=geometry.calendarTop,'mobile blog and Pickle must precede calendar');}
   else assert(geometry.blog.y>=geometry.main.bottom,'blog must follow calendar on tablet screens');
   assert(Number(geometry.routeCount)>0,'calendar routes loaded');
   assert.equal(await page.locator('#naver-blog-frame').count(),1);
   assert.equal(await page.locator('#naver-blog-frame').getAttribute('src'),BLOG);
   assert.equal(await page.locator('.blog-original-link').getAttribute('href'),BLOG);
   assert.equal(await page.locator('.blog-posts').count(),0,'Radar uses the original blog instead of a post list');
   assert.equal(await page.locator('.blog-promo-link').getAttribute('href'),'https://pickle.com/i/K2GRZDJQPSKY');
   assert.equal(await page.locator('.blog-promo-link').getAttribute('target'),'_blank');
   assert.equal(await page.locator('.sidebar-eyebrow').first().evaluate(e=>getComputedStyle(e).fontSize),'8px');
   const promoBelow=await page.evaluate(()=>document.querySelector('.pickle-inline-promo').getBoundingClientRect().top>=document.querySelector('.blog-original').getBoundingClientRect().bottom);
   assert(promoBelow,'Pickle promotion must follow embedded blog in the same card');
   if(width>=1440){
    await page.evaluate(()=>scrollTo(0,400));
    const sticky=await page.locator('#developer-blog').evaluate(e=>({top:e.getBoundingClientRect().top,position:getComputedStyle(e).position}));
    assert.equal(sticky.position,'sticky');assert(Math.abs(sticky.top-16)<=1,'card follows viewport when scrolling');
    await page.locator('.blog-promo-link').scrollIntoViewIfNeeded();
    assert(await page.locator('.blog-promo-link').evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),'Pickle link remains reachable in a short viewport');
   }
   const oldMonth=await page.locator('#month').inputValue();await page.locator('#next-month').click();assert.notEqual(await page.locator('#month').inputValue(),oldMonth);
   await page.locator('#recommend-ke').click();assert(await page.locator('#trip-dialog').isVisible());await page.locator('#trip-close').click();
   await page.evaluate(()=>{scrollTo(0,0);document.querySelector('.naver-sidebar-inner').scrollTop=0;});
   await page.screenshot({path:path.join(evidence,`homepage-${width}.png`),fullPage:true});
   await page.locator('#developer-blog').screenshot({path:path.join(evidence,`blog-${width}.png`)});
   if(width===390){
    await page.screenshot({path:path.join(evidence,'mobile-blog-between-panels.png')});
    await page.setViewportSize({width:1728,height:1080});
    assert.equal(await page.locator('.page-columns > #developer-blog').count(),1,'desktop placement restored after resize');
    await page.setViewportSize({width,height});
    assert.equal(await page.locator('.routes-panel + #developer-blog + .calendar-panel').count(),1,'mobile placement restored after resize');
    assert.equal(await page.locator('#naver-blog-frame').count(),1,'never duplicate embedded blog');
   }
   assert.equal(errors.length,0,errors.join('\n'));
   results.push({width,height,geometry,oneEmbeddedBlog:true,radarCardDesign:true,sticky:width>=1440,calendarMonthChange:true,recommendationDialog:true,errors});await page.close();
  }
  const failure=await browser.newPage({viewport:{width:390,height:844},locale:'ko-KR'});await setup(failure,{failedBlog:true});
  await failure.locator('#developer-blog').scrollIntoViewIfNeeded();
  assert(await failure.locator('#calendar-grid').isVisible(),'blog failure must not hide calendar');
  assert(await failure.locator('.blog-original-link').isVisible(),'direct link available when embed fails');await failure.close();
  // Render the actual public Naver page once, separate from deterministic layout checks.
  const live=await browser.newPage({viewport:{width:1728,height:1080},locale:'ko-KR'});await setup(live,{mockBlog:false});
  await live.locator('#naver-blog-frame').scrollIntoViewIfNeeded();
  await live.frameLocator('#naver-blog-frame').getByText(/ENYA/).first().waitFor({state:'visible',timeout:45000});
  await live.locator('#developer-blog').screenshot({path:path.join(evidence,'blog-live-naver.png')});
  const liveTitle=await live.locator('#naver-blog-frame').evaluate(e=>({src:e.src,height:e.getBoundingClientRect().height}));
  await live.close();
  fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify({passed:true,results,embedFailureIsolated:true,liveNaverRendered:true,liveTitle},null,2));console.log(JSON.stringify({passed:true,viewports:results.length,liveNaverRendered:true}));
 }finally{if(browser)await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
