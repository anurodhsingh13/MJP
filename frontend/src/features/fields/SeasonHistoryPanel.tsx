import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { History } from 'lucide-react';
import { loadFieldJobs, queueFieldJob, type DatabaseField, type ProcessingJob } from '../../lib/api';
import { usePreferences } from '../../lib/preferencesContext';
import { seasonDatesOutdated } from './season';
import './season-history.css';

/** Builds the season NDVI time series in the background: one clear image about every 10 days. */
export function SeasonHistoryPanel({ field, onComplete, onEditDates }: { field: DatabaseField; onComplete: () => void; onEditDates?: () => void }) {
  const { t } = usePreferences();
  const [job, setJob] = useState<ProcessingJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(false);
  const previous = useRef<ProcessingJob | null>(null);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);
  useEffect(() => {
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const latest = (await loadFieldJobs(field.id)).find(item => item.kind === 'history' && item.boundary_version === (field.boundary_version ?? 1)) ?? null;
        if (stopped) return;
        // Reload the chart once, when a job this page saw running has just succeeded.
        const wasActive = previous.current && previous.current.id === latest?.id && ['queued', 'running'].includes(previous.current.status);
        previous.current = latest;
        setJob(latest); setError(false);
        if (wasActive && latest?.status === 'succeeded') onCompleteRef.current();
        timer = setTimeout(() => void read(), latest && ['queued', 'running'].includes(latest.status) ? 2000 : 20000);
      } catch { if (!stopped) { setError(true); timer = setTimeout(() => void read(), 6000); } }
    };
    void read();
    return () => { stopped = true; clearTimeout(timer); };
  }, [field.id, field.boundary_version]);
  const active = job && ['queued', 'running'].includes(job.status);
  const result = (job?.status === 'succeeded' ? job.result : null) as { acceptedImages?: number; rejected?: number; attempted?: number; window?: { start: string; end: string; fromSowing: boolean } } | null;
  async function start() {
    setStarting(true); setError(false);
    try { const created = await queueFieldJob(field.id, 'history'); previous.current = created; setJob(created); }
    catch { setError(true); }
    finally { setStarting(false); }
  }
  const outdated = seasonDatesOutdated(field);
  return <section id="season-history" className="season-history" aria-labelledby="season-history-title">
    <div className="season-history-head"><History aria-hidden="true" size={20}/><h3 id="season-history-title">{t('Season NDVI history', 'सीज़न का NDVI इतिहास')}</h3></div>
    <p>{t('Adds a clear satellite picture for about every 10 days of the season. Cloudy dates are skipped.', 'सीज़न के लगभग हर 10 दिन की एक साफ़ सैटेलाइट तस्वीर जोड़ता है। बादल वाली तारीख़ें छोड़ दी जाती हैं।')}</p>
    {outdated && <p className="season-history-warning">{t('Your sowing and harvest dates are missing or from an old season. Update them so seasonal greenness changes are interpreted correctly.', 'बुवाई और कटाई की तारीख़ें नहीं हैं या पुराने सीज़न की हैं। उन्हें अपडेट करें ताकि हरियाली के मौसमी बदलाव सही समझे जाएँ।')} {onEditDates ? <button type="button" className="text-button" onClick={onEditDates}>{t('Edit field dates', 'तारीख़ें बदलें')}</button> : <Link to={`/fields/${field.id}/overview`}>{t('Open the field', 'खेत खोलें')}</Link>}</p>}
    <div className="season-history-actions">
      <button type="button" className="primary-action" disabled={Boolean(active) || starting} onClick={() => void start()}>{active ? t('Building history…', 'इतिहास बन रहा है…') : t('Build season history', 'सीज़न का इतिहास बनाएँ')}</button>
      {active && <span role="status" aria-live="polite">{job?.progress}</span>}
    </div>
    {result && <p className="success-notice" role="status">{t(`Added ${result.acceptedImages ?? 0} clear image dates${result.rejected ? `; ${result.rejected} dates were too cloudy` : ''}.`, `${result.acceptedImages ?? 0} साफ़ तस्वीरों की तारीख़ें जुड़ीं${result.rejected ? `; ${result.rejected} तारीख़ों पर बादल ज़्यादा थे` : ''}।`)}</p>}
    {job?.status === 'failed' && <p role="alert">{t('History could not be built. Your saved readings are unchanged; retry later.', 'इतिहास नहीं बन सका। आपकी सेव रीडिंग वैसी ही हैं; बाद में फिर कोशिश करें।')}</p>}
    {error && <p role="alert">{t('Could not reach the image service. Retry shortly.', 'तस्वीर सेवा से संपर्क नहीं हुआ। थोड़ी देर बाद कोशिश करें।')}</p>}
  </section>;
}
