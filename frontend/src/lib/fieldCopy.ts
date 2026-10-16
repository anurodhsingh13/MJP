import { assessEvidence } from '../../../shared/evidence';
import type { DatabaseField } from './api';
import type { Language } from './preferencesContext';

export const fieldAssessment = (field: DatabaseField) => field.assessment || assessEvidence(field.latestObservation ?? null, field.previousObservation ?? null, field.policy);
export function fieldCopy(field: DatabaseField, language: Language) {
  const assessment = fieldAssessment(field);
  const oneImage = assessment.comparableObservations === 1;
  const copy = {
    needs_inspection: ['Needs inspection', 'खेत की जाँच करें', 'Vegetation decreased between the last two clear images. Visit the field to understand why.', 'पिछली दो साफ़ तस्वीरों के बीच हरियाली कम दिखी है। वजह जानने के लिए खेत देखें।'],
    no_unusual_change: ['No unusual change detected', 'बड़ा बदलाव नहीं दिखा', 'No large vegetation decrease was found in the last two clear images. Continue your regular field checks.', 'पिछली दो साफ़ तस्वीरों में हरियाली की बड़ी कमी नहीं दिखी। खेत की नियमित जाँच जारी रखें।'],
    image_too_old: ['Image too old', 'नई तस्वीर चाहिए', 'The last clear image is too old to describe your field today. Check for a newer image.', 'पिछली साफ़ तस्वीर पुरानी है। आज की स्थिति जानने के लिए नई तस्वीर देखें।'],
    not_enough_data: ['Not enough usable data', oneImage ? 'एक और तस्वीर चाहिए' : 'साफ़ तस्वीर नहीं मिली', oneImage ? 'One clear image is available. Another comparable date is needed to tell what changed.' : 'There is not enough clear imagery to assess this field. This does not mean the crop is damaged.', oneImage ? 'एक साफ़ तस्वीर मिली है। बदलाव समझने के लिए दूसरी तारीख़ की तस्वीर चाहिए।' : 'खेत की स्थिति बताने लायक साफ़ तस्वीर नहीं मिली। इसका मतलब फ़सल खराब होना नहीं है।'],
    awaiting_analysis: ['Awaiting first analysis', 'पहली तस्वीर की जाँच बाकी', 'Your field is saved. Check satellite images to start monitoring.', 'खेत सेव हो गया है। निगरानी शुरू करने के लिए satellite तस्वीरों की जाँच करें।'],
  }[assessment.state];
  return { assessment, title: copy[language === 'hi' ? 1 : 0], explanation: copy[language === 'hi' ? 3 : 2] };
}
