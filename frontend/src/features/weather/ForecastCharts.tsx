import { useState } from 'react';
import { LineChart, Line, BarChart, Bar, Cell, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import type { Forecast, ForecastDay } from '../../../../shared/forecast';
import { usePreferences } from '../../lib/preferencesContext';
import { dayFormatter, finite, mm } from './chartFormat';
import './weather-charts.css';

const HIGH = '#c0651b', LOW = '#2f78a0', RAIN = '#478eac', HEAVY = '#1d5f80', HEAVY_MM = 20;

/** Seven-day forecast as two readable charts: temperature (day high / night low) and rain per day. */
export function ForecastCharts({ forecast }: { forecast: Forecast }) {
  const { t, language } = usePreferences();
  const locale = language === 'hi' ? 'hi-IN' : 'en-IN';
  const [narrow, setNarrow] = useState(false);
  const tickFull = dayFormatter(locale, { weekday: 'short', day: 'numeric' });
  // On a phone seven "Wed 18" labels collide, so show just the weekday there.
  const tick = narrow ? dayFormatter(locale, { weekday: 'short' }) : tickFull;
  const full = dayFormatter(locale, { weekday: 'long', day: 'numeric', month: 'long' });
  const days = forecast.days;
  const totalRain = days.reduce((sum, day) => sum + (finite(day.rainMm) ?? 0), 0);
  const wettest = days.reduce<ForecastDay | null>((best, day) => (finite(day.rainMm) ?? 0) > (finite(best?.rainMm) ?? 0) ? day : best, null);
  const hottest = days.reduce<ForecastDay | null>((best, day) => finite(day.maxC) !== null && (best === null || finite(day.maxC)! > finite(best.maxC)!) ? day : best, null);
  const coolest = days.reduce<ForecastDay | null>((best, day) => finite(day.minC) !== null && (best === null || finite(day.minC)! < finite(best.minC)!) ? day : best, null);
  const maxRain = Math.max(0, ...days.map(day => finite(day.rainMm) ?? 0));
  const noRain = totalRain < 0.5;

  type TipProps = { active?: boolean; payload?: ReadonlyArray<{ payload?: ForecastDay }> };
  const tip = ({ active, payload }: TipProps) => {
    const day = active ? payload?.[0]?.payload : undefined;
    if (!day) return null;
    return <div className="wx-tip"><strong>{full(day.date)}</strong>
      <span>{t('Daytime high', 'दिन का अधिकतम')}: <b>{finite(day.maxC) ?? '—'}°C</b></span>
      <span>{t('Night low', 'रात का न्यूनतम')}: <b>{finite(day.minC) ?? '—'}°C</b></span>
      <span>{t('Rain', 'बारिश')}: <b>{mm(finite(day.rainMm) ?? 0)}</b>{finite(day.rainChance) !== null && <> · {t('chance', 'संभावना')} {day.rainChance}%</>}</span></div>;
  };
  // Own label renderer: the default one wraps "2.5 mm" onto two lines inside a narrow bar.
  const rainLabel = (props: { x?: number | string; y?: number | string; width?: number | string; value?: number | string }) => {
    const value = finite(props.value) ?? 0;
    if (props.x == null || props.y == null || value <= 0) return null;
    return <text x={Number(props.x) + Number(props.width ?? 0) / 2} y={Number(props.y) - 5} textAnchor="middle" fontSize={11} fontWeight={700} fill="#1d5f80" stroke="#fff" strokeWidth={3} paintOrder="stroke">{mm(value)}</text>;
  };
  const xAxis = <XAxis dataKey="date" tickFormatter={tick} interval={0} tick={{ fontSize: 11, fill: '#2f4a38' }} padding={{ left: 18, right: 18 }}/>;

  return <div className="wx-charts">
    <div className="wx-stats">
      <div className="wx-stat rain"><span>{t('Rain in the next 7 days', 'अगले 7 दिन में बारिश')}</span>
        <strong>{noRain ? t('No rain expected', 'बारिश का अनुमान नहीं') : mm(totalRain)}</strong>
        {!noRain && wettest && <small>{t('Most on', 'सबसे ज़्यादा')} {tickFull(wettest.date)}: {mm(finite(wettest.rainMm) ?? 0)}</small>}</div>
      {hottest && <div className="wx-stat hot"><span>{t('Hottest day', 'सबसे गर्म दिन')}</span><strong>{Math.round(finite(hottest.maxC)!)}°C</strong><small>{tickFull(hottest.date)}</small></div>}
      {coolest && <div className="wx-stat cool"><span>{t('Coolest night', 'सबसे ठंडी रात')}</span><strong>{Math.round(finite(coolest.minC)!)}°C</strong><small>{tickFull(coolest.date)}</small></div>}
    </div>
    <div className="wx-grid">
      <div className="wx-chart" role="img" aria-label={t('Forecast temperature chart in Celsius: daytime high and night low for each of the next 7 days', 'अगले 7 दिनों का तापमान ग्राफ़ (सेल्सियस): हर दिन का अधिकतम और रात का न्यूनतम')}>
        <h4>{t('Temperature (°C)', 'तापमान (°C)')}</h4>
        <ul className="wx-key"><li><i style={{ background: HIGH }} aria-hidden="true"/>{t('Daytime high', 'दिन का अधिकतम')}</li><li><i style={{ background: LOW }} aria-hidden="true"/>{t('Night low', 'रात का न्यूनतम')}</li></ul>
        <div className="wx-plot"><ResponsiveContainer onResize={width => setNarrow(width < 430)}>
          <LineChart data={days} margin={{ top: 22, right: 10, left: 0, bottom: 4 }}>
            <CartesianGrid vertical={false} strokeDasharray="4 5" stroke="#d3dfd3"/>
            {xAxis}
            <YAxis width={40} unit="°" tick={{ fontSize: 12, fill: '#2f4a38' }} domain={[(min: number) => Math.floor(min - 3), (max: number) => Math.ceil(max + 3)]}/>
            <Tooltip content={tip as never} cursor={{ stroke: '#19744a', strokeDasharray: '3 3' }}/>
            <Line dataKey="maxC" stroke={HIGH} strokeWidth={3} dot={{ r: 5, fill: HIGH, stroke: '#fff', strokeWidth: 2 }} isAnimationActive={false}>
              <LabelList dataKey="maxC" position="top" offset={9} formatter={(value: unknown) => `${Math.round(Number(value))}°`} fontSize={12} fontWeight={700} fill="#8a4b14"/>
            </Line>
            <Line dataKey="minC" stroke={LOW} strokeWidth={3} dot={{ r: 5, fill: LOW, stroke: '#fff', strokeWidth: 2 }} isAnimationActive={false}>
              <LabelList dataKey="minC" position="bottom" offset={9} formatter={(value: unknown) => `${Math.round(Number(value))}°`} fontSize={12} fontWeight={700} fill="#245f80"/>
            </Line>
          </LineChart>
        </ResponsiveContainer></div>
      </div>
      <div className="wx-chart" role="img" aria-label={t('Forecast rainfall chart in millimetres for each of the next 7 days', 'अगले 7 दिनों की बारिश का ग्राफ़ (मिलीमीटर)')}>
        <h4>{t('Rain each day (mm)', 'हर दिन की बारिश (मिमी)')}</h4>
        <ul className="wx-key"><li><i className="sq" style={{ background: RAIN }} aria-hidden="true"/>{t('Rain', 'बारिश')}</li><li><i className="sq" style={{ background: HEAVY }} aria-hidden="true"/>{t(`Heavy rain (${HEAVY_MM} mm or more)`, `तेज़ बारिश (${HEAVY_MM} मिमी या ज़्यादा)`)}</li></ul>
        {noRain && <p className="wx-empty">{t('No rain is forecast for the next 7 days.', 'अगले 7 दिन बारिश का अनुमान नहीं है।')}</p>}
        <div className="wx-plot"><ResponsiveContainer>
          <BarChart data={days} margin={{ top: 22, right: 10, left: 0, bottom: 4 }}>
            <CartesianGrid vertical={false} strokeDasharray="4 5" stroke="#d3dfd3"/>
            {xAxis}
            <YAxis width={40} tick={{ fontSize: 12, fill: '#2f4a38' }} allowDecimals={false} domain={[0, Math.max(5, Math.ceil(maxRain * 1.3))]}/>
            <Tooltip content={tip as never} cursor={{ fill: '#0001' }}/>
            <Bar dataKey="rainMm" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {days.map(day => <Cell key={day.date} fill={(finite(day.rainMm) ?? 0) >= HEAVY_MM ? HEAVY : RAIN}/>)}
              <LabelList dataKey="rainMm" content={rainLabel as never}/>
            </Bar>
          </BarChart>
        </ResponsiveContainer></div>
      </div>
    </div>
  </div>;
}
