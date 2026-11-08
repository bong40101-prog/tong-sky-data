const root=document.getElementById('developer-blog');
if(root){
 // Move the same card so the iframe is never duplicated on narrow screens.
 const desktopAnchor=document.createComment('developer-blog-desktop');root.before(desktopAnchor);
 const calendar=document.querySelector('.results-layout > .calendar-panel');
 const mobile=window.matchMedia('(max-width:760px)');
 const placeSidebar=()=>{if(mobile.matches&&calendar)calendar.before(root);else desktopAnchor.after(root);};
 placeSidebar();mobile.addEventListener('change',placeSidebar);
}
