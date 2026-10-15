import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const data=JSON.parse(readFileSync('datasets/demo/ftw-india-sample.geojson','utf8'));
const base=`http://127.0.0.1:${process.env.API_PORT||3001}/api`;
async function api(path,method='GET',body){
 const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 const payload=await response.json();if(!response.ok)throw new Error(payload.error||`HTTP ${response.status}`);return payload;
}
const fields=await api('/fields');
const imported=[];
for(const feature of data.features){
 const p=feature.properties;
 if(!p.name.startsWith('Public demo:')||feature.geometry.type!=='Polygon')throw new Error('Only labelled public demo polygons are accepted');
 let field=fields.find(item=>item.name===p.name);
 if(!field){field=await api('/fields','POST',{name:p.name,provenance:'public_boundary',crop:'Unrecorded crop — public boundary benchmark',boundary_geojson:feature.geometry,planting_date:null,harvest_date:null});fields.push(field);}
 const events=await api(`/fields/${field.id}/events`);
 const provenance={kind:'public_benchmark_demo',dataset:p.dataset,source_id:p.source_id,boundary_year:p.boundary_year,license:p.license,source_url:p.source_url,authors:'Sherrie Wang, Francois Waldner, David B. Lobell; distributed through FTW/Kerner Lab',warning:p.warning};
 if(!events.some(event=>event.event_type==='dataset_import'&&event.notes?.includes(`"source_id":"${p.source_id}"`))){
  await api(`/fields/${field.id}/events`,'POST',{event_type:'dataset_import',event_date:new Date().toISOString().slice(0,10),notes:JSON.stringify(provenance)});
 }
 imported.push({id:field.id,name:field.name,source_id:p.source_id,area_hectares:field.area_hectares});
 console.log(`${field.name}: ${field.area_hectares} ha, source attribution recorded.`);
}
mkdirSync('.local',{recursive:true});writeFileSync('.local/public-demo-import.json',JSON.stringify({importedAt:new Date().toISOString(),fields:imported},null,2)+'\n',{mode:0o600});
console.log(`Ready: ${imported.length} public demos. Existing original fields were not changed.`);
