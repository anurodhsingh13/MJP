import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Stethoscope, ShieldCheck, MapPinned, Camera } from 'lucide-react';
import { loadCropAdvice, type CropAdviceResponse, type DatabaseField } from '../../lib/api';
import { usePreferences } from '../../lib/preferencesContext';
import './crop-advice.css';

const likelihoodLabel = (value: string, t: (en: string, hi: string) => string) =>
  value === 'high' ? t('More likely', 'ज़्यादा संभावना') : value === 'medium' ? t('Possible', 'संभव') : t('Less likely', 'कम संभावना');

/** NDVI + latest photo -> possible issues, precautions and a clear visit answer. Runs only when the farmer asks. */
export function CropAdvice({ field }: { field: DatabaseField }) {
  const { t, language } = usePreferences();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CropAdviceResponse | null>(null);
  async function run() {
    if (busy) return;
    setBusy(true); setError('');
    try { setResult(await loadCropAdvice(field.id, language === 'hi' ? 'hi-IN' : 'en-IN')); }
    catch (caught) { setError(caught instanceof Error ? caught.message : t('Advice is unavailable. Try again.', 'सलाह उपलब्ध नहीं है। फिर कोशिश करें।')); }
    finally { setBusy(false); }
  }
  const visit = result?.visit;
  const headline = !visit ? '' : visit.visit === 'yes'
    ? (visit.when === 'within_3_days' ? t('Yes — visit the field within 3 days', 'हाँ — 3 दिन के अंदर खेत जाएँ') : t('Yes — visit the field this week', 'हाँ — इसी हफ़्ते खेत जाएँ'))
    : visit.visit === 'if_concerned' ? t('Not enough data — visit if you are concerned and take a photo', 'पर्याप्त जानकारी नहीं — चिंता हो तो खेत जाकर फ़ोटो लें')
    : t('No urgent visit needed — keep routine checks', 'अभी ज़रूरी दौरा नहीं — नियमित जाँच जारी रखें');
  const reasonText: Record<string, string> = {
    ndvi_drop: t('Greenness (NDVI) fell since the last comparable image.', 'पिछली तुलनीय तस्वीर से हरियाली (NDVI) घटी है।'),
    low_ndvi_growing: t('NDVI is low for a crop that should be growing.', 'बढ़ती फ़सल के लिए NDVI कम है।'),
    photo_urgent: t('The photo shows symptoms worth checking.', 'फ़ोटो में ऐसे लक्षण हैं जिन्हें देखना चाहिए।'),
    advice_urgent: t('The satellite and weather readings together are worth a closer look in the field.', 'सैटेलाइट और मौसम की जानकारी मिलाकर खेत को पास से देखना ठीक रहेगा।'),
    likely_issue: t('A likely problem was found; confirm it in the field.', 'एक संभावित समस्या मिली; खेत में पुष्टि करें।'),
    no_fresh_imagery: t('There is no fresh, clear satellite image to judge the crop.', 'फ़सल परखने के लिए ताज़ा, साफ़ सैटेलाइट तस्वीर नहीं है।'),
    all_clear: t('No unusual change was found in the satellite images.', 'सैटेलाइट तस्वीरों में कोई असामान्य बदलाव नहीं मिला।'),
  };
  const ndvi = result?.evidence.ndvi;
  return <section className="crop-advice" aria-labelledby="crop-advice-title">
    <div className="crop-advice-head"><Stethoscope size={23} aria-hidden="true"/>
      <div><h2 id="crop-advice-title">{t('Crop health advice', 'फ़सल सेहत सलाह')}</h2>
        <p>{t('Uses the satellite NDVI and your latest field photo to suggest possible problems, precautions and whether to visit.', 'सैटेलाइट NDVI और आपकी ताज़ा फ़ोटो से संभावित समस्या, सावधानियाँ और खेत जाने की सलाह देता है।')}</p></div></div>
    <button type="button" className="crop-advice-run" onClick={() => void run()} disabled={busy} aria-busy={busy}>{busy ? t('Checking…', 'जाँच रहे हैं…') : result ? t('Check again', 'फिर से जाँचें') : t('Get advice', 'सलाह लें')}</button>
    <p className="crop-advice-privacy">{t('Pressing the button sends this field’s NDVI numbers, crop details and your latest photo to Google Gemini.', 'बटन दबाने पर इस खेत के NDVI आँकड़े, फ़सल की जानकारी और आपकी ताज़ा फ़ोटो Google Gemini को भेजी जाती है।')}</p>
    {error && <p role="alert" className="crop-advice-error">{error}</p>}
    {result && visit && <div className="crop-advice-result">
      <div className={`crop-advice-visit ${visit.visit}`}><MapPinned size={20} aria-hidden="true"/><div><strong>{headline}</strong>
        <ul>{visit.reasons.map(reason => <li key={reason}>{reasonText[reason] ?? reason}</li>)}</ul></div></div>
      {ndvi && <dl className="crop-advice-ndvi">
        <div><dt>NDVI</dt><dd>{ndvi.latest ?? '—'}</dd></div>
        <div><dt>{t('Image date', 'तस्वीर की तारीख़')}</dt><dd>{ndvi.observedOn}</dd></div>
        <div><dt>{t('Change', 'बदलाव')}</dt><dd>{result.evidence.assessment.change == null ? '—' : (result.evidence.assessment.change > 0 ? '+' : '') + result.evidence.assessment.change}</dd></div>
        {ndvi.affectedAreaPercent != null && <div><dt>{t('Weak area', 'कमज़ोर हिस्सा')}</dt><dd>{ndvi.affectedAreaPercent}%</dd></div>}
      </dl>}
      {!result.advice && <p>{t('There is no accepted NDVI reading for this field yet. Refresh the satellite images first.', 'इस खेत की अभी कोई मान्य NDVI रीडिंग नहीं है। पहले सैटेलाइट तस्वीरें अपडेट करें।')}</p>}
      {result.advice && <>
        <p className="crop-advice-summary">{result.advice.summary}</p>
        <h3><Camera size={17} aria-hidden="true"/> {t('Photo', 'फ़ोटो')}</h3>
        {result.photoUsed
          ? (result.advice.photoSeen.length ? <ul>{result.advice.photoSeen.map(item => <li key={item}>{item}</li>)}</ul> : <p>{t('The photo did not show clear symptoms.', 'फ़ोटो में साफ़ लक्षण नहीं दिखे।')}</p>)
          : <p>{t('No field photo was available. Add one for a closer look.', 'कोई खेत की फ़ोटो नहीं थी। बेहतर जाँच के लिए जोड़ें।')} <Link to={`/fields/${field.id}/history?photo=1#scouting-title`}>{t('Add a photo', 'फ़ोटो जोड़ें')}</Link></p>}
        {result.advice.possibleIssues.length > 0 && <><h3>{t('Possible problems (not a diagnosis)', 'संभावित समस्याएँ (पक्का निदान नहीं)')}</h3>
          <ul className="crop-advice-issues">{result.advice.possibleIssues.map(issue => <li key={issue.name}><span className={`likelihood ${issue.likelihood}`}>{likelihoodLabel(issue.likelihood, t)}</span><strong>{issue.name}</strong><small>{issue.reason}</small></li>)}</ul></>}
        {result.advice.precautions.length > 0 && <><h3><ShieldCheck size={17} aria-hidden="true"/> {t('Precautions to take', 'ये सावधानियाँ रखें')}</h3>
          <ul>{result.advice.precautions.map(item => <li key={item}>{item}</li>)}</ul></>}
        {result.advice.checkInField.length > 0 && <><h3>{t('Check these during the visit', 'खेत जाकर यह देखें')}</h3>
          <ol>{result.advice.checkInField.map(item => <li key={item}>{item}</li>)}</ol></>}
      </>}
      <p className="crop-advice-caution">{t('This is guidance, not a confirmed disease diagnosis, and the satellite alert behind it has not yet been tested on real fields in this app. Confirm in the field and talk to your local agriculture officer or KVK before spraying any chemical.', 'यह सलाह है, पक्का रोग-निदान नहीं, और इसके पीछे के सैटेलाइट अलर्ट को इस ऐप के असली खेतों पर अभी परखा नहीं गया है। कोई दवा छिड़कने से पहले खेत में पुष्टि करें और अपने कृषि अधिकारी या KVK से बात करें।')}</p>
    </div>}
  </section>;
}
