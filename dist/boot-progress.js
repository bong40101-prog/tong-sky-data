import {sourcesFor,asianaLoadRegions} from './data.js?v=159';

// Present completed regions in a stable order without delaying any downloads.
// One brief display interval per real completion prevents fast work from being
// collapsed into a single browser paint. Transport/empty catch-all stages do not
// count as continents, and the main screen owns the final 10 percent.
export function bootRegionSteps(catalogs){
 return [...sourcesFor(catalogs,['KE']),...asianaLoadRegions(catalogs.OZ).filter(region=>region!=='기타').map(region=>({carrier:'OZ',region}))];
}
export function createBootProgress({steps,onUpdate,pause=()=>new Promise(resolve=>setTimeout(resolve,120)),isCurrent=()=>true}){
 const key=step=>step.carrier+':'+step.region,states=new Map();let cursor=0,completed=0,running=null,closed=false;
 function drain(){
  if(running)return running;
  if(cursor>=steps.length||!isCurrent()||!closed&&!states.has(key(steps[cursor])))return Promise.resolve();
  running=(async()=>{
   while(cursor<steps.length&&isCurrent()){
    const step=steps[cursor],event=states.get(key(step));
    if(!event&&!closed)break;
    cursor++;
    if(event?.phase!=='done')continue;
    completed++;
    onUpdate({...event,completed,total:steps.length,percent:Math.floor(completed*90/steps.length)});
    await pause();
   }
  })().finally(()=>{running=null;if(cursor<steps.length&&isCurrent()&&states.has(key(steps[cursor])))void drain();});
  return running;
 }
 return {
  report(event){
   if(!isCurrent()||closed||!['done','error'].includes(event.phase))return;
   if(event.source.carrier==='OZ'&&event.source.region==='아시아나'&&event.phase==='error'){
    for(const step of steps.filter(step=>step.carrier==='OZ'))states.set(key(step),event);
   }else if(steps.some(step=>key(step)===key(event.source)))states.set(key(event.source),event);
   void drain();
  },
  async flush(){closed=true;if(running)await running;await drain();return {completed,total:steps.length};}
 };
}
