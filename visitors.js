const ENDPOINT='https://korea-futures-cloudflare.pages.dev/api/tongsky-visitors';
function koreanDay(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
export function startVisitorCounter({doc=document,fetcher=fetch,setTimer=window.setTimeout.bind(window),clearTimer=window.clearTimeout.bind(window)}={}){
 const label=doc.getElementById('daily-visitors');
 if(!label)return {ready:Promise.resolve(),stop(){}};
 let stopped=false,inflight=null,resetTimer=null,day=null;
 async function record(){
  const controller=new AbortController(),timeout=setTimer(()=>controller.abort(),8000);
  try{
   const response=await fetcher(ENDPOINT,{method:'POST',mode:'cors',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal});
   if(!response.ok)throw Error('Counter unavailable');
   const data=await response.json(),delay=Date.parse(data.nextResetAt)-Date.parse(data.serverNow)+1000;
   if(data.method!=='daily_unique_ip'||!/^\d{4}-\d{2}-\d{2}$/.test(data.date)||!Number.isSafeInteger(data.dailyVisitors)||data.dailyVisitors<1||!Number.isFinite(delay)||delay<1000||delay>86402000)throw Error('Invalid counter data');
   if(stopped)return;
   day=data.date;label.textContent='오늘 방문자 '+data.dailyVisitors.toLocaleString('ko-KR')+'명';label.dataset.date=day;
   clearTimer(resetTimer);resetTimer=setTimer(()=>refresh(),delay);
  }catch{if(!stopped)label.textContent='오늘 방문자 집계 불가';}
  finally{clearTimer(timeout);}
 }
 function refresh(){if(stopped)return Promise.resolve();if(!inflight)inflight=record().finally(()=>{inflight=null;});return inflight;}
 const onVisible=()=>{if(doc.visibilityState==='visible'&&day!==koreanDay())refresh();};
 doc.addEventListener('visibilitychange',onVisible);
 return {ready:refresh(),refresh,stop(){stopped=true;clearTimer(resetTimer);doc.removeEventListener('visibilitychange',onVisible);}};
}
if(typeof window!=='undefined')startVisitorCounter();
