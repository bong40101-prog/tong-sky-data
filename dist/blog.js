const root=document.getElementById('developer-blog');
const BLOG='https://blog.naver.com/mkj2449';
const LIVE_FEED='https://korea-futures-cloudflare.pages.dev/api/tongsky-blog';
const FEED='https://raw.githubusercontent.com/bong40101-prog/tong-sky-data/gh-pages/blog-feed.json';
const REFRESH_MS=5*60*1000,RESUME_MS=60*1000;
let loading=false,started=false,lastAttempt=0,shownPosts=[];
const allowedPost=value=>{try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='blog.naver.com'&&/^\/mkj2449\/\d+$/.test(url.pathname)?url.origin+url.pathname:null;}catch{return null;}};
function validPosts(feed){
 if(feed?.schema!==1||feed.blogUrl!==BLOG||!Array.isArray(feed.posts))throw Error('Invalid feed');
 const seen=new Set();
 const posts=feed.posts.filter(post=>post&&allowedPost(post.url)&&typeof post.title==='string'&&post.title.trim()&&Number.isFinite(Date.parse(post.publishedAt)))
  .sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt))
  .filter(post=>{if(seen.has(post.url))return false;seen.add(post.url);return true;}).slice(0,3);
 if(!posts.length)throw Error('No valid posts');return posts;
}
async function recentPosts(){
 for(const [url,timeout,live] of [[LIVE_FEED,8000,true],[FEED+'?refresh='+Math.floor(Date.now()/REFRESH_MS),6000,false]]){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{
   const response=await fetch(url,{signal:controller.signal,cache:'no-store',credentials:'omit'});
   if(!response.ok)throw Error('Feed unavailable');
   return {posts:validPosts(await response.json()),live};
  }catch{ /* Preserve the saved list if the public RSS service is temporarily unavailable. */ }
  finally{clearTimeout(timer);}
 }
 throw Error('Feed unavailable');
}
async function loadPosts(){
 if(loading)return;loading=true;lastAttempt=Date.now();
 const status=root.querySelector('[data-blog-status]'),list=root.querySelector('[data-blog-posts]');
 try{
  const {posts,live}=await recentPosts();
  // An older fallback or delayed upstream response must never replace a newer displayed list.
  const older=shownPosts.length&&Date.parse(posts[0].publishedAt)<Date.parse(shownPosts[0].publishedAt);
  if(!older&&JSON.stringify(posts)!==JSON.stringify(shownPosts)){
   const fragment=document.createDocumentFragment();
   for(const post of posts){
    const li=document.createElement('li'),a=document.createElement('a'),title=document.createElement('span');
    a.className='blog-post-link';a.href=allowedPost(post.url);a.target='_blank';a.rel='noopener noreferrer';
    title.className='blog-post-title';title.textContent=post.title;title.title=post.title;a.append(title);
    const date=new Date(post.publishedAt),time=document.createElement('time');time.dateTime=date.toISOString();time.textContent=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);a.append(time);
    li.append(a);fragment.append(li);
   }
   list.replaceChildren(fragment);shownPosts=posts;
  }
  status.textContent='최신 글 확인이 지연되어 저장된 목록을 표시합니다.';status.hidden=live&&!older;
 }catch{
  status.textContent=shownPosts.length?'최신 글 확인이 지연되어 마지막으로 불러온 목록을 표시합니다.':'최근 게시물 목록을 불러오지 못했어요. 블로그에서 확인해 주세요.';status.hidden=false;
 }finally{loading=false;}
}
function startPosts(){
 if(started)return;started=true;void loadPosts();
 setInterval(()=>{if(!document.hidden)void loadPosts();},REFRESH_MS);
 const resume=()=>{if(!document.hidden&&Date.now()-lastAttempt>=RESUME_MS)void loadPosts();};
 document.addEventListener('visibilitychange',resume);window.addEventListener('focus',resume);
}
if(root){
 const desktopAnchor=document.createComment('developer-blog-desktop');root.before(desktopAnchor);
 const calendar=document.querySelector('.results-layout > .calendar-panel');
 const mobile=window.matchMedia('(max-width:760px)');
 const placeSidebar=()=>{if(mobile.matches&&calendar)calendar.before(root);else desktopAnchor.after(root);};
 placeSidebar();mobile.addEventListener('change',placeSidebar);
 // Keep the blog independent of calendar boot progress and collection requests.
 const screen=document.getElementById('app-screen');
 if(!screen?.hidden)startPosts();
 else{const observer=new MutationObserver(()=>{if(!screen.hidden){observer.disconnect();startPosts();}});observer.observe(screen,{attributes:true,attributeFilter:['hidden']});}
}
