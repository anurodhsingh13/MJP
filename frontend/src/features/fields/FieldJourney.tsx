import { Link } from 'react-router-dom';
import { AlertCircle, ClipboardCheck, Camera, MapPinned, ChartNoAxesCombined, ArrowRight } from 'lucide-react';
import type { DatabaseField } from '../../lib/api';
import { fieldAssessment } from '../../lib/fieldCopy';
import { usePreferences } from '../../lib/preferencesContext';
import './FieldJourney.css';

export function FieldJourney({ field }: { field: DatabaseField }) {
  const { t } = usePreferences();
  const assessment = fieldAssessment(field);
  const needsVisit = assessment.state === 'needs_inspection';
  const needsImage = ['image_too_old','not_enough_data','awaiting_analysis'].includes(assessment.state);
  const path = '/fields/' + field.id;
  const steps = [
    { title:t('1. Review the evidence','1. तस्वीर और कारण देखें'),hint:needsImage?t('New clear imagery is needed','नई साफ़ तस्वीर चाहिए'):t('View actual satellite observations','सैटेलाइट रीडिंग देखें'),href:path+'/map',Icon:MapPinned },
    { title:t('2. Decide what to inspect','2. तय करें क्या जाँचना है'),hint:needsVisit?t('Ground-check recommended','खेत जाकर जाँचें'):needsImage?t('Do not infer crop health from missing data','डेटा न होने पर सेहत का अनुमान न लगाएँ'):t('Continue regular checks','नियमित जाँच करते रहें'),href:path+'/overview?action=visit',Icon:ClipboardCheck },
    { title:t('3. Save a photo and note','3. फ़ोटो और नोट दर्ज करें'),hint:t('Record what you actually saw','जो सच में दिखा उसे दर्ज करें'),href:path+'/history?photo=1#scouting-title',Icon:Camera },
    { title:t('4. Compare observations later','4. फिर बदलाव देखें'),hint:t('Check later images and visit history','नई तस्वीरें और पुराने रिकॉर्ड देखें'),href:path+'/analysis',Icon:ChartNoAxesCombined }
  ];
  return <section className="field-journey" aria-labelledby="field-journey-heading">
    <div className="field-journey-heading"><AlertCircle size={21} aria-hidden="true"/><div>
      <h2 id="field-journey-heading">{t('From satellite finding to field action','सैटेलाइट संकेत से खेत की जाँच तक')}</h2>
      <p>{t('Follow these four steps. Your existing field tools remain available below.','ये चार कदम अपनाएँ। नीचे सभी पुराने टूल पहले जैसे उपलब्ध हैं।')}</p>
    </div></div>
    <div className="field-journey-grid">{steps.map(({title,hint,href,Icon})=>
      <Link className="field-journey-step" key={href} to={href}>
        <Icon size={23} aria-hidden="true"/><strong>{title}</strong><span>{hint}</span><ArrowRight className="field-journey-arrow" size={17} aria-hidden="true"/>
      </Link>
    )}</div>
    <p className="field-journey-notice">{t('NDVI detects vegetation change, not a confirmed disease or treatment. Verify causes on the ground.','NDVI हरियाली में बदलाव बताता है, बीमारी या इलाज की पुष्टि नहीं। खेत में जाँच करें।')}</p>
  </section>;
}
