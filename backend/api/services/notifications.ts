import type {Request,Response} from 'express';
import {pool} from '../db/pool.ts';import {actor} from './auth.ts';
export const defaultNotificationPreferences={visits:true,imagery:true,processing:true,weather:true,browser:false};
export type NotificationPreferences=typeof defaultNotificationPreferences;
export function notificationPreferences(value:unknown):NotificationPreferences{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Use valid notification preferences');
 const result={...defaultNotificationPreferences};for(const key of Object.keys(result) as (keyof NotificationPreferences)[]){const input=(value as Record<string,unknown>)[key];if(input!==undefined&&typeof input!=='boolean')throw Error('Notification preferences must be true or false');if(input!==undefined)result[key]=input as boolean;}return result;
}
export async function syncNotifications(ownerId:string){
 // Stable evidence/task/job identities prevent duplicate notifications on repeated refreshes.
 await pool.query(`insert into account_notifications(owner_id,field_id,event_key,kind,title_en,title_hi,field_name,href)
 select f.owner_id,f.id,'task:'||t.id||':'||t.due_on,'visits','Planned field visit is due','खेत की तय जाँच बाकी है',f.name,'/fields/'||f.id||'/overview#planned-tasks'
 from field_tasks t join fields f on f.id=t.field_id where f.owner_id=$1 and f.provenance not in ('demo','public_boundary') and t.due_on<=current_date and t.status<>'resolved'
 union all
 select f.owner_id,f.id,'alert:'||a.id,'imagery',a.title,'हरियाली में बदलाव: खेत की जाँच करें',f.name,'/fields/'||f.id||'/map'
 from alerts a join fields f on f.id=a.field_id where f.owner_id=$1 and a.action_status not in ('resolved','superseded') and a.boundary_version=f.boundary_version
 union all
 select f.owner_id,f.id,'job:'||j.id,'processing',case when j.status='succeeded' then 'Processing completed' else 'Processing failed — retry is available' end,case when j.status='succeeded' then 'प्रोसेसिंग पूरी हुई' else 'प्रोसेसिंग रुकी — फिर कोशिश करें' end,f.name,'/fields/'||f.id||'/overview'
 from ingestion_jobs j join fields f on f.id=j.field_id where f.owner_id=$1 and j.status in ('succeeded','failed') and j.boundary_version=f.boundary_version
 union all
 select f.owner_id,f.id,'imagery:'||f.id||':'||f.boundary_version||':'||coalesce(f.latest_scene_id,'none'),'imagery','A newer usable satellite image is needed','नई साफ़ सैटेलाइट तस्वीर चाहिए',f.name,'/fields/'||f.id||'/map'
 from fields f where f.owner_id=$1 and f.provenance not in ('demo','public_boundary') and (f.last_observation is null or f.last_observation<current_date-14)
 union all
 select f.owner_id,f.id,'weather:'||f.id||':'||ff.retrieved_at::date,'weather','Heavy rain is forecast; check drainage and forecast updates','तेज़ बारिश का अनुमान: जल निकासी और अपडेट देखें',f.name,'/fields/'||f.id||'/overview#field-forecast'
 from field_forecasts ff join fields f on f.id=ff.field_id where f.owner_id=$1 and ff.expires_at>now() and exists(select 1 from jsonb_array_elements(ff.payload->'days') d where (d->>'rainMm')::numeric>=20)
 on conflict(owner_id,event_key) do nothing`,[ownerId]);
}
export async function listNotifications(_request:Request,response:Response){
 const account=actor(response);if(!account){response.json({notifications:[],preferences:defaultNotificationPreferences,mode:'local'});return;}
 await syncNotifications(account.id);
 const preferences=(await pool.query('select preferences from notification_preferences where owner_id=$1',[account.id])).rows[0]?.preferences||defaultNotificationPreferences;
 const notifications=(await pool.query('select id,field_id,field_name,title_en,title_hi,kind,href,read_at,created_at from account_notifications where owner_id=$1 order by created_at desc,id desc limit 100',[account.id])).rows;
 response.json({notifications,preferences,mode:'account'});
}
export async function readNotifications(request:Request,response:Response){
 const account=actor(response);if(!account){response.status(401).json({error:'Sign in to update notifications'});return;}
 const ids=request.body?.ids;const all=request.body?.all===true;
 if(!all&&(!Array.isArray(ids)||ids.length>100||ids.some(id=>typeof id!=='string'||!/^[-a-f0-9]{36}$/i.test(id)))){response.status(400).json({error:'Choose valid notifications'});return;}
 await pool.query('update account_notifications set read_at=coalesce(read_at,now()) where owner_id=$1 and ($2::boolean or id=any($3::uuid[]))',[account.id,all,all?[]:ids]);response.json({ok:true});
}
export async function saveNotificationPreferences(request:Request,response:Response){
 const account=actor(response);if(!account){response.status(401).json({error:'Sign in to save preferences'});return;}
 let preferences:NotificationPreferences;try{preferences=notificationPreferences(request.body);}catch{response.status(400).json({error:'Use valid notification preferences'});return;}
 await pool.query('insert into notification_preferences(owner_id,preferences) values($1,$2) on conflict(owner_id) do update set preferences=excluded.preferences',[account.id,JSON.stringify(preferences)]);response.json({preferences});
}
