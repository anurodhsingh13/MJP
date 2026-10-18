import type {Request,Response} from 'express';
import {pool} from '../db/pool.ts';
import {forecastUrl,normaliseForecast} from '../services/forecast.ts';
const CACHE_MS=10*60*1000;
const cache=new Map<string,{expires:number;data:ReturnType<typeof normaliseForecast>}>();
export async function getFieldForecast(request:Request,response:Response){
 const fieldId=String(request.params.fieldId);
 try{
  const location=await pool.query<{latitude:number|null;longitude:number|null}>(
   'select ST_Y(location) as latitude, ST_X(location) as longitude from public.fields where id=$1',[fieldId]);
  if(!location.rowCount){response.status(404).json({error:'Field not found'});return;}
  const {latitude,longitude}=location.rows[0];
  if(latitude===null||longitude===null||!Number.isFinite(Number(latitude))||!Number.isFinite(Number(longitude))){
   response.status(422).json({error:'Add a valid field location to see its forecast'});return;
  }
  const now=Date.now();
  const key=`${fieldId}:${latitude}:${longitude}`;
  const stored=cache.get(key);
  if(stored&&stored.expires>now){response.json(stored.data);return;}
  const url=forecastUrl(Number(latitude),Number(longitude));
  const provider=await fetch(url,{signal:AbortSignal.timeout(12000),headers:{Accept:'application/json'}});
  if(!provider.ok){response.status(503).json({error:'Forecast provider unavailable. Historical weather is unchanged.'});return;}
  const raw=await provider.json() as unknown;
  const forecast=normaliseForecast(raw,fieldId,new Date(now).toISOString());
  cache.set(key,{expires:now+CACHE_MS,data:forecast});
  if(cache.size>250)for(const [id,entry] of cache)if(entry.expires<=now)cache.delete(id);
  response.json(forecast);
 }catch(error){
  console.error('Forecast request unavailable:',error instanceof Error?error.message:'Unknown error');
  response.status(503).json({error:'Unable to fetch the weather forecast right now. Retry later.'});
 }
}
