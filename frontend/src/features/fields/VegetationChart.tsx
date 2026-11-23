import { useState } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea, ReferenceDot, LabelList } from 'recharts';
import type { FieldEvent, VegetationIndexObservation } from '../../lib/api';
import { usePreferences } from '../../lib/preferencesContext';

type Index = 'ndvi_value'|'ndmi_value'|'ndre_value';
type BandKey = 'high'|'moderate'|'low'|'bare';
type Point = { date: number; value: number; coverage: number | null; cloud: number | null; weak: number | null };
type RainDay = { observed_on: string; precipitation_mm: number | string | null };
const num = (value: unknown): number | null => value == null || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;

export function VegetationChart({ observations, index = 'ndvi_value', events = [], simple = false, season, rain }: { simple?: boolean; observations: VegetationIndexObservation[]; index?: Index; events?: FieldEvent[]; rain?: RainDay[]; season?: { plantingDate?: string | null; harvestDate?: string | null } }) {
  const { t, date, language } = usePreferences();
  const [compact, setCompact] = useState(false);
  const isNdvi = index === 'ndvi_value';
  const names:Record<Index,string> = {
    ndvi_value:t('Greenness (NDVI)','हरियाली (NDVI)'),
    ndmi_value:t('Water signal in plants (NDMI)','पौधों में पानी का संकेत (NDMI)'),
    ndre_value:t('Leaf colour signal (NDRE)','पत्तियों के रंग का संकेत (NDRE)')
  };
  const nouns:Record<Index,string> = {
    ndvi_value:t('Greenness','हरियाली'), ndmi_value:t('Water signal','पानी का संकेत'), ndre_value:t('Leaf colour signal','पत्तियों के रंग का संकेत')
  };
  // Plain meaning for the two secondary views; they have no validated colour bands, so they get words instead of zones.
  const meanings:Record<Index,string> = {
    ndvi_value:'',
    ndmi_value:t('Higher number = more water in the plants. A number that keeps falling may mean the crop needs water.','ऊँचा नंबर = पौधों में ज़्यादा पानी। नंबर लगातार गिरे तो फ़सल को पानी की ज़रूरत हो सकती है।'),
    ndre_value:t('Higher number = deeper green, healthier-looking leaves (more chlorophyll). A number that keeps falling may mean the leaves are turning pale.','ऊँचा नंबर = गहरे हरे, स्वस्थ दिखते पत्ते (ज़्यादा क्लोरोफ़िल)। नंबर लगातार गिरे तो पत्ते पीले पड़ रहे हो सकते हैं।')
  };
  const axisTitles:Record<Index,string> = {
    ndvi_value:t('NDVI (0 = bare, 1 = very green)','NDVI (0 = खाली, 1 = बहुत हरा)'),
    ndmi_value:t('Water signal (higher = more water)','पानी का संकेत (ऊँचा = ज़्यादा पानी)'),
    ndre_value:t('Leaf colour (higher = deeper green)','पत्तियों का रंग (ऊँचा = गहरा हरा)')
  };
  // Same ranges, colours and names as the "Greenness across the field" zones card, so the app speaks one language.
  const bands: { key: BandKey; from: number; to: number; fill: string; dot: string; name: string; range: string }[] = [
    { key: 'high', from: .6, to: 1, fill: '#1a9850', dot: '#157a3e', name: t('Dense, healthy green', 'घनी, स्वस्थ हरियाली'), range: '0.6+' },
    { key: 'moderate', from: .4, to: .6, fill: '#91cf60', dot: '#4f8f2c', name: t('Moderate green', 'मध्यम हरियाली'), range: '0.4–0.6' },
    { key: 'low', from: .2, to: .4, fill: '#fee08b', dot: '#b8860b', name: t('Sparse or weak green', 'कम या कमज़ोर हरियाली'), range: '0.2–0.4' },
    { key: 'bare', from: -1, to: .2, fill: '#d9a066', dot: '#a0602a', name: t('Bare soil / almost no crop', 'खाली मिट्टी / लगभग फ़सल नहीं'), range: '< 0.2' },
  ];
  const bandOf = (value: number) => bands.find(band => value >= band.from) ?? bands[3];

  const chart: Point[] = observations
    .map(item => ({ date: Date.parse(item.observed_on), value: item[index] == null ? NaN : Number(item[index]),
      coverage: num(item.valid_coverage_percent), cloud: num(item.cloud_cover), weak: num(item.affected_coverage_percent) }))
    .filter(item => Number.isFinite(item.date) && Number.isFinite(item.value))
    .sort((a,b)=>a.date-b.date);
  const first = chart[0], last = chart.at(-1), previous = chart.length > 1 ? chart[chart.length - 2] : undefined;
  const peak = chart.reduce<Point | undefined>((best, item) => !best || item.value > best.value ? item : best, undefined);
  const peakIndex = peak ? chart.indexOf(peak) : -1;
  const lowIndex = chart.reduce((best, item, position) => item.value < chart[best].value ? position : best, 0);

  // The headline answers "what is happening NOW": the latest picture against the one before it.
  // (Comparing only first and last hid a recent fall that followed an earlier rise.)
  const recent = last && previous ? last.value - previous.value : null;
  const overall = first && last && chart.length > 1 ? last.value - first.value : null;
  const direction = recent == null ? 'unknown' : recent < -0.03 ? 'down' : recent > 0.03 ? 'up' : 'stable';
  const conclusion = direction === 'down' ? (isNdvi ? t('Greenness fell in the latest picture','ताज़ा तस्वीर में हरियाली घटी') : t(`${nouns[index]} fell in the latest picture`,`${nouns[index]} — ताज़ा तस्वीर में गिरावट`))
    : direction === 'up' ? (isNdvi ? t('Greenness rose in the latest picture','ताज़ा तस्वीर में हरियाली बढ़ी') : t(`${nouns[index]} rose in the latest picture`,`${nouns[index]} — ताज़ा तस्वीर में बढ़त`))
    : direction === 'stable' ? t('Almost no change in the latest picture','ताज़ा तस्वीर में लगभग कोई बदलाव नहीं')
    : t('More dates are needed','और तारीख़ों की ज़रूरत है');
  const icon = direction === 'down' ? '↘' : direction === 'up' ? '↗' : direction === 'stable' ? '→' : '•';
  const iso = (time: number) => new Date(time).toISOString().slice(0, 10);
  const sign = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
  const valueLabel = (value:number|null|undefined) => value == null ? '—' : value.toFixed(2);

  const dataMin = chart.length ? Math.min(...chart.map(item => item.value)) : 0;
  const dataMax = chart.length ? Math.max(...chart.map(item => item.value)) : 1;
  const round2 = (value: number) => Math.round(value * 100) / 100;
  let yMin = 0, yMax = 1;
  let yTicks: number[] = [0, .2, .4, .6, .8, 1];
  if (isNdvi) {
    yMin = dataMin < 0 ? Math.max(-1, Math.floor(dataMin * 5) / 5) : 0;
    yTicks = yTicks.filter(tick => tick >= yMin);
  } else {
    // Zoom to the data (not the full -1..1 scale) so a real change is visible instead of a flat line.
    const step = dataMax - dataMin <= .5 ? .1 : .2;
    yMin = Math.max(-1, round2(Math.floor((dataMin - .05) / step) * step));
    yMax = Math.min(1, round2(Math.ceil((dataMax + .05) / step) * step));
    if (yMax - yMin < .4) yMax = Math.min(1, round2(yMin + .4));
    yTicks = [];
    for (let value = yMin; value <= yMax + 1e-9; value += step) yTicks.push(round2(value));
  }
  const yDomain: [number, number] = [yMin, yMax];

  const locale = language === 'hi' ? 'hi-IN' : 'en-IN';
  const spansYears = Boolean(first && last && new Date(first.date).getUTCFullYear() !== new Date(last.date).getUTCFullYear());
  const shortDate = (time: number) => new Date(time).toLocaleDateString(locale, { day: 'numeric', month: 'short', ...(spansYears ? { year: '2-digit' } : {}), timeZone: 'UTC' });
  const everyDate = chart.length <= (compact ? 4 : 7);
  // Change between neighbouring pictures, drawn on the segment, so the reader sees WHERE the rise or fall happened.
  const mids = chart.length > 1 && chart.length <= (compact ? 3 : 9)
    ? chart.slice(1).map((item, position) => ({ date: (chart[position].date + item.date) / 2, value: (chart[position].value + item.value) / 2, delta: item.value - chart[position].value }))
    : [];
  const showLabel = (position: number) => chart.length <= (compact ? 6 : 10) || position === chart.length - 1 || position === peakIndex || position === lowIndex;

  const seasonMarks = [
    { key: 'sowing', time: season?.plantingDate ? Date.parse(`${season.plantingDate.slice(0, 10)}T00:00:00Z`) : NaN, label: t('Sowing', 'बुवाई') },
    { key: 'harvest', time: season?.harvestDate ? Date.parse(`${season.harvestDate.slice(0, 10)}T00:00:00Z`) : NaN, label: t('Harvest', 'कटाई') },
  ].filter(mark => Number.isFinite(mark.time) && first && last && mark.time >= first.date && mark.time <= last.date);
  const range = last && first ? (first.date === last.date ? date(iso(first.date)) : `${date(iso(first.date))} – ${date(iso(last.date))}`) : '';
  const single = chart.length === 1;
  const rainRows = rain && first && last
    ? rain.map(item => ({ date: Date.parse(`${String(item.observed_on).slice(0, 10)}T00:00:00Z`), value: num(item.precipitation_mm) ?? 0 }))
      .filter(item => Number.isFinite(item.date) && item.date >= first.date && item.date <= last.date).sort((a, b) => a.date - b.date)
    : [];
  const showRain = simple && isNdvi && chart.length > 1 && rainRows.length > 0;
  const rainTotal = rainRows.reduce((sum, item) => sum + item.value, 0);
  const spanDays = first && last ? Math.round((last.date - first.date) / 86400000) + 1 : 0;
  // Weather history is often saved for only a few recent days. Missing days are "no data", never "no rain".
  const rainPartial = rainRows.length < spanDays * 0.7;
  const rainPeak = rainRows.reduce((best, item) => item.value > best.value ? item : best, { date: 0, value: 0 });
  const rainAxisMax = Math.max(5, Math.ceil(rainPeak.value * 1.2));
  const mmText = (value: number) => `${value < 10 ? value.toFixed(1).replace(/\.0$/, '') : Math.round(value)} mm`;
  const latestBand = last && isNdvi ? bandOf(last.value) : null;

  type TipProps = { active?: boolean; payload?: ReadonlyArray<{ payload?: Point }> };
  const tip = ({ active, payload }: TipProps) => {
    const point = active ? payload?.find(entry => entry.payload && 'coverage' in entry.payload)?.payload : undefined;
    if (!point) return null;
    const band = isNdvi ? bandOf(point.value) : null;
    return <div className="vc-tip"><strong>{date(iso(point.date))}</strong>
      <span>{names[index]}: <b>{point.value.toFixed(2)}</b></span>
      {band && <span><i style={{ background: band.fill }} aria-hidden="true"/>{band.name} ({band.range})</span>}
      {isNdvi && point.weak != null && <span>{t('Weak-looking part of the field', 'खेत का कमज़ोर दिखने वाला हिस्सा')}: <b>{point.weak.toFixed(0)}%</b></span>}
      {point.coverage != null && <small>{t('Field clearly visible', 'खेत साफ़ दिखा')}: {Math.round(point.coverage)}%{point.cloud != null && ` · ${t('cloud', 'बादल')} ${Math.round(point.cloud)}%`}</small>}</div>;
  };
  const dot = (props: { cx?: number; cy?: number; index?: number; value?: number }) => {
    const { cx, cy, index: position = 0, value = 0 } = props;
    if (cx == null || cy == null) return <g key={position}/>;
    const latest = position === chart.length - 1;
    return <circle key={position} cx={cx} cy={cy} r={latest ? 8 : 6} fill={isNdvi ? bandOf(value).dot : '#19744a'} stroke="#fff" strokeWidth={2}/>;
  };
  const pointLabel = (props: { x?: number | string; y?: number | string; value?: number | string; index?: number }) => {
    const position = props.index ?? 0;
    if (!showLabel(position) || props.x == null || props.y == null) return null;
    const latest = position === chart.length - 1;
    return <text key={position} x={Number(props.x)} y={Number(props.y) - (latest ? 15 : 13)} textAnchor="middle" fontSize={latest ? 14 : 12} fontWeight={latest ? 800 : 700} fill="#17442d" stroke="#fff" strokeWidth={3} paintOrder="stroke">{Number(props.value).toFixed(2)}</text>;
  };

  return <div className="farmer-chart-section">
    {simple && <div className={`farmer-chart-summary chart-direction-${direction}`} aria-live="polite">
      <span className="farmer-chart-arrow" aria-hidden="true">{icon}</span>
      <div><strong>{conclusion}</strong>
        <p>{recent == null || !last || !previous
          ? t('Only one picture date is available.','अभी केवल एक तस्वीर की तारीख़ उपलब्ध है।')
          : t(`Now ${valueLabel(last.value)} · before ${valueLabel(previous.value)} (${shortDate(previous.date)}) · change ${sign(recent)}`,`अब ${valueLabel(last.value)} · पहले ${valueLabel(previous.value)} (${shortDate(previous.date)}) · बदलाव ${sign(recent)}`)}</p>
        {latestBand && <p className="vc-now"><i style={{ background: latestBand.fill }} aria-hidden="true"/>{t('Latest picture shows:', 'ताज़ा तस्वीर में:')} <b>{latestBand.name}</b> ({latestBand.range})</p>}
        {overall != null && first && peak && <small>{t(`Since the first picture (${valueLabel(first.value)}): ${sign(overall)} · Highest ${valueLabel(peak.value)} on ${shortDate(peak.date)}`,`पहली तस्वीर (${valueLabel(first.value)}) से: ${sign(overall)} · सबसे ज़्यादा ${valueLabel(peak.value)}, ${shortDate(peak.date)} को`)}</small>}
        {range && <small>{range} · {chart.length} {chart.length === 1 ? t('picture','तस्वीर') : t('pictures','तस्वीरें')}</small>}</div>
    </div>}
    {!isNdvi
      ? <ul className="vc-key vc-key-single" aria-label={t('How to read this graph', 'यह ग्राफ़ कैसे पढ़ें')}>
          <li className="vc-key-meaning"><span>{meanings[index]}</span></li>
          <li className="vc-key-dots"><i className="vc-dot" aria-hidden="true"/><span>{t('Each dot = one satellite picture; the number is its value', 'हर बिंदु = एक सैटेलाइट तस्वीर; संख्या उसकी रीडिंग है')}</span></li>
          <li className="vc-key-meaning"><span>{t('Values depend on the crop and its growth stage, so compare with your own earlier dates rather than with other fields.', 'रीडिंग फ़सल और उसकी अवस्था पर निर्भर करती है, इसलिए दूसरे खेतों से नहीं, अपनी पिछली तारीख़ों से तुलना करें।')}</span></li>
        </ul>
      : <ul className="vc-key" aria-label={t('What the colours mean', 'रंगों का मतलब')}>
          {bands.map(band => <li key={band.key}><i style={{ background: band.fill }} aria-hidden="true"/><span>{band.name}</span><b>{band.range}</b></li>)}
          <li className="vc-key-dots"><i className="vc-dot" aria-hidden="true"/><span>{t('Each dot = one satellite picture; the number is its NDVI', 'हर बिंदु = एक सैटेलाइट तस्वीर; संख्या उसका NDVI है')}</span></li>
        </ul>}
    {single && simple && last && <div className="vc-single" role="status">
      <strong>{t(`Only 1 satellite picture so far (${shortDate(last.date)}).`, `अभी सिर्फ़ 1 सैटेलाइट तस्वीर है (${shortDate(last.date)})।`)}</strong>
      <p>{t('A graph needs at least 2 pictures to show whether the crop is getting better or worse. Add the earlier pictures of this season and the line will appear.', 'फ़सल बेहतर हो रही है या खराब, यह दिखाने के लिए कम से कम 2 तस्वीरें चाहिए। इस सीज़न की पिछली तस्वीरें जोड़ें, तब लाइन दिखेगी।')}</p>
      <a href="#season-history">{t('Add earlier pictures', 'पिछली तस्वीरें जोड़ें')} ↓</a>
    </div>}
    <div className={`vegetation-chart${single ? ' single' : ''}`} role="img" aria-label={t(`${names[index]} across ${chart.length} picture dates. ${conclusion}.`,`${chart.length} तस्वीरों में ${names[index]}। ${conclusion}।`)}>
      {chart.length ? <ResponsiveContainer width="100%" height="100%" onResize={width => setCompact(width < 560)}>
        <LineChart data={chart} margin={{ top:30, left:4, right:12, bottom:30 }}>
          <CartesianGrid vertical={false} strokeDasharray="4 5" stroke="#cdd9cd"/>
          <XAxis dataKey="date" type="number" scale="time" domain={['dataMin','dataMax']} padding={{ left: 26, right: 30 }}
            ticks={everyDate ? chart.map(item => item.date) : undefined} tickCount={everyDate ? undefined : 5} minTickGap={14}
            tickFormatter={value => shortDate(Number(value))} tick={{fontSize:12,fill:'#2f4a38'}}
            label={{ value: t('Date of satellite picture', 'सैटेलाइट तस्वीर की तारीख़'), position: 'insideBottom', offset: -18, fontSize: 12, fill: '#2f4a38' }}/>
          <YAxis domain={yDomain} ticks={yTicks} width={compact ? 38 : 52} tickFormatter={value => Number(value).toFixed(1)} tick={{fontSize:12,fill:'#2f4a38'}}
            label={compact ? undefined : { value: axisTitles[index], angle: -90, position: 'insideLeft', offset: 8, fontSize: 11, fill: '#2f4a38', style: { textAnchor: 'middle' } }}/>
          {isNdvi && bands.map(band => <ReferenceArea key={band.key} y1={Math.max(band.from, yDomain[0])} y2={band.to} fill={band.fill} fillOpacity={.2} stroke="none" ifOverflow="hidden"/>)}
          {seasonMarks.map(mark => <ReferenceLine key={mark.key} x={mark.time} stroke="#6b4f1d" strokeDasharray="5 4" label={{ value: mark.label, position: 'insideTopLeft', fontSize: 12, fill: '#6b4f1d' }}/>)}
          <Tooltip content={tip as never} cursor={{ stroke: '#19744a', strokeDasharray: '3 3' }}/>
          <Line name={names[index]} type="linear" dataKey="value" stroke="#19744a" strokeWidth={3} dot={dot as never} activeDot={{r:9}} connectNulls={false} isAnimationActive={false}>
            <LabelList dataKey="value" content={pointLabel as never}/>
          </Line>
          {mids.filter(mid => Math.abs(mid.delta) >= 0.03).map(mid => <ReferenceDot key={mid.date} x={mid.date} y={mid.value} r={0} ifOverflow="visible"
            label={{ value: `${mid.delta > 0 ? '▲' : '▼'} ${Math.abs(mid.delta).toFixed(2)}`, position: mid.delta > 0 ? 'bottom' : 'top', offset: 10, fontSize: 11, fontWeight: 700, fill: mid.delta > 0 ? '#157a3e' : '#a0402a', stroke: '#fff', strokeWidth: 3, paintOrder: 'stroke' }}/>)}
          {events.filter(event => ['planting','irrigation','fertilizer','scouting','harvest'].includes(event.event_type)).map(event => <ReferenceLine key={event.id} x={Date.parse(event.event_date)} stroke="#a87424" label={t(event.event_type, ({planting:'बुवाई',irrigation:'सिंचाई',fertilizer:'खाद',scouting:'जाँच',harvest:'कटाई'} as Record<string,string>)[event.event_type])}/>)}
        </LineChart>
      </ResponsiveContainer> : <p>{t('No pictures available','अभी तस्वीर उपलब्ध नहीं है')}</p>}
    </div>
    {showRain && first && last && <div className="vc-rain">
      <h4>{t('Rain between these pictures (mm per day)', 'इन तस्वीरों के बीच की बारिश (मिमी प्रति दिन)')}</h4>
      <p>{rainPartial
        ? t(`Rain data is available for only ${rainRows.length} of ${spanDays} days (${shortDate(rainRows[0].date)} – ${shortDate(rainRows[rainRows.length - 1].date)}): ${rainTotal < 0.5 ? 'no rain on those days' : `${mmText(rainTotal)} of rain on those days`}. Use "Update past weather" for more days.`,
            `${spanDays} में से सिर्फ़ ${rainRows.length} दिन की बारिश की जानकारी है (${shortDate(rainRows[0].date)} – ${shortDate(rainRows[rainRows.length - 1].date)}): उन दिनों ${rainTotal < 0.5 ? 'बारिश नहीं हुई' : `${mmText(rainTotal)} बारिश हुई`}। ज़्यादा दिनों के लिए "पिछले मौसम की जानकारी लाएँ" दबाएँ।`)
        : rainTotal < 0.5
        ? t(`No rain was recorded between ${shortDate(first.date)} and ${shortDate(last.date)}.`, `${shortDate(first.date)} से ${shortDate(last.date)} के बीच बारिश दर्ज नहीं हुई।`)
        : t(`${mmText(rainTotal)} of rain between ${shortDate(first.date)} and ${shortDate(last.date)}; the most was ${mmText(rainPeak.value)} on ${shortDate(rainPeak.date)}. Rain can explain part of a change in greenness, but it does not prove the cause.`,
            `${shortDate(first.date)} से ${shortDate(last.date)} के बीच ${mmText(rainTotal)} बारिश; सबसे ज़्यादा ${shortDate(rainPeak.date)} को ${mmText(rainPeak.value)}। बारिश हरियाली के बदलाव का एक कारण हो सकती है, पर यह पक्का सबूत नहीं।`)}</p>
      <div className="vc-rain-plot" role="img" aria-label={t(`Daily rain between the picture dates, ${mmText(rainTotal)} in total`, `तस्वीरों की तारीख़ों के बीच रोज़ की बारिश, कुल ${mmText(rainTotal)}`)}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rainRows} margin={{ top: 6, left: 4, right: 12, bottom: 6 }}>
            <CartesianGrid vertical={false} strokeDasharray="4 5" stroke="#cdd9cd"/>
            <XAxis dataKey="date" type="number" scale="time" domain={[first.date, last.date]} padding={{ left: 26, right: 30 }} ticks={chart.map(item => item.date)} tick={false} tickLine={false}/>
            <YAxis width={compact ? 38 : 52} ticks={[0, rainAxisMax]} domain={[0, rainAxisMax]} tick={{ fontSize: 11, fill: '#2f4a38' }} allowDecimals={false}/>
            {chart.map(item => <ReferenceLine key={item.date} x={item.date} stroke="#19744a" strokeDasharray="3 4" strokeOpacity={.5}/>)}
            <Bar dataKey="value" fill="#478eac" barSize={compact ? 4 : 7} radius={[2, 2, 0, 0]} isAnimationActive={false}/>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <small>{t('Dashed lines mark the satellite picture dates.', 'टूटी लाइनें सैटेलाइट तस्वीरों की तारीख़ दिखाती हैं।')}</small>
    </div>}
    {simple && <p className="farmer-chart-footnote">{isNdvi ? t('Low greenness is normal just after sowing and near harvest.','बुवाई के तुरंत बाद और कटाई के पास कम हरियाली सामान्य है।') : t('Compare with your own earlier pictures.','अपनी पिछली तस्वीरों से तुलना करें।')}</p>}
  </div>;
}
