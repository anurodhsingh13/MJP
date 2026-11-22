import {test} from 'node:test';
import assert from 'node:assert/strict';
import {backfillBaseline,pickBaselineScenes,type BaselineEngine,type BaselineScene} from './baselineBackfill.ts';

const scene=(tile:string,date:string,cloud:number,n=date):BaselineScene=>({id:`20250101T050000_20250101T050000_T${tile}`.replace('20250101T050000_20250101T050000',n.replace(/-/g,'')),image_id:`COPERNICUS/S2_SR_HARMONIZED/${n}_${tile}`,observed_at:`${date}T05:00:00+00:00`,cloud_cover:cloud});
const A='11111111-1111-4111-8111-111111111111';

test('one least-cloudy scene per 10-day bin, only on the primary tile, oldest first',()=>{
 const scenes=[scene('44RKT','2025-06-02',30),scene('44RKT','2025-06-04',5),scene('43RGK','2025-06-04',1,'20250604b'),scene('44RKT','2025-06-25',10)];
 const picked=pickBaselineScenes(scenes,'44RKT');
 assert.deepEqual(picked.map(item=>item.observed_at.slice(0,10)),['2025-06-04','2025-06-25']);
 assert.ok(picked.every(item=>item.id.endsWith('T44RKT')));
 const any=pickBaselineScenes(scenes,null);
 assert.equal(any.length,2);
 assert.ok(any[0].id.endsWith('T43RGK'));
});

function fakeDb(known:string[]=[],field:Record<string,unknown>|null={boundary_version:2,sentinel_tile:'44RKT'}){
 const inserts:unknown[][]=[];
 return {inserts,async query(text:string,values?:unknown[]){
  if(text.includes('from public.fields'))return {rows:field?[field]:[]};
  if(text.includes('from public.field_ndvi_baseline'))return {rows:known.map(scene_id=>({scene_id}))};
  if(text.includes('insert into public.field_ndvi_baseline')){inserts.push(values??[]);return {rows:[]};}
  throw new Error('unexpected query');
 }};
}
const engineFor=(scenes:BaselineScene[],measure:BaselineEngine['measure'])=>({async search(start:string,end:string){return scenes.filter(item=>item.observed_at.slice(0,10)>=start&&item.observed_at.slice(0,10)<end);},measure});

test('stores only usable readings, skips stored dates and counts failures',async()=>{
 const scenes=[scene('44RKT','2024-06-04',5),scene('44RKT','2024-07-04',5),scene('44RKT','2024-08-04',5),scene('44RKT','2024-09-04',5),scene('44RKT','2024-10-04',5)];
 const db=fakeDb(['gee-20240604_T44RKT']);
 const measure=async(imageId:string)=>{
  if(imageId.includes('2024-07-04'))return {ndvi:.6,validPixels:200,validCoverage:95};
  if(imageId.includes('2024-08-04'))return {ndvi:.6,validPixels:200,validCoverage:40};
  if(imageId.includes('2024-09-04'))throw new Error('engine down');
  return {ndvi:.5,validPixels:200,validCoverage:90};
 };
 const summary=await backfillBaseline(db,A,[2024],engineFor(scenes,measure),new Date('2026-11-22T00:00:00Z'));
 assert.deepEqual(summary,{years:[2024],candidates:5,stored:2,alreadyStored:1,unusable:1,failed:1});
 assert.equal(db.inserts.length,2);
 assert.equal(db.inserts[0][0],A);
 assert.equal(db.inserts[0][1],2);
 assert.equal(db.inserts[0][2],'gee-20240704_T44RKT');
});

test('only earlier years from 2018 are accepted and the field must exist',async()=>{
 const engine=engineFor([],async()=>null);
 const now=new Date('2026-11-22T00:00:00Z');
 for(const years of [[],[2026],[2017],[2024.5]])await assert.rejects(backfillBaseline(fakeDb(),A,years,engine,now),/earlier years/);
 await assert.rejects(backfillBaseline(fakeDb([],null),A,[2024],engine,now),/Field not found/);
});
