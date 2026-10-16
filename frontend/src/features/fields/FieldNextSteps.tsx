import { Link } from 'react-router-dom';
import { ClipboardCheck, ArrowRight } from 'lucide-react';
import type { DatabaseField } from '../../lib/api';
import { fieldAssessment } from '../../lib/fieldCopy';
import { usePreferences } from '../../lib/preferencesContext';
import './FieldNextSteps.css';

/** Safe field checks only: satellite greenness cannot determine a disease or treatment. */
export function FieldNextSteps({ field }: { field: DatabaseField }) {
  const { t } = usePreferences();
  const state = fieldAssessment(field).state;
  const steps = state === 'needs_inspection'
    ? [
      t('Inspect the area where the crop looks different.','जहाँ फ़सल अलग दिखे, उस हिस्से को देखें।'),
      t('Look for irrigation problems, harvesting, bare soil, yellow leaves or pests.','पानी की कमी, कटाई, खाली मिट्टी, पीले पत्ते या कीट के संकेत देखें।'),
      t('Add a field photo and note what you actually observe.','फ़ोटो और जो सच में दिखा उसका नोट जोड़ें।')
    ]
    : state === 'image_too_old' || state === 'not_enough_data' || state === 'awaiting_analysis'
      ? [
        t('Check for a newer, clearer satellite observation.','नई और साफ़ सैटेलाइट तस्वीर देखें।'),
        t('Do not assume the crop is healthy or damaged while imagery is missing.','तस्वीर न होने पर फ़सल अच्छी या खराब होने का अंदाज़ा न लगाएँ।'),
        t('If you are concerned, visit the field and record a photo.','चिंता हो तो खेत जाकर फ़ोटो और नोट दर्ज करें।')
      ]
      : [
        t('Keep inspecting your crop regularly.','फ़सल की नियमित जाँच करते रहें।'),
        t('Check for visible changes in leaves, irrigation and crop growth.','पत्तियों, सिंचाई और फ़सल की बढ़त में बदलाव देखें।'),
        t('Record a photo and note to compare at the next visit.','अगली जाँच से तुलना के लिए फ़ोटो और नोट सेव करें।')
      ];
  return <section className="field-next-guidance" aria-label={t('Suggested field checks','खेत की जाँच के सुझाव')}>
    <div className="field-next-guidance-heading">
      <ClipboardCheck size={23} aria-hidden="true"/>
      <div><h2>{t('What should I check next?', 'अब खेत में क्या जाँचें?')}</h2>
        <p>{t('Practical checks based on the available imagery, not a crop-disease diagnosis.', 'उपलब्ध तस्वीरों के आधार पर सामान्य जाँच के सुझाव, बीमारी की पुष्टि नहीं।')}</p></div>
    </div>
    <ol>{steps.map(step=><li key={step}>{step}</li>)}</ol>
    <div className="field-next-guidance-actions">
      <Link to={`/fields/${field.id}/history?photo=1#scouting-title`}>{t('Add a photo and note','फ़ोटो और नोट जोड़ें')} <ArrowRight size={16} aria-hidden="true"/></Link>
      <Link to={`/fields/${field.id}/analysis`}>{t('See satellite evidence','सैटेलाइट जानकारी देखें')}</Link>
    </div>
    <p className="field-next-guidance-caution">{t('Do not apply pesticides or fertilizer solely because the NDVI decreased. Confirm the cause in the field and consult a qualified adviser when appropriate.', 'सिर्फ NDVI घटने पर कीटनाशक या खाद न डालें। पहले खेत में वजह जाँचें और ज़रूरत पर कृषि विशेषज्ञ से सलाह लें।')}</p>
  </section>;
}
