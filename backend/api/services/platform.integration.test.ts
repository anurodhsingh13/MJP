import {test,after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import type {Request,Response} from 'express';
import {askAssistant} from '../controllers/assistantController.ts';
import {pool} from '../db/pool.ts';import {syncNotifications,listNotifications,readNotifications,saveNotificationPreferences} from './notifications.ts';import {assistantHistory} from './assistantHistory.ts';import {forecastFor} from './forecast.ts';import {createFieldEvent} from '../controllers/fieldsController.ts';
const enabled=process.env.CHM_INTEGRATION==='1';
after(async()=>{await pool.end();});
async function invoke(handler:(request:Request,response:Response)=>Promise<void>,account:{id:string;email:string},body:unknown={},params:Record<string,string>={},query:Record<string,string>={}){let status=200;let payload:any;await handler({body,params,query} as unknown as Request,{locals:{account},status(code:number){status=code;return this;},json(value:unknown){payload=value;}} as unknown as Response);return {status,payload};}
test('platform persistence isolates owners, deduplicates notices and notes, and caches real-mode forecasts',{skip:!enabled},async()=>{
 const url=new URL(process.env.DATABASE_URL!);assert.ok(['localhost','127.0.0.1'].includes(url.hostname));assert.equal(url.pathname,'/chm_integration');
 const users:string[]=[];const fields:string[]=[];const original=globalThis.fetch;
 try{
  for(let i=0;i<2;i++){users.push((await pool.query("insert into app_users(email,password_hash) values($1,'unused') returning id",[`platform-${randomUUID()}@example.invalid`])).rows[0].id);fields.push((await pool.query("insert into fields(name,crop,owner_id,provenance,location) values('Platform fixture','Wheat',$1,'user_reported',ST_SetSRID(ST_MakePoint(77,28),4326)) returning id",[users[i]])).rows[0].id);}
  const account={id:users[0],email:'fixture@example.invalid'};
  await pool.query("insert into field_tasks(field_id,title,due_on) values($1,'Visit',current_date)",[fields[0]]);
  await pool.query("insert into ingestion_jobs(field_id,owner_id,boundary_version,kind,status) values($1,$2,1,'satellite','failed')",[fields[0],users[0]]);
  let calls=0;
  globalThis.fetch=(async()=>{calls++;const days=Array.from({length:7},(_,i)=>new Date(Date.now()+i*86400000).toISOString().slice(0,10));return new Response(JSON.stringify({timezone:'Asia/Kolkata',daily:{time:days,temperature_2m_min:Array(7).fill(20),temperature_2m_max:Array(7).fill(30),precipitation_sum:Array(7).fill(25),precipitation_probability_max:Array(7).fill(80)}}));}) as typeof fetch;
  const forecast=await forecastFor(fields[0]);assert.equal(forecast.days.length,7);await forecastFor(fields[0]);assert.equal(calls,1);
  await syncNotifications(users[0]);await syncNotifications(users[0]);const list=await invoke(listNotifications,account);assert.equal(list.payload.notifications.length,4);
  const other={id:users[1],email:'other@example.invalid'};await syncNotifications(users[1]);const otherList=await invoke(listNotifications,other);assert.equal(otherList.payload.notifications.length,1);
  await invoke(readNotifications,other,{ids:[list.payload.notifications[0].id]});assert.equal((await pool.query('select read_at from account_notifications where id=$1',[list.payload.notifications[0].id])).rows[0].read_at,null);
  assert.equal((await invoke(saveNotificationPreferences,account,{browser:'yes'})).status,400);
  await invoke(saveNotificationPreferences,account,{imagery:false,browser:false});assert.equal((await invoke(listNotifications,account)).payload.preferences.imagery,false);
  const client_key=randomUUID(),body={event_type:'scouting',event_date:new Date().toISOString().slice(0,10),notes:'Offline replay test',client_key};
  const first=await invoke(createFieldEvent,account,body,{fieldId:fields[0]}),second=await invoke(createFieldEvent,account,body,{fieldId:fields[0]});assert.equal(first.status,201);assert.equal(second.payload.id,first.payload.id);assert.equal((await pool.query('select count(*)::int n from field_events where field_id=$1 and client_key=$2',[fields[0],client_key])).rows[0].n,1);
  const previousKey=process.env.SARVAM_API_KEY;process.env.SARVAM_API_KEY='fixture-key';
  globalThis.fetch=(async()=>new Response(JSON.stringify({choices:[{message:{content:'A controlled fixture reply.'}}],model:'fixture'}))) as typeof fetch;
  try{const answer=await invoke(askAssistant,account,{message:'Explain NDVI',saveHistory:true});assert.equal(answer.status,200);assert.equal(answer.payload.historySaved,true);const history=await invoke(assistantHistory,account);assert.deepEqual(history.payload.map((item:{role:string})=>item.role),['user','assistant']);}finally{if(previousKey===undefined)delete process.env.SARVAM_API_KEY;else process.env.SARVAM_API_KEY=previousKey;}
  await pool.query("insert into assistant_messages(owner_id,field_id,role,content) values($1,$2,'user','Private fixture')",[users[0],fields[0]]);
  assert.equal((await invoke(assistantHistory,other,{}, {},{fieldId:fields[0]})).status,404);assert.equal((await invoke(assistantHistory,account,{}, {},{fieldId:fields[0]})).payload[0].content,'Private fixture');
 }finally{globalThis.fetch=original;if(fields.length)await pool.query('delete from fields where id=any($1::uuid[])',[fields]);if(users.length)await pool.query('delete from app_users where id=any($1::uuid[])',[users]);}
});
