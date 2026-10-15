import { useState, useEffect, useCallback } from 'react';
import { useParams, useOutletContext } from 'react-router-dom';
import { GoogleSatelliteMap } from '../../lib/GoogleSatelliteMap';
import { calculateNdvi, ingestSentinelScenes, loadFieldAlerts, loadScenes, resolveFieldAlert } from '../../lib/api';

function preferredObservation(scenes: Array<{ scene_id: string; observed_at: string }>, lastObservation: string | null) {
  return scenes.find(scene => lastObservation && scene.observed_at.slice(0, 10) === lastObservation.slice(0, 10))?.scene_id
    || [...scenes].sort((a, b) => b.observed_at.localeCompare(a.observed_at))[0]?.scene_id || '';
}

export function FieldMap() {
  const { field, refreshField } = useOutletContext<{ field: any; refreshField: () => Promise<void> }>();
  const { fieldId } = useParams();
  const [scenes, setScenes] = useState<any[]>([]);
  const [activeSceneId, setActiveSceneId] = useState<string>('');
  const [alerts, setAlerts] = useState<any[]>([]);
  const [resolving, setResolving] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refreshScenes = useCallback(async () => {
    if (!fieldId) return [];
    const data = await loadScenes(fieldId);
    setScenes(data);
    setActiveSceneId(current => current && data.some(scene => scene.scene_id === current) ? current : data[0]?.scene_id || '');
    return data;
  }, [fieldId]);

  useEffect(() => {
    if (!fieldId) return;
    let cancelled = false;
    loadScenes(fieldId).then(data => {
      if (cancelled) return;
      setScenes(data);
      setActiveSceneId(preferredObservation(data, field.last_observation));
    }).catch(() => { if (!cancelled) setError('Unable to load satellite observations.'); });
    loadFieldAlerts(fieldId).then(alerts => {
      if (!cancelled) setAlerts(alerts);
    }).catch(() => { if (!cancelled) setError('Unable to load field alerts.'); });
    return () => { cancelled = true; };
  }, [fieldId, field.last_observation]);

  const tileUrl = fieldId && activeSceneId && field.boundary_geojson
    ? `/api/fields/${fieldId}/tiles/${encodeURIComponent(activeSceneId)}/{z}/{x}/{y}.png`
    : null;
  const stressGeojson = alerts.find(alert => !alert.resolved && alert.severity === 'high' && alert.scene_id === activeSceneId)?.stress_geojson ?? null;
  const activeAlert = alerts.find(alert => !alert.resolved && alert.scene_id === activeSceneId);

  const processLatestScene = async () => {
    if (!fieldId || processing || !field.boundary_geojson) return;
    setProcessing(true);
    setError('');
    setMessage('Searching for recent Sentinel-2 observations…');
    try {
      await ingestSentinelScenes(fieldId);
      const availableScenes = await refreshScenes();
      const sceneId = availableScenes[0]?.scene_id;
      if (!sceneId) throw new Error('No suitable Sentinel-2 observation was found in the last 90 days.');
      setActiveSceneId(sceneId);
      setMessage('Calculating NDVI, NDRE, NDMI, SAVI and EVI…');
      const result = await calculateNdvi(fieldId, sceneId);
      const [updatedAlerts] = await Promise.all([loadFieldAlerts(fieldId), refreshField()]);
      setAlerts(updatedAlerts);
      setMessage(`Analysis complete. NDVI ${result.ndvi.toFixed(3)} with ${result.validCoverage.toFixed(1)}% valid coverage.`);
    } catch (caught) {
      setMessage('');
      setError(caught instanceof Error ? caught.message : 'Satellite processing failed.');
    } finally {
      setProcessing(false);
    }
  };

  const hasLocation = field.latitude != null && field.longitude != null && Number.isFinite(Number(field.latitude)) && Number.isFinite(Number(field.longitude));

  return (
    <div className="field-map-panel">
      <div className="field-map-toolbar">
        <label>
          <strong>Select Observation:</strong>
          <select disabled={processing || !scenes.length} value={activeSceneId} onChange={e => setActiveSceneId(e.target.value)} style={{ marginLeft: '0.5rem' }}>
            {!scenes.length && <option value="">No observations available</option>}
            {scenes.map(s => (
              <option key={s.scene_id} value={s.scene_id}>
                {new Date(s.observed_at).toLocaleDateString()} (Cloud: {s.cloud_cover}%)
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={processLatestScene} disabled={processing || !field.boundary_geojson} style={{ minHeight: '44px', padding: '0.65rem 1rem', background: '#4d7c0f', color: 'white', border: 0, borderRadius: '6px' }}>
          {processing ? 'Processing…' : 'Find & Process Best Recent Scene'}
        </button>
      </div>
      {!field.boundary_geojson && <div role="status" style={{ padding: ".75rem 1rem", background: "#fff7ed", color: "#9a3412" }}>No field boundary saved. Available scenes cover the saved location; crop-health indices require your actual field boundary.</div>}
      {message && <div role="status" style={{ padding: '.75rem 1rem', background: '#ecfccb', color: '#365314' }}>{message}</div>}
      {error && <div role="alert" style={{ padding: '.75rem 1rem', background: '#fee2e2', color: '#991b1b' }}>{error}</div>}
      {activeAlert && <div role="alert" style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'1rem', padding:'.75rem 1rem', background:'#fff7ed', color:'#9a3412' }}><span><strong>{activeAlert.title}</strong> for this observation</span><button type="button" disabled={resolving} onClick={async () => {
        if (!fieldId || resolving) return;
        setResolving(true); setError('');
        try { await resolveFieldAlert(fieldId, activeAlert.id); setAlerts(current => current.map(alert => alert.id === activeAlert.id ? { ...alert, resolved:true } : alert)); }
        catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to resolve alert'); }
        finally { setResolving(false); }
      }}>{resolving ? 'Resolving…' : 'Mark resolved'}</button></div>}
      <div className="field-map-canvas">
        {hasLocation ? (
          <GoogleSatelliteMap
            latitude={Number(field.latitude)}
            longitude={Number(field.longitude)}
            fieldName={field.name}
            boundaryGeojson={field.boundary_geojson}
            stressGeojson={stressGeojson}
            tileUrl={tileUrl}
          />
        ) : (
          <div role="alert" style={{ padding: '2rem' }}>This field has no valid location or boundary. Edit the field before requesting satellite analysis.</div>
        )}
        <div className="ndvi-map-legend">
          <h4 style={{ margin: '0 0 0.5rem 0' }}>NDVI Legend</h4>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>-0.2</span>
            <div style={{ width: '100px', height: '10px', background: 'linear-gradient(to right, #a50026, #fee08b, #006837)' }}></div>
            <span>1.0</span>
          </div>
        </div>
      </div>
    </div>
  );
}
