import { Link } from 'react-router-dom';
import { CalendarCheck, Camera, ChartNoAxesCombined, ClipboardCheck, Info, Satellite } from 'lucide-react';
import { fieldAssessment } from '../../lib/fieldCopy';
import { usePreferences } from '../../lib/preferencesContext';
import type { DatabaseField } from '../../lib/api';
import './MapInspectionGuide.css';

export function MapInspectionGuide({field, imageDate, accepted}:{field:DatabaseField;imageDate:string|null;accepted:boolean}) {
  const {t,date}=usePreferences();
  const state=fieldAssessment(field).state;
  const needsVisit=state==='needs_inspection';
  const actions=needsVisit
    ? [t('Inspect visible crop differences, water availability and recent field operations.', 'जहाँ हरियाली बदली है वहाँ फ़सल, पानी और हाल की खेती के काम देखें।'),
      t('Record leaf symptoms or pests only when actually seen on the ground.', 'पत्तियों के लक्षण या कीट केवल खेत में देखकर ही दर्ज करें।')]
    : !accepted
      ? [t('Choose a usable image date or run a fresh image check.', 'साफ़ तस्वीर की तारीख चुनें या नई तस्वीर खोजें।'),
        t('Without a usable observation, satellite evidence cannot establish crop condition.', 'साफ़ तस्वीर नहीं होने पर फ़सल का हाल तय नहीं किया जा सकता।')]
      : [t('Use the map colours to decide which parts deserve closer inspection.', 'नक्शे के रंग देखकर तय करें कि किस हिस्से में जाँच करनी है।'),
        t('Continue regular field visits and save what you observe.', 'खेत की नियमित जाँच करें और जो दिखे उसे सेव करें।')];
  return <section className="map-inspection-guide" aria-label={t('Map-based field guidance','नक्शे के आधार पर खेत की जाँच')}>
    <header className="map-inspection-guide-header"><Satellite size={22} aria-hidden="true"/>
      <div><h2>{t('From map to action','नक्शे से अगला काम')}</h2>
        <p>{imageDate && accepted ? t(`Selected image: ${date(imageDate)}`,`चुनी तस्वीर: ${date(imageDate)}`) : t('No verified image selected','मान्य सैटेलाइट तस्वीर नहीं चुनी गई')}</p></div>
    </header>
    <div className="map-inspection-guide-grid">
      <div className="map-inspection-guide-steps"><strong><ClipboardCheck size={18} aria-hidden="true"/>{t('What to check','क्या जाँचें')}</strong>
        <ol>{actions.map(item=><li key={item}>{item}</li>)}</ol>
      </div>
      <div className="map-inspection-guide-actions">
        <Link to={`/fields/${field.id}/overview?action=visit`}><CalendarCheck size={19} aria-hidden="true"/>{t('Plan a visit','जाँच तय करें')}</Link>
        <Link to={`/fields/${field.id}/history?photo=1#scouting-title`}><Camera size={19} aria-hidden="true"/>{t('Save photo and note','फ़ोटो और नोट जोड़ें')}</Link>
        <Link to={`/fields/${field.id}/analysis`}><ChartNoAxesCombined size={19} aria-hidden="true"/>{t('View changes','बदलाव देखें')}</Link>
      </div>
    </div>
    <p className="map-inspection-guide-note"><Info size={16} aria-hidden="true"/>{t('Map colours show vegetation patterns, not a confirmed disease or prescribed treatment. Verify findings in the field.', 'नक्शे के रंग हरियाली का संकेत हैं, बीमारी या इलाज की पुष्टि नहीं। खेत में जाँच कर पुष्टि करें।')}</p>
  </section>;
}
