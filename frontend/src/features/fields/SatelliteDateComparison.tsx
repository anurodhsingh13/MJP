import {useState} from 'react';
import {OpenFieldMap} from '../../lib/OpenFieldMap';
import {qualityReason} from '../../../../shared/evidence';
import {findImageForDate,type DatabaseField,type Observation} from '../../lib/api';
import {usePreferences} from '../../lib/preferencesContext';
import '../platform.css';
import './ndvi-versus.css';

type IndexKey='ndvi'|'ndre'|'ndmi';
/** Fixed value range and colours per index. They match the engine's tile renderer, so a colour means the same value on every date. */
const INDEXES:Record<IndexKey,{label:string;field:'ndvi_value'|'ndre_value'|'ndmi_value';min:number;max:number;ticks:number[];bar:string}>={
 ndvi:{label:'NDVI',field:'ndvi_value',min:-0.2,max:1,ticks:[-0.2,0,0.2,0.4,0.6,0.8,1],bar:'linear-gradient(90deg,#a50026,#d73027,#f46d43,#fdae61,#fee08b,#ffffbf,#d9ef8b,#a6d96a,#66bd63,#1a9850,#006837)'},
 ndre:{label:'NDRE',field:'ndre_value',min:-0.1,max:0.6,ticks:[-0.1,0,0.1,0.2,0.3,0.4,0.5,0.6],bar:'linear-gradient(90deg,#440154,#3b528b,#21908d,#5dc863,#fde725)'},
 ndmi:{label:'NDMI',field:'ndmi_value',min:-0.4,max:0.6,ticks:[-0.4,-0.2,0,0.2,0.4,0.6],bar:'linear-gradient(90deg,#a6611a,#dfc27d,#80cdc1,#2c7fb8,#08306b)'},
};
const reading=(o:Observation,key:IndexKey)=>{const raw=o[INDEXES[key].field];return raw==null||raw===''?null:Number.isFinite(Number(raw))?Number(raw):null;};

