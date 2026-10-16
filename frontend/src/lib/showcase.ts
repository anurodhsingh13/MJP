/** Self-contained fictional showcase. Enabled only by ?demo=1; no database or providers. */
import { assessEvidence, type Observation } from '../../../shared/evidence';
import type { DatabaseField } from './api';
const anchor = Date.now();
const date = (days:number) => new Date(anchor-days*86400000).toISOString().slice(0,10);
const uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
type Field = DatabaseField;
const crops=[['Wheat North','Wheat',.46,.73,3,2],['Rice East','Rice',.68,.67,2,1],['Maize Riverside','Maize',.75,.52,4,0],['Mustard West','Mustard',.55,.56,32,0],['Cotton Block','Cotton',.4,.66,2,0],['Sugarcane','Sugarcane',.68,.64,3,0],['Potato South','Potato',.58,.61,5,2],['Newly Added Field','Unknown',null,null,0,0]] as const;
const polygon=(i:number)=>({type:'Polygon',coordinates:[[[77.41+i*.014,28.55+i*.008],[77.418+i*.014,28.55+i*.008],[77.418+i*.014,28.558+i*.008],[77.41+i*.014,28.558+i*.008],[77.41+i*.014,28.55+i*.008]] ]});
const indexObs=(i:number,ndvi:number,ago:number):Observation=>({
 scene_id:`SHOWCASE-S2-${i}-${ago}`,observed_on:date(ago),acquired_at:new Date(anchor-ago*86400000).toISOString(),
 ndvi_value:ndvi,ndmi_value:Number((ndvi*.55-.08).toFixed(3)),ndre_value:Number((ndvi*.68).toFixed(3)),
 cloud_cover:i===4?82:12,valid_coverage_percent:i===4?24:91,valid_pixel_count:i===4?4:720,
 source:'Illustrative Sentinel-2 scenario',provenance:'measured_imagery',accepted:i!==4,boundary_version:1,calculation_version:'showcase-v1'
});
const observations=new Map<string,Observation[]>();
const tasks=new Map<string,Array<Record<string,unknown>>>();
const events=new Map<string,Array<Record<string,unknown>>>();
const alerts=new Map<string,Array<Record<string,unknown>>>();
const scouting=new Map<string,Array<Record<string,unknown>>>();
const jobs=new Map<string,Array<Record<string,unknown>>>();
const fields:Field[]=crops.map(([name,crop,ndvi,previous,age,due],i)=>{
 const id=uuid(i+1),base=ndvi===null?[]:[indexObs(i,ndvi,age),...(previous===null?[]:[indexObs(i,previous,age+9)])];
 observations.set(id,base);
 tasks.set(id,Array.from({length:due},(_,j)=>({id:uuid(100+i*4+j),field_id:id,title:j?'Review irrigation':'Inspect north boundary',reason:'Scheduled inspection',due_on:date(j),status:'open',scene_id:base[0]?.scene_id||null,boundary_version:1})));
 events.set(id,[{id:uuid(200+i),field_id:id,event_type:'planting',event_date:date(42+i),notes:`Illustrative ${crop} sowing record`,created_at:new Date().toISOString()}]);
 scouting.set(id,[]);
 alerts.set(id,i===0?[{id:uuid(300+i),title:'Vegetation decrease: inspect in person',severity:'neutral',observed_at:date(age),resolved:false,action_status:'open',scene_id:base[0]?.scene_id,stress_geojson:null}]:[]);
 jobs.set(id,[]);
 const latest=base[0]||null,older=base[1]||null;return {
 id,name,crop,area_hectares:Number((1+i*.34).toFixed(2)),health_score:null,health_delta:null,canopy_coverage:0,
 ndvi_average:ndvi,latitude:28.554+i*.008,longitude:77.414+i*.014,boundary_geojson:polygon(i),boundary_version:1,
 planting_date:date(42+i),harvest_date:null,expected_yield_tons:null,last_observation:latest?.observed_on||null,
 provenance:'user_reported' as const,isDemo:false,latestObservation:latest,previousObservation:older,
 assessment:assessEvidence(latest,older),dueTasks:due,latestJob:null,latest_scene_id:latest?.scene_id||null,
 };
});
const weather=(id:string)=>Array.from({length:45},(_,i)=>({
 id:uuid(1000+i),observed_on:date(44-i),temperature_c:Math.round((23+6*Math.sin(i/6))*10)/10,
 precipitation_mm:i%9===0?15.2:i%5===0?3.5:0,humidity_percent:Math.round(49+21*Math.cos(i/7)),
 source_url:'https://example.invalid/showcase-weather',field_id:id
}));
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const result=(fieldId:string)=>fields.find(f=>f.id===fieldId);
const mockTiles=new Response('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#619f58" opacity=".55"/><path d="M0 80L256 140M-20 190L280 30" stroke="#daec72" stroke-width="52" opacity=".4"/><path d="M60 0L120 256" stroke="#317f4a" stroke-width="36" opacity=".5"/></svg>',{headers:{'content-type':'image/svg+xml'}});
async function respond(path:string,method:string,body:Record<string,unknown>,search:string):Promise<Response>{
 if(path==='/api/auth/session')return json({mode:'local',user:null});
 if(path==='/api/health')return json({status:'ok',database:'showcase-memory'});
 if(path==='/api/fields'){
  if(method==='POST'){
   const id=uuid(4000+fields.length),field={...fields[7],...body,id,name:String(body.name||'New field'),crop:String(body.crop||'Unknown'),boundary_geojson:body.boundary_geojson as Record<string,unknown>,latestObservation:null,previousObservation:null,last_observation:null,latest_scene_id:null,ndvi_average:null,dueTasks:0,assessment:assessEvidence(null,null)};
   fields.push(field);observations.set(id,[]);tasks.set(id,[]);events.set(id,[]);alerts.set(id,[]);scouting.set(id,[]);jobs.set(id,[]);return json(field,201);
  }
  return json(fields.map(f=>({...f,latestJob:jobs.get(f.id)?.[0]||null,dueTasks:(tasks.get(f.id)||[]).filter(t=>t.status!=='resolved'&&String(t.due_on)<=date(0)).length})));
 }
 if(path==='/api/assistant')return json({answer:'The illustrative readings suggest checking the field in person before deciding on a treatment.',model:'showcase',languageCode:body.languageCode||'en-IN',evidenceDates:[date(3)]});
 const match=path.match(/^\/api\/fields\/([^/]+)(?:\/(.*))?$/);if(!match)return json({error:'Not found'},404);
 const fieldId=match[1],section=match[2]||'',field=result(fieldId);if(!field)return json({error:'Field not found'},404);
 const data=observations.get(fieldId)||[];
 if(!section){
  if(method==='DELETE'){fields.splice(fields.indexOf(field),1);return new Response(null,{status:204});}
  if(method==='PATCH'){Object.assign(field,body);return json(field);}
  return json(field);
 }
 if(section==='boundary'&&method==='PATCH'){field.boundary_geojson=body.boundary_geojson as Record<string,unknown>;field.boundary_version=(field.boundary_version||1)+1;return json({boundary_version:field.boundary_version});}
 if(section==='ndvi')return json(data);
 if(section==='ndvi/analysis')return json({status:'analysed',statusLabel:'Illustrative vegetation trend',trend:field.assessment?.change!=null&&field.assessment.change<-.1?'declining':'stable',summary:'Two example image dates can be compared.',recommendation:'Inspect the field before taking action.',observations:data.length,average:field.ndvi_average,slopePerDay:data.length>1?Number((Number(data[0].ndvi_value)-Number(data[1].ndvi_value))/9):null,languageCode:new URLSearchParams(search).get('language')||'en-IN',source:'showcase'});
 if(section==='weather')return json(weather(fieldId));
 if(section==='scenes')return json(data.map((o,i)=>({scene_id:o.scene_id,observed_at:o.acquired_at,cloud_cover:o.cloud_cover,processing_status:o.accepted?'processed':'rejected',valid_coverage_percent:o.valid_coverage_percent,valid_pixel_count:o.valid_pixel_count})));
 if(section==='alerts'){return json(alerts.get(fieldId)||[]);}
 if(section.startsWith('alerts/')&&method==='PATCH'){const alert=(alerts.get(fieldId)||[]).find(a=>a.id===section.split('/')[1]);if(alert){alert.action_status=body.status||'resolved';alert.resolved=alert.action_status==='resolved';}return json(alert||{});}
 if(section==='events'){
  const records=events.get(fieldId)||[];if(method==='POST'){const record={id:uuid(2000+records.length),field_id:fieldId,...body,created_at:new Date().toISOString()};records.unshift(record);return json(record,201);}return json(records);
 }
 if(section.startsWith('events/')&&method==='DELETE'){const records=events.get(fieldId)||[];const i=records.findIndex(e=>e.id===section.split('/')[1]);if(i>=0)records.splice(i,1);return new Response(null,{status:204});}
 if(section==='tasks'){
  const records=tasks.get(fieldId)||[];if(method==='POST'){let task=records.find(t=>t.client_key===body.client_key);if(!task){task={id:uuid(5000+records.length+fields.indexOf(field)*30),field_id:fieldId,...body,status:'open',boundary_version:field.boundary_version};records.unshift(task);}return json(task,201);}return json(records);
 }
 if(section.startsWith('tasks/')&&method==='PATCH'){const task=(tasks.get(fieldId)||[]).find(t=>t.id===section.split('/')[1]);if(task)task.status=body.status;return json(task||{});}
 if(section==='scouting'){
  const cases=scouting.get(fieldId)||[];if(method==='POST'){const item={id:uuid(3000+cases.length+fields.indexOf(field)*20),observed_on:body.observed_on,crop:body.crop||field.crop,symptoms:body.symptoms||'',notes:body.notes||'',diagnosis_status:'unavailable',diagnosis:{},photos:[{id:uuid(8000+cases.length),width:640,height:480,quality:'recorded'}]};cases.unshift(item);return json(item,201);}return json({cases,diagnosis:{status:'unavailable',provider:null,reason:'Showcase photo records only'}});
 }
 if(section==='jobs'){
  const records=jobs.get(fieldId)||[];if(method==='POST'){const kind=body.kind==='weather'?'weather':'satellite';const job={id:uuid(6000+records.length+fields.indexOf(field)*20),field_id:fieldId,boundary_version:field.boundary_version||1,kind,status:'succeeded',progress:'Complete',result:kind==='weather'?{imported:45}:{accepted:data.length>0,sceneId:data[0]?.scene_id},error:null,created_at:new Date().toISOString(),finished_at:new Date().toISOString()};records.unshift(job);return json(job,202);}return json(records);
 }
 if(section==='ndvi/process-latest')return json({accepted:data.length>0,sceneId:data[0]?.scene_id,ndvi:data[0]?.ndvi_value,validCoverage:data[0]?.valid_coverage_percent,attempts:data.length?[{sceneId:data[0].scene_id,status:'accepted'}]:[]});
 if(section==='ingest/weather')return json({source:'showcase',imported:45});
 if(section==='ingest/sentinel-scenes')return json({source:'showcase',imported:data.length});
 if(section.startsWith('ndvi/from-scene/'))return json({sceneId:section.split('/')[2],ndvi:data[0]?.ndvi_value||0,validPixels:720,validCoverage:91,healthScore:70,source:'showcase',accepted:true,qualityReason:null});
 if(section.startsWith('tiles/'))return mockTiles.clone();
 if(section.startsWith('overlay/'))return json({image:'',bounds:{north:Number(field.latitude)+.004,south:Number(field.latitude)-.004,east:Number(field.longitude)+.004,west:Number(field.longitude)-.004}});
 return json([]);
}
export function enableShowcase(){
 const original=window.fetch.bind(window);
 window.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.toString():input.url,window.location.origin);
  if(url.origin!==window.location.origin||!url.pathname.startsWith('/api/'))return original(input,init);
  let body:Record<string,unknown>={};try{body=JSON.parse(String(init?.body||'{}'));}catch{/* no body */}
  return respond(url.pathname,(init?.method||'GET').toUpperCase(),body,url.search);
 };
}
