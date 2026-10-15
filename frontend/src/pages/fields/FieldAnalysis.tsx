import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { loadNdviAnalysis, loadNdvi, askFieldAssistant, loadWeather, ingestWeather, loadFieldEvents, type DatabaseField, type NdviAnalysis, type VegetationIndexObservation, type WeatherObservation, type FieldEvent } from '../../lib/api';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend, ReferenceLine } from 'recharts';

export function FieldAnalysis() {
  const { field } = useOutletContext<{ field: DatabaseField }>();
  const [analysis, setAnalysis] = useState<NdviAnalysis | null>(null);
  const [observations, setObservations] = useState<VegetationIndexObservation[]>([]);
  const [weather, setWeather] = useState<WeatherObservation[]>([]);
  const [events,setEvents]=useState<FieldEvent[]>([]);
  const [range,setRange]=useState('90');
  const [viewTime]=useState(()=>Date.now());
  const [index,setIndex]=useState('ndvi_value');
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [language, setLanguage] = useState('en-IN');
  const [loading, setLoading] = useState(true);
  
  const [question, setQuestion] = useState('');
  const [evidenceDates,setEvidenceDates]=useState<string[]>([]);
  const [answer, setAnswer] = useState('');
  const [assistantError, setAssistantError] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  const [weatherMessage, setWeatherMessage] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!field?.id) return;
    let cancelled = false;
    Promise.allSettled([
      loadNdviAnalysis(field.id, language), loadNdvi(field.id), loadWeather(field.id),loadFieldEvents(field.id)
    ]).then(results => {
      if (cancelled) return;
      const [analysisData, ndviData, weatherData,eventData] = results;
      setEvents(eventData.status==='fulfilled'?eventData.value:[]);
      setAnalysis(analysisData.status === 'fulfilled' ? analysisData.value : null);
      setObservations(ndviData.status === 'fulfilled' ? ndviData.value : []);
      setWeather(weatherData.status === 'fulfilled' ? weatherData.value : []);
      const errors = results.filter(result => result.status === 'rejected').map(result => result.reason instanceof Error ? result.reason.message : 'A service is unavailable');
      setError(errors.join('. ')); setLoading(false);
    });
    return () => { cancelled = true; };
  }, [field?.id, language, reload]);

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || asking) return;
    setAnswer(''); setAssistantError('');
    setAsking(true);
    try {
      const res = await askFieldAssistant(question, field.id, language);
      setAnswer(res.answer);setEvidenceDates(res.evidenceDates||[]);
    } catch (caught) {
      setAssistantError(caught instanceof Error ? caught.message : 'Assistant unavailable. Please try again.');
    } finally {
      setAsking(false);
    }
  };

  const accepted=observations.filter(obs=>obs.accepted&&obs.provenance==='measured_imagery'&&obs.boundary_version===(field.boundary_version??1));
  const cutoff=range==='season' ? (field.planting_date?Date.parse(field.planting_date):0) : viewTime-Number(range)*86400000;
  const chart=accepted.filter(obs=>Date.parse(obs.observed_on)>=cutoff).map(obs=>({...obs,date:Date.parse(obs.observed_on),ndvi_value:obs.ndvi_value==null?null:Number(obs.ndvi_value),ndmi_value:obs.ndmi_value==null?null:Number(obs.ndmi_value),ndre_value:obs.ndre_value==null?null:Number(obs.ndre_value)}));
  if (loading) return <div style={{ padding: '2rem' }}>Loading analysis...</div>;

  return (
    <div className="field-columns">
      <div>
        {error && <div role="alert">{error} <button type="button" onClick={() => { setLoading(true); setReload(value => value + 1); }}>Retry analysis</button></div>}
        <div className="content-heading" style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ margin: 0 }}>Health Analysis</h2>
          <select aria-label="Analysis language" value={language} onChange={e => { setLoading(true); setLanguage(e.target.value); }} style={{ padding: '0.5rem', borderRadius: '4px' }}>
            <option value="en-IN">English</option>
            <option value="hi-IN">Hindi (हिंदी)</option>
          </select>
        </div>

        {analysis ? (
          <div style={{ background: '#f8faf5', padding: '1.5rem', borderRadius: '8px', border: '1px solid #dde4d5', marginBottom: '2rem' }}>
            <h3 style={{ marginTop: 0, color: '#344225' }}>{analysis.statusLabel}{analysis.trend ? ` (Trend: ${analysis.trend})` : ''}</h3>
            <p style={{ color: '#334155', fontSize: '1.1rem', lineHeight: '1.5' }}>{analysis.summary}</p>
            {analysis.recommendation && (
              <div style={{ marginTop: '1rem', padding: '1rem', background: '#fff', borderRadius: '4px', borderLeft: '4px solid #166534' }}>
                <strong>Recommendation:</strong> {analysis.recommendation}
              </div>
            )}
          </div>
        ) : (
          <div style={{ padding: '1rem', background: '#f9fafb', borderRadius: '8px', marginBottom: '2rem' }}>No automated analysis available for this field.</div>
        )}

        <section className="vegetation-trends" aria-label="Vegetation trends"><h3>What changed in the field?</h3><p>Actual acquisitions only. Gaps between images are not observations. A falling index is a reason to inspect, not a diagnosis.</p><div className="content-heading"><label>Date range<select value={range} onChange={event=>setRange(event.target.value)}><option value="30">30 days</option><option value="90">90 days</option><option value="season">{field.planting_date?'Since recorded planting':'All available dates'}</option></select></label><label>Vegetation index<select value={index} onChange={event=>setIndex(event.target.value)}><option value="ndvi_value">NDVI — vegetation</option><option value="ndmi_value">NDMI — canopy water signal</option><option value="ndre_value">NDRE — red-edge signal</option></select></label></div>
          {chart.length?<div style={{height:280,width:'100%',marginTop:'1rem'}}><ResponsiveContainer width="100%" height="100%"><LineChart data={chart} margin={{left:0,right:20,bottom:12}}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="date" type="number" scale="time" domain={['dataMin','dataMax']} tickFormatter={value=>new Date(value).toLocaleDateString(undefined,{month:'short',day:'numeric'})}/><YAxis domain={[-1,1]} width={42}/><Tooltip labelFormatter={value=>new Date(Number(value)).toLocaleDateString()}/><Line name={index.split('_')[0].toUpperCase()} dataKey={index} stroke="#4d7c0f" strokeWidth={2} dot={{r:4}} connectNulls={false} strokeDasharray="2 5" isAnimationActive={false}/>{events.filter(event=>['planting','irrigation','fertilizer','scouting','harvest'].includes(event.event_type)&&Date.parse(event.event_date)>=cutoff).map(event=><ReferenceLine key={event.id} x={Date.parse(event.event_date)} stroke="#8b5cf6" label={event.event_type}/>)}</LineChart></ResponsiveContainer></div>:<p>No accepted observations in this range. Find a usable image on the Map tab.</p>}
          {analysis?.slopePerDay!=null&&<p>Descriptive slope: {analysis.slopePerDay} NDVI/day · {analysis.observations} dates · {analysis.dateStart} to {analysis.dateEnd}. This does not predict crop growth or yield.</p>}
        </section>
        <details className="technical-observations"><summary>Advanced: measurements and experimental score</summary><p>Experimental score = 75% normalized NDVI + 25% normalized NDMI (or NDVI when NDMI is missing), clamped to 0–100. Coverage controls acceptance independently. This is not disease probability or guaranteed yield. Historical records may be unverified.</p><p>NDVI normalization: (NDVI − 0.15) / 0.65. NDMI normalization: (NDMI + 0.2) / 0.7. Both are clamped to 0–1 before weighting. These are unvalidated display heuristics.</p>
        <h3>Vegetation Indices (NDVI)</h3>
        {observations.length > 0 ? (
          <div className="table-scroll" role="region" aria-label="Vegetation observations" tabIndex={0}><table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: '0.75rem 0' }}>Date</th>
                <th>Cloud Cover</th>
                <th>NDVI</th>
                <th>NDRE</th>
                <th>NDMI</th><th>Coverage / status</th>
              </tr>
            </thead>
            <tbody>
              {observations.map((obs, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: '0.75rem 0' }}>{new Date(obs.observed_on).toLocaleDateString()}</td>
                  <td>{obs.cloud_cover!=null?`${obs.cloud_cover}%`:'Unavailable'}</td>
                  <td style={{ fontWeight: 'bold' }}>{obs.ndvi_value==null?'Unavailable':Number(obs.ndvi_value).toFixed(3)}</td>
                  <td>{obs.ndre_value != null ? Number(obs.ndre_value).toFixed(3) : 'Unavailable'}</td>
                  <td>{obs.ndmi_value != null ? Number(obs.ndmi_value).toFixed(3) : 'Unavailable'}</td><td>{obs.valid_coverage_percent??'Unavailable'} · {obs.accepted?'Accepted':obs.quality_reason||'Unverified'}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : (
          <p>No observations recorded yet.</p>
        )}

        </details>
        <div className="content-heading" style={{ marginTop: '3rem', marginBottom: '1rem' }}>
          <h3>Historical weather — NASA POWER</h3>
          <button 
            onClick={async () => {
              if (weatherLoading) return;
              setWeatherLoading(true); setWeatherMessage('');
              try {
                const result = await ingestWeather(field.id);
                const data = await loadWeather(field.id);
                setWeather(data);
                setWeatherMessage(`Weather synced: ${result.imported} observations imported.`);
              } catch (e) {
                setWeatherMessage(e instanceof Error ? e.message : 'Weather sync failed. Try again.');
              } finally {
                setWeatherLoading(false);
              }
            }}
            disabled={weatherLoading}
            style={{ background: '#f3f4f6', border: '1px solid #d1d5db', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer' }}
          >
            {weatherLoading ? 'Syncing...' : 'Sync Weather Data'}
          </button>
        </div>

        <p>Historical modeled weather, typically delayed 2–3 days. It is not a forecast or a precise irrigation schedule.</p>
        {weatherMessage && <p role="status">{weatherMessage}</p>}
        {weather.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div className="weather-chart" style={{ height: '300px', width: '100%', background: '#fff', border: '1px solid #e5e7eb', padding: '1rem', borderRadius: '8px' }}>
              <h4 style={{ marginTop: 0, textAlign: 'center', color: '#4b5563' }}>Temperature (°C)</h4>
              <ResponsiveContainer width="100%" height="85%">
                <LineChart data={weather} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="observed_on" tickFormatter={(tick) => new Date(tick).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} />
                  <YAxis />
                  <Tooltip labelFormatter={(label) => new Date(label as string | number).toLocaleDateString()} />
                  <Legend />
                  <Line type="monotone" dataKey="temperature_c" name="Avg Temp" stroke="#ef4444" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="weather-chart" style={{ height: '300px', width: '100%', background: '#fff', border: '1px solid #e5e7eb', padding: '1rem', borderRadius: '8px' }}>
              <h4 style={{ marginTop: 0, textAlign: 'center', color: '#4b5563' }}>Precipitation (mm)</h4>
              <ResponsiveContainer width="100%" height="85%">
                <BarChart data={weather} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="observed_on" tickFormatter={(tick) => new Date(tick).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} />
                  <YAxis />
                  <Tooltip labelFormatter={(label) => new Date(label as string | number).toLocaleDateString()} />
                  <Legend />
                  <Bar dataKey="precipitation_mm" name="Precipitation" fill="#3b82f6" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <div style={{ padding: '2rem', textAlign: 'center', background: '#f9fafb', borderRadius: '8px', border: '1px dashed #d1d5db' }}>
            <p style={{ color: '#6b7280' }}>No weather data synced yet. Click the sync button above to fetch historical climate data from NASA POWER.</p>
          </div>
        )}
      </div>

      <div style={{ background: '#f9fafb', padding: '1.5rem', borderRadius: '8px', border: '1px solid #e5e7eb', height: 'fit-content' }}>
        <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>Ask Assistant</h3>
        <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '1rem' }}>Ask AI about your field's health or crop management in your preferred language.</p>
        
        <form onSubmit={handleAsk} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <textarea 
            value={question} 
            onChange={e => setQuestion(e.target.value)} 
            placeholder="e.g. When should I irrigate next?" 
            rows={4}
            maxLength={2000}
            aria-label="Question for field assistant"
            style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #d1d5db', resize: 'vertical' }}
            required
          />
          <button 
            type="submit" 
            disabled={asking || !question.trim()}
            style={{ background: '#4d7c0f', color: 'white', padding: '0.75rem', borderRadius: '4px', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
          >
            {asking ? 'Thinking...' : 'Ask AI'}
          </button>
        </form>

        {assistantError && <div className="assistant-error" role="alert">{assistantError}</div>}
        {answer && (
          <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'white', borderRadius: '4px', border: '1px solid #e5e7eb', fontSize: '0.9rem', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
            <strong>Answer:</strong><p>Satellite evidence dates: {evidenceDates.join(', ')||'No dated imagery supplied'}</p>
            <p style={{ margin: '0.5rem 0 0 0' }}>{answer}</p>
          </div>
        )}
      </div>
    </div>
  );
}
