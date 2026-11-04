import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {bootRegionSteps,createBootProgress} from '../dist/boot-progress.js';
const catalogs=JSON.parse(await readFile(new URL('../dist/catalog.json',import.meta.url)));
const steps=bootRegionSteps(catalogs);
const event=(source,phase='done')=>({source,phase});
test('both airlines expose continent steps, without giving transport or an empty catch-all a continent share',()=>{
 assert.equal(steps.length,11);
 assert.deepEqual(steps.slice(0,6).map(s=>s.carrier),Array(6).fill('KE'));
 assert.deepEqual(steps.slice(6).map(s=>s.carrier),Array(5).fill('OZ'));
 assert.ok(steps.every(s=>!['기타','전체 자료 다운로드','동북아시아','대한민국'].includes(s.region)));
});
test('a burst of out-of-order completions remains one visible completed region per display interval',async()=>{
 const visible=[],release=[];
 const progress=createBootProgress({steps,onUpdate:p=>visible.push(p),pause:()=>new Promise(resolve=>release.push(resolve))});
 for(const step of [...steps].reverse())progress.report(event(step));
 const flushed=progress.flush();
 for(let i=0;i<steps.length;i++){
  assert.equal(visible.length,i+1);
  assert.equal(visible[i].source.carrier,steps[i].carrier);
  assert.equal(visible[i].source.region,steps[i].region);
  assert.ok(visible[i].percent<100);
  release.shift()();await new Promise(resolve=>setTimeout(resolve,0));
 }
 assert.deepEqual(await flushed,{completed:11,total:11});
 assert.equal(visible.at(-1).percent,90);
 assert.ok(visible.every((p,i)=>i===0||p.percent>visible[i-1].percent));
});
test('loading events, missing regions, and errors never create successful completion or 100 percent',async()=>{
 const visible=[],progress=createBootProgress({steps,onUpdate:p=>visible.push(p),pause:async()=>{}});
 progress.report(event(steps[0],'loading'));assert.equal(visible.length,0);
 progress.report(event(steps[1]));progress.report(event(steps[0],'error'));
 progress.report(event({carrier:'OZ',region:'아시아나'},'error'));
 assert.deepEqual(await progress.flush(),{completed:1,total:11});
 assert.equal(visible.length,1);assert.equal(visible[0].source.region,steps[1].region);
 assert.ok(visible[0].percent<90);
});
test('an obsolete attempt cannot overwrite a newer startup while draining queued completions',async()=>{
 let current=true,release;const visible=[];
 const progress=createBootProgress({steps,onUpdate:p=>visible.push(p),isCurrent:()=>current,pause:()=>new Promise(resolve=>release=resolve)});
 progress.report(event(steps[0]));progress.report(event(steps[1]));
 current=false;release();await progress.flush();progress.report(event(steps[2]));
 assert.equal(visible.length,1);
});
