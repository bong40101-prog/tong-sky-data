const PREFIX='tongsky.notice.dismissed.v1.';
export function createNoticeController({document:doc=globalThis.document,storage}={}){
 if(storage===undefined)try{storage=globalThis.localStorage;}catch{storage=null;}
 const dialogs=[...doc.querySelectorAll('.announcement-dialog')];let started=false,cursor=0;
 const hidden=dialog=>{try{return storage?.getItem(PREFIX+dialog.dataset.noticeId)==='1';}catch{return false;}};
 const next=()=>{while(cursor<dialogs.length){const dialog=dialogs[cursor++];if(hidden(dialog))continue;dialog.showModal();return;}};
 for(const dialog of dialogs){
  const close=()=>{dialog.close();next();};
  dialog.querySelector('.notice-close').addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.querySelector('.notice-dismiss').addEventListener('click',()=>{
   try{if(!storage?.setItem)throw new Error('Storage unavailable');storage.setItem(PREFIX+dialog.dataset.noticeId,'1');}
   catch{const message=dialog.querySelector('.notice-save-status');message.hidden=false;message.textContent='숨김 설정을 저장하지 못했습니다. 이번에만 닫으려면 ‘닫기’를 눌러주세요.';return;}
   close();
  });
 }
 return {show(){if(started)return;started=true;next();}};
}
