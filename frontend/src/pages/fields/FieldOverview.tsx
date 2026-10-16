import { useEffect, useState, type FormEvent } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { CalendarCheck, Camera, Map, Sprout, ArrowRight } from 'lucide-react';
import { createFieldTask, loadFieldTasks, updateFieldTask, type DatabaseField, type FieldTask, type TaskState } from '../../lib/api';
import { fieldCopy } from '../../lib/fieldCopy';
import { usePreferences } from '../../lib/preferencesContext';
import { ImageCheckPanel } from '../../features/fields/ImageCheckPanel';

const today = () => new Date().toLocaleDateString('en-CA');
export function FieldOverview() {
  const { field, refreshField } = useOutletContext<{ field: DatabaseField; refreshField: () => Promise<void> }>();
  const { t, language, date, area } = usePreferences();
  const [params, setParams] = useSearchParams();
  const copy = fieldCopy(field, language);
  const [tasks, setTasks] = useState<FieldTask[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saved, setSaved] = useState(false);
  const [due, setDue] = useState(today);
  const [title, setTitle] = useState(() => t(`Visit ${field.name}`, `${field.name} की जाँच`));
  const [reason, setReason] = useState(copy.explanation);
  const [clientKey, setClientKey] = useState(() => crypto.randomUUID());
  const [reload, setReload] = useState(0);
  const [changing, setChanging] = useState<string | null>(null);
  const planning = params.get('action') === 'visit';
  useEffect(() => {
    let stopped = false;
    void loadFieldTasks(field.id).then(value => { if (!stopped) { setTasks(value); setLoadError(false); } }).catch(() => { if (!stopped) setLoadError(true); });
    return () => { stopped = true; };
  }, [field.id, reload]);
  useEffect(() => { if (planning) document.getElementById('visit-title')?.focus(); }, [planning]);
  async function save(event: FormEvent) {
    event.preventDefault(); if (saving) return;
    setSaving(true); setSaveError(false); setSaved(false);
    try {
      const task = await createFieldTask(field.id, { client_key: clientKey, title: title.trim() || t(`Visit ${field.name}`, `${field.name} की जाँच`), reason: reason.trim() || copy.explanation, due_on: due, scene_id: field.latestObservation?.scene_id ?? null });
      setTasks(current => [task, ...current.filter(item => item.id !== task.id)]);
      setClientKey(crypto.randomUUID()); setTitle(t(`Visit ${field.name}`, `${field.name} की जाँच`)); setReason(copy.explanation); setSaved(true); setParams({}, { replace: true });
      await refreshField();
    } catch { setSaveError(true); }
    finally { setSaving(false); }
  }
  const taskLabel = (status: TaskState) => ({ open: t('Planned', 'तय की गई'), acknowledged: t('Seen', 'देख लिया'), action_taken: t('Visit / action done', 'जाँच / काम किया'), resolved: t('Closed', 'बंद') })[status];
  return <div className="field-overview">
    <section className={`condition-card condition-${copy.assessment.state}`} aria-label={t('Field summary', 'खेत की स्थिति')}>
      <span className="eyebrow">{t('YOUR FIELD TODAY', 'आज आपके खेत की स्थिति')}</span>
      <h2><Sprout aria-hidden="true" size={28}/>{copy.title}</h2><p className="condition-explanation">{copy.explanation}</p>
      <dl className="field-facts"><div><dt>{t('Satellite image', 'Satellite तस्वीर')}</dt><dd>{field.latestObservation ? date(field.latestObservation.observed_on) : t('Not available yet', 'अभी उपलब्ध नहीं')}</dd></div>
        <div><dt>{t('Image age', 'तस्वीर कितनी पुरानी')}</dt><dd>{copy.assessment.ageDays == null ? t('Not available', 'उपलब्ध नहीं') : t(`${copy.assessment.ageDays} days`, `${copy.assessment.ageDays} दिन`)}</dd></div>
        <div><dt>{t('Field visible clearly', 'खेत का साफ़ दिखा हिस्सा')}</dt><dd>{field.latestObservation?.valid_coverage_percent != null ? `${field.latestObservation.valid_coverage_percent}%` : t('Not available', 'उपलब्ध नहीं')}</dd></div>
        <div><dt>{t('Field area', 'खेत का क्षेत्रफल')}</dt><dd>{area(field.area_hectares)}</dd></div></dl>
      {(field.isDemo || field.provenance === 'public_boundary' || field.provenance === 'demo') && <p className="demo-label">{t('Demo / public parcel. Current crop and dates are unverified.', 'डेमो / सार्वजनिक खेत। अभी की फ़सल और तारीख़ें सत्यापित नहीं हैं।')}</p>}
      <p className="quiet">{t('Satellite images show vegetation changes. A field visit is needed to understand their cause.', 'Satellite तस्वीरें हरियाली में बदलाव दिखाती हैं। वजह समझने के लिए खेत में जाँच ज़रूरी है।')}</p>
    </section>
    <section className="quick-actions no-print" aria-label={t('What to do next', 'अब क्या करें')}>
      <button type="button" onClick={() => { setParams({ action: 'visit' }); setSaved(false); }}><CalendarCheck aria-hidden="true"/><strong>{t('Plan a field visit', 'खेत की जाँच तय करें')}</strong><span>{t('Choose a date and save a reminder in your field tasks.', 'तारीख़ चुनकर खेत के कामों में सेव करें।')}</span></button>
      <Link to={`/fields/${field.id}/history?photo=1#scouting-title`}><Camera aria-hidden="true"/><strong>{t('Add photo & note', 'फ़ोटो और नोट जोड़ें')}</strong><span>{t('Record what you see in the field.', 'खेत में जो दिखे उसे दर्ज करें।')}</span></Link>
      <Link to={`/fields/${field.id}/map`}><Map aria-hidden="true"/><strong>{t('See field map', 'खेत का नक्शा देखें')}</strong><span>{t('Find the areas you want to inspect.', 'जाँच के लिए जगह देखें।')}</span></Link>
    </section>
    {planning && <section className="visit-form no-print" aria-labelledby="visit-heading"><h2 id="visit-heading">{t('Plan a field visit', 'खेत की जाँच तय करें')}</h2>
      <form onSubmit={save}><label>{t('Visit title', 'जाँच का नाम')}<input id="visit-title" value={title} maxLength={200} placeholder={t(`Visit ${field.name}`, `${field.name} की जाँच`)} onChange={event => setTitle(event.target.value)}/></label>
        <label>{t('Visit date', 'जाँच की तारीख़')}<input type="date" value={due} required onChange={event => setDue(event.target.value)}/></label>
        <label>{t('Reason for the visit', 'जाँच की वजह')}<textarea value={reason} maxLength={2000} placeholder={copy.explanation} onChange={event => setReason(event.target.value)}/></label>
        <p>{t('Saved with this field and the current image, when available. This creates an in-app task; it does not send a phone notification.', 'इस खेत और उपलब्ध तस्वीर के साथ सेव होगा। यह ऐप में काम की सूची बनाता है; फ़ोन पर नोटिफ़िकेशन नहीं भेजता।')}</p>
        {saveError && <p role="alert">{t('Visit could not be saved. Your entries are still here; please retry.', 'जाँच सेव नहीं हुई। जानकारी यहीं है; दोबारा कोशिश करें।')}</p>}
        <div className="button-row"><button type="submit" className="primary-action" disabled={saving}>{saving ? t('Saving…', 'सेव कर रहे हैं…') : t('Save visit', 'जाँच सेव करें')}</button><button type="button" disabled={saving} onClick={() => setParams({})}>{t('Cancel', 'रद्द करें')}</button></div>
      </form></section>}
    {saved && <p className="success-notice" role="status">{t('Field visit saved.', 'खेत की जाँच सेव हो गई।')}</p>}
    <ImageCheckPanel field={field} onComplete={refreshField}/>
    <section className="overview-tasks" aria-labelledby="overview-tasks-title"><div className="section-heading"><h2 id="overview-tasks-title">{t('Planned visits & tasks', 'तय जाँच और काम')}</h2><Link to={`/fields/${field.id}/history`}>{t('Open field diary', 'खेत की डायरी खोलें')} <ArrowRight size={16} aria-hidden="true"/></Link></div>
      {loadError && <p role="alert">{t('Tasks could not be loaded.', 'कामों की सूची नहीं मिली।')} <button type="button" onClick={() => setReload(value => value + 1)}>{t('Retry', 'फिर कोशिश करें')}</button></p>}
      {!loadError && !tasks.length && <p>{t('No visits planned. Use “Plan a field visit” to choose a date.', 'अभी कोई जाँच तय नहीं है। तारीख़ चुनने के लिए “खेत की जाँच तय करें” दबाएँ।')}</p>}
      {tasks.map(task => <article className="task-row" key={task.id}><div><strong>{task.title}</strong><p>{task.due_on ? date(task.due_on) : t('No date chosen', 'तारीख़ तय नहीं')}{task.status !== 'resolved' && task.due_on && task.due_on < today() ? ` · ${t('Overdue', 'तारीख़ निकल गई')}` : ''}</p>{task.reason && <p className="quiet">{task.reason}</p>}</div>
        <label>{t('Visit status', 'जाँच की स्थिति')}<select aria-label={`${t('Visit status', 'जाँच की स्थिति')}: ${task.title}`} value={task.status} disabled={changing === task.id} onChange={async event => {
          const status = event.target.value as TaskState; setChanging(task.id); setLoadError(false);
          try { await updateFieldTask(field.id, task.id, status); setTasks(current => current.map(item => item.id === task.id ? { ...item, status } : item)); await refreshField(); }
          catch { setLoadError(true); } finally { setChanging(null); }
        }}>{(['open','acknowledged','action_taken','resolved'] as const).map(status => <option key={status} value={status}>{taskLabel(status)}</option>)}</select></label>
      </article>)}
      {tasks.some(task => task.status === 'resolved') && <p className="quiet">{t('Closing a task records your action. It does not confirm crop recovery.', 'काम बंद करना आपकी कार्रवाई दर्ज करता है। इससे फ़सल के ठीक होने की पुष्टि नहीं होती।')}</p>}
    </section>
  </div>;
}
