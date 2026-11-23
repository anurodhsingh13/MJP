import {useState} from 'react';
import {OpenFieldMap} from '../../lib/OpenFieldMap';
import {qualityReason} from '../../../../shared/evidence';
import type {DatabaseField,Observation} from '../../lib/api';
import {usePreferences} from '../../lib/preferencesContext';
import '../platform.css';
import './ndvi-versus.css';

/** Reuses the existing independently-scoped NDVI tile renderer. */
export function SatelliteDateComparison({field,observations}:{field:DatabaseField;observations:Observation[]}){
 const {t,date}=usePreferences();const [before,setBefore]=useState('');const [after,setAfter]=useState('');
 const available=observations.filter(o=>o.scene_id&&o.accepted&&o.provenance==='measured_imagery'&&o.boundary_version===(field.boundary_version??1)&&!qualityReason(o,field.policy))
  .slice().sort((a,b)=>(a.acquired_at||a.observed_on).localeCompare(b.acquired_at||b.observed_on));
 const older=available.find(o=>o.scene_id===before)||available.at(-2);
 const newer=available.find(o=>o.scene_id===after)||available.at(-1);
 const position=field.latitude!=null&&field.longitude!=null&&Number.isFinite(Number(field.latitude))&&Number.isFinite(Number(field.longitude))&&field.boundary_geojson;
 const distinct=older&&newer&&older.scene_id!==newer.scene_id;
 const chronological=distinct&&(older.acquired_at||older.observed_on)<(newer.acquired_at||newer.observed_on);
 const comparable=chronological&&Boolean(older.calculation_version)&&older.calculation_version===newer.calculation_version;
 const delta=comparable?Number(newer.ndvi_value)-Number(older.ndvi_value):0;
 const panel=(reading:Observation,index:number)=><figure className="ndvi-panel" key={reading.scene_id}>
  <div className="ndvi-map"><span className="ndvi-badge">({index?'b':'a'}) {index?t('After','बाद में'):t('Before','पहले')} · {date(reading.observed_on)}</span>
   <OpenFieldMap latitude={Number(field.latitude)} longitude={Number(field.longitude)} fieldName={field.name} boundaryGeojson={field.boundary_geojson} tileUrl={`/api/fields/${field.id}/tiles/${encodeURIComponent(reading.scene_id!)}/{z}/{x}/{y}.png`} opacity={.85}/></div>
  <figcaption>NDVI <b>{Number(reading.ndvi_value).toFixed(2)}</b> · {t('Clear view','साफ़ हिस्सा')} {reading.valid_coverage_percent}% · {t('Cloud','बादल')} {reading.cloud_cover??'—'}%</figcaption>
 </figure>;
 return <section className="platform-panel satellite-comparison" aria-label={t('Processed satellite image comparison','प्रोसेस की गई सैटेलाइट तस्वीरों की तुलना')}>
  <h3>{t('Compare processed image layers','प्रोसेस की गई तस्वीरों की तुलना')}</h3>
  <p>{t('Greenness colours for your field, not natural photographs.','आपके खेत की हरियाली के रंग, असली फ़ोटो नहीं।')}</p>
  {available.length<2||!position?<p>{t('Two quality-accepted images and a saved field boundary are needed.','दो साफ़ स्वीकृत तस्वीरें और खेत की सीमा चाहिए।')}</p>:<>
   <div className="platform-two-column">{([['before',older,setBefore],['after',newer,setAfter]] as const).map(([side,reading,set])=><label key={side}>{side==='before'?t('Before acquisition','पहली तस्वीर'):t('After acquisition','दूसरी तस्वीर')}<select value={reading?.scene_id||''} onChange={event=>set(event.target.value)}>{available.map(o=><option value={o.scene_id!} key={o.scene_id}>{date(o.observed_on)} · {(o.acquired_at||'').slice(11,16)} · {o.scene_id}</option>)}</select></label>)}</div>
   {!chronological&&<p role="alert">{t('Choose two different acquisitions with Before earlier than After.','दो अलग तस्वीरें चुनें; पहली तस्वीर दूसरी से पुरानी हो।')}</p>}
   {distinct&&<div className="ndvi-versus">
    {panel(older,0)}<div className="ndvi-vs" aria-hidden="true"><span>Vs</span></div>{panel(newer,1)}
   </div>}
   {comparable?<div className={`ndvi-change ${delta<0?'down':delta>0?'up':'flat'}`}><strong>{delta<0?'▼':delta>0?'▲':'►'} {delta>0?'+':''}{delta.toFixed(3)}</strong><span>{t('NDVI change','NDVI बदलाव')} · {delta<0?t('Less green','हरियाली घटी'):delta>0?t('Greener','हरियाली बढ़ी'):t('Unchanged','कोई बदलाव नहीं')}</span></div>:chronological&&<p>{t('Processing methods differ or are unknown; the averages cannot be compared reliably.','प्रोसेसिंग के तरीके अलग या अज्ञात हैं; मानों की भरोसेमंद तुलना नहीं हो सकती।')}</p>}
   <div className="ndvi-scale" role="img" aria-label={t('NDVI colour scale from -0.2 (bare) to 1 (dense green), the same on both dates','NDVI रंग-पैमाना -0.2 (खाली) से 1 (घनी हरियाली), दोनों तारीख़ों पर एक जैसा')}>
    <div className="ndvi-scale-title"><b aria-hidden="true">✔</b> {t('Same colour scale on both dates, so the colours can be compared fairly','दोनों तारीख़ों पर एक ही रंग-पैमाना, इसलिए रंगों की सही तुलना हो सकती है')}</div>
    <div className="ndvi-scale-bar" />
    <div className="ndvi-scale-ticks" aria-hidden="true">{[-0.2,0,0.2,0.4,0.6,0.8,1].map(tick=><span key={tick} style={{left:`${(tick+0.2)/1.2*100}%`}}>{tick}</span>)}</div>
    <div className="ndvi-scale-ends" aria-hidden="true"><span>{t('Bare soil / no crop','खाली मिट्टी / फ़सल नहीं')}</span><span>{t('Dense, healthy green','घनी, स्वस्थ हरियाली')}</span></div>
   </div>
  </>}
 </section>;
}
