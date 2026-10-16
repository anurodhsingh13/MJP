import { assessEvidence } from '../../../shared/evidence';
import type { DatabaseField } from './api';
import type { Language } from './preferencesContext';

export const fieldAssessment = (field: DatabaseField) => field.assessment || assessEvidence(field.latestObservation ?? null, field.previousObservation ?? null, field.policy);
export function fieldNextAction(field: DatabaseField) {
  const state = fieldAssessment(field).state;
  if (state === 'needs_inspection') return 'visit';
  if (Number(field.dueTasks) > 0) return 'tasks';
  if (state !== 'no_unusual_change') return 'images';
  return 'photo';
}
export function fieldActionHref(field: DatabaseField) {
  const base = `/fields/${field.id}`;
  return { visit: `${base}/overview?action=visit`, tasks: `${base}/overview#planned-tasks`, images: `${base}/overview#image-check`, photo: `${base}/history?photo=1#scouting-title` }[fieldNextAction(field)];
}
export function fieldCopy(field: DatabaseField, language: Language) {
  const assessment = fieldAssessment(field);
  const oneImage = assessment.comparableObservations === 1;
  const copy = {
    needs_inspection: ['Visit this field', 'खेत जाकर देखें', 'The crop looks less green in the last two clear pictures. A visit will help explain why.', 'पिछली दो साफ़ तस्वीरों में हरियाली कम दिखी। खेत जाकर इसकी वजह देखें।'],
    no_unusual_change: ['No big change seen', 'बड़ा बदलाव नहीं दिखा', 'The last two clear pictures show no large drop in greenness. Keep checking your crop as usual.', 'पिछली दो साफ़ तस्वीरों में हरियाली की बड़ी कमी नहीं दिखी। नियमित रूप से खेत देखते रहें।'],
    image_too_old: ['A newer picture is needed', 'नई तस्वीर चाहिए', 'The last clear picture is old. We cannot tell how the crop is doing now.', 'पिछली साफ़ तस्वीर पुरानी है। उससे आज की फ़सल का हाल नहीं बता सकते।'],
    not_enough_data: [oneImage ? 'One more picture is needed' : 'A clear picture is needed', oneImage ? 'एक और तस्वीर चाहिए' : 'साफ़ तस्वीर चाहिए', oneImage ? 'We have one clear picture. A second date is needed to see what changed.' : 'We cannot see enough of this field clearly yet. The crop condition is unknown.', oneImage ? 'एक साफ़ तस्वीर मिली है। बदलाव देखने के लिए दूसरी तारीख़ की तस्वीर चाहिए।' : 'खेत अभी साफ़ नहीं दिखा। फ़सल का हाल बताने के लिए जानकारी पूरी नहीं है।'],
    awaiting_analysis: ['Ready for the first picture', 'पहली तस्वीर देखें', 'Your field is saved. Find a clear satellite picture to begin.', 'आपका खेत सेव है। शुरू करने के लिए उपग्रह से ली गई साफ़ तस्वीर खोजें।'],
  }[assessment.state];
  const action = fieldNextAction(field);
  const actionCopy = {
    visit: ['Plan a field visit', 'खेत की जाँच तय करें', 'Check the crop, water and recent harvesting. Add a photo of what you find.', 'फ़सल, पानी और हाल की कटाई देखें। जो दिखे उसकी फ़ोटो जोड़ें।'],
    tasks: ['See planned visits', 'तय जाँच देखें', 'A visit or task is due. Open the list and record what you have done.', 'तय जाँच या काम बाकी है। सूची खोलकर किया गया काम दर्ज करें।'],
    images: ['Find a clear picture', 'साफ़ तस्वीर खोजें', 'Try a new image check. If no clear picture is available, visit the field and add a note.', 'नई तस्वीर खोजें। साफ़ तस्वीर न मिले तो खेत जाकर नोट जोड़ें।'],
    photo: ['Add photo & note', 'फ़ोटो और नोट जोड़ें', 'Keep a record of what you see during your next routine field visit.', 'अगली बार खेत जाएँ तो जो दिखे उसकी फ़ोटो और नोट सेव करें।'],
  }[action];
  return { assessment, action, title: copy[language === 'hi' ? 1 : 0], explanation: copy[language === 'hi' ? 3 : 2], actionLabel: actionCopy[language === 'hi' ? 1 : 0], actionHint: actionCopy[language === 'hi' ? 3 : 2] };
}
