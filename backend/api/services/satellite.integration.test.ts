import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pool} from '../db/pool.ts';
import {processScene,processLatest} from './satellite.ts';
import {getFields} from '../controllers/fieldsController.ts';
import type {Request,Response} from 'express';

// Explicit opt-in: uses only the isolated CHM database and deletes only its own fixture field.
test('PostGIS transactions preserve recency, deduplicate evidence, reject quality and version boundary edits', {skip:process.env.CHM_INTEGRATION!=='1'}, async()=>{
 const url=new URL(process.env.DATABASE_URL!);
 assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'5435');assert.equal(url.pathname,'/terrascope');
 assert.equal((await pool.query('select current_database() as name')).rows[0].name,'terrascope');
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
  for(const [scene,hours] of [['old',72],['new',24],['low',12],['changed',6]] as const){
   dates[scene]=new Date(Date.now()-hours*3600000).toISOString();
   await pool.query(`insert into satellite_scenes(field_id,scene_id,collection,observed_at,source,catalog_url,assets) values($1,$2,'sentinel-2-l2a',$3,'fixture','https://example.invalid',$4)`,[field.id,scene,dates[scene],JSON.stringify({red:{href:scene},nir:{href:'nir'},scl:{href:'scl'}})]);
  }
  globalThis.fetch=(async(_url:unknown,init:RequestInit)=>{
   const body=JSON.parse(init.body as string);
   if(body.redUrl==='old'){oldStarted();await oldGate;}
   if(body.redUrl==='changed'){boundaryStarted();await boundaryGate;}
   return new Response(JSON.stringify({ndvi:body.redUrl==='old'?.8:.6,ndmi:.3,ndre:null,savi:.6,evi:null,
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
  const changing=processScene(field.id,'changed');await boundaryReady;
  const edited={...polygon,coordinates:[[[77,28],[77.005,28],[77.005,28.005],[77,28.005],[77,28]]]};
  await pool.query('update fields set boundary_geom=ST_GeomFromGeoJSON($2) where id=$1',[field.id,JSON.stringify(edited)]);
  releaseBoundary();assert.equal((await changing).accepted,false);
  const version=(await pool.query('select boundary_version,latest_scene_id,last_observation from fields where id=$1',[field.id])).rows[0];
  assert.equal(version.boundary_version,2);assert.equal(version.latest_scene_id,null);assert.equal(version.last_observation,null);
  assert.equal((await pool.query('select count(*)::int as count from field_boundary_versions where field_id=$1',[field.id])).rows[0].count,2);
  assert.equal((await pool.query('select count(*)::int as count from vegetation_indices where field_id=$1 and boundary_version=1',[field.id])).rows[0].count,4);
  let responseFields:Array<{id:string;last_observation:string|null;assessment:{state:string};isDemo:boolean}> = [];
  await getFields({} as Request,{json(value:typeof responseFields){responseFields=value;},status(){throw new Error('Fields request failed');}} as unknown as Response);
  assert.equal(responseFields.find(item=>item.id===field.id)?.last_observation,null);
  assert.equal(responseFields.find(item=>item.id===field.id)?.assessment.state,'awaiting_analysis');
  const states=await pool.query('select scene_id,processing_status from satellite_scenes where field_id=$1',[field.id]);
  assert.ok(states.rows.every(row=>row.processing_status==='discovered'));
 }finally{
  releaseOld();releaseBoundary();globalThis.fetch=originalFetch;
  await pool.query('delete from fields where id=$1',[field.id]);await pool.end();
 }
});
