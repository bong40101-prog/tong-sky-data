const root=document.getElementById('developer-blog');
const BLOG='https://blog.naver.com/mkj2449';
const FEED='https://raw.githubusercontent.com/bong40101-prog/tong-sky-data/gh-pages/blog-feed.json';
const allowedPost=value=>{try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='blog.naver.com'&&/^\/mkj2449\/\d+$/.test(url.pathname)?url.origin+url.pathname:null;}catch{return null;}};
async function loadPosts(){
 const status=root.querySelector('[data-blog-status]'),list=root.querySelector('[data-blog-posts]');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6000);
 try{
  const response=await fetch(FEED,{signal:controller.signal,cache:'no-cache',credentials:'omit'});
  if(!response.ok)throw Error('Feed unavailable');
  const feed=await response.json();
  if(feed.schema!==1||feed.blogUrl!==BLOG||!Array.isArray(feed.posts))throw Error('Invalid feed');
  const fragment=document.createDocumentFragment();let count=0;
  for(const post of feed.posts.slice(0,3)){
   const url=allowedPost(post.url);if(!url||typeof post.title!=='string'||!post.title.trim())continue;
   const li=document.createElement('li'),a=document.createElement('a'),title=document.createElement('span');
   a.className='blog-post-link';a.href=url;a.target='_blank';a.rel='noopener noreferrer';
   title.className='blog-post-title';title.textContent=post.title;title.title=post.title;a.append(title);
   const date=new Date(post.publishedAt);if(!Number.isNaN(date.getTime())){const time=document.createElement('time');time.dateTime=date.toISOString();time.textContent=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);a.append(time);}
   li.append(a);fragment.append(li);count++;
  }
  if(!count)throw Error('No valid posts');
  list.replaceChildren(fragment);status.hidden=true;
 }catch{status.textContent='최근 게시물 목록을 불러오지 못했어요. 블로그에서 확인해 주세요.';status.hidden=false;}
 finally{clearTimeout(timer);}
}
if(root){
 // Reuse one sidebar so links, feed state and keyboard order match its visible position.
 const desktopAnchor=document.createComment('developer-blog-desktop');root.before(desktopAnchor);
 const calendar=document.querySelector('.results-layout > .calendar-panel');
 const mobile=window.matchMedia('(max-width:760px)');
 const placeSidebar=()=>{if(mobile.matches&&calendar)calendar.before(root);else desktopAnchor.after(root);};
 placeSidebar();mobile.addEventListener('change',placeSidebar);
 // Start after the calendar's boot screen is gone; this never participates in its progress or error state.
 const screen=document.getElementById('app-screen');
 if(!screen?.hidden)void loadPosts();
 else{const observer=new MutationObserver(()=>{if(!screen.hidden){observer.disconnect();void loadPosts();}});observer.observe(screen,{attributes:true,attributeFilter:['hidden']});}
}
