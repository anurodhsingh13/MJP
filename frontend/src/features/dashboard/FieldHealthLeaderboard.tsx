import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowDownRight, ArrowUpRight, Minus, TableProperties } from 'lucide-react';
import type { DatabaseField } from '../../lib/api';
import { fieldAssessment } from '../../lib/fieldCopy';
import { usePreferences } from '../../lib/preferencesContext';
import './field-health-leaderboard.css';

type Sort = 'priority' | 'change' | 'date' | 'name';
const isReal = (field: DatabaseField) => !field.isDemo && field.provenance !== 'demo' && field.provenance !== 'public_boundary';
const usable = (field: DatabaseField, which: 'latestObservation' | 'previousObservation') => {
  const observation = field[which];
  return observation && observation.accepted === true && observation.provenance === 'measured_imagery'
    && observation.boundary_version === (field.boundary_version ?? 1)
    && typeof observation.ndvi_value === 'number' && Number.isFinite(observation.ndvi_value) ? observation : null;
};
const rank = (field: DatabaseField) => {
  const state = fieldAssessment(field).state;
  if (state === 'needs_inspection') return 0;
  if (Number(field.dueTasks) > 0) return 1;
  if (state !== 'no_unusual_change') return 2;
  return 3;
};

/** Read-only comparison of accepted readings. No estimated NDVI or crop diagnosis. */
export function FieldHealthLeaderboard({ fields }: { fields: DatabaseField[] }) {
  const { t, date } = usePreferences();
  const [sort, setSort] = useState<Sort>('priority');
  const [showAll, setShowAll] = useState(false);
  const rows = useMemo(() => fields.filter(isReal).map(field => {
    const latest = usable(field, 'latestObservation');
    const previous = usable(field, 'previousObservation');
    const compatible = !!(latest && previous && latest.observed_on !== previous.observed_on);
    const change = compatible ? Number(latest.ndvi_value) - Number(previous.ndvi_value) : null;
    return { field, latest, change };
  }).sort((a, b) => {
    if (sort === 'priority') return rank(a.field) - rank(b.field) || a.field.name.localeCompare(b.field.name);
    if (sort === 'change') return (a.change === null ? 1 : 0) - (b.change === null ? 1 : 0)
      || (a.change ?? 0) - (b.change ?? 0);
    if (sort === 'date') return (b.latest?.observed_on ?? '').localeCompare(a.latest?.observed_on ?? '');
    return a.field.name.localeCompare(b.field.name);
  }), [fields, sort]);
  if (!rows.length) return null;
  return <section className="health-leaderboard" aria-labelledby="health-leaderboard-heading">
    <header className="health-leaderboard-heading">
      <div>
        <span className="health-leaderboard-kicker"><TableProperties size={16} aria-hidden="true"/> {t('ALL-FIELD COMPARISON', 'सभी खेतों की तुलना')}</span>
        <h3 id="health-leaderboard-heading">{t('Which field should I check?', 'सबसे पहले कौन सा खेत देखें?')}</h3>
        <p>{t('Compare real fields using the latest accepted satellite observations. No reading means unknown, not healthy.', 'असली खेतों की उपलब्ध साफ़ सैटेलाइट रीडिंग देखें। जानकारी नहीं मिलने का मतलब स्वस्थ होना नहीं है।')}</p>
      </div>
      <label>{t('Sort fields', 'खेत क्रम में रखें')}
        <select value={sort} onChange={event => setSort(event.target.value as Sort)}>
          <option value="priority">{t('Action needed', 'ज़रूरी काम')}</option>
          <option value="change">{t('Largest NDVI decrease', 'सबसे अधिक हरियाली कमी')}</option>
          <option value="date">{t('Newest observation', 'नई तस्वीर')}</option>
          <option value="name">{t('Field name', 'खेत का नाम')}</option>
        </select>
      </label>
    </header>
    <div className="health-leaderboard-list">
      {rows.slice(0, showAll ? rows.length : 5).map(({ field, latest, change }) => {
        const state = fieldAssessment(field).state;
        const caption = state === 'needs_inspection'
          ? t('Visit recommended', 'खेत जाकर देखें')
          : Number(field.dueTasks) > 0
            ? t('Visit/task due', 'तय काम बाकी')
            : state === 'no_unusual_change'
              ? t('No unusual decrease seen', 'बड़ी कमी नहीं दिखी')
              : t('More imagery needed', 'और तस्वीर चाहिए');
        const Icon = change === null || Math.abs(change) < .005 ? Minus : change < 0 ? ArrowDownRight : ArrowUpRight;
        return <Link className="health-leaderboard-row" key={field.id} to={`/fields/${field.id}/overview`}>
          <span className="health-leaderboard-main"><strong>{field.name}</strong><small>{field.crop && field.crop !== 'Unknown' ? field.crop : t('Crop not provided', 'फ़सल नहीं बताई गई')}</small></span>
          <span className="health-leaderboard-status">{caption}</span>
          <span className="health-leaderboard-value"><small>{t('NDVI change', 'NDVI बदलाव')}</small>
            {change === null ? <b>—</b> : <b><Icon size={15} aria-hidden="true"/> {change > 0 ? '+' : ''}{change.toFixed(3)}</b>}
          </span>
          <span className="health-leaderboard-date"><small>{t('Last clear image', 'पिछली साफ़ तस्वीर')}</small>
            <b>{latest ? date(latest.observed_on) : t('Not available', 'उपलब्ध नहीं')}</b></span>
          <ArrowRight className="health-leaderboard-arrow" size={18} aria-hidden="true"/>
        </Link>;
      })}
    </div>
    {rows.length > 5 && <button type="button" className="health-leaderboard-expand" onClick={() => setShowAll(value => !value)}
      aria-expanded={showAll}>{showAll ? t('Show fewer fields', 'कम खेत दिखाएँ') : t(`Show all ${rows.length} fields`, `सभी ${rows.length} खेत दिखाएँ`)}</button>}
    <p className="health-leaderboard-footnote">{t('NDVI measures vegetation reflectance, not a confirmed disease or yield. Change is shown only when two accepted readings from the same boundary are available.', 'NDVI से हरियाली का संकेत मिलता है, बीमारी या पैदावार पक्की नहीं होती। बदलाव तभी दिखेगा जब एक ही खेत-सीमा की दो मान्य रीडिंग हों।')}</p>
  </section>;
}
