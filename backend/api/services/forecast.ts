/** Seven-day field forecast. Separate from historical NASA POWER observations. */
export type ForecastDay={date:string;min_c:number|null;max_c:number|null;rain_probability_percent:number|null;precipitation_mm:number|null;humidity_percent:number|null;wind_speed_kmh:number|null};
export type FieldForecast={source:'Open-Meteo'|'Synthetic showcase';source_url:string;field_id:string;issued_at:string;timezone:string;units:{temperature:'°C';precipitation:'mm';wind_speed:'km/h'};days:ForecastDay[]};
const num=(value:unknown, min=-Infinity,max=Infinity):number|null=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max?value:null;
const iso=(value:unknown)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value:'';
export function normaliseForecast(payload:unknown,fieldId:string,issuedAt:string):FieldForecast{
 if(!payload||typeof payload!=='object')throw new Error('Forecast provider returned invalid data');
 const obj=payload as Record<string,unknown>;
 const daily=obj.daily as Record<string,unknown>|undefined;
 if(!daily||!Array.isArray(daily.time)||daily.time.length<1||daily.time.length>7)throw new Error('Forecast provider returned incomplete dates');
 const hourly=obj.hourly as Record<string,unknown>|undefined;
 const hours=Array.isArray(hourly?.time)?hourly.time:[];
 const humidity=Array.isArray(hourly?.relative_humidity_2m)?hourly.relative_humidity_2m:[];
 const averageHumidity=(day:string):number|null=>{
  const values=hours.map((time,i)=>String(time).startsWith(day)?num(humidity[i],0,100):null).filter((value):value is number=>value!==null);
  return values.length?Math.round(values.reduce((sum,value)=>sum+value,0)/values.length):null;
 };
 const array=(key:string,index:number)=>Array.isArray(daily[key])?daily[key][index]:null;
 const days:ForecastDay[]=daily.time.map((value,index)=>{
  const date=iso(value);if(!date)throw new Error('Invalid forecast date');
  return {date,min_c:num(array('temperature_2m_min',index),-100,75),max_c:num(array('temperature_2m_max',index),-100,75),
   rain_probability_percent:num(array('precipitation_probability_max',index),0,100),
   precipitation_mm:num(array('precipitation_sum',index),0,2000),
   humidity_percent:averageHumidity(date),wind_speed_kmh:num(array('wind_speed_10m_max',index),0,500)};
 });
 return {source:'Open-Meteo',source_url:'https://open-meteo.com/',field_id:fieldId,issued_at:issuedAt,
  timezone:typeof obj.timezone==='string'?obj.timezone:'auto',
  units:{temperature:'°C',precipitation:'mm',wind_speed:'km/h'},days};
}
export function forecastUrl(lat:number,lon:number){
 const url=new URL('https://api.open-meteo.com/v1/forecast');
 url.searchParams.set('latitude',String(lat));url.searchParams.set('longitude',String(lon));
 url.searchParams.set('forecast_days','7');url.searchParams.set('timezone','auto');
 url.searchParams.set('daily','temperature_2m_min,temperature_2m_max,precipitation_probability_max,precipitation_sum,wind_speed_10m_max');
 url.searchParams.set('hourly','relative_humidity_2m');
 return url.toString();
}
