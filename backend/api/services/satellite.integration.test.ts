import {after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {pool} from '../db/pool.ts';
import {processScene,processLatest} from './satellite.ts';
import {getFields} from '../controllers/fieldsController.ts';
import {hashToken} from './auth.ts';
import {app} from '../app.ts';
import type {Request,Response} from 'express';

function integrationDatabaseUrl(value:string|undefined):URL{
 assert.ok(value,'DATABASE_URL must point to the dedicated CHM integration database');
 const url=new URL(value);
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname),'Integration tests may only connect to loopback PostgreSQL');
 assert.ok(['5432','5435'].includes(url.port||'5432'),'Integration tests may only use the standard local PostgreSQL ports');
 assert.equal(url.pathname,'/chm_integration','Refusing to run against a development or production database');
 return url;
}

test('integration database guard rejects ordinary development and remote databases',()=>{
 assert.throws(()=>integrationDatabaseUrl('postgres://localhost:5432/terrascope'),/development or production/);
 assert.throws(()=>integrationDatabaseUrl('postgres://db.example.com:5432/chm_integration'),/loopback/);
});

// Explicit opt-in: requires a dedicated local CHM integration database and deletes only its fixture field.
test('PostGIS transactions preserve recency, deduplicate evidence, reject quality and version boundary edits', {skip:process.env.CHM_INTEGRATION!=='1'}, async()=>{
 integrationDatabaseUrl(process.env.DATABASE_URL);
 assert.equal((await pool.query('select current_database() as name')).rows[0].name,'chm_integration');
 const polygon={type:'Polygon',coordinates:[[[77,28],[77.01,28],[77.01,28.01],[77,28.01],[77,28]]]};
 const field=(await pool.query(`insert into fields(name,crop,boundary_geom,location) values('Evidence regression fixture','Unknown',ST_GeomFromGeoJSON($1),ST_SetSRID(ST_MakePoint(77,28),4326)) returning id`,[JSON.stringify(polygon)])).rows[0];
 const originalFetch=globalThis.fetch;
 let releaseOld:()=>void=()=>{};
 let oldStarted:()=>void=()=>{};
 let releaseBoundary:()=>void=()=>{};
 let boundaryStarted:()=>void=()=>{};
 const oldReady=new Promise<void>(resolve=>{oldStarted=resolve;});
 const oldGate=new Promise<void>(resolve=>{releaseOld=resolve;});
 const boundaryReady=new Promise<void>(resolve=>{boundaryStarted=resolve;});
 const boundaryGate=new Promise<void>(resolve=>{releaseBoundary=resolve;});
 const dates:Record<string,string>={};
 try{
  for(const [scene,hours] of [['old',96],['new',48],['low',24],['changed',12]] as const){
   dates[scene]=new Date(Date.now()-hours*3600000).toISOString();
   await pool.query(`insert into satellite_scenes(field_id,scene_id,collection,observed_at,source,catalog_url,assets) values($1,$2,'sentinel-2-l2a',$3,'fixture','https://example.invalid',$4)`,[field.id,scene,dates[scene],JSON.stringify({red:{href:scene},nir:{href:'nir'},scl:{href:'scl'}})]);
  }
  globalThis.fetch=(async(_url:unknown,init:RequestInit)=>{
   const body=JSON.parse(init.body as string);
   if(body.redUrl==='old'){oldStarted();await oldGate;}
   if(body.redUrl==='changed'){boundaryStarted();await boundaryGate;}
   return new Response(JSON.stringify({ndvi:body.redUrl==='old'?.8:body.redUrl==='recovered'?.9:.6,ndmi:.3,ndre:null,savi:.6,evi:null,
    validPixels:body.redUrl==='low'?2:100,validCoverage:body.redUrl==='low'?20:90,minimum:.2,maximum:.8,median:.6,standardDeviation:.01,stressGeojson:null}));
  }) as typeof fetch;
  const older=processScene(field.id,'old');await oldReady;
  await processScene(field.id,'new');releaseOld();await older;
  let summary=(await pool.query('select latest_scene_id,last_observation,ndvi_average from fields where id=$1',[field.id])).rows[0];
  assert.equal(summary.latest_scene_id,'new');assert.equal(Number(summary.ndvi_average),.6);
  await processScene(field.id,'new');
  assert.equal((await pool.query('select count(*)::int as count from vegetation_indices where field_id=$1',[field.id])).rows[0].count,2);
  assert.equal((await pool.query('select count(*)::int as count from alerts where field_id=$1',[field.id])).rows[0].count,1);
  assert.equal((await processScene(field.id,'low')).accepted,false);
  summary=(await pool.query('select latest_scene_id from fields where id=$1',[field.id])).rows[0];assert.equal(summary.latest_scene_id,'new');
  // Skip the newest candidate for this fallback check; newest eligible is the low-quality scene.
  await pool.query("update satellite_scenes set observed_at=now()-interval '400 days' where field_id=$1 and scene_id='changed'",[field.id]);
  const latest=await processLatest(field.id);assert.equal(latest.accepted,true);assert.ok('sceneId' in latest);assert.equal(latest.sceneId,'new');
  assert.equal(latest.attempts[0].sceneId,'low');assert.equal(latest.attempts[0].status,'rejected');
  const recoveredAt=new Date(Date.now()-3600000).toISOString();
  await pool.query(`insert into satellite_scenes(field_id,scene_id,collection,observed_at,source,catalog_url,assets)
   values($1,'recovered','sentinel-2-l2a',$2,'fixture','https://example.invalid',$3)`,
   [field.id,recoveredAt,JSON.stringify({red:{href:'recovered'},nir:{href:'nir'},scl:{href:'scl'}})]);
  const recovered=await processScene(field.id,'recovered');assert.equal(recovered.accepted,true);
  summary=(await pool.query('select latest_scene_id from fields where id=$1',[field.id])).rows[0];
  assert.equal(summary.latest_scene_id,'recovered');
  assert.equal((await pool.query("select action_status from alerts where field_id=$1 and evidence_key like 'decline:%'",[field.id])).rows[0].action_status,'superseded');
  const changing=processScene(field.id,'changed');await boundaryReady;
  const edited={...polygon,coordinates:[[[77,28],[77.005,28],[77.005,28.005],[77,28.005],[77,28]]]};
  await pool.query('update fields set boundary_geom=ST_GeomFromGeoJSON($2) where id=$1',[field.id,JSON.stringify(edited)]);
  releaseBoundary();assert.equal((await changing).accepted,false);
  const version=(await pool.query('select boundary_version,latest_scene_id,last_observation from fields where id=$1',[field.id])).rows[0];
  assert.equal(version.boundary_version,2);assert.equal(version.latest_scene_id,null);assert.equal(version.last_observation,null);
  assert.equal((await pool.query('select count(*)::int as count from field_boundary_versions where field_id=$1',[field.id])).rows[0].count,2);
  assert.equal((await pool.query('select count(*)::int as count from vegetation_indices where field_id=$1 and boundary_version=1',[field.id])).rows[0].count,5);
  let responseFields:Array<{id:string;last_observation:string|null;assessment:{state:string};isDemo:boolean}> = [];
  await getFields({} as Request,{json(value:typeof responseFields){responseFields=value;},status(){throw new Error('Fields request failed');}} as unknown as Response);
  assert.equal(responseFields.find(item=>item.id===field.id)?.last_observation,null);
  assert.equal(responseFields.find(item=>item.id===field.id)?.assessment.state,'awaiting_analysis');
  const states=await pool.query('select scene_id,processing_status from satellite_scenes where field_id=$1',[field.id]);
  assert.ok(states.rows.every(row=>row.processing_status==='discovered'));
 }finally{
  releaseOld();releaseBoundary();globalThis.fetch=originalFetch;
  await pool.query('delete from fields where id=$1',[field.id]);
 }
});

