import {createHash} from 'node:crypto';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
import {DELAY_MS,kstDay,plan,key,merge,read,write,progress} from './model.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),args=process.argv.slice(2),probe=args.includes('--probe');
const catalog=read(path.join(here,'../src/main/assets/regions.json')),script=fs.readFileSync(path.join(here,'../src/main/assets/calendar.js'),'utf8');
const source=catalog.source,origin=process.env.SKY_ORIGIN||'ICN',region=process.env.SKY_REGION||'유럽',day=kstDay();
const root=path.resolve(process.env.SKY_DATA_DIR||path.join(here,'data')),shard=Number(process.env.SKY_SHARD||0),regionId=catalog.ids[region],statusFile=path.join(root,'shards',regionId+'-'+shard+'.json');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));class Stop extends Error{}
let previous=read(statusFile),queries=probe?['CDG','SGN'].map(destination=>({origin,destination,month:plan(origin,[{code:destination}])[1].month})):plan(origin,catalog.regions[region].filter(a=>!process.env.SKY_CODES_JSON||JSON.parse(process.env.SKY_CODES_JSON).includes(a.code)));
if(!probe&&previous?.day===day&&previous.state==='completed'){console.log('Already collected this Korean calendar day');process.exit(0);}
let state=!probe&&previous?.day===day?{...previous,state:'running',error:''}:{schema:1,origin,region,regionId,shard,day,startedAt:new Date().toISOString(),updatedAt:null,completedAt:null,state:'running',total:queries.length,completed:0,succeeded:0,failed:0,error:'',percent:0};
if(state.total!==queries.length)throw Error('Plan changed during a resumable run');
const published=(buildBundles=false)=>{state.percent=progress(state);state.updatedAt=new Date().toISOString();write(statusFile,state);aggregate(buildBundles);if(process.env.SKY_PUBLISH==='1'){const r=spawnSync('python3',[path.join(here,'publish.py'),root],{stdio:'inherit',env:process.env});if(r.status!==0)throw new Stop('Result publishing failed; stopping collection');}};
function aggregate(buildBundles=false){
 const regionDir=path.join(root,'shards');for(const [name,id] of Object.entries(catalog.ids)){
  const shards=fs.existsSync(regionDir)?fs.readdirSync(regionDir).filter(f=>f.startsWith(id+'-')&&f.endsWith('.json')).map(f=>read(path.join(regionDir,f))).filter(s=>s.day===day):[];if(!shards.length)continue;
  const total=plan(origin,catalog.regions[name]).length,completed=shards.reduce((a,s)=>a+s.completed,0),succeeded=shards.reduce((a,s)=>a+s.succeeded,0),failed=shards.reduce((a,s)=>a+s.failed,0),stopped=shards.find(s=>s.state==='stopped');
  let bundleVersion=read(path.join(root,'regions',id+'.json'))?.bundleVersion||null;if(buildBundles){const records=plan(origin,catalog.regions[name]).map(q=>read(path.join(root,'snapshots',key(q)+'.json'))).filter(Boolean);if(records.length){bundleVersion=createHash('sha256').update(JSON.stringify(records)).digest('hex');write(path.join(root,'bundles',id+'.json'),{schema:1,origin,region:name,bundleVersion,records});}}
  write(path.join(root,'regions',id+'.json'),{bundleVersion,schema:1,origin,region:name,day,total,completed,succeeded,failed,percent:progress({completed,total}),state:stopped?'stopped':completed===total?failed?'partial':'completed':'running',error:stopped?.error||'',updatedAt:new Date().toISOString(),completedAt:completed===total?new Date().toISOString():null});
 }
}
let lastPublish=0;function checkpoint(force=false){state.percent=progress(state);state.updatedAt=new Date().toISOString();write(statusFile,state);if(force||Date.now()-lastPublish>60000){published(force);lastPublish=Date.now();}}
const {chromium}=await import('playwright');const browser=await chromium.launch({headless:process.env.SKY_HEADED!=='1'});const context=await browser.newContext({locale:'ko-KR',viewport:{width:1280,height:900}});const page=await context.newPage();let blocked='',deniedResponse=null,deniedBody=Promise.resolve();
page.on('response',r=>{try{const h=new URL(r.url()).hostname;if((h==='koreanair.com'||h.endsWith('.koreanair.com'))&&[401,403,429].includes(r.status())){blocked='Official site access restriction HTTP '+r.status()+' '+r.url();deniedResponse={status:r.status(),url:r.url(),body:''};deniedBody=r.text().then(t=>{deniedResponse.body=t.slice(0,1800);}).catch(()=>{});}}catch{}});
page.on('crash',()=>{blocked='Browser renderer crashed';});
async function lookup(q){
 if(blocked)throw new Stop(blocked);let stage='consent',stageAt=Date.now(),started=Date.now();await page.goto(source,{waitUntil:'load',timeout:60000});await page.waitForLoadState('networkidle',{timeout:15000}).catch(()=>{});await sleep(1500);
 while(Date.now()-started<180000){
  if(blocked)throw new Stop(blocked);if(new URL(page.url()).origin!==new URL(source).origin||new URL(page.url()).pathname!==new URL(source).pathname)throw new Stop('Left official collection page');
  if(Date.now()-stageAt>(stage==='consent'?60000:25000))throw Error('Timed out at '+stage);
  const r=await page.evaluate(script+`(${JSON.stringify(stage)},${JSON.stringify(q)})`);
  if(!r||typeof r!=='object')throw new Stop('Official page structure or script changed');if(r.error)throw new Stop(r.error);if(r.data)return r.data;
  if(r.next){stage=r.next;stageAt=Date.now();if(r.type)await page.keyboard.type(r.type,{delay:120});if(r.tap)await page.mouse.click(r.tap.x,r.tap.y,{delay:50});}
  await sleep(350);
 }
 throw Error('Query exceeded maximum duration');
}
try{
 checkpoint(true);let consecutive=0;
 for(let i=state.completed;i<queries.length;i++){
  if(Date.now()-Date.parse(state.startedAt)>330*60000)throw new Stop('Execution budget reached; last checkpoint preserved');
  const q=queries[i],file=path.join(root,'snapshots',key(q)+'.json');state.currentQuery=q;checkpoint();
  try{const result=await lookup(q);write(file,merge(read(file),q,result));state.succeeded++;consecutive=0;}
  catch(e){if(e instanceof Stop)throw e;state.failed++;consecutive++;write(path.join(root,'errors',key(q)+'.json'),{query:q,attemptedAt:new Date().toISOString(),error:e.message});console.log(key(q)+': '+e.message);if(consecutive>=5)throw new Stop('Five consecutive lookup failures; stopping instead of continuing requests');}
  state.completed=i+1;checkpoint();if(i+1<queries.length)await sleep(DELAY_MS);
 }
 state.state=state.failed?'partial':'completed';state.completedAt=new Date().toISOString();checkpoint(true);if(probe&&state.succeeded!==queries.length)throw Error('Live probe failed');
}catch(e){state.state='stopped';state.error=e.message;await deniedBody;state.deniedResponse=deniedResponse;state.evidence={url:page.url(),title:await page.title().catch(()=>''),text:await page.locator('body').innerText({timeout:2000}).catch(()=>'')};state.evidence.text=state.evidence.text.slice(0,1800);checkpoint(true);console.error(e.message);process.exitCode=1;}finally{await browser.close();}
