import fs from 'node:fs';import {plan} from './model.mjs';
const catalog=JSON.parse(fs.readFileSync(new URL('../src/main/assets/regions.json',import.meta.url),'utf8'));
const include=[];for(const [region,airports] of Object.entries(catalog.regions)){for(let i=0;i<airports.length;i+=10){const codes=airports.slice(i,i+10).map(a=>a.code);include.push({region,shard:Math.floor(i/10),codes:JSON.stringify(codes)});}}
process.stdout.write(JSON.stringify({include}));
