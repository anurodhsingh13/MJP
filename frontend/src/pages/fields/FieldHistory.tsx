import { useEffect, useState, type FormEvent } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { loadFieldEvents, createFieldEvent, deleteFieldEvent, loadScouting, saveScouting, loadFieldTasks, updateFieldTask, type ScoutingCase, type DatabaseField, type FieldEvent, type FieldTask, type TaskState } from '../../lib/api';
import { usePreferences } from '../../lib/preferencesContext';
import {PhotoQualityPreview} from '../../features/fields/PhotoQualityPreview';
import {isScoutingDraftDate} from '../../features/fields/scoutingDraft';
import {OfflineDiaryDrafts} from '../../features/fields/OfflineDiaryDrafts';

function EventNotes({event}:{event:FieldEvent}) {
  const {t}=usePreferences();
  let source:Record<string,unknown>|null=null;
  if(event.event_type==='dataset_import'&&event.notes){
    try { const parsed:unknown=JSON.parse(event.notes); if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))source=parsed as Record<string,unknown>; }
    catch { /* Preserve ordinary text notes from earlier imports. */ }
  }
  if(source) return <>
    <p>{t(`Historical boundary recorded in ${source.boundary_year || 'an unknown year'}. Current crop and dates are unverified.`, `${source.boundary_year || 'अज्ञात वर्ष'} की पुरानी सीमा। अभी की फ़सल और तारीख़ें सत्यापित नहीं हैं।`)}</p>
    {typeof source.source_url==='string'&&source.source_url.startsWith('https://')&&<a href={source.source_url} target="_blank" rel="noreferrer">{t('Dataset source and attribution ↗','स्रोत और श्रेय ↗')}</a>}
    <details><summary>{t('Source details','स्रोत की जानकारी')}</summary><p>{String(source.dataset||'')} · {String(source.license||'')}</p><p>{String(source.warning||'')}</p></details>
  </>;
  return <p>{event.notes || t('No notes provided','कोई नोट नहीं')}</p>;
}

