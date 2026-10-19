export type ForecastDay={date:string;minC:number|null;maxC:number|null;rainMm:number|null;rainChance:number|null;humidity:number|null;windKph:number|null};
export type Forecast={source:string;sourceUrl:string;retrievedAt:string;expiresAt:string;issuedAt:string|null;timezone:string;provenance:'forecast'|'demo';current:{time:string;temperatureC:number|null;humidity:number|null;rainMm:number|null;windKph:number|null}|null;days:ForecastDay[]};
const number=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:null;
export function parseForecast(value:unknown,now=Date.now()):Forecast{
 const data=value as Record<string,any>;const daily=data?.daily;
 if(!Array.isArray(daily?.time)||daily.time.length!==7||typeof data.timezone!=='string')throw new Error('Forecast provider returned incomplete data');
 const days:ForecastDay[]=daily.time.map((date:unknown,i:number)=>{
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date)))throw new Error('Invalid forecast date');
  const row={date,minC:number(daily.temperature_2m_min?.[i]),maxC:number(daily.temperature_2m_max?.[i]),rainMm:number(daily.precipitation_sum?.[i]),rainChance:number(daily.precipitation_probability_max?.[i]),humidity:number(daily.relative_humidity_2m_mean?.[i]),windKph:number(daily.wind_speed_10m_max?.[i])};
  if(row.minC===null||row.maxC===null||row.minC>row.maxC||row.minC< -100||row.maxC>70||(row.rainMm!==null&&row.rainMm<0)||(row.rainChance!==null&&(row.rainChance<0||row.rainChance>100))||(row.humidity!==null&&(row.humidity<0||row.humidity>100)))throw new Error('Invalid forecast measurements');
  return row;
 });
 if(new Set(days.map(day=>day.date)).size!==7||days.some((day,i)=>i>0&&day.date<=days[i-1].date))throw new Error('Forecast days must be distinct and ordered');
 const current=data.current&&typeof data.current.time==='string'?{time:data.current.time,temperatureC:number(data.current.temperature_2m),humidity:number(data.current.relative_humidity_2m),rainMm:number(data.current.precipitation),windKph:number(data.current.wind_speed_10m)}:null;
 return {source:'Open-Meteo',sourceUrl:'https://open-meteo.com/',retrievedAt:new Date(now).toISOString(),expiresAt:new Date(now+30*60000).toISOString(),issuedAt:null,timezone:data.timezone,provenance:'forecast',current,days};
}
export function demoForecast():Forecast{
 const today=new Date();const days=Array.from({length:7},(_,i)=>({date:new Date(Date.UTC(today.getFullYear(),today.getMonth(),today.getDate()+i)).toISOString().slice(0,10),minC:19+i%3,maxC:29+i%4,rainMm:i===2?24:i===3?7:0,rainChance:i===2?85:i===3?65:10,humidity:60+i*2,windKph:10+i}));
 return {source:'Synthetic forecast fixture',sourceUrl:'',retrievedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+1800000).toISOString(),issuedAt:null,timezone:'Asia/Kolkata',provenance:'demo',current:{time:new Date().toISOString(),temperatureC:26,humidity:60,rainMm:0,windKph:10},days};
}
