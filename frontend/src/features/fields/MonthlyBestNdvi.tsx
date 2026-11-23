import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts';
import type { VegetationIndexObservation } from '../../lib/api';
import { usePreferences } from '../../lib/preferencesContext';
import './monthly-best.css';

type Month = { key: string; time: number; best: number | null; bestDate: string | null; coverage: number | null; pictures: number };
const num = (value: unknown): number | null => value == null || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
// Same colour bands as the NDVI trend chart above, so one colour always means the same thing.
const bandColour = (value: number) => value >= .6 ? '#1a9850' : value >= .4 ? '#91cf60' : value >= .2 ? '#fee08b' : '#d9a066';

/**
 * "Best" NDVI of a month = the highest NDVI among that month's accepted (clear) satellite pictures.
 * Cloud and haze lower NDVI far more often than they raise it, so the highest clear reading is the fairest picture of how
 * green the crop got. Months without any accepted picture stay empty; they are never filled or guessed.
 */
export function MonthlyBestNdvi({ observations }: { observations: VegetationIndexObservation[] }) {
  const { t, date, language } = usePreferences();
  const locale = language === 'hi' ? 'hi-IN' : 'en-IN';
  const readings = observations
    .map(item => ({ day: item.observed_on.slice(0, 10), value: num(item.ndvi_value), coverage: num(item.valid_coverage_percent) }))
    .filter((item): item is { day: string; value: number; coverage: number | null } => item.value != null && /^\d{4}-\d{2}-\d{2}$/.test(item.day))
    .sort((a, b) => a.day.localeCompare(b.day));
  if (!readings.length) return null;

  const first = readings[0].day, last = readings[readings.length - 1].day;
  const spansYears = first.slice(0, 4) !== last.slice(0, 4);
  const monthLabel = (time: number, long = false) => new Date(time).toLocaleDateString(locale, { month: long ? 'long' : 'short', ...(spansYears || long ? { year: long ? 'numeric' : '2-digit' } : {}), timeZone: 'UTC' });

  const months: Month[] = [];
  const endYear = Number(last.slice(0, 4)), endMonth = Number(last.slice(5, 7));
  let year = Number(first.slice(0, 4)), month = Number(first.slice(5, 7));
  while (year < endYear || (year === endYear && month <= endMonth)) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const inMonth = readings.filter(item => item.day.startsWith(key));
    const top = inMonth.reduce<typeof inMonth[number] | null>((best, item) => !best || item.value > best.value ? item : best, null);
    months.push({ key, time: Date.UTC(year, month - 1, 1), best: top ? top.value : null, bestDate: top ? top.day : null, coverage: top ? top.coverage : null, pictures: inMonth.length });
    if (month === 12) { year += 1; month = 1; } else month += 1;
  }

  const filled = months.filter(item => item.best != null);
  const bestMonth = filled.reduce((best, item) => (item.best as number) > (best.best as number) ? item : best, filled[0]);
  const latest = filled[filled.length - 1];
  const earlier = filled.length > 1 ? filled[filled.length - 2] : null;
  const change = earlier ? (latest.best as number) - (earlier.best as number) : null;
  const sign = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
  const arrow = (value: number) => value > .03 ? '▲' : value < -.03 ? '▼' : '►';
  const tone = (value: number) => value > .03 ? 'up' : value < -.03 ? 'down' : 'flat';
  const deltas = new Map<string, number>();
  filled.forEach((item, position) => { if (position > 0) deltas.set(item.key, (item.best as number) - (filled[position - 1].best as number)); });

  const rows = months.map(item => ({ ...item, label: monthLabel(item.time), value: item.best }));
  type Row = typeof rows[number];
  type TipProps = { active?: boolean; payload?: ReadonlyArray<{ payload?: Row }> };
  const tip = ({ active, payload }: TipProps) => {
    const row = active ? payload?.[0]?.payload : undefined;
    if (!row) return null;
    return <div className="mb-tip"><strong>{monthLabel(row.time, true)}</strong>
      {row.best == null ? <span>{t('No clear satellite picture this month', 'इस महीने कोई साफ़ सैटेलाइट तस्वीर नहीं')}</span> : <>
        <span>{t('Best NDVI', 'सबसे अच्छा NDVI')}: <b>{row.best.toFixed(2)}</b></span>
        <span>{t('From the picture of', 'तस्वीर की तारीख़')} {date(row.bestDate as string)}</span>
        {row.coverage != null && <span>{t('Clear area in it', 'इसमें साफ़ हिस्सा')}: {Math.round(row.coverage)}%</span>}
        <span>{t('Clear pictures this month', 'इस महीने की साफ़ तस्वीरें')}: {row.pictures}</span></>}
    </div>;
  };

  return <section className="monthly-best" aria-labelledby="monthly-best-title">
    <h3 id="monthly-best-title">{t('Best NDVI of each month', 'हर महीने का सबसे अच्छा NDVI')}</h3>
    <p className="mb-note">{t('For each month we take the greenest of its clear satellite pictures, then compare the months side by side. Months with no clear picture are left empty, not guessed.', 'हर महीने की साफ़ सैटेलाइट तस्वीरों में से सबसे हरी को चुनकर महीनों की आपस में तुलना की गई है। जिस महीने साफ़ तस्वीर नहीं थी उसे खाली छोड़ा है, अनुमान नहीं लगाया।')}</p>
    <div className="mb-tiles">
      <div className="mb-tile best"><small>{t('Greenest month', 'सबसे हरा महीना')}</small><strong>{monthLabel(bestMonth.time, true)}</strong><span>NDVI {(bestMonth.best as number).toFixed(2)}</span></div>
      <div className="mb-tile"><small>{t('Latest month', 'ताज़ा महीना')}</small><strong>{monthLabel(latest.time, true)}</strong><span>NDVI {(latest.best as number).toFixed(2)}</span></div>
      <div className={`mb-tile ${change == null ? '' : tone(change)}`}><small>{t('Change from the month before', 'पिछले महीने से बदलाव')}</small>
        <strong>{change == null ? '—' : `${arrow(change)} ${sign(change)}`}</strong>
        <span>{earlier == null ? t('Need two months with clear pictures', 'दो महीनों की साफ़ तस्वीरें चाहिए') : t(`vs ${monthLabel(earlier.time, true)}`, `${monthLabel(earlier.time, true)} के मुक़ाबले`)}</span></div>
    </div>
    <figure className="mb-chart" aria-label={t('Bar chart of the best NDVI for each month', 'हर महीने के सबसे अच्छे NDVI का बार चार्ट')}>
      <ResponsiveContainer width="100%" height={270}>
        <BarChart data={rows} margin={{ top: 22, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid vertical={false} stroke="#dce3d8" />
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#20382b' }} interval={0} />
          <YAxis domain={[0, 1]} ticks={[0, .2, .4, .6, .8, 1]} tick={{ fontSize: 12, fill: '#526557' }} width={34} />
          <Tooltip content={tip} cursor={{ fill: '#286443', fillOpacity: .07 }} />
          <Bar dataKey="value" radius={[8, 8, 0, 0]} maxBarSize={64} isAnimationActive={false}>
            {rows.map(row => <Cell key={row.key} fill={row.best == null ? 'transparent' : bandColour(row.best)} stroke={row.key === bestMonth.key ? '#17472d' : 'none'} strokeWidth={row.key === bestMonth.key ? 3 : 0} />)}
            <LabelList dataKey="value" position="top" formatter={(value: unknown) => typeof value === 'number' ? value.toFixed(2) : ''} style={{ fontSize: 12, fontWeight: 700, fill: '#20382b' }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </figure>
    <ul className="mb-chips" aria-label={t('Month by month change', 'महीने-दर-महीने बदलाव')}>
      {months.map(item => {
        const delta = deltas.get(item.key);
        return <li key={item.key} className={item.key === bestMonth.key ? 'is-best' : ''}>
          <b>{monthLabel(item.time)}</b>
          {item.best == null ? <span className="mb-none">{t('no clear picture', 'साफ़ तस्वीर नहीं')}</span> : <span>{item.best.toFixed(2)}</span>}
          {delta != null && <em className={tone(delta)}>{arrow(delta)} {sign(delta)}</em>}
          {item.key === bestMonth.key && <i>★ {t('Best', 'सबसे अच्छा')}</i>}
        </li>;
      })}
    </ul>
    <p className="mb-legend"><span className="d high"/>{t('0.6+ dense, healthy', '0.6+ घना, स्वस्थ')} <span className="d mod"/>{t('0.4–0.6 moderate', '0.4–0.6 मध्यम')} <span className="d low"/>{t('0.2–0.4 sparse', '0.2–0.4 कम')} <span className="d bare"/>{t('below 0.2 bare', '0.2 से कम खाली')}</p>
  </section>;
}