export function FieldHistory() {
  const { field } = useOutletContext<{field:DatabaseField}>();
  const { t, date } = usePreferences();
  const [params] = useSearchParams();
  const [events, setEvents] = useState<FieldEvent[]>([]);
  const [cases, setCases] = useState<ScoutingCase[]>([]);
  const [tasks, setTasks] = useState<FieldTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [eventError, setEventError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [type, setType] = useState('planting');
  const [eventDate, setEventDate] = useState('');
  const [notes, setNotes] = useState('');
  const [reload, setReload] = useState(0);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [photoDate, setPhotoDate] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [symptoms, setSymptoms] = useState('');
  const [photoNotes, setPhotoNotes] = useState('');
  const [photoSaving, setPhotoSaving] = useState(false);
  const [photoError, setPhotoError] = useState(false);
  const [photoSaved, setPhotoSaved] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [draftReadyField, setDraftReadyField] = useState<string | null>(null);
  // Keep text-only scouting drafts for this tab. Photos are never stored in browser storage.
  useEffect(() => {
    const storageKey = `terrascope:scouting-draft:${field.id}`;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return;
      const draft:unknown = JSON.parse(raw);
      if (!draft || typeof draft !== 'object') return;
      const data = draft as Record<string,unknown>;
      if (isScoutingDraftDate(data.observed_on)) setPhotoDate(data.observed_on);
      if (typeof data.symptoms === 'string') setSymptoms(data.symptoms.slice(0,4000));
      if (typeof data.notes === 'string') setPhotoNotes(data.notes.slice(0,4000));
      if (typeof data.client_key === 'string' && /^[a-f0-9-]{36}$/i.test(data.client_key)) setKey(data.client_key);
    } catch { /* Storage may be disabled; upload remains usable. */ }
    finally { setDraftReadyField(field.id); }
  }, [field.id]);
  useEffect(() => {
    const storageKey = `terrascope:scouting-draft:${field.id}`;
    if (draftReadyField !== field.id) return;
    try {
      if (symptoms || photoNotes || photo) sessionStorage.setItem(storageKey,JSON.stringify({observed_on:photoDate,symptoms,notes:photoNotes,client_key:key}));
      else sessionStorage.removeItem(storageKey);
    } catch { /* Private browsing or storage quotas must not prevent uploading. */ }
  }, [field.id,photoDate,symptoms,photoNotes,photo,key,draftReadyField]);
  const eventTitle = (value:string) => ({planting:t('Planting','बुवाई'),fertilizer:t('Fertilizer Application','खाद डालना'),irrigation:t('Irrigation','सिंचाई'),pesticide:t('Pesticide Application','कीटनाशक डालना'),scouting:t('Scouting / Observation','खेत की जाँच'),harvest:t('Harvest','कटाई'),other:t('Other','अन्य'),dataset_import:t('Public boundary imported','सार्वजनिक सीमा जोड़ी गई')} as Record<string,string>)[value] || value;
  useEffect(() => {
    let stopped = false;
    void Promise.allSettled([loadFieldEvents(field.id),loadScouting(field.id),loadFieldTasks(field.id)]).then(([diary,scouting,visits]) => {
      if (stopped) return;
      if (diary.status === 'fulfilled') setEvents(diary.value);
      if (scouting.status === 'fulfilled') setCases(scouting.value.cases);
      if (visits.status === 'fulfilled') setTasks(visits.value);
      setLoadError([diary,scouting,visits].some(item => item.status === 'rejected')); setLoading(false);
    });
    return () => { stopped = true; };
  }, [field.id,reload]);
  useEffect(() => { if (!loading && params.get('photo') === '1') { document.getElementById('scouting-title')?.scrollIntoView(); document.getElementById('scouting-photo')?.focus({preventScroll:true}); } }, [loading,params]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  async function addEvent(event: FormEvent) {
    event.preventDefault(); if (saving) return;
    setSaving(true); setEventError(false);
    try { const saved = await createFieldEvent(field.id,type,eventDate,notes); setEvents(current => [saved,...current].sort((a,b) => b.event_date.localeCompare(a.event_date))); setNotes(''); setEventDate(''); }
    catch { setEventError(true); } finally { setSaving(false); }
  }
  async function addPhoto(event: FormEvent) {
    event.preventDefault(); if (!photo || photoSaving) return;
    setPhotoError(false); setPhotoSaved(false);
    if (photo.size > 5*1024*1024 || !['image/jpeg','image/png','image/webp'].includes(photo.type)) { setPhotoError(true); return; }
    setPhotoSaving(true);
    try {
      const image = await new Promise<string>((resolve,reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Unable to read image')); reader.onerror = () => reject(new Error('Unable to read image')); reader.readAsDataURL(photo); });
      const saved = await saveScouting(field.id,{client_key:key,observed_on:photoDate,crop:field.crop && field.crop !== 'Unknown' ? field.crop : undefined,symptoms,notes:photoNotes,image});
      setCases(current => [saved,...current.filter(item => item.id !== saved.id)]); setPhoto(null); setPreview(''); setSymptoms(''); setPhotoNotes(''); setKey(crypto.randomUUID()); try { sessionStorage.removeItem(`terrascope:scouting-draft:${field.id}`); } catch { /* Optional storage. */ } setPhotoSaved(true);
      const input = document.getElementById('scouting-photo') as HTMLInputElement | null; if (input) input.value = '';
      try { setTasks(await loadFieldTasks(field.id)); } catch { setLoadError(true); }
    } catch { setPhotoError(true); } finally { setPhotoSaving(false); }
  }
  if (loading) return <div className="diary-layout" role="status">{t('Loading field diary…','खेत की डायरी ला रहे हैं…')}</div>;
  return <div className="diary-layout"><div className="content-heading"><h2>{t('Field diary','खेत की डायरी')}</h2><Link to={`/fields/${field.id}/overview?action=visit`}>{t('Plan a field visit','खेत की जाँच तय करें')} →</Link></div>
    {loadError && <p className="error-notice" role="alert">{t('Some diary records could not be loaded.','डायरी की कुछ जानकारी नहीं मिली।')} <button onClick={() => { setLoading(true); setReload(value => value+1); }}>{t('Retry loading history','फिर कोशिश करें')}</button></p>}
    <OfflineDiaryDrafts fieldId={field.id} onSynced={saved=>setEvents(current=>[saved,...current.filter(item=>item.id!==saved.id)].sort((a,b)=>b.event_date.localeCompare(a.event_date)))}/>
    <section className="diary-form"><h3>{t('Log New Event','खेत का काम दर्ज करें')}</h3><form onSubmit={addEvent}><label>{t('Event Type','किस तरह का काम')}<select value={type} onChange={event => setType(event.target.value)}>{['planting','fertilizer','irrigation','pesticide','scouting','harvest','other'].map(value => <option key={value} value={value}>{eventTitle(value)}</option>)}</select></label><label>{t('Date','तारीख़')}<input type="date" required value={eventDate} onChange={event => setEventDate(event.target.value)}/></label><label>{t('Notes (Optional)','नोट (ज़रूरी नहीं)')}<textarea value={notes} maxLength={4000} onChange={event => setNotes(event.target.value)} rows={3}/></label>{eventError && <p role="alert">{t('Event could not be saved. Your entries are still here; please retry.','काम सेव नहीं हुआ। जानकारी यहीं है; फिर कोशिश करें।')}</p>}<button type="submit" className="primary-action" disabled={saving}>{saving ? t('Saving…','सेव कर रहे हैं…') : t('Save Event','काम सेव करें')}</button></form></section>
    <section aria-labelledby="events-title"><h3 id="events-title">{t('Recorded field work','दर्ज किए गए काम')}</h3>{!events.length && <p>{t('No events recorded for this field.','इस खेत का कोई काम अभी दर्ज नहीं है।')}</p>}{events.map(item => <article className="history-event" key={item.id}><div><strong>{eventTitle(item.event_type)}</strong><EventNotes event={item}/><small>{date(item.event_date)}</small></div><button type="button" className="text-button" disabled={deleting === item.id} onClick={async () => { if (!window.confirm(t('Delete this field event?','यह काम हटाएँ?'))) return; setDeleting(item.id); try { await deleteFieldEvent(field.id,item.id); setEvents(current => current.filter(value => value.id !== item.id)); } catch { setLoadError(true); } finally { setDeleting(null); } }}>{deleting === item.id ? t('Deleting…','हटा रहे हैं…') : t('Delete','हटाएँ')}</button></article>)}</section>
    <section className="scouting-panel" aria-labelledby="scouting-title"><h2 id="scouting-title" tabIndex={-1}>{t('Photo scouting','फ़ोटो और खेत की जाँच')}</h2><p>{t('Photograph what you see and add a note. Photos are saved to this field; automatic disease diagnosis is not available.','जो दिखे उसकी फ़ोटो और नोट जोड़ें। फ़ोटो इस खेत में सेव होगी; बीमारी की अपने आप पहचान अभी उपलब्ध नहीं है।')}</p><form onSubmit={addPhoto}><label>{t('Observation date','जाँच की तारीख़')}<input aria-label={t('Scouting observation date','खेत की जाँच की तारीख़')} type="date" required max={new Date().toLocaleDateString('en-CA')} value={photoDate} onChange={event => setPhotoDate(event.target.value)}/></label><label>{t('Symptoms','क्या दिख रहा है')}<textarea value={symptoms} maxLength={4000} onChange={event => setSymptoms(event.target.value)} rows={2}/></label><label>{t('Notes','नोट')}<textarea value={photoNotes} maxLength={4000} onChange={event => setPhotoNotes(event.target.value)} rows={3}/></label><label>{t('Crop photo','फ़सल की फ़ोटो')}<input id="scouting-photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" required onChange={event => { const image = event.target.files?.[0] ?? null; setPhoto(image); setPreview(image ? URL.createObjectURL(image) : ''); setPhotoError(false); }}/></label><small>{t('JPEG, PNG or WebP up to 5 MB. Take a clear, close photo in daylight.','JPEG, PNG या WebP, 5 MB तक। दिन की रोशनी में पास से साफ़ फ़ोटो लें।')}</small>{preview && <img className="scouting-photo-preview" src={preview} alt={t('Selected crop photo preview','चुनी फ़सल की फ़ोटो का पूर्वावलोकन')}/>}<PhotoQualityPreview fieldId={field.id} file={photo}/>{photoError && <p role="alert">{t('Photo could not be saved. Your note and selected photo are still here; check the date or connection, then retry.','फ़ोटो सेव नहीं हुई। आपका नोट और चुनी हुई फ़ोटो यहीं हैं; तारीख़ या इंटरनेट जाँचकर दोबारा कोशिश करें।')}</p>}<button type="submit" className="primary-action" disabled={photoSaving || !photo}>{photoSaving ? t('Saving photo and field note…','फ़ोटो और नोट सेव कर रहे हैं…') : t('Save scouting note','फ़ोटो और नोट सेव करें')}</button></form>{photoSaved && <p className="success-notice" role="status">{t('Photo and field note saved.','फ़ोटो और नोट सेव हो गए।')}</p>}
      <p className="quiet">{t('Diagnosis unavailable: no licensed, validated provider is configured. Photo quality review is not a crop diagnosis.','बीमारी की पहचान उपलब्ध नहीं है: कोई सत्यापित सेवा जुड़ी नहीं है। फ़ोटो की गुणवत्ता जाँचना बीमारी की पहचान नहीं है।')}</p>
      {!cases.length && <p>{t('No photos or scouting notes recorded for this field.','इस खेत की कोई फ़ोटो या जाँच का नोट नहीं है।')}</p>}{cases.map(item => <article className="scouting-case" key={item.id}><h3>{t('Field note','खेत का नोट')} · {date(item.observed_on)}</h3>{item.symptoms && <p>{item.symptoms}</p>}{item.notes && <p>{item.notes}</p>}{item.photos?.map(image => <div key={image.id}><img className="scouting-photo-preview" loading="lazy" alt={t('Saved crop scouting photo','सेव की हुई फ़सल की फ़ोटो')} src={document.documentElement.dataset.showcase==='true' && (image.preview_url?.startsWith('/images/')||image.preview_url?.startsWith('data:image/')) ? image.preview_url : `/api/fields/${field.id}/scouting/${item.id}/photos/${image.id}`} /><details><summary>{t('Photo quality','फ़ोटो की गुणवत्ता')}</summary>{image.quality}</details></div>)}<button className="text-button" disabled={deleting === item.id} onClick={async () => { if (!window.confirm(t('Delete this photo note and its follow-up task?','यह फ़ोटो नोट और उससे जुड़ा काम हटाएँ?'))) return; setDeleting(item.id); try { const response = await fetch(`/api/fields/${field.id}/scouting/${item.id}`,{method:'DELETE'}); if (!response.ok) throw new Error('Delete failed'); setCases(current => current.filter(value => value.id !== item.id)); setTasks(await loadFieldTasks(field.id)); } catch { setLoadError(true); } finally { setDeleting(null); } }}>{t('Delete photo note','फ़ोटो नोट हटाएँ')}</button></article>)}
    </section>
    <section aria-labelledby="tasks-title"><h2 id="tasks-title">{t('Follow-up tasks','आगे के काम')}</h2>{!tasks.length && <p>{t('No follow-up tasks are open for this field.','इस खेत का कोई आगे का काम नहीं है।')}</p>}{tasks.map(item => <article className="task-row" key={item.id}><div><strong>{item.title}</strong><p>{item.due_on ? date(item.due_on) : t('No date chosen','तारीख़ तय नहीं')}</p></div><label>{t('State','स्थिति')}<select aria-label={`${t('Task state for','काम की स्थिति:')} ${item.title}`} value={item.status} disabled={deleting === item.id} onChange={async event => { const status = event.target.value as TaskState; setDeleting(item.id); try { await updateFieldTask(field.id,item.id,status); setTasks(current => current.map(value => value.id === item.id ? {...value,status} : value)); } catch { setLoadError(true); } finally { setDeleting(null); } }}>{(['open','acknowledged','action_taken','resolved'] as const).map(value => <option key={value} value={value}>{{open:t('Open','खुला'),acknowledged:t('Acknowledged','देख लिया'),action_taken:t('Action taken','कार्रवाई की'),resolved:t('Resolved','बंद')}[value]}</option>)}</select></label></article>)}<p className="quiet">{t('Closing a task does not confirm crop recovery.','काम बंद करने से फ़सल के ठीक होने की पुष्टि नहीं होती।')}</p></section>
  </div>;
}
