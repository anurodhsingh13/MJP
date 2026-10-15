import { useState } from 'react';
import { useModalDialog } from '../../lib/useModalDialog';
import { processLatest } from '../../lib/api';
import { FieldBoundaryEditor } from './FieldBoundaryEditor';
import { polygonAreaHectares, validatePolygonBoundary, type PolygonBoundary } from './boundary';

type Step = 'basic' | 'dates' | 'boundary' | 'confirm';

export function AddFieldWizard({ onComplete, onCancel }: { onComplete: (fieldId: string) => void, onCancel: () => void }) {
  const [step, setStep] = useState<Step>('basic');
  const [name, setName] = useState('');
  const [crop, setCrop] = useState('');
  const [plantingDate, setPlantingDate] = useState('');
  const [harvestDate, setHarvestDate] = useState('');
  
  const [polygonGeojson, setPolygonGeojson] = useState<PolygonBoundary|null>(null);
  const [savedFieldId, setSavedFieldId] = useState<string | null>(null);
  const [clientKey] = useState(()=>crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [boundaryFinished, setBoundaryFinished] = useState(false);
  const [importError,setImportError]=useState('');
  const areaHectares=polygonAreaHectares(polygonGeojson);
  const outerRing=polygonGeojson?.coordinates[0]??[];
  const boundaryPoints=outerRing.length>1&&outerRing[0][0]===outerRing.at(-1)?.[0]&&outerRing[0][1]===outerRing.at(-1)?.[1]?outerRing.length-1:outerRing.length;
  
  const closeWizard = () => savedFieldId ? onComplete(savedFieldId) : onCancel();

  useModalDialog(true, closeWizard, saving);

  const undoBoundaryPoint = () => {
    if(!polygonGeojson||!boundaryPoints)return;
    const open=outerRing.slice(0,boundaryPoints);
    open.pop();
    if(open.length>=3)open.push([...open[0]]);
    setPolygonGeojson({...polygonGeojson,coordinates:[open,...polygonGeojson.coordinates.slice(1)]});
    setBoundaryFinished(false);
  };

  const clearBoundary = () => {
    setBoundaryFinished(false);
    setPolygonGeojson(null);
    setImportError('');
  };

  const importBoundary=async(event:React.ChangeEvent<HTMLInputElement>)=>{
    const file=event.target.files?.[0];if(!file)return;
    setImportError('');
    try{
      if(file.size>120*1024)throw new Error('GeoJSON files must be smaller than 120 KB to fit the API boundary limit.');
      const parsed=JSON.parse(await file.text()) as {type?:string;geometry?:unknown;features?:Array<{geometry?:unknown}>};
      const geometry=parsed.type==='Feature'?parsed.geometry:parsed.type==='FeatureCollection'&&parsed.features?.length===1?parsed.features[0].geometry:parsed;
      if(geometry&&typeof geometry==='object'&&(geometry as {type?:string}).type==='MultiPolygon'){
        throw new Error('This service supports one Polygon per field. MultiPolygon imports are not supported; split the parcel into separate fields.');
      }
      if(!validatePolygonBoundary(geometry))throw new Error('Choose a valid GeoJSON Polygon with closed rings and WGS84 [longitude, latitude] coordinates. FeatureCollections must contain exactly one Polygon.');
      const area=polygonAreaHectares(geometry);
      if(!Number.isFinite(area)||area<=0||area>10000)throw new Error('The Polygon area must be greater than zero and no more than 10,000 hectares.');
      setPolygonGeojson(geometry);setBoundaryFinished(false);
    }catch(caught){setImportError(caught instanceof Error?caught.message:'Unable to read this GeoJSON file.');}
    finally{event.target.value='';}
  };

  const handleSave = async () => {
    if (!polygonGeojson || saving) return;
    setSaving(true);
    setError('');
    let fieldId = savedFieldId;
    try {
      if (!fieldId) {
        setStatus('Saving field boundary…');
        const response = await fetch('/api/fields', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json','Idempotency-Key':clientKey },
          body: JSON.stringify({
            name,
            crop,
            planting_date: plantingDate || null,
            harvest_date: harvestDate || null,
            boundary_geojson: polygonGeojson,
          })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Failed to save field');
        if (typeof payload.id !== 'string' || !payload.id) throw new Error('The field was saved, but its ID could not be confirmed. Contact support before trying again.');
        fieldId = payload.id;
        setSavedFieldId(fieldId);
      }

      setStatus('Field boundary saved. Satellite processing is starting…');
      const ingestionResponse = await fetch(`/api/fields/${fieldId}/ingest/sentinel-scenes?days=90`, { method: 'POST' });
      const ingestion = await ingestionResponse.json().catch(() => ({}));
      if (!ingestionResponse.ok) throw new Error(ingestion.error || 'Satellite scene search failed');

      if (!fieldId) throw new Error('Field ID is unavailable. Reopen the saved field before retrying analysis.');
      setStatus('Checking newest scenes first and moving to older images if needed…');
      const result = await processLatest(fieldId);
      if (!result.accepted || !result.sceneId) {
        const attempts = result.attempts.map(attempt =>
          `${attempt.sceneId}: ${attempt.status}${attempt.reason ? ` — ${attempt.reason}` : ''}`
        ).join('; ');
        const processingFailed=result.attempts.some(attempt=>attempt.status==='failed');
        setStatus(result.attempts.length===0
          ? 'Field boundary saved. No usable satellite image is currently available.'
          : processingFailed
            ? 'Field boundary saved. Satellite processing failed and can be retried.'
            : 'Field boundary saved. No image met the field-quality requirements.');
        setError([result.message || 'The field is saved; no usable observation was accepted.', attempts].filter(Boolean).join(' '));
        return;
      }

      setStatus(`Field boundary saved. A usable Sentinel-2 observation was accepted from scene ${result.sceneId}.`);
      onComplete(fieldId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to complete field setup');
      setStatus(fieldId ? 'Field boundary saved. Satellite processing failed and can be retried without creating the field again.' : '');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="wizard-modal" role="presentation">
      <div className="wizard-content" role="dialog" aria-modal="true" aria-labelledby="add-field-title">
        <button type="button" onClick={closeWizard} disabled={saving} aria-label="Close add field" style={{ float: 'right' }}>Close</button>
        <h2 id="add-field-title">Add new field</h2>
        <p className="step-label">Step {(['basic', 'dates', 'boundary', 'confirm'] as Step[]).indexOf(step) + 1} of 4</p>
        
        {step === 'basic' && (
          <form onSubmit={(e) => { e.preventDefault(); if (name.trim() && crop.trim()) setStep('dates'); else setError('Field name and crop are required.'); }}>
            <label>Field Name <input required value={name} onChange={e => setName(e.target.value)} placeholder="e.g. North block" /></label>
            <label>Crop Type <input required value={crop} onChange={e => setCrop(e.target.value)} placeholder="e.g. Wheat" /></label>
            <div className="actions">
              <button type="button" onClick={onCancel} disabled={saving}>Cancel</button>
              <button type="submit">Next</button>
            </div>
          </form>
        )}

        {step === 'dates' && (
          <form onSubmit={(e) => { e.preventDefault(); if (plantingDate && harvestDate && harvestDate < plantingDate) { setError('Harvest date must be on or after planting date.'); return; } setError(''); setStep('boundary'); }}>
            <label>Planting Date (Optional) <input type="date" value={plantingDate} onChange={e => setPlantingDate(e.target.value)} /></label>
            <label>Expected Harvest (Optional) <input type="date" min={plantingDate || undefined} value={harvestDate} onChange={e => setHarvestDate(e.target.value)} /></label>
            <div className="actions">
              <button type="button" onClick={() => setStep('basic')}>Back</button>
              <button type="submit">Next</button>
            </div>
          </form>
        )}

        {step === 'boundary' && (
          <div>
            <p>Use the OpenStreetMap basemap to add corners, drag the white vertex handles to edit them, and finish the Polygon. No map key is required.</p>
            <FieldBoundaryEditor boundary={polygonGeojson} onChange={boundary=>{setPolygonGeojson(boundary);setImportError('');}} boundaryFinished={boundaryFinished}/>
            <div className="boundary-tools" aria-live="polite">
              <span>{boundaryPoints} point{boundaryPoints === 1 ? '' : 's'} · {areaHectares.toFixed(2)} ha (calculated boundary area)</span>
              <button type="button" onClick={undoBoundaryPoint} disabled={!boundaryPoints}>Undo point</button>
              <button type="button" onClick={clearBoundary} disabled={!boundaryPoints}>Clear</button>
              <button type="button" onClick={() => setBoundaryFinished(true)} disabled={boundaryPoints < 3 || boundaryFinished}>
                {boundaryFinished ? 'Boundary finished' : 'Finish boundary'}
              </button>
            </div>
            <label>Import GeoJSON Polygon<input type="file" accept=".geojson,.json,application/geo+json,application/json" onChange={importBoundary}/></label>
            <p>Supported: one valid GeoJSON Polygon, Polygon Feature, or a FeatureCollection containing one Polygon. MultiPolygon is not supported; split it into separate fields. Coordinates must be WGS84 longitude, latitude.</p>
            {importError&&<p role="alert">{importError}</p>}
            <div className="actions" style={{ marginTop: '1rem' }}>
              <button type="button" onClick={() => setStep('dates')}>Back</button>
              <button type="button" disabled={!polygonGeojson || !validatePolygonBoundary(polygonGeojson) || !boundaryFinished || areaHectares<=0 || areaHectares>10000} onClick={() => setStep('confirm')}>Review</button>
            </div>
          </div>
        )}

        {step === 'confirm' && (
          <div>
            <h3>Review Field Details</h3>
            <ul>
              <li><strong>Name:</strong> {name}</li>
              <li><strong>Crop:</strong> {crop}</li>
              <li><strong>Planting:</strong> {plantingDate || 'Unknown'}</li>
              <li><strong>Expected harvest:</strong> {harvestDate || 'Unknown'}</li>
              <li><strong>Area:</strong> {areaHectares.toFixed(2)} ha</li>
            </ul>
            <div className="actions">
              <button type="button" onClick={() => setStep('boundary')} disabled={saving || Boolean(savedFieldId)}>Back</button>
              <button type="button" onClick={handleSave} disabled={saving}>
                {saving ? (savedFieldId ? 'Checking images…' : 'Saving field…') : savedFieldId ? 'Retry Satellite Processing' : 'Save & Analyse Field'}
              </button>
            </div>
            {status && <p className="wizard-status" role="status">{status}</p>}
            {savedFieldId && !saving && <button type="button" onClick={() => onComplete(savedFieldId)}>Open saved field</button>}
          </div>
        )}
        {error && <p className="wizard-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
