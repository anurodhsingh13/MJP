import {after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../db/pool.ts';
import {queueStaleWeather} from './weatherSchedule.ts';

const enabled=process.env.CHM_INTEGRATION==='1';
after(async()=>{await pool.end();});

test('weather refresh queues only fields that are behind, once, and again only after the 6-hour guard',{skip:!enabled},async()=>{
 const url=new URL(process.env.DATABASE_URL!);assert.ok(['localhost','127.0.0.1'].includes(url.hostname));assert.equal(url.pathname,'/chm_integration');
 const user=(await pool.query("insert into app_users(email,password_hash) values($1,'unused') returning id",[`weather-${randomUUID()}@example.invalid`])).rows[0].id;
 const field=async(name:string)=>(await pool.query("insert into fields(name,crop,owner_id,provenance,location) values($1,'Wheat',$2,'user_reported',ST_SetSRID(ST_MakePoint(77,28),4326)) returning id",[name,user])).rows[0].id as string;
 const [behind,fresh,empty]=[await field('Weather behind'),await field('Weather fresh'),await field('Weather empty')];
 const ids=[behind,fresh,empty];
 const weather=(id:string,daysAgo:number)=>pool.query("insert into weather_observations(field_id,observed_on,temperature_c,source_url) values($1,current_date-$2::int,25,'https://example.invalid/fixture')",[id,daysAgo]);
 const queued=async()=>(await pool.query("select field_id::text from ingestion_jobs where kind='weather' and field_id=any($1::uuid[]) and status in ('queued','running')",[ids])).rows.map(r=>r.field_id).sort();
 try{
  await weather(behind,8);          // newest day is 8 days old: older than the 3-day publication lag, so it is behind
  await weather(fresh,3);           // newest day is exactly the publication lag: nothing newer can exist yet
  await queueStaleWeather();
  assert.deepEqual(await queued(),[behind,empty].sort(),'a field with old data and a field with none are queued; the up-to-date field is not');
  await queueStaleWeather();
  assert.equal((await pool.query("select count(*)::int n from ingestion_jobs where kind='weather' and field_id=any($1::uuid[])",[ids])).rows[0].n,2,'running the scheduler again must not duplicate jobs');
  await pool.query("update ingestion_jobs set status='succeeded',finished_at=now() where kind='weather' and field_id=any($1::uuid[])",[ids]);
  await queueStaleWeather();
  assert.deepEqual(await queued(),[],'a job that just finished blocks a new one for 6 hours (an outage is not retried every tick)');
  await pool.query("update ingestion_jobs set created_at=now()-interval '7 hours' where kind='weather' and field_id=any($1::uuid[])",[ids]);
  await queueStaleWeather();
  assert.deepEqual(await queued(),[behind,empty].sort(),'after the guard window the stale fields are queued again');
 }finally{
  await pool.query('delete from ingestion_jobs where field_id=any($1::uuid[])',[ids]);
  await pool.query('delete from weather_observations where field_id=any($1::uuid[])',[ids]);
  await pool.query('delete from fields where id=any($1::uuid[])',[ids]);
  await pool.query('delete from app_users where id=$1',[user]);
 }
});
