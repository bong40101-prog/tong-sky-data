import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {plan,kstDay,validate,merge,write,read,progress,DELAY_MS} from './model.mjs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {includedRegions,assertIncludedRegion} from './region-policy.mjs';
const q={origin:'ICN',destination:'CDG',month:'2026-11'};
const snapshot=()=>({...q,sourceUpdatedAt:'2026-10-28T23:00:00+09:00',collectedAt:'2026-10-29T01:00:00Z',dates:Array.from({length:30},(_,i)=>({date:'2026-11-'+String(i+1).padStart(2,'0'),status:'OBSERVED',economyAward:i===0,premiumAward:false,prestigeAward:false,premiumUpgrade:false,prestigeUpgrade:false,firstCombined:false}))});
test('Korean calendar day crosses UTC correctly',()=>{assert.equal(kstDay(new Date('2026-10-28T16:00:00Z')),'2026-10-29');});
test('all regional airports and months, no duplicate origin or route',()=>{const p=plan('ICN',[{code:'ICN'},{code:'CDG'},{code:'CDG'},{code:'SGN'}],'2026-10-29');assert.equal(p.length,26);assert.equal(p[0].month,'2026-10');assert.equal(p[12].month,'2027-10');assert.equal(new Set(p.map(x=>JSON.stringify(x))).size,26);});
test('complete month is validated',()=>assert.doesNotThrow(()=>validate(q,snapshot())));
test('wrong route or missing dates cannot overwrite a cache',()=>{assert.throws(()=>validate({...q,destination:'JFK'},snapshot()));const v=snapshot();v.dates.pop();assert.throws(()=>validate(q,v));});
test('same-source changes and older source are rejected',()=>{const old=merge(null,q,snapshot());const v=snapshot();v.dates[0].economyAward=false;assert.throws(()=>merge(old,q,v));v.sourceUpdatedAt='2026-10-27T23:00:00+09:00';assert.throws(()=>merge(old,q,v));});
test('new source preserves previous successful snapshot',()=>{const old=merge(null,q,snapshot());const v=snapshot();v.sourceUpdatedAt='2026-10-29T23:00:00+09:00';assert.deepEqual(merge(old,q,v).previous,old.current);});
test('missing source and invalid seat counts cannot become availability',()=>{const v=snapshot();v.sourceUpdatedAt='';assert.throws(()=>validate(q,v));v.sourceUpdatedAt=snapshot().sourceUpdatedAt;v.dates[0].economyAward=2;assert.throws(()=>validate(q,v));});
test('atomic cache and checkpoint are recoverable',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sky-'));try{write(path.join(dir,'result.json'),snapshot());assert.deepEqual(read(path.join(dir,'result.json')),snapshot());assert.equal(read(path.join(dir,'missing.json')),null);}finally{fs.rmSync(dir,{recursive:true});}});
test('progress counts attempted items and uses the same four-second pause as the phone',()=>{assert.equal(progress({completed:1,total:3}),33);assert.equal(progress({completed:3,total:3}),100);assert.equal(DELAY_MS,4000);});
const here=path.dirname(fileURLToPath(import.meta.url)),catalog=read(path.join(here,'../src/main/assets/regions.json'));
test('cloud matrix excludes Northeast Asia and Korea while preserving every retained regional code',()=>{
 const result=spawnSync(process.execPath,[path.join(here,'plan.mjs')],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
 const matrix=JSON.parse(result.stdout).include;assert.ok(matrix.length>0);assert.ok(matrix.every(row=>!['동북아시아','대한민국'].includes(row.region)));
 const actual=matrix.flatMap(row=>JSON.parse(row.codes)).sort(),expected=includedRegions(catalog).flatMap(([,airports])=>airports.map(airport=>airport.code)).sort();assert.deepEqual(actual,expected);
 assert.ok(actual.includes('CDG'));assert.ok(actual.includes('JFK'));assert.ok(actual.includes('BKK'));for(const code of ['NRT','CAN','GMP','CJU'])assert.ok(!actual.includes(code));
});
test('excluded or unknown manual collection regions fail before browser import, requests or checkpoint creation',()=>{
 for(const region of ['동북아시아','대한민국','UNKNOWN']){
  assert.throws(()=>assertIncludedRegion(catalog,region));const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sky-excluded-'));
  try{const result=spawnSync(process.execPath,[path.join(here,'collector.mjs')],{env:{...process.env,SKY_REGION:region,SKY_DATA_DIR:directory,SKY_PUBLISH:'0'},encoding:'utf8'});assert.notEqual(result.status,0);assert.match(result.stderr,/excluded region|Unknown collection region/);assert.doesNotMatch(result.stderr,/calendar\.js|playwright|Browser/);assert.deepEqual(fs.readdirSync(directory),[]);}finally{fs.rmSync(directory,{recursive:true});}
 }
});
test('restored excluded cloud artifacts cannot be republished, and retained routes preserve the ICN anchor',()=>{
 const result=spawnSync('python3',[path.join(here,'region-policy.test.py')],{encoding:'utf8'});assert.equal(result.status,0,result.stdout+result.stderr);
});
