import { LineChart, Line, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import type { WeatherObservation } from '../../lib/api';
import { usePreferences } from '../../lib/preferencesContext';
import { dayFormatter, finite, mm } from './chartFormat';
import './weather-charts.css';

const TEMP = '#c0651b', RAIN = '#478eac', HEAVY = '#1d5f80', HEAVY_MM = 20;
type Row = { observed_on: string; temp: number | null; rain: number | null };

/** Past weather as readable charts: average temperature, and rain per day, with a plain summary on top. */
export function HistoricalWeatherCharts({ weather }: { weather: WeatherObservation[] }) {
  const { t, language } = usePreferences();
  const locale = language === 'hi' ? 'hi-IN' : 'en-IN';
  const tick = dayFormatter(locale, { day: 'numeric', month: 'short' });
  const full = dayFormatter(locale, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
  const rows: Row[] = [...weather].sort((a, b) => a.observed_on.localeCompare(b.observed_on))
    .map(item => ({ observed_on: item.observed_on, temp: finite(item.temperature_c), rain: finite(item.precipitation_mm) }));
  const temps = rows.filter(row => row.temp !== null);
  const totalRain = rows.reduce((sum, row) => sum + (row.rain ?? 0), 0);
  const rainyDays = rows.filter(row => (row.rain ?? 0) >= 1).length;
  const maxRain = Math.max(0, ...rows.map(row => row.rain ?? 0));
  const wettest = rows.find(row => row.rain === maxRain && maxRain > 0);
  const average = temps.length ? temps.reduce((sum, row) => sum + row.temp!, 0) / temps.length : null;
  const hottestValue = temps.length ? Math.max(...temps.map(row => row.temp!)) : null;
  const coolestValue = temps.length ? Math.min(...temps.map(row => row.temp!)) : null;
  const hottest = temps.find(row => row.temp === hottestValue);
  const first = rows[0], last = rows.at(-1);
  const period = first && last ? `${tick(first.observed_on)} – ${tick(last.observed_on)}` : '';
  const lastTempIndex = rows.reduce((found, row, position) => row.temp !== null ? position : found, -1);
  const firstTempIndex = rows.findIndex(row => row.temp !== null);
  const hottestIndex = rows.findIndex(row => row.temp === hottestValue && hottestValue !== null);
  const coolestIndex = rows.findIndex(row => row.temp === coolestValue && coolestValue !== null);

  type TipProps = { active?: boolean; payload?: ReadonlyArray<{ payload?: Row }> };
  const tip = ({ active, payload }: TipProps) => {
    const row = active ? payload?.[0]?.payload : undefined;
    if (!row) return null;
    return <div className="wx-tip"><strong>{full(row.observed_on)}</strong>
      <span>{t('Average temperature', 'औसत तापमान')}: <b>{row.temp === null ? '—' : `${row.temp.toFixed(1)}°C`}</b></span>
      <span>{t('Rain', 'बारिश')}: <b>{mm(row.rain ?? 0)}</b></span></div>;
  };
  const xAxis = <XAxis dataKey="observed_on" tickFormatter={tick} interval="preserveStartEnd" minTickGap={34} tick={{ fontSize: 11, fill: '#2f4a38' }} padding={{ left: 14, right: 18 }}/>;
  const tempLabel = (props: { x?: number | string; y?: number | string; value?: number | string; index?: number }) => {
    const position = props.index ?? -1;
    if (props.x == null || props.y == null || ![firstTempIndex, lastTempIndex, hottestIndex, coolestIndex].includes(position)) return null;
    return <text key={position} x={Number(props.x)} y={Number(props.y) - 10} textAnchor="middle" fontSize={12} fontWeight={700} fill="#7a5200" stroke="#fff" strokeWidth={3} paintOrder="stroke">{Number(props.value).toFixed(0)}°</text>;
  };
  const rainLabel = (props: { x?: number | string; y?: number | string; width?: number | string; value?: number | string }) => {
    const value = finite(props.value) ?? 0;
    if (props.x == null || props.y == null || value <= 0 || !(value === maxRain || value >= HEAVY_MM)) return null;
    return <text x={Number(props.x) + Number(props.width ?? 0) / 2} y={Number(props.y) - 5} textAnchor="middle" fontSize={11} fontWeight={700} fill="#1d5f80" stroke="#fff" strokeWidth={3} paintOrder="stroke">{mm(value)}</text>;
  };

  return <div className="wx-charts">
    <div className="wx-stats">
      <div className="wx-stat rain"><span>{t('Total rain', 'कुल बारिश')}{period && ` · ${period}`}</span><strong>{totalRain < 0.5 ? t('No rain', 'बारिश नहीं') : mm(totalRain)}</strong>
        <small>{t(`${rainyDays} rainy day${rainyDays === 1 ? '' : 's'} (1 mm or more)`, `${rainyDays} दिन बारिश (1 मिमी या ज़्यादा)`)}</small></div>
      {average !== null && <div className="wx-stat hot"><span>{t('Average temperature', 'औसत तापमान')}</span><strong>{average.toFixed(1)}°C</strong>
        {hottest && <small>{t('Warmest day', 'सबसे गर्म दिन')}: {tick(hottest.observed_on)} ({hottestValue!.toFixed(0)}°C)</small>}</div>}
      {wettest && <div className="wx-stat"><span>{t('Wettest day', 'सबसे ज़्यादा बारिश का दिन')}</span><strong>{mm(maxRain)}</strong><small>{tick(wettest.observed_on)}</small></div>}
    </div>
    <div className="wx-grid">
      <div className="wx-chart weather-chart" role="img" aria-label={t(`Average daily temperature over ${rows.length} days`, `${rows.length} दिनों का औसत तापमान`)}>
        <h4>{t('Temperature (°C)', 'तापमान (°C)')}</h4>
        <p className="wx-help">{t('One point per day (daily average). Numbers show the first, last, warmest and coolest day.', 'हर दिन का एक बिंदु (दैनिक औसत)। संख्याएँ पहले, आख़िरी, सबसे गर्म और सबसे ठंडे दिन की हैं।')}</p>
        <div className="wx-plot"><ResponsiveContainer>
          <LineChart data={rows} margin={{ top: 22, right: 10, left: 0, bottom: 4 }}>
            <CartesianGrid vertical={false} strokeDasharray="4 5" stroke="#d3dfd3"/>
            {xAxis}
            <YAxis width={40} unit="°" tick={{ fontSize: 12, fill: '#2f4a38' }} domain={[(min: number) => Math.floor(min - 2), (max: number) => Math.ceil(max + 2)]}/>
            <Tooltip content={tip as never} cursor={{ stroke: '#19744a', strokeDasharray: '3 3' }}/>
            <Line dataKey="temp" stroke={TEMP} strokeWidth={2.5} dot={{ r: 3, fill: TEMP, stroke: '#fff', strokeWidth: 1.5 }} activeDot={{ r: 6 }} connectNulls={false} isAnimationActive={false}>
              <LabelList dataKey="temp" content={tempLabel as never}/>
            </Line>
          </LineChart>
        </ResponsiveContainer></div>
      </div>
      <div className="wx-chart weather-chart" role="img" aria-label={t(`Rainfall per day over ${rows.length} days`, `${rows.length} दिनों की रोज़ की बारिश`)}>
        <h4>{t('Rain each day (mm)', 'हर दिन की बारिश (मिमी)')}</h4>
        <ul className="wx-key"><li><i className="sq" style={{ background: RAIN }} aria-hidden="true"/>{t('Rain', 'बारिश')}</li><li><i className="sq" style={{ background: HEAVY }} aria-hidden="true"/>{t(`Heavy rain (${HEAVY_MM} mm or more)`, `तेज़ बारिश (${HEAVY_MM} मिमी या ज़्यादा)`)}</li></ul>
        {totalRain < 0.5 && <p className="wx-empty">{t('No rain was recorded in this period.', 'इस अवधि में बारिश दर्ज नहीं हुई।')}</p>}
        <div className="wx-plot"><ResponsiveContainer>
          <BarChart data={rows} margin={{ top: 22, right: 10, left: 0, bottom: 4 }}>
            <CartesianGrid vertical={false} strokeDasharray="4 5" stroke="#d3dfd3"/>
            {xAxis}
            <YAxis width={40} tick={{ fontSize: 12, fill: '#2f4a38' }} allowDecimals={false} domain={[0, Math.max(5, Math.ceil(maxRain * 1.3))]}/>
            <Tooltip content={tip as never} cursor={{ fill: '#0001' }}/>
            <Bar dataKey="rain" fill={RAIN} radius={[3, 3, 0, 0]} isAnimationActive={false}>
              <LabelList dataKey="rain" content={rainLabel as never}/>
            </Bar>
          </BarChart>
        </ResponsiveContainer></div>
      </div>
    </div>
  </div>;
}
