const ENDPOINT='https://korea-futures-cloudflare.pages.dev/api/tongsky-feedback';
export function setupFeedback({document=globalThis.document,fetcher=globalThis.fetch,getContext=()=>({})}={}){
 const dialog=document.getElementById('feedback-dialog'),form=document.getElementById('feedback-form'),open=document.getElementById('feedback-open'),close=document.getElementById('feedback-close'),status=document.getElementById('feedback-status'),send=document.getElementById('feedback-send');
 let sending=false,receipt=null,lastPayload='',requestId='';
 const setStatus=(text,error=false)=>{status.textContent=text;status.classList.toggle('feedback-error',error);};
 open.addEventListener('click',()=>{if(receipt){form.reset();receipt=null;setStatus('');send.disabled=false;}dialog.showModal();});
 close.addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>open.focus());
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(sending||receipt||!form.reportValidity())return;
  const value=name=>form.elements.namedItem(name).value.trim();const payload={kind:value('kind'),title:value('title'),message:value('message'),contact:value('contact'),website:value('website'),context:getContext()};
  const serial=JSON.stringify(payload);if(serial!==lastPayload){lastPayload=serial;requestId=crypto.randomUUID();}
  sending=true;send.disabled=true;send.textContent='접수 중…';setStatus('');
  try{
   const response=await fetcher(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,id:requestId}),credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(15000)});
   const result=await response.json();if(!response.ok||!result.ok||result.id!==requestId)throw Error(response.status===429?'잠시 후 다시 제출해 주세요.':'접수하지 못했습니다. 작성 내용은 유지됩니다. 다시 시도해 주세요.');
   receipt=result.id;setStatus('접수되었습니다. 운영자만 확인할 수 있습니다. 접수번호 '+receipt.slice(0,8));send.textContent='접수 완료';
  }catch(error){setStatus(error.name==='TimeoutError'?'연결 시간이 초과되었습니다. 같은 내용으로 다시 시도해 주세요.':error.message||'접수하지 못했습니다. 다시 시도해 주세요.',true);send.textContent='비공개로 제출';send.disabled=false;}
  finally{sending=false;}
 });
 return {get sending(){return sending;}};
}
