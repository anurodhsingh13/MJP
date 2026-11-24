import {NDVI_CLASS_BREAKS} from '../../../../shared/evidence';
import type {Observation} from '../../lib/api';
import {usePreferences} from '../../lib/preferencesContext';
import './index-values.css';

const num=(value:unknown)=>value==null||value===''?null:Number.isFinite(Number(value))?Number(value):null;

/** Plain-language reading of the NDVI average, using the same class breaks as the field zones. */
function ndviMeaning(value:number,t:(en:string,hi:string)=>string){
 if(value<NDVI_CLASS_BREAKS.low)return t('Bare soil or very little green','खाली मिट्टी या बहुत कम हरियाली');
 if(value<NDVI_CLASS_BREAKS.moderate)return t('Low greenness','कम हरियाली');
 if(value<NDVI_CLASS_BREAKS.high)return t('Moderate greenness','मध्यम हरियाली');
 return t('Dense, healthy green','घनी, स्वस्थ हरियाली');
}

/** The latest clear image's index averages for the whole field, shown on the Overview. */
export function IndexValues({observation}:{observation:Observation|null|undefined}){
 const {t,date}=usePreferences();
 const ndvi=observation?num(observation.ndvi_value):null;
 if(!observation||ndvi==null)return <section className="index-values" aria-label={t('Satellite index values','सैटेलाइट सूचकांक')}>
  <h3>{t('Satellite readings','सैटेलाइट रीडिंग')}</h3><p>{t('No clear satellite image yet, so there is no NDVI value to show.','अभी कोई साफ़ सैटेलाइट तस्वीर नहीं है, इसलिए NDVI मान नहीं दिख रहा।')}</p></section>;
 const ndre=num(observation.ndre_value),ndmi=num(observation.ndmi_value);
 return <section className="index-values" aria-label={t('Satellite index values','सैटेलाइट सूचकांक')}>
  <h3>{t('Satellite readings','सैटेलाइट रीडिंग')} <span>· {date(observation.observed_on)}</span></h3>
  <div className="index-values-main"><strong>{ndvi.toFixed(2)}</strong><div><b>NDVI</b><span>{ndviMeaning(ndvi,t)}</span></div></div>
  <div className="index-values-others">
   <div><b>NDRE</b><strong>{ndre==null?'—':ndre.toFixed(2)}</strong><span>{t('Leaf colour','पत्तियों का रंग')}</span></div>
   <div><b>NDMI</b><strong>{ndmi==null?'—':ndmi.toFixed(2)}</strong><span>{t('Plant water','पौधों में पानी')}</span></div>
  </div>
  <p className="quiet">{t('Average over your field from the latest clear satellite image. Compare dates on the Map tab.','आपके खेत का औसत, सबसे नई साफ़ सैटेलाइट तस्वीर से। तारीख़ों की तुलना Map टैब में करें।')}</p>
 </section>;
}
