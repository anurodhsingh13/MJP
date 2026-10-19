import type {Request,Response} from 'express';
import {pool} from '../db/pool.ts';
import {providerJson} from './provider.ts';
import {parseForecast,type Forecast} from '../../../shared/forecast.ts';
const cache=new Map<string,{value:Forecast;latitude:number;longitude:number}>();
const pending=new Map<string,Promise<Forecast>>();
export async function forecastFor(fieldId:string):Promise<Forecast>{
 const field=(await pool.query<{latitude:number|null;longitude:number|null}>('select ST_Y(location) latitude,ST_X(location) longitude from fields where id=$1',[fieldId])).rows[0];
 if(!field||field.latitude===null||field.longitude===null)throw new Error('Add field coordinates to enable the forecast');
 const {latitude,longitude}=field;
 const key=fieldId+':'+latitude+':'+longitude;
 const stored=(await pool.query<{payload:Forecast}>('select payload from field_forecasts where field_id=$1 and latitude=$2 and longitude=$3 and expires_at>now()',[fieldId,latitude,longitude])).rows[0];if(stored)return stored.payload;
 const cached=cache.get(key);if(cached&&Date.parse(cached.value.expiresAt)>Date.now())return cached.value;
 if(pending.has(key))return pending.get(key)!;
 const work=(async()=>{
  const url=new URL('https://api.open-meteo.com/v1/forecast');
  url.search=new URLSearchParams({latitude:String(latitude),longitude:String(longitude),daily:'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,relative_humidity_2m_mean,wind_speed_10m_max',current:'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m',forecast_days:'7',timezone:'auto'}).toString();
  const value=parseForecast(await providerJson(url.href));
  await pool.query('insert into field_forecasts(field_id,latitude,longitude,retrieved_at,expires_at,payload) values($1,$2,$3,$4,$5,$6) on conflict(field_id) do update set latitude=excluded.latitude,longitude=excluded.longitude,retrieved_at=excluded.retrieved_at,expires_at=excluded.expires_at,payload=excluded.payload',[fieldId,latitude,longitude,value.retrievedAt,value.expiresAt,JSON.stringify(value)]);
  if(cache.size>=500)cache.delete(cache.keys().next().value!);cache.set(key,{value,latitude,longitude});return value;
 })();pending.set(key,work);try{return await work;}finally{pending.delete(key);}
}
export async function getForecast(request:Request,response:Response){
 try{response.json(await forecastFor(String(request.params.fieldId)));}catch(error){
  const noLocation=error instanceof Error&&error.message.startsWith('Add field');response.status(noLocation?422:502).json({error:noLocation?'Add field coordinates to enable the forecast':'Forecast provider unavailable. Historical weather is unchanged; retry shortly.'});
 }
}