/** Side-by-side map comparison of two accepted images for NDVI, NDRE or NDMI, using the independently scoped tile renderer. */
export function SatelliteDateComparison({field,observations,onImageAdded}:{field:DatabaseField;observations:Observation[];onImageAdded?:()=>Promise<void>}){
 const {t,date}=usePreferences();const [before,setBefore]=useState('');const [after,setAfter]=useState('');const [index,setIndex]=useState<IndexKey>('ndvi');const [pickedDate,setPickedDate]=useState('');const [busy,setBusy]=useState(false);const [notice,setNotice]=useState('');
 const cfg=INDEXES[index];
 const copy={
  ndvi:{name:t('Greenness (NDVI)','हरियाली (NDVI)'),intro:t('Greenness colours for your field, not natural photographs.','आपके खेत की हरियाली के रंग, असली फ़ोटो नहीं।'),low:t('Bare soil / no crop','खाली मिट्टी / फ़सल नहीं'),high:t('Dense, healthy green','घनी, स्वस्थ हरियाली'),down:t('Less green','हरियाली घटी'),up:t('Greener','हरियाली बढ़ी'),
   aria:t('NDVI colour scale from -0.2 (bare) to 1 (dense green), the same on both dates','NDVI रंग-पैमाना -0.2 (खाली) से 1 (घनी हरियाली), दोनों तारीख़ों पर एक जैसा')},
  ndre:{name:t('Leaf colour (NDRE)','पत्तियों का रंग (NDRE)'),intro:t('Leaf-colour (chlorophyll) signal for your field, not natural photographs.','आपके खेत में पत्तियों के रंग (क्लोरोफ़िल) का संकेत, असली फ़ोटो नहीं।'),low:t('Low chlorophyll (pale leaves)','कम क्लोरोफ़िल (फीकी पत्तियाँ)'),high:t('High chlorophyll (deep green leaves)','ज़्यादा क्लोरोफ़िल (गहरी हरी पत्तियाँ)'),down:t('Paler leaves','पत्तियाँ फीकी हुईं'),up:t('Deeper leaf colour','पत्तियों का रंग गहरा हुआ'),
   aria:t('NDRE colour scale from -0.1 (purple, low chlorophyll) to 0.6 (yellow, high chlorophyll), the same on both dates','NDRE रंग-पैमाना -0.1 (बैंगनी, कम क्लोरोफ़िल) से 0.6 (पीला, ज़्यादा क्लोरोफ़िल), दोनों तारीख़ों पर एक जैसा')},
  ndmi:{name:t('Water in plants (NDMI)','पौधों में पानी (NDMI)'),intro:t('Water content of the crop canopy, not soil moisture and not natural photographs.','फ़सल की पत्तियों में पानी का संकेत; मिट्टी की नमी या असली फ़ोटो नहीं।'),low:t('Dry canopy','सूखी पत्तियाँ'),high:t('Water-rich canopy','पानी से भरपूर पत्तियाँ'),down:t('Less water in the canopy','पौधों में पानी घटा'),up:t('More water in the canopy','पौधों में पानी बढ़ा'),
   aria:t('NDMI colour scale from -0.4 (sand, dry) to 0.6 (navy, water-rich), the same on both dates','NDMI रंग-पैमाना -0.4 (रेतीला, सूखा) से 0.6 (गहरा नीला, पानी से भरपूर), दोनों तारीख़ों पर एक जैसा')},
 }[index];
 const available=observations.filter(o=>o.scene_id&&o.accepted&&o.provenance==='measured_imagery'&&o.boundary_version===(field.boundary_version??1)&&!qualityReason(o,field.policy))
  .slice().sort((a,b)=>(a.acquired_at||a.observed_on).localeCompare(b.acquired_at||b.observed_on));
 const older=available.find(o=>o.scene_id===before)||available.at(-2);
 const newer=available.find(o=>o.scene_id===after)||available.at(-1);
 const position=field.latitude!=null&&field.longitude!=null&&Number.isFinite(Number(field.latitude))&&Number.isFinite(Number(field.longitude))&&field.boundary_geojson;
 const distinct=older&&newer&&older.scene_id!==newer.scene_id;
 const chronological=distinct&&(older.acquired_at||older.observed_on)<(newer.acquired_at||newer.observed_on);
 const comparable=chronological&&Boolean(older.calculation_version)&&older.calculation_version===newer.calculation_version;
 const olderValue=older?reading(older,index):null,newerValue=newer?reading(newer,index):null;
 const haveValues=olderValue!=null&&newerValue!=null;
 const delta=comparable&&haveValues?newerValue-olderValue:0;
 const tileUrl=(o:Observation)=>`/api/fields/${field.id}/tiles/${encodeURIComponent(o.scene_id!)}/{z}/{x}/{y}.png${index==='ndvi'?'':`?index=${index}`}`;
 const DAY=86400000;
 const dayOf=(o?:Observation)=>o?(o.acquired_at||String(o.observed_on)).slice(0,10):'';
 /** Earliest pickable date is two years back; the latest is the day before the image it is compared with. */
 const minDate=new Date(Date.now()-730*DAY).toISOString().slice(0,10);
 const maxDate=newer?new Date(Date.parse(`${dayOf(newer)}T00:00:00Z`)-DAY).toISOString().slice(0,10):'';
 const findDate=async()=>{
  if(!pickedDate||!newer||busy)return;
  setBusy(true);setNotice('');
  try{
   const result=await findImageForDate(field.id,pickedDate,dayOf(newer));
   if(result.found&&result.sceneId){
    await onImageAdded?.();setBefore(result.sceneId);
    const gap=result.daysFromRequested??0;
    setNotice(gap>0?t(`No clear image on that exact date. Showing the closest clear one, ${gap} day${gap===1?'':'s'} away.`,`उस तारीख़ की साफ़ तस्वीर नहीं मिली। सबसे नज़दीकी साफ़ तस्वीर दिखा रहे हैं, ${gap} दिन दूर।`):t('Image for that date is ready.','उस तारीख़ की तस्वीर तैयार है।'));
   }else setNotice(result.message);
  }catch(error){setNotice(error instanceof Error?error.message:t('Image search unavailable. Please retry.','तस्वीर खोज अभी उपलब्ध नहीं। फिर कोशिश करें।'));}
  finally{setBusy(false);}
 };
 const panel=(item:Observation,side:number)=>{const value=reading(item,index);return <figure className="ndvi-panel" key={`${index}-${item.scene_id}`}>
  <div className="ndvi-map"><span className="ndvi-badge">({side?'b':'a'}) {side?t('After','बाद में'):t('Before','पहले')} · {date(item.observed_on)}</span>
   <OpenFieldMap latitude={Number(field.latitude)} longitude={Number(field.longitude)} fieldName={field.name} boundaryGeojson={field.boundary_geojson} tileUrl={tileUrl(item)} layerLabel={cfg.label} opacity={.85}/></div>
  <figcaption>{cfg.label} <b>{value==null?'—':value.toFixed(2)}</b> · {t('Clear view','साफ़ हिस्सा')} {item.valid_coverage_percent}% · {t('Cloud','बादल')} {item.cloud_cover??'—'}%</figcaption>
 </figure>;};
 return <section className="platform-panel satellite-comparison" aria-label={t('Processed satellite image comparison','प्रोसेस की गई सैटेलाइट तस्वीरों की तुलना')}>
  <h3>{t('Compare processed image layers','प्रोसेस की गई तस्वीरों की तुलना')}</h3>
  <div className="ndvi-index-picker" role="group" aria-label={t('Index shown on both maps','दोनों नक्शों पर दिखने वाला सूचकांक')}>
   {(['ndvi','ndre','ndmi'] as IndexKey[]).map(key=><button type="button" key={key} aria-pressed={key===index} onClick={()=>setIndex(key)}>
    <b>{INDEXES[key].label}</b><span>{key==='ndvi'?t('Greenness','हरियाली'):key==='ndre'?t('Leaf colour','पत्तियों का रंग'):t('Plant water','पौधों में पानी')}</span></button>)}
  </div>
  <p>{copy.intro}</p>
  {!position||available.length<1?<p>{t('A saved field boundary and at least one quality-accepted image are needed.','खेत की सीमा और कम से कम एक साफ़ स्वीकृत तस्वीर चाहिए।')}</p>:<>
   <form className="ndvi-date-finder" onSubmit={event=>{event.preventDefault();void findDate();}}>
    <label>{t('Compare the latest image with an earlier date','सबसे नई तस्वीर की तुलना किसी पुरानी तारीख़ से करें')}
     <input type="date" value={pickedDate} min={minDate} max={maxDate} disabled={busy} onChange={event=>setPickedDate(event.target.value)}/></label>
    <button type="submit" disabled={!pickedDate||busy}>{busy?t('Searching satellite images…','सैटेलाइट तस्वीरें खोज रहे हैं…'):t('Find image','तस्वीर खोजें')}</button>
   </form>
   <p className="ndvi-date-hint">{t('Any date in the last 2 years. If that day has no clear image, the closest clear one within 5 days is used.','पिछले 2 साल की कोई भी तारीख़। उस दिन साफ़ तस्वीर न हो तो 5 दिन के भीतर की सबसे नज़दीकी साफ़ तस्वीर ली जाती है।')}</p>
   {notice&&<p role="status" className="ndvi-date-notice">{notice}</p>}
   {available.length<2?<p>{t('Pick an earlier date above to compare it with your latest image.','अपनी सबसे नई तस्वीर से तुलना के लिए ऊपर कोई पुरानी तारीख़ चुनें।')}</p>:<>
   <div className="platform-two-column">{([['before',older,setBefore],['after',newer,setAfter]] as const).map(([side,item,set])=><label key={side}>{side==='before'?t('Before acquisition','पहली तस्वीर'):t('After acquisition','दूसरी तस्वीर')}<select value={item?.scene_id||''} onChange={event=>set(event.target.value)}>{available.map(o=><option value={o.scene_id!} key={o.scene_id}>{date(o.observed_on)} · {(o.acquired_at||'').slice(11,16)} · {o.scene_id}</option>)}</select></label>)}</div>
   {!chronological&&<p role="alert">{t('Choose two different acquisitions with Before earlier than After.','दो अलग तस्वीरें चुनें; पहली तस्वीर दूसरी से पुरानी हो।')}</p>}
   {distinct&&<div className="ndvi-versus">
    {panel(older,0)}<div className="ndvi-vs" aria-hidden="true"><span>Vs</span></div>{panel(newer,1)}
   </div>}
   {comparable&&haveValues?<div className={`ndvi-change ${delta<0?'down':delta>0?'up':'flat'}`}><strong>{delta<0?'▼':delta>0?'▲':'►'} {delta>0?'+':''}{delta.toFixed(3)}</strong><span>{cfg.label} {t('change','बदलाव')} · {delta<0?copy.down:delta>0?copy.up:t('Unchanged','कोई बदलाव नहीं')}</span></div>
    :comparable?<p>{t(`${cfg.label} values were not stored for one of these images, so no change figure is shown. The maps may still draw if the image has the needed bands.`,`इनमें से एक तस्वीर के ${cfg.label} मान सेव नहीं हैं, इसलिए बदलाव की संख्या नहीं दिख रही। ज़रूरी बैंड हों तो नक्शे फिर भी बन सकते हैं।`)}</p>
    :chronological&&<p>{t('Processing methods differ or are unknown; the averages cannot be compared reliably.','प्रोसेसिंग के तरीके अलग या अज्ञात हैं; मानों की भरोसेमंद तुलना नहीं हो सकती।')}</p>}
   <div className="ndvi-scale" role="img" aria-label={copy.aria}>
    <div className="ndvi-scale-title"><b aria-hidden="true">✔</b> {t('Same colour scale on both dates, so the colours can be compared fairly','दोनों तारीख़ों पर एक ही रंग-पैमाना, इसलिए रंगों की सही तुलना हो सकती है')}</div>
    <div className="ndvi-scale-bar" style={{background:cfg.bar}} />
    <div className="ndvi-scale-ticks" aria-hidden="true">{cfg.ticks.map(tick=><span key={tick} style={{left:`${(tick-cfg.min)/(cfg.max-cfg.min)*100}%`}}>{tick}</span>)}</div>
    <div className="ndvi-scale-ends" aria-hidden="true"><span>{copy.low}</span><span>{copy.high}</span></div>
   </div>
  </>}
  </>}
 </section>;
}
