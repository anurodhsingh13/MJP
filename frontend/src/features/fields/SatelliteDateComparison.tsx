import {useState} from 'react';
import {OpenFieldMap} from '../../lib/OpenFieldMap';
import {qualityReason} from '../../../../shared/evidence';
<<<<<<< HEAD
import type {DatabaseField,Observation} from '../../lib/api';
import {usePreferences} from '../../lib/preferencesContext';
import '../platform.css';

/** Reuses the existing independently-scoped NDVI tile renderer. */
export function SatelliteDateComparison({field,observations}:{field:DatabaseField;observations:Observation[]}){
 const {t,date}=usePreferences();const [before,setBefore]=useState('');const [after,setAfter]=useState('');
 const available=observations.filter(o=>o.scene_id&&o.accepted&&o.provenance==='measured_imagery'&&o.boundary_version===(field.boundary_version??1)&&!qualityReason(o,field.policy))
  .slice().sort((a,b)=>(a.acquired_at||a.observed_on).localeCompare(b.acquired_at||b.observed_on));
 const older=available.find(o=>o.scene_id===before)||available.at(-2);
 const newer=available.find(o=>o.scene_id===after)||available.at(-1);
 const demo=document.documentElement.dataset.showcase==='true';
 const position=field.latitude!=null&&field.longitude!=null&&Number.isFinite(Number(field.latitude))&&Number.isFinite(Number(field.longitude))&&field.boundary_geojson;
 const distinct=older&&newer&&older.scene_id!==newer.scene_id;
 const chronological=distinct&&(older.acquired_at||older.observed_on)<(newer.acquired_at||newer.observed_on);
 const comparable=chronological&&Boolean(older.calculation_version)&&older.calculation_version===newer.calculation_version;
 return <section className="platform-panel satellite-comparison" aria-label={t('Processed satellite image comparison','प्रोसेस की गई सैटेलाइट तस्वीरों की तुलना')}>
  <h3>{t('Compare processed image layers','प्रोसेस की गई तस्वीरों की तुलना')}</h3>
  <p>{demo?t('Illustrative demo layers and synthetic values.','डेमो की उदाहरण परतें और काल्पनिक मान।'):t('Each panel uses the selected scene’s processed NDVI pixels, clipped to this boundary. These are vegetation visualizations, not natural-colour photographs.','हर नक्शा चुनी तस्वीर के NDVI पिक्सल खेत की सीमा में दिखाता है। ये हरियाली के रंग हैं, असली रंगों वाली फ़ोटो नहीं।')}</p>
  {available.length<2||!position?<p>{t('Two quality-accepted images and a saved field boundary are needed.','दो साफ़ स्वीकृत तस्वीरें और खेत की सीमा चाहिए।')}</p>:<>
   <div className="platform-two-column">{([['before',older,setBefore],['after',newer,setAfter]] as const).map(([side,reading,set])=><label key={side}>{side==='before'?t('Before acquisition','पहली तस्वीर'):t('After acquisition','दूसरी तस्वीर')}<select value={reading?.scene_id||''} onChange={event=>set(event.target.value)}>{available.map(o=><option value={o.scene_id!} key={o.scene_id}>{date(o.observed_on)} · {(o.acquired_at||'').slice(11,16)} · {o.scene_id}</option>)}</select></label>)}</div>
   {!chronological&&<p role="alert">{t('Choose two different acquisitions with Before earlier than After.','दो अलग तस्वीरें चुनें; पहली तस्वीर दूसरी से पुरानी हो।')}</p>}
   {distinct&&<div className="platform-two-column satellite-comparison-maps">{[older,newer].map((reading,index)=><div key={index}><h4>{index?t('After','बाद में'):t('Before','पहले')} · {date(reading.observed_on)}</h4><OpenFieldMap latitude={Number(field.latitude)} longitude={Number(field.longitude)} fieldName={field.name} boundaryGeojson={field.boundary_geojson} tileUrl={`/api/fields/${field.id}/tiles/${encodeURIComponent(reading.scene_id!)}/{z}/{x}/{y}.png`} opacity={.8}/><p>NDVI {Number(reading.ndvi_value).toFixed(3)} · {t('Clear view','साफ़ हिस्सा')} {reading.valid_coverage_percent}% · {t('Cloud','बादल')} {reading.cloud_cover??'—'}%</p><small>{reading.source} · {reading.calculation_version}</small></div>)}</div>}
   {comparable?<p><strong>{t('NDVI change','NDVI बदलाव')}: {(Number(newer.ndvi_value)-Number(older.ndvi_value)).toFixed(3)}</strong> · {Number(newer.ndvi_value)<Number(older.ndvi_value)?t('Less green','हरियाली घटी'):Number(newer.ndvi_value)>Number(older.ndvi_value)?t('Greener','हरियाली बढ़ी'):t('Unchanged','कोई बदलाव नहीं')}</p>:chronological&&<p>{t('Processing methods differ or are unknown; the averages cannot be compared reliably.','प्रोसेसिंग के तरीके अलग या अज्ञात हैं; मानों की भरोसेमंद तुलना नहीं हो सकती।')}</p>}
   <p className="platform-legend">NDVI: <span style={{background:'#a50026'}}/> ≤ −0.2 / {t('low','कम')} <span style={{background:'#ffffbf'}}/> 0.4 <span style={{background:'#006837'}}/> +1 / {t('high vegetation signal','हरियाली का अधिक संकेत')}</p>
=======
import type {DatabaseField,Observation,SatelliteScene} from '../../lib/api';
import {usePreferences} from '../../lib/preferencesContext';
export function SatelliteDateComparison({field,scenes,observations}:{field:DatabaseField;scenes:SatelliteScene[];observations:Observation[]}){
 const {t,date}=usePreferences();
 const [before,setBefore]=useState('');
 const [after,setAfter]=useState('');
 const available=observations.filter(o=>o.accepted&&o.provenance==='measured_imagery'&&o.boundary_version===field.boundary_version&&!qualityReason(o,field.policy)&&scenes.some(scene=>scene.scene_id===o.scene_id)).sort((a,b)=>a.observed_on.localeCompare(b.observed_on));
 const earlier=available.find(o=>o.scene_id===before)||available[0];
 const later=available.find(o=>o.scene_id===after)||available.at(-1);
 const hasPosition=field.latitude!=null&&field.longitude!=null&&Number.isFinite(Number(field.latitude))&&Number.isFinite(Number(field.longitude));
 const valid=available.length>=2&&earlier&&later&&earlier.scene_id!==later.scene_id&&hasPosition&&field.boundary_geojson;
 const tile=(id:string)=>`/api/fields/${field.id}/tiles/${encodeURIComponent(id)}/{z}/{x}/{y}.png`;
 return <section className="advanced-comparison" aria-label={t('Real two-date vegetation comparison','दो तारीख़ों की वनस्पति तुलना')}>
  <h2>{t('Before and after: actual NDVI map layers','पहले और बाद में: NDVI मैप की दो परतें')}</h2>
  <p>{t('Choose two processed, quality-accepted Sentinel scenes. Each map loads that scene’s own NDVI tiles using the saved field boundary.','दो गुणवत्ता-जाँची गई Sentinel तस्वीरें चुनें। हर नक्शा उसी तारीख़ की NDVI टाइलें दिखाता है।')}</p>
  {!valid?<p>{t('Two accepted satellite images and a saved field boundary are required.','दो साफ़ सैटेलाइट तस्वीरें और खेत की सीमा चाहिए।')}</p>:
  <>
   <div className="advanced-compare-controls">
    <label>{t('Before','पहले')}<select value={earlier.scene_id??''} onChange={e=>setBefore(e.target.value)}>{available.filter(o=>o.scene_id!==later.scene_id).map(o=><option key={o.scene_id} value={o.scene_id??''}>{date(o.observed_on)}</option>)}</select></label>
    <label>{t('After','बाद में')}<select value={later.scene_id??''} onChange={e=>setAfter(e.target.value)}>{available.filter(o=>o.scene_id!==earlier.scene_id).map(o=><option key={o.scene_id} value={o.scene_id??''}>{date(o.observed_on)}</option>)}</select></label>
   </div>
   <div className="advanced-compare-maps">{[earlier,later].map((o,i)=><div key={o.scene_id}><h3>{i===0?t('Before','पहले'):t('After','बाद में')} · {date(o.observed_on)}</h3><OpenFieldMap latitude={Number(field.latitude)} longitude={Number(field.longitude)} fieldName={field.name} boundaryGeojson={field.boundary_geojson} tileUrl={tile(o.scene_id??'')} opacity={.82}/><p>NDVI {Number(o.ndvi_value).toFixed(3)} · {t('Usable pixels','साफ़ पिक्सल')}: {o.valid_pixel_count}</p></div>)}</div>
   <p><strong>{t('NDVI change','NDVI बदलाव')}: {(Number(later.ndvi_value)-Number(earlier.ndvi_value)).toFixed(3)}</strong> · {t('Differences do not establish the cause of stress or disease.','बदलाव से रोग या परेशानी का कारण निश्चित नहीं होता।')}</p>
>>>>>>> origin/main
  </>}
 </section>;
}
