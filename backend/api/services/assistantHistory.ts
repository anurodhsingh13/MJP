import type {Request,Response} from 'express';import {pool} from '../db/pool.ts';import {actor} from './auth.ts';
let lastSuccessAt:string|null=null;
export function recordAssistantSuccess(){lastSuccessAt=new Date().toISOString();}
export async function assistantAvailability(_request:Request,response:Response){response.json({configured:Boolean(process.env.SARVAM_API_KEY?.trim()&&!process.env.SARVAM_API_KEY.trim().startsWith('your-')),model:process.env.SARVAM_MODEL?.trim()||'sarvam-105b',mode:'provider',lastSuccessAt,availability:'Connectivity is verified only when a request succeeds'});}
export async function assistantHistory(request:Request,response:Response){
 const account=actor(response);if(!account){response.json([]);return;}
 const fieldId=request.query.fieldId;
 if(fieldId!==undefined&&(typeof fieldId!=='string'||!/^[-a-f0-9]{36}$/i.test(fieldId))){response.status(400).json({error:'Use a valid field id'});return;}
 if(fieldId&&!(await pool.query('select id from fields where id=$1 and owner_id=$2',[fieldId,account.id])).rowCount){response.status(404).json({error:'Field not found'});return;}
 response.json((await pool.query('select role,content,created_at from (select role,content,created_at,position from assistant_messages where owner_id=$1 and field_id is not distinct from $2::uuid order by created_at desc,position desc limit 30) history order by created_at,position',[account.id,fieldId||null])).rows);
}
export async function deleteAssistantHistory(_request:Request,response:Response){const account=actor(response);if(!account){response.status(401).json({error:'Sign in to clear saved conversations'});return;}await pool.query('delete from assistant_messages where owner_id=$1',[account.id]);response.json({ok:true});}
