import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea } from 'recharts';
import type { FieldEvent, VegetationIndexObservation } from '../../lib/api';
import { usePreferences } from '../../lib/preferencesContext';

type Index = 'ndvi_value'|'ndmi_value'|'ndre_value';
export function VegetationChart({ observations, index = 'ndvi_value', events = [], simple = false, season }: { simple?: boolean; observations: VegetationIndexObservation[]; index?: Index; events?: FieldEvent[]; season?: { plantingDate?: string | null; harvestDate?: string | null } }) {
  const { t, date } = usePreferences();
  const names:Record<Index,string> = {
    ndvi_value:t('Greenness','हरियाली'),
    ndmi_value:t('Water signal in plants','पौधों में पानी का संकेत'),
    ndre_value:t('Leaf reflectance','पत्तियों से लौटने वाली रोशनी')
  };
  const chart = observations
    .map(item => ({ date: Date.parse(item.observed_on), value: item[index] == null ? null : Number(item[index]) }))
    .filter(item => Number.isFinite(item.date) && item.value !== null && Number.isFinite(item.value))
    .sort((a,b)=>a.date-b.date);
  const first = chart[0], last = chart.at(-1);
  const difference = first && last && chart.length > 1 ? Number(last?.value ?? 0)-Number(first.value) : null;
  const direction = difference == null ? 'unknown' : difference < -0.03 ? 'down' : difference > 0.03 ? 'up' : 'stable';
  const conclusion = direction === 'down' ? t('Greenness decreased','हरियाली घटी')
    : direction === 'up' ? t('Greenness increased','हरियाली बढ़ी')
    : direction === 'stable' ? t('Almost no change','लगभग कोई बदलाव नहीं')
    : t('More dates are needed','और तारीख़ों की ज़रूरत है');
  // NDVI greenness bands behind the line (same ranges as the field zones), and the farmer's sowing/harvest dates.
  const ndviBands = index === 'ndvi_value' ? [
    { from: -1, to: .2, fill: '#d9a066' }, { from: .2, to: .4, fill: '#fee08b' }, { from: .4, to: .6, fill: '#91cf60' }, { from: .6, to: 1, fill: '#1a9850' },
  ] : [];
  const lowest = chart.reduce((minimum, item) => Math.min(minimum, Number(item.value)), 0);
  const yDomain: [number, number] = index === 'ndvi_value' ? [Math.max(-1, Math.floor(Math.min(0, lowest) * 10) / 10), 1] : [-1, 1];
  const seasonMarks = [
    { key: 'sowing', time: season?.plantingDate ? Date.parse(`${season.plantingDate.slice(0, 10)}T00:00:00Z`) : NaN, label: t('Sowing', 'बुवाई') },
    { key: 'harvest', time: season?.harvestDate ? Date.parse(`${season.harvestDate.slice(0, 10)}T00:00:00Z`) : NaN, label: t('Harvest', 'कटाई') },
  ].filter(mark => Number.isFinite(mark.time) && first && last && mark.time >= first.date && mark.time <= last.date);
  const icon = direction === 'down' ? '↘' : direction === 'up' ? '↗' : direction === 'stable' ? '→' : '•';
  const range = last && first ? `${date(new Date(first.date).toISOString().slice(0,10))} – ${date(new Date(last.date).toISOString().slice(0,10))}` : '';
  const valueLabel = (value:number|null) => value == null ? '—' : value.toFixed(2);
  return <div className="farmer-chart-section">
    {simple && <div className={`farmer-chart-summary chart-direction-${direction}`} aria-live="polite">
      <span className="farmer-chart-arrow" aria-hidden="true">{icon}</span>
      <div><strong>{conclusion}</strong><p>{difference == null
        ? t('Only one picture date is available.','अभी केवल एक तस्वीर की तारीख़ उपलब्ध है।')
        : t(`From ${valueLabel(Number(first.value))} to ${valueLabel(Number(last?.value ?? 0))} · change ${difference > 0 ? '+' : ''}${difference.toFixed(2)}`,`पहले ${valueLabel(Number(first.value))}, अब ${valueLabel(Number(last?.value ?? 0))} · बदलाव ${difference > 0 ? '+' : ''}${difference.toFixed(2)}`)}</p>
      {range && <small>{range} · {chart.length} {t('pictures','तस्वीरें')}</small>}</div>
    </div>}
    {simple && <div className="farmer-graph-explainer"><span><b>●</b> {t('Dots = satellite picture dates','बिंदु = सैटेलाइट तस्वीर की तारीख़ें')}</span><span><b>↗</b> {t('Up = more vegetation signal','ऊपर = अधिक हरियाली का संकेत')}</span><span><b>↘</b> {t('Down = less vegetation signal','नीचे = कम हरियाली का संकेत')}</span>{index === 'ndvi_value' && <span><b>▤</b> {t('Shaded bands = bare (<0.2), low, moderate, high (≥0.6) greenness','रंगीन पट्टियाँ = खाली (<0.2), कम, मध्यम, ज़्यादा (≥0.6) हरियाली')}</span>}</div>}
    <div className="vegetation-chart" role="img" aria-label={t(`${names[index]} across ${chart.length} picture dates. ${conclusion}.`,`${chart.length} तस्वीरों में ${names[index]}। ${conclusion}।`)}>
      {chart.length ? <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chart} margin={{ top:16, left:0, right:24, bottom:12 }}>
          <CartesianGrid vertical={false} strokeDasharray="4 5" stroke="#d7e5d7"/>
          <XAxis dataKey="date" type="number" scale="time" domain={['dataMin','dataMax']} tickCount={Math.min(5,chart.length)} tickFormatter={value => date(new Date(Number(value)).toISOString().slice(0,10))} tick={{fontSize:12,fill:'#45614d'}}/>
          <YAxis domain={yDomain} width={42} hide={simple} tick={{fontSize:12,fill:'#45614d'}}/>
          {ndviBands.map(band => <ReferenceArea key={band.from} y1={Math.max(band.from, yDomain[0])} y2={band.to} fill={band.fill} fillOpacity={.13} stroke="none" ifOverflow="hidden"/>)}
          {seasonMarks.map(mark => <ReferenceLine key={mark.key} x={mark.time} stroke="#6b4f1d" strokeDasharray="5 4" label={{ value: mark.label, position: 'insideTopLeft', fontSize: 12, fill: '#6b4f1d' }}/>)}
          <Tooltip labelFormatter={value => date(new Date(Number(value)).toISOString().slice(0,10))} formatter={(value)=>[Number(value).toFixed(2),names[index]]}/>
          <Line name={names[index]} type="linear" dataKey="value" stroke="#19744a" strokeWidth={3} dot={{r:6,stroke:'#fff',strokeWidth:2,fill:'#19744a'}} activeDot={{r:8}} connectNulls={false} isAnimationActive={false}/>
          {events.filter(event => ['planting','irrigation','fertilizer','scouting','harvest'].includes(event.event_type)).map(event => <ReferenceLine key={event.id} x={Date.parse(event.event_date)} stroke="#a87424" label={t(event.event_type, ({planting:'बुवाई',irrigation:'सिंचाई',fertilizer:'खाद',scouting:'जाँच',harvest:'कटाई'} as Record<string,string>)[event.event_type])}/>)}
        </LineChart>
      </ResponsiveContainer> : <p>{t('No pictures available','अभी तस्वीर उपलब्ध नहीं है')}</p>}
    </div>
    {simple && <p className="farmer-chart-footnote">{t('This graph compares pictures, not crop health or disease. The line between dots is only a visual guide.','यह ग्राफ़ तस्वीरों का बदलाव दिखाता है, बीमारी या फ़सल की सेहत की पुष्टि नहीं। बिंदुओं के बीच लाइन केवल समझाने के लिए है।')}</p>}
  </div>;
}
