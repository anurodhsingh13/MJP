import { useState, useEffect, useCallback } from 'react';
import { useParams, useOutletContext } from 'react-router-dom';
import { OpenFieldMap } from '../../lib/OpenFieldMap';
import { ingestSentinelScenes, loadFieldAlerts, loadScenes, loadNdvi, processLatest, resolveFieldAlert, type DatabaseField, type SatelliteScene, type Alert, type Observation } from '../../lib/api';

function preferredObservation(scenes: SatelliteScene[], latestAcceptedSceneId?: string | null) {
  if (latestAcceptedSceneId && scenes.some(scene => scene.scene_id === latestAcceptedSceneId)) return latestAcceptedSceneId;
  return scenes[0]?.scene_id || '';
}

export function FieldMap() {
  const { field, refreshField } = useOutletContext<{ field: DatabaseField; refreshField: () => Promise<void> }>();
  const { fieldId } = useParams();
  const [sceneState, setSceneState] = useState<{ fieldId: string; scenes: SatelliteScene[] }>({ fieldId: '', scenes: [] });
  const [selectedScene, setSelectedScene] = useState<{ fieldId: string; sceneId: string }>({ fieldId: '', sceneId: '' });
  const [observationState, setObservationState] = useState<{ fieldId: string; observations: Observation[] }>({ fieldId: '', observations: [] });
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [opacity,setOpacity]=useState(.8);
  const [showLayer,setShowLayer]=useState(true);
  const [resolving, setResolving] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const scenes = sceneState.fieldId === fieldId ? sceneState.scenes : [];
  const activeSceneId = selectedScene.fieldId === fieldId ? selectedScene.sceneId : '';
  const observations = observationState.fieldId === fieldId ? observationState.observations : [];
  const latestEvidence = field.latestObservation?.accepted
    && field.latestObservation.provenance === 'measured_imagery'
    && field.latestObservation.boundary_version === field.boundary_version
    ? field.latestObservation.scene_id
    : field.latest_scene_id ?? null;

  const refreshScenes = useCallback(async () => {
    if (!fieldId) return [];
    const data = await loadScenes(fieldId);
    setSceneState({ fieldId, scenes: data });
    setSelectedScene(current => {
      const activeId = current.fieldId === fieldId ? current.sceneId : '';
      const next = activeId && data.some(scene => scene.scene_id === activeId)
        ? activeId
        : preferredObservation(data, latestEvidence);
      return { fieldId, sceneId: next };
    });
    return data;
  }, [fieldId, latestEvidence]);

  useEffect(() => {
    if (!fieldId) return;
    let cancelled = false;
    loadScenes(fieldId).then(data => {
      if (cancelled) return;
      setSceneState({ fieldId, scenes: data });
      setSelectedScene(current => {
        const activeId = current.fieldId === fieldId ? current.sceneId : '';
        const next = activeId && data.some(scene => scene.scene_id === activeId)
          ? activeId
          : preferredObservation(data, latestEvidence);
        return { fieldId, sceneId: next };
      });
    }).catch(() => { if (!cancelled) setError('Unable to load satellite observations.'); });
    loadNdvi(fieldId).then(data=>{if(!cancelled)setObservationState({fieldId,observations:data});}).catch(()=>{if(!cancelled)setError('Unable to load image quality.');});
    loadFieldAlerts(fieldId).then(alerts => {
      if (!cancelled) setAlerts(alerts);
    }).catch(() => { if (!cancelled) setError('Unable to load field alerts.'); });
    return () => { cancelled = true; };
  }, [fieldId, latestEvidence]);

  const selectedObservation=field.boundary_version == null ? undefined : observations.find(obs=>obs.scene_id===activeSceneId && obs.boundary_version===field.boundary_version);
  const activeScene = scenes.find(scene=>scene.scene_id===activeSceneId);
  const latestAcceptedSceneId = latestEvidence;
  const selectedEvidenceLabel = selectedObservation?.accepted && selectedObservation.provenance === 'measured_imagery'
    ? (activeSceneId === latestAcceptedSceneId ? 'Latest accepted observation' : 'Historical accepted observation')
    : selectedObservation ? 'Not accepted for crop-health evidence' : 'Not analysed for the current boundary';
  const tileUrl = fieldId && activeSceneId && field.boundary_geojson && showLayer && selectedObservation?.accepted && selectedObservation.provenance === 'measured_imagery'
    ? `/api/fields/${fieldId}/tiles/${encodeURIComponent(activeSceneId)}/{z}/{x}/{y}.png`
    : null;
  const stressGeojson = selectedObservation?.accepted && selectedObservation.provenance === 'measured_imagery'
    ? selectedObservation.inspection_geojson ?? null
    : alerts.find(alert => !alert.resolved && alert.severity === 'high' && alert.scene_id === activeSceneId)?.stress_geojson ?? null;
  const activeAlert = alerts.find(alert => !alert.resolved && alert.scene_id === activeSceneId);

  const processLatestScene = async () => {
    if (!fieldId || processing || !field.boundary_geojson) return;
    setProcessing(true);
    setError('');
    setMessage('Searching for recent Sentinel-2 observations…');
    try {
      await ingestSentinelScenes(fieldId);
      const availableScenes = await refreshScenes();
      if (!availableScenes.length) throw new Error('No recent scene was found. Your previous observation is unchanged.');
      setMessage('Checking newest images for usable field pixels…');
      const result = await processLatest(fieldId);
      if (result.sceneId) setSelectedScene({ fieldId, sceneId: result.sceneId });
      const [updatedAlerts,updatedObservations] = await Promise.all([loadFieldAlerts(fieldId), loadNdvi(fieldId),refreshField()]);
      setAlerts(updatedAlerts);setObservationState({fieldId,observations:updatedObservations});await refreshScenes();
      if (result.accepted) setMessage(`Analysis complete. Accepted image: ${result.validCoverage}% usable field coverage.`);
      else { setMessage(''); setError(result.message || 'No image met quality requirements. Your previous accepted observation is unchanged.'); }
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
          <select disabled={processing || !scenes.length} value={activeSceneId} onChange={e => setSelectedScene({ fieldId: fieldId || '', sceneId: e.target.value })}>
            {!scenes.length && <option value="">No observations available</option>}
            {scenes.map(scene => {
              const sceneObservation = observations.find(observation =>
                observation.scene_id === scene.scene_id
                && field.boundary_version != null
                && observation.boundary_version === field.boundary_version
              );
              const isLatestAccepted = scene.scene_id === latestAcceptedSceneId && sceneObservation?.accepted && sceneObservation.provenance === 'measured_imagery';
              const sceneLabel = isLatestAccepted ? 'Latest accepted' : sceneObservation?.accepted && sceneObservation.provenance === 'measured_imagery' ? 'Historical accepted' : sceneObservation ? 'Not accepted' : 'Not analysed';
              return (
              <option key={scene.scene_id} value={scene.scene_id}>
                {new Date(scene.observed_at).toLocaleDateString()} · {sceneLabel} · {scene.scene_id} (scene cloud: {scene.cloud_cover==null?'Unavailable':`${scene.cloud_cover}%`})
              </option>
              );
            })}
          </select>
        </label>
        <button type="button" onClick={processLatestScene} disabled={processing || !field.boundary_geojson} style={{ minHeight: '44px', padding: '0.65rem 1rem', background: '#4d7c0f', color: 'white', border: 0, borderRadius: '6px' }}>
          {processing ? 'Processing…' : 'Find & Process Best Recent Scene'}
        </button>
      </div>
      {!latestAcceptedSceneId && scenes.length > 0 && <p role="status">No accepted observation is available for the current field boundary. Showing the newest available scene; it is not a crop-health assessment.</p>}
      {!field.boundary_geojson && <div role="status" style={{ padding: ".75rem 1rem", background: "#fff7ed", color: "#9a3412" }}>No field boundary saved. Available scenes cover the saved location; crop-health indices require your actual field boundary.</div>}
      {message && <div role="status" style={{ padding: '.75rem 1rem', background: '#ecfccb', color: '#365314' }}>{message}</div>}
      {error && <div role="alert" style={{ padding: '.75rem 1rem', background: '#fee2e2', color: '#991b1b' }}>{error}</div>}
      {activeAlert && <div className="map-alert" role="alert" style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'1rem', padding:'.75rem 1rem', background:'#fff7ed', color:'#9a3412' }}><span><strong>{activeAlert.title}</strong> for this observation. Manually closing this notice does not verify crop recovery.</span><button type="button" disabled={resolving} onClick={async () => {
        if (!fieldId || resolving) return;
        setResolving(true); setError('');
        try { await resolveFieldAlert(fieldId, activeAlert.id); setAlerts(current => current.map(alert => alert.id === activeAlert.id ? { ...alert, resolved:true } : alert)); }
        catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to resolve alert'); }
        finally { setResolving(false); }
      }}>{resolving ? 'Resolving…' : 'Mark resolved'}</button></div>}
      <section className="selected-image-evidence" aria-label="Selected image evidence">
        <strong>Selected acquisition: {activeScene?.observed_at.slice(0,10)||'None'} · {selectedEvidenceLabel}</strong>
        <p>Scene ID: {activeScene?.scene_id||'Unavailable'} · Scene processing: {activeScene?.processing_status||'Unavailable'}</p>
        <p>Selected evidence boundary version: {selectedObservation?.boundary_version??'Unavailable'} · Current field boundary version: {field.boundary_version??'Unavailable'}</p>
        <p>Usable field coverage: {selectedObservation?.valid_coverage_percent!=null?`${selectedObservation.valid_coverage_percent}%`:'Unavailable'} · Usable pixels: {selectedObservation?.valid_pixel_count??'Unavailable'}</p>
        <p>Scene-wide cloud cover: {activeScene?.cloud_cover!=null?`${activeScene.cloud_cover}%`:'Unavailable'} (not field coverage)</p>
        {selectedObservation&&!selectedObservation.accepted&&<p>Not accepted: {selectedObservation.quality_reason||'Unverified legacy evidence'}</p>}
        {latestAcceptedSceneId && <p>Latest accepted scene for this boundary: {latestAcceptedSceneId}. Selecting another acquisition shows historical evidence, not the latest field status.</p>}
        <label><input type="checkbox" checked={showLayer} onChange={event=>setShowLayer(event.target.checked)}/> Show analysed NDVI layer (accepted evidence only)</label>
        <label>Layer opacity<input type="range" min="0" max="1" step="0.1" value={opacity} onChange={event=>setOpacity(Number(event.target.value))}/></label>
        <p>The street/satellite basemap has its own dates. It is not the selected Sentinel acquisition. Transparent areas have no usable measurements.</p>
      </section>
      <div className="field-map-canvas">
        {hasLocation ? (
          <OpenFieldMap
            latitude={Number(field.latitude)}
            longitude={Number(field.longitude)}
            fieldName={field.name}
            boundaryGeojson={field.boundary_geojson}
            stressGeojson={stressGeojson}
            tileUrl={tileUrl}
            opacity={opacity}
          />
        ) : (
          <div role="alert" style={{ padding: '2rem' }}>This field has no valid location or boundary. Edit the field before requesting satellite analysis.</div>
        )}
        <div className="ndvi-map-legend">
          <h4 style={{ margin: '0 0 0.5rem 0' }}>Vegetation signal (NDVI)</h4>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>Less vegetation</span>
            <div style={{ width: '100px', height: '10px', background: 'linear-gradient(to right, #a50026, #fee08b, #006837)' }}></div>
            <span>More vegetation</span>
          </div>
        </div>
      </div>
    </div>
  );
}
