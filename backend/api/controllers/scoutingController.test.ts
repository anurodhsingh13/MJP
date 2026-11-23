import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Request,Response} from 'express';
import {saveScouting,checkPotatoLeaf} from './scoutingController.ts';

test('scouting rejects unsupported inspection labels before accessing storage or the database',async()=>{
 for(const invalid of [
  {observation_category:'disease_diagnosis',growth_stage:'vegetative',severity:'moderate'},
  {observation_category:'visual_symptom',growth_stage:'fruiting-outside-list',severity:'moderate'},
  {observation_category:'visual_symptom',growth_stage:'vegetative',severity:'extreme'},
 ]){
  let status=200;
  let payload:unknown;
  await saveScouting({
   params:{fieldId:'00000000-0000-0000-0000-000000000001'},
   body:{client_key:'00000000-0000-0000-0000-000000000002',observed_on:'2026-10-15',...invalid},
  } as unknown as Request,{
   status(code:number){status=code;return this;},
   json(value:unknown){payload=value;},
  } as unknown as Response);
  assert.equal(status,400);
  assert.deepEqual(payload,{error:'Choose a supported observation category, growth stage and severity'});
 }
});

// 1x1 JPEG; the controller only checks signature/size before forwarding to the engine.
const tinyJpeg='data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
function fakeResponse(){
 const out:{status:number;body?:unknown;headers:Record<string,string>}={status:200,headers:{}};
 const response={status(code:number){out.status=code;return response;},json(value:unknown){out.body=value;},setHeader(k:string,v:string){out.headers[k]=v;}};
 return {out,response:response as unknown as Response};
}
async function leafCheckWith(engine:{status:number;body:unknown}|'down',image:unknown=tinyJpeg){
 const original=globalThis.fetch;
 globalThis.fetch=(async()=>{if(engine==='down')throw new Error('connection refused');return new Response(JSON.stringify(engine.body),{status:engine.status});}) as typeof fetch;
 try{const {out,response}=fakeResponse();await checkPotatoLeaf({params:{fieldId:'f'},body:{image}} as unknown as Request,response);return out;}
 finally{globalThis.fetch=original;}
}

test('leaf check rejects a missing or malformed image without calling the engine',async()=>{
 for(const image of [null,'not-a-data-url','data:image/gif;base64,R0lGODlhAQABAAAAACw=']){
  assert.equal((await leafCheckWith({status:200,body:{}},image)).status,400);
 }
});

test('leaf check passes an answered result through and never stores it',async()=>{
 const out=await leafCheckWith({status:200,body:{status:'answered',label:'Late Blight',confidence:0.97,probabilities:{Healthy:0.01,'Early Blight':0.02,'Late Blight':0.97},modelVersion:'v1',disclaimer:'d',serverPath:'/secret'}});
 assert.equal(out.status,200);
 const body=out.body as Record<string,unknown>;
 assert.equal(body.status,'answered');assert.equal(body.label,'Late Blight');
 assert.equal('serverPath' in body,false);
 assert.equal(out.headers['Cache-Control'],'no-store');
});

test('leaf check reports not_sure and photo_quality without a label',async()=>{
 const unsure=(await leafCheckWith({status:200,body:{status:'not_sure',label:null,confidence:0.6}})).body as Record<string,unknown>;
 assert.equal(unsure.status,'not_sure');assert.equal(unsure.label,null);
 const poor=(await leafCheckWith({status:200,body:{status:'photo_quality',issues:['underexposed'],suggestions:['Retake']}})).body as Record<string,unknown>;
 assert.deepEqual(poor.issues,['underexposed']);assert.equal(poor.label,null);
});

test('leaf check says unavailable when the model is missing, and 503 when the engine is down',async()=>{
 const missing=await leafCheckWith({status:503,body:{detail:'x'}});
 assert.equal(missing.status,200);assert.deepEqual(missing.body,{status:'unavailable'});
 assert.equal((await leafCheckWith('down')).status,503);
 assert.equal((await leafCheckWith({status:200,body:{status:'surprise'}})).status,502);
});
