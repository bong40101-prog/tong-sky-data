const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),evidence=path.join(root,'test-evidence');fs.mkdirSync(evidence,{recursive:true});
const server=spawn('python3',['-m','http.server','8148','--bind','127.0.0.1','--directory',path.join(root,'dist')],{stdio:'ignore'});
const results=[];
(async()=>{
 let browser;
 try{
  for(let i=0;i<50;i++){try{const r=await fetch('http://127.0.0.1:8148/');if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({headless:true});
  const feed=fs.readFileSync(path.join(root,'dist/blog-feed.json'),'utf8');
  for(const [width,height] of [[1728,1080],[1440,1000],[1280,900],[390,844]]){
   const page=await browser.newPage({viewport:{width,height},locale:'ko-KR'}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{for(const id of ['operator','excluded-region','feedback','recommendations'])localStorage.setItem('tongsky.notice.dismissed.v1.'+id,'1');});
   await page.route('https://korea-futures-cloudflare.pages.dev/**',r=>r.abort());
   await page.route('https://raw.githubusercontent.com/**',route=>{
    const u=new URL(route.request().url());
    if(u.pathname.endsWith('/blog-feed.json'))return route.fulfill({contentType:'application/json',body:feed});
    if(u.pathname.endsWith('/europe.json'))return route.fulfill({contentType:'application/json',body:fs.readFileSync(path.join(root,'tests/current-europe.json'))});
    if(u.pathname.endsWith('/asiana.json'))return route.fulfill({contentType:'application/json',body:fs.readFileSync(path.join(root,'tests/asiana-packed.json'))});
    return route.fulfill({status:404,contentType:'application/json',body:'{}'});
   });
   await page.goto('http://127.0.0.1:8148/');
   await page.locator('#app-screen').waitFor({state:'visible'});
   for(const dialog of await page.locator('.announcement-dialog[open]').all())await dialog.locator('.notice-close').click();
   await page.waitForFunction(()=>document.querySelectorAll('.blog-post-link').length===3);
   const geometry=await page.evaluate(()=>{const a=document.querySelector('.calendar-content').getBoundingClientRect(),b=document.getElementById('developer-blog').getBoundingClientRect();return {main:{x:a.x,y:a.y,width:a.width,bottom:a.bottom},blog:{x:b.x,y:b.y,width:b.width},pageWidth:document.documentElement.scrollWidth,viewport:innerWidth,routeCount:document.getElementById('route-count').textContent};});
   assert(geometry.pageWidth<=width+1,'horizontal overflow');
   if(width>=1440)assert(geometry.blog.x>=geometry.main.x+geometry.main.width,'blog must be on right');
   else assert(geometry.blog.y>=geometry.main.bottom,'blog must follow calendar on narrow screens');
   assert(Number(geometry.routeCount)>0,'calendar routes loaded');
   assert.equal(await page.locator('.blog-post-link').first().getAttribute('href'),'https://blog.naver.com/mkj2449/224469201430');
   assert.equal(await page.locator('.blog-promo-link').getAttribute('href'),'https://pickle.com/i/K2GRZDJQPSKY');
   assert.equal(await page.locator('.blog-promo-link').getAttribute('target'),'_blank');
   const promoBelow=await page.evaluate(()=>document.querySelector('.blog-promo').getBoundingClientRect().top>=document.querySelector('.blog-posts').getBoundingClientRect().bottom);
   assert(promoBelow,'Pickle promotion must follow blog posts');
   const oldMonth=await page.locator('#month').inputValue();await page.locator('#next-month').click();assert.notEqual(await page.locator('#month').inputValue(),oldMonth);
   await page.locator('#recommend-ke').click();assert(await page.locator('#trip-dialog').isVisible());await page.locator('#trip-close').click();
   await page.screenshot({path:path.join(evidence,`homepage-${width}.png`),fullPage:true});
   await page.locator('#developer-blog').screenshot({path:path.join(evidence,`blog-${width}.png`)});
   await page.route('https://raw.githubusercontent.com/**/blog-feed.json',r=>r.fulfill({status:503,body:'unavailable'}));
   await page.reload();await page.locator('#app-screen').waitFor({state:'visible'});
   await page.waitForFunction(()=>document.querySelector('[data-blog-status]').textContent.includes('불러오지 못했어요'));
   assert(await page.locator('#calendar-grid').isVisible(),'blog error must not hide calendar');
   assert.equal(errors.length,0,errors.join('\n'));
   results.push({width,height,geometry,posts:3,calendarMonthChange:true,recommendationDialog:true,feedFailureIsolated:true,errors});await page.close();
  }
  fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify({passed:true,results},null,2));console.log(JSON.stringify({passed:true,viewports:results.length}));
 }finally{if(browser)await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
