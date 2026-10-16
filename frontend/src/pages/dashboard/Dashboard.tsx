import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarCheck, CloudSun, MapPin, Sprout } from 'lucide-react';
import { loadFields, type DatabaseField } from '../../lib/api';
import { fieldAssessment, fieldCopy } from '../../lib/fieldCopy';
import { usePreferences } from '../../lib/preferencesContext';
import { AddFieldWizard } from '../../features/fields/AddFieldWizard';

export function Dashboard() {
  const navigate = useNavigate();
  const { t, language, date, area } = usePreferences();
  const [fields, setFields] = useState<DatabaseField[]>([]);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [includeDemo, setIncludeDemo] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    loadFields().then(data => { if (!cancelled) setFields(data); }).catch(() => { if (!cancelled) setError(true); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reload]);
  const real = fields.filter(field => !field.isDemo && field.provenance !== 'demo' && field.provenance !== 'public_boundary');
  const inspection = real.filter(field => fieldAssessment(field).state === 'needs_inspection');
  const dataIssues = real.filter(field => ['image_too_old','not_enough_data','awaiting_analysis'].includes(fieldAssessment(field).state));
  const due = real.filter(field => Number(field.dueTasks) > 0);
  const visible = fields.filter(field => (includeDemo || real.includes(field))
    && `${field.name} ${field.crop}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())
    && (filter === 'all' || (filter === 'data' ? dataIssues.includes(field) : filter === 'due' ? due.includes(field) : fieldAssessment(field).state === filter)));
  const choose = (value: string) => { setFilter(value); document.getElementById('my-fields')?.scrollIntoView({ behavior: 'smooth' }); };
  return <main className="dashboard-shell">
    <header className="dashboard-header overview-header"><div><span className="eyebrow">{t('YOUR FARM, ONE CLEAR VIEW', 'आपके खेत, एक नज़र में')}</span><h1>{t('How are your fields today?', 'आज आपके खेत कैसे हैं?')}</h1><p>{t('See which field needs a visit and which needs a clearer satellite image.', 'देखें किस खेत में जाना है और किसकी साफ़ satellite तस्वीर चाहिए।')}</p></div><button className="primary-action" onClick={() => setAdding(true)}>{t('+ Add field', '+ खेत जोड़ें')}</button></header>
    <nav className="overview-nav" aria-label={t('Main navigation', 'मुख्य नेविगेशन')}><a href="#overview">{t('Overview', 'एक नज़र')}</a><a href="#my-fields">{t('My fields', 'मेरे खेत')}</a><Link to="/reports">{t('Reports', 'रिपोर्ट')}</Link><Link to="/datasets">{t('Help & data sources', 'मदद और जानकारी के स्रोत')}</Link></nav>
    {error && <div className="service-error" role="alert"><strong>{t('Fields unavailable', 'खेतों की जानकारी नहीं मिली')}</strong><span>{t('Check your connection and try again. Your saved fields are safe.', 'इंटरनेट कनेक्शन देखकर फिर कोशिश करें। आपके सेव किए खेत सुरक्षित हैं।')}</span><button onClick={() => { setLoading(true); setError(false); setReload(value => value + 1); }}>{t('Retry', 'फिर कोशिश करें')}</button></div>}
    {!error && !loading && <>
      <section id="overview" className="summary-grid" aria-label={t('Farm summary', 'खेतों का सारांश')}>
        <button className="summary-tile inspection-tile" onClick={() => choose('needs_inspection')}><Sprout aria-hidden="true"/><span>{t('Needs inspection', 'खेत की जाँच करें')}</span><strong>{inspection.length}</strong><small>{t('Check the crop in person', 'खेत में जाकर देखें')}</small></button>
        <button className="summary-tile" onClick={() => choose('data')}><CloudSun aria-hidden="true"/><span>{t('Needs a clearer image', 'साफ़ तस्वीर चाहिए')}</span><strong>{dataIssues.length}</strong><small>{t('Crop condition is not confirmed', 'फ़सल की स्थिति की पुष्टि नहीं')}</small></button>
        <button className="summary-tile" onClick={() => choose('due')}><CalendarCheck aria-hidden="true"/><span>{t('Visits / tasks due', 'आज तक के तय काम')}</span><strong>{due.length}</strong><small>{t('Fields with tasks due today or earlier', 'जिन खेतों के काम आज या पहले तय थे')}</small></button>
        <button className="summary-tile" onClick={() => choose('all')}><MapPin aria-hidden="true"/><span>{t('Your saved fields', 'आपके सेव किए खेत')}</span><strong>{real.length}</strong><small>{t('Your own fields; demos excluded', 'आपके खेत; डेमो शामिल नहीं')}</small></button>
      </section>
      <section className="attention-panel" aria-labelledby="attention-heading"><span className="eyebrow">{t('WHAT TO DO NEXT', 'अब क्या करें')}</span><h2 id="attention-heading">{t('Needs attention', 'खेत की जाँच करें')}</h2>
        {inspection.length ? inspection.slice(0, 5).map(field => <article className="attention-row" key={field.id}><span className="attention-icon" aria-hidden="true"><Sprout/></span><div><strong>{field.name}</strong><p>{fieldCopy(field, language).explanation}</p></div><Link className="action-link" to={`/fields/${field.id}/overview?action=visit`}>{t('Plan a field visit', 'जाँच की तारीख़ तय करें')} <ArrowRight size={18} aria-hidden="true"/></Link></article>)
          : <p>{real.length ? t('No large vegetation decrease detected in the available comparable images. Continue your regular field visits.', 'उपलब्ध तुलना योग्य तस्वीरों में हरियाली की बड़ी कमी नहीं दिखी। खेत की नियमित जाँच जारी रखें।') : t('Add your first field to start. Demo parcels are kept separate.', 'शुरू करने के लिए अपना पहला खेत जोड़ें। डेमो खेत अलग रखे जाते हैं।')}</p>}
        {inspection.length > 5 && <button className="text-button" onClick={() => choose('needs_inspection')}>{t(`See all ${inspection.length} fields needing inspection`, `जाँच वाले सभी ${inspection.length} खेत देखें`)}</button>}
      </section>
      {dataIssues.length > 0 && <section className="data-notice" aria-label={t('Image updates', 'तस्वीर की जानकारी')}><CloudSun size={28} aria-hidden="true"/><div><h2>{t(`${dataIssues.length} ${dataIssues.length === 1 ? "field needs" : "fields need"} more recent or clearer images`, `${dataIssues.length} खेतों की नई या साफ़ तस्वीर चाहिए`)}</h2><p>{t('Old, cloudy or missing images do not tell us the crop is damaged. Open a field to check for another image.', 'पुरानी, बादलों वाली या गायब तस्वीर का मतलब फ़सल खराब होना नहीं है। दूसरी तस्वीर खोजने के लिए खेत खोलें।')}</p></div><button onClick={() => choose('data')}>{t('See these fields', 'ये खेत देखें')}</button></section>}
      <section id="my-fields" aria-labelledby="fields-heading"><div className="section-heading"><div><span className="eyebrow">{t('YOUR LAND', 'आपकी ज़मीन')}</span><h2 id="fields-heading">{t('My fields', 'मेरे खेत')}</h2></div><span>{t(`${visible.length} shown`, `${visible.length} दिख रहे हैं`)}</span></div>
        <div className="field-filters"><label>{t('Search fields', 'खेत खोजें')}<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('Field name or crop', 'खेत या फ़सल का नाम')}/></label><label>{t('Show fields', 'कौन से खेत दिखाएँ')}<select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">{t('All fields', 'सभी खेत')}</option><option value="needs_inspection">{t('Needs inspection', 'जाँच ज़रूरी')}</option><option value="data">{t('Needs a clearer image', 'साफ़ तस्वीर चाहिए')}</option><option value="due">{t('Visits / tasks due', 'तय काम बाकी')}</option><option value="no_unusual_change">{t('No unusual change detected', 'बड़ा बदलाव नहीं दिखा')}</option></select></label><label className="checkbox-label"><input type="checkbox" checked={includeDemo} onChange={event => setIncludeDemo(event.target.checked)}/>{t('Show demo & public parcels', 'डेमो और सार्वजनिक खेत दिखाएँ')}</label></div>
        {visible.length ? <div className="field-grid">{visible.map(field => {
          const { assessment, title, explanation } = fieldCopy(field, language);
          const active = field.latestJob && ['queued','running'].includes(field.latestJob.status);
          return <article className="field-card" key={field.id}><div className="field-card-top"><div><span className={`evidence-status status-${assessment.state}`}>{assessment.state === 'needs_inspection' ? '⚑' : assessment.state === 'no_unusual_change' ? '✓' : '◷'} {title}</span><h3><Link to={`/fields/${field.id}/overview`}>{field.name}</Link></h3><small>{!field.crop || field.crop === 'Unknown' ? t('Crop unknown', 'फ़सल अज्ञात') : field.crop} · {area(field.area_hectares)}</small></div></div><p>{explanation}</p><dl className="evidence-facts"><div><dt>{t('Satellite image', 'Satellite तस्वीर')}</dt><dd>{field.latestObservation ? date(field.latestObservation.observed_on) : t('Not available yet', 'अभी उपलब्ध नहीं')}</dd></div><div><dt>{t('Field visible clearly', 'खेत का साफ़ दिखा हिस्सा')}</dt><dd>{field.latestObservation?.valid_coverage_percent != null ? `${field.latestObservation.valid_coverage_percent}%` : t('Not available', 'उपलब्ध नहीं')}</dd></div></dl>
            {field.isDemo && <p className="demo-label">{t('Demo / public boundary · current crop unverified', 'डेमो / सार्वजनिक खेत · अभी की फ़सल सत्यापित नहीं')}</p>}
            {active && <p className="job-badge" role="status">{t('Satellite image check in progress', 'Satellite तस्वीर की जाँच चल रही है')}</p>}
            {field.latestJob?.status === 'failed' && <p className="job-badge job-failed">{t('Image check could not finish. Open this field to retry.', 'तस्वीर की जाँच पूरी नहीं हुई। दोबारा कोशिश के लिए खेत खोलें।')}</p>}
            {Number(field.dueTasks) > 0 && <p className="due-badge">{t(`${field.dueTasks} ${Number(field.dueTasks) === 1 ? "task" : "tasks"} due`, `${field.dueTasks} तय काम बाकी`)}</p>}
            <footer><Link className="action-link" to={`/fields/${field.id}/overview`}>{t('Open field', 'खेत खोलें')} <ArrowRight size={18} aria-hidden="true"/></Link></footer></article>;
        })}</div> : <div className="dashboard-state"><h2>{fields.length ? t('No fields match this view', 'इस फ़िल्टर में कोई खेत नहीं') : t('No fields added yet', 'अभी कोई खेत नहीं जोड़ा')}</h2><p>{fields.length ? t('Change the search or show all your fields.', 'खोज बदलें या सभी खेत दिखाएँ।') : t('Give your field a name and mark its boundary. You can add planting dates later.', 'खेत का नाम दें और उसकी सीमा बनाएँ। बुवाई की तारीख़ बाद में जोड़ सकते हैं।')}</p>{fields.length ? <button onClick={() => { setQuery(''); setFilter('all'); }}>{t('Clear filters', 'फ़िल्टर हटाएँ')}</button> : <button className="primary-action" onClick={() => setAdding(true)}>{t('Add your first field', 'अपना पहला खेत जोड़ें')}</button>}</div>}
      </section>
      <details className="evidence-help"><summary>{t('How to read satellite evidence', 'Satellite तस्वीरों को कैसे समझें')}</summary><p>{t('The clear-view percentage is the usable part of your field in an image. Poor coverage does not mean unhealthy crops. With only one clear image, we cannot yet assess change.', 'साफ़ दिखा प्रतिशत बताता है कि तस्वीर में खेत का कितना हिस्सा जाँचने लायक था। कम हिस्सा दिखने का मतलब फ़सल खराब होना नहीं है। केवल एक साफ़ तस्वीर से बदलाव नहीं बताया जा सकता।')}</p><p>{t('Satellite vegetation signals cannot identify a disease. Harvest, crop maturity, bare soil and mixed pixels can change them.', 'Satellite की हरियाली से किसी बीमारी की पहचान नहीं होती। कटाई, फ़सल पकना, खाली मिट्टी और मिले-जुले pixels से भी बदलाव आ सकता है।')}</p><Link to="/datasets">{t('Data sources & limitations', 'जानकारी के स्रोत और सीमाएँ')}</Link></details>
    </>}
    {loading && <div className="dashboard-state" role="status">{t('Loading fields…', 'खेतों की जानकारी ला रहे हैं…')}</div>}
    {adding && <AddFieldWizard onComplete={fieldId => { setAdding(false); navigate(`/fields/${fieldId}/overview`); }} onCancel={() => setAdding(false)}/>}
  </main>;
}
