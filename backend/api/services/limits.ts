import type {Request,Response,NextFunction} from 'express';import {pool} from '../db/pool.ts';import {actor,hashToken} from './auth.ts';
export function rateLimit(scope:string,limit:number,windowSeconds=900){return async(request:Request,response:Response,next:NextFunction)=>{
 try{
  const key=hashToken(scope+':'+(actor(response)?.id||request.ip||'local'));
  const row=(await pool.query<{attempts:number}>(`insert into auth_limits(key,attempts) values($1,1) on conflict(key) do update set attempts=case when auth_limits.window_start<now()-$2*interval '1 second' then 1 else auth_limits.attempts+1 end,window_start=case when auth_limits.window_start<now()-$2*interval '1 second' then now() else auth_limits.window_start end returning attempts`,[key,windowSeconds])).rows[0];
  if(row.attempts>limit){response.setHeader('Retry-After',String(windowSeconds));response.status(429).json({error:'Too many requests. Please retry shortly.'});return;}next();
 }catch{response.status(503).json({error:'Request service unavailable. Please retry shortly.'});}
};}