test('field owners cannot read or mutate another account’s field through the API',{skip:process.env.CHM_INTEGRATION!=='1'},async()=>{
 integrationDatabaseUrl(process.env.DATABASE_URL);
 const previousAuthMode=process.env.AUTH_MODE;process.env.AUTH_MODE='required';
 const users=[randomUUID(),randomUUID()],fields:string[]=[randomUUID(),randomUUID()],tokens=[randomBytes(32).toString('hex'),randomBytes(32).toString('hex')];
 const polygon={type:'Polygon',coordinates:[[[77,28],[77.01,28],[77.01,28.01],[77,28.01],[77,28]]]};
 let server:ReturnType<typeof app.listen>|undefined;
 try{
  for(let index=0;index<2;index++){
   await pool.query('insert into app_users(id,email,password_hash) values($1,$2,$3)',[users[index],`ownership-${users[index]}@example.invalid`,'unused']);
   await pool.query('insert into app_sessions(token_hash,user_id,expires_at) values($1,$2,now()+interval \'5 minutes\')',[hashToken(tokens[index]),users[index]]);
   await pool.query(`insert into fields(id,name,crop,boundary_geom,location,owner_id) values($1,$2,'Unknown',ST_GeomFromGeoJSON($3),ST_SetSRID(ST_MakePoint(77,28),4326),$4)`,[fields[index],`Private field ${index}`,JSON.stringify(polygon),users[index]]);
  }
  server=app.listen(0,'127.0.0.1');
  await new Promise<void>((resolve,reject)=>{server?.once('listening',resolve);server?.once('error',reject);});
  const address=server.address();assert.ok(address&&typeof address!=='string');
  const base=`http://127.0.0.1:${address.port}/api/fields`;
  const headers={cookie:`chm_session=${tokens[0]}`,origin:'http://localhost:5173'};
  const owned=await fetch(base,{headers});assert.equal(owned.status,200);
  const records=await owned.json() as Array<{id:string}>;assert.deepEqual(records.map(record=>record.id),[fields[0]]);
  for(const path of [`/${fields[1]}`,`/${fields[1]}/scenes`,`/${fields[1]}/alerts`,`/${fields[1]}/ndvi`,`/${fields[1]}/events`,`/${fields[1]}/scouting`,`/${fields[1]}/tasks`]){
   const response=await fetch(base+path,{headers});assert.equal(response.status,404,path);
  }
  const queued=await fetch(`${base}/${fields[1]}/jobs`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({kind:'satellite'})});
  assert.equal(queued.status,404);
  const assistant=await fetch(new URL('/api/assistant',base),{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({fieldId:fields[1],message:'Review the field'})});
  assert.equal(assistant.status,404);
  const patch=await fetch(`${base}/${fields[1]}/boundary`,{method:'PATCH',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({boundary_geojson:{...polygon,coordinates:[[[77,28],[77.005,28],[77.005,28.005],[77,28.005],[77,28]]]}})});
  assert.equal(patch.status,404);
  const crossOrigin=await fetch(`${base}/${fields[0]}/boundary`,{method:'PATCH',headers:{cookie:headers.cookie,origin:'https://attacker.invalid','content-type':'application/json'},body:'{}'});
  assert.equal(crossOrigin.status,403);
  const clientKey=randomUUID(),createBody={name:'Idempotent field',crop:'Unknown',boundary_geojson:polygon};
  const create=()=>fetch(base,{method:'POST',headers:{...headers,'content-type':'application/json','Idempotency-Key':clientKey},body:JSON.stringify(createBody)});
  const created=(await create());assert.equal(created.status,201);const createdField=await created.json() as {id:string};fields.push(createdField.id);
  const retried=(await create());assert.equal(retried.status,201);assert.equal((await retried.json() as {id:string}).id,createdField.id);
  assert.equal((await pool.query('select count(*)::int as count from fields where client_key=$1',[clientKey])).rows[0].count,1);
  const unchanged=(await pool.query('select boundary_version from fields where id=$1',[fields[1]])).rows[0];
  assert.equal(unchanged.boundary_version,1);
 }finally{
  if(server)await new Promise<void>((resolve,reject)=>server!.close(error=>error?reject(error):resolve()));
  await pool.query('delete from fields where id=any($1::uuid[])',[fields]);
  await pool.query('delete from app_users where id=any($1::uuid[])',[users]);
  if(previousAuthMode===undefined)delete process.env.AUTH_MODE;else process.env.AUTH_MODE=previousAuthMode;
 }
});

after(async()=>{await pool.end();});
