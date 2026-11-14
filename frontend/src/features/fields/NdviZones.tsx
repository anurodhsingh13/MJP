import type { NdviClasses } from '../../../../shared/evidence';
import { usePreferences } from '../../lib/preferencesContext';
import './ndvi-zones.css';

/** NDVI greenness zones of one clear image. Ranges describe greenness, not crop health. */
export function NdviZones({ classes, date, tile, compact = false }: { classes: NdviClasses | null | undefined; date?: string; tile?: string | null; compact?: boolean }) {
  const { t, date: formatDate } = usePreferences();
  if (!classes) return null;
  const zones = [
    { key: 'high', value: classes.high, label: t('High greenness (NDVI ≥ 0.6)', 'ज़्यादा हरियाली (NDVI ≥ 0.6)'), short: t('High', 'ज़्यादा') },
    { key: 'moderate', value: classes.moderate, label: t('Moderate (0.4–0.6)', 'मध्यम (0.4–0.6)'), short: t('Moderate', 'मध्यम') },
    { key: 'low', value: classes.low, label: t('Low (0.2–0.4)', 'कम (0.2–0.4)'), short: t('Low', 'कम') },
    { key: 'bare', value: classes.bare, label: t('Bare soil / very low (< 0.2)', 'खाली ज़मीन / बहुत कम (< 0.2)'), short: t('Bare', 'खाली') },
  ] as const;
  return <section className={`ndvi-zones${compact ? ' compact' : ''}`} aria-label={t('Field greenness zones', 'खेत में हरियाली के हिस्से')}>
    <div className="ndvi-zones-head">
      <h3>{t('Greenness across the field', 'खेत में हरियाली कैसी फैली है')}</h3>
      {(date || tile) && <small>{date ? formatDate(date) : ''}{date && tile ? ' · ' : ''}{tile ? t(`Sentinel-2 tile ${tile}`, `Sentinel-2 टाइल ${tile}`) : ''}</small>}
    </div>
    <div className="ndvi-zones-bar" role="img" aria-label={zones.map(zone => `${zone.label}: ${zone.value}%`).join(', ')}>
      {zones.filter(zone => zone.value > 0).map(zone => <span key={zone.key} className={`zone-${zone.key}`} style={{ width: `${zone.value}%` }} title={`${zone.label}: ${zone.value}%`} />)}
    </div>
    <ul className="ndvi-zones-legend">
      {zones.map(zone => <li key={zone.key}><i className={`zone-${zone.key}`} aria-hidden="true" /><span>{compact ? zone.short : zone.label}</span><b>{zone.value === 0 ? 0 : zone.value.toFixed(zone.value < 10 ? 1 : 0)}%</b></li>)}
    </ul>
    {!compact && <p className="quiet">{t('Share of clearly visible field pixels in each NDVI range. Low greenness is normal after sowing and near harvest; it is not a disease diagnosis.', 'साफ़ दिखे खेत के हिस्सों का NDVI के हिसाब से बँटवारा। बुवाई के बाद और कटाई के पास कम हरियाली सामान्य है; यह बीमारी की पहचान नहीं है।')}</p>}
  </section>;
}
