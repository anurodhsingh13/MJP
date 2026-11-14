import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadFields, type DatabaseField } from '../../lib/api';
import { usePreferences } from '../../lib/preferencesContext';
import { AddFieldWizard } from '../../features/fields/AddFieldWizard';
import { FarmHome } from '../../features/dashboard/FarmHome';

export function Dashboard() {
  const navigate = useNavigate();
  const { t } = usePreferences();
  const [fields, setFields] = useState<DatabaseField[]>([]);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    loadFields().then(data => { if (!cancelled) setFields(data); }).catch(() => { if (!cancelled) setError(true); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reload]);
  return <main className="dashboard-shell simple-farm">
    {!error && !loading && <FarmHome fields={fields} onAddField={() => setAdding(true)} />}
    {error && <div className="service-error" role="alert"><strong>{t('Fields unavailable', 'खेतों की जानकारी नहीं मिली')}</strong><span>{t('Check your connection and try again. Your saved fields are safe.', 'कनेक्शन देखकर फिर कोशिश करें। आपके सेव किए खेत सुरक्षित हैं।')}</span><button onClick={() => { setLoading(true); setError(false); setReload(value => value + 1); }}>{t('Retry', 'फिर कोशिश करें')}</button></div>}
    {loading && <div className="dashboard-state" role="status">{t('Loading fields…', 'खेतों की जानकारी ला रहे हैं…')}</div>}
    {adding && <AddFieldWizard onComplete={fieldId => { setAdding(false); navigate(`/fields/${fieldId}/overview`); }} onCancel={() => setAdding(false)} />}
  </main>;
}
