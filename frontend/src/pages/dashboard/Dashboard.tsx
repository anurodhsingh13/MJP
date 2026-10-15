import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { loadFields, type DatabaseField } from '../../lib/api';
import { assessEvidence } from '../../../../shared/evidence';
import { AddFieldWizard } from '../../features/fields/AddFieldWizard';

const assessment = (field:DatabaseField) => field.assessment || assessEvidence(null,null);
const priority = {needs_inspection:0,image_too_old:1,not_enough_data:2,awaiting_analysis:3,no_unusual_change:4};
const icons = {needs_inspection:'⚑',image_too_old:'◷',not_enough_data:'◌',awaiting_analysis:'◇',no_unusual_change:'✓'};
export function Dashboard() {
  const navigate=useNavigate();
  const [fields,setFields]=useState<DatabaseField[]>([]);
  const [adding,setAdding]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [query,setQuery]=useState('');
  const [filter,setFilter]=useState('all');
  const [includeDemo,setIncludeDemo]=useState(false);
  const refreshFields=()=>{
    setLoading(true);setError('');loadFields().then(setFields).catch(()=>setError('Your fields could not be loaded. Check the local services and retry.')).finally(()=>setLoading(false));
  };
  useEffect(()=>{
    let cancelled=false;
    loadFields().then(data=>{if(!cancelled)setFields(data);}).catch(()=>{if(!cancelled)setError('Your fields could not be loaded. Check the local services and retry.');}).finally(()=>{if(!cancelled)setLoading(false);});
    return()=>{cancelled=true;};
  },[]);
  const real=fields.filter(field=>!field.isDemo && field.provenance!=='demo' && field.provenance!=='public_boundary');
  const visible=fields.filter(field=>(includeDemo||real.includes(field)) && `${field.name} ${field.crop}`.toLowerCase().includes(query.toLowerCase()) && (filter==='all'||assessment(field).state===filter));
  const attention=real.filter(field=>assessment(field).state!=='no_unusual_change').sort((a,b)=>priority[assessment(a).state]-priority[assessment(b).state]);
  const count=(state:string)=>real.filter(field=>assessment(field).state===state).length;
  return <main className="dashboard-shell">
    <header className="dashboard-header overview-header"><div><span className="eyebrow">TERRASCOPE · FIELD MONITORING</span><h1>Your fields, <span>at a glance.</span></h1><p>See what changed, check the evidence, and choose your next field visit.</p></div><button className="primary-action" onClick={()=>setAdding(true)}>+ Add field</button></header>
    <nav className="overview-nav" aria-label="Main navigation"><a href="#overview">Overview</a><a href="#my-fields">My fields</a><Link to="/datasets">Data sources & help</Link></nav>
    {error&&<div className="service-error" role="alert"><strong>Fields unavailable</strong><span>{error}</span><button onClick={refreshFields}>Retry</button></div>}
    {!error&&!loading&&<>
      <section id="overview" className="summary-grid" aria-label="Farm summary">
        <article><span>Needs inspection</span><strong>{count('needs_inspection')}</strong><small>vegetation decreased; visit to understand why</small></article>
        <article><span>Old imagery</span><strong>{count('image_too_old')}</strong><small>current crop condition is unknown</small></article>
        <article><span>Missing or limited evidence</span><strong>{count('not_enough_data')+count('awaiting_analysis')}</strong><small>includes first analysis and processing</small></article>
        <article><span>Your saved fields</span><strong>{real.length}</strong><small>saved does not mean actively monitored</small></article>
      </section>
      <section className="attention-panel" aria-labelledby="attention-heading"><span className="eyebrow">YOUR NEXT ACTION</span><h2 id="attention-heading">Needs attention</h2>
        {attention.length?attention.slice(0,5).map(field=><Link className="attention-row" key={field.id} to={`/fields/${field.id}/${assessment(field).state==='needs_inspection'?'history':'map'}`}><span className="attention-icon" aria-hidden="true">{icons[assessment(field).state]}</span><div><strong>{field.name}</strong><p>{assessment(field).title} · {assessment(field).explanation}</p></div><span>{assessment(field).nextAction} →</span></Link>):<p>{real.length?'No large vegetation decrease detected in the available comparable evidence. Keep checking your fields.':'Add your own field to start. Demo parcels are excluded from this list.'}</p>}
      </section>
      <section id="my-fields" aria-labelledby="fields-heading"><div className="section-heading"><div><span className="eyebrow">YOUR LAND</span><h2 id="fields-heading">My fields</h2></div><span>{visible.length} shown</span></div>
        <div className="field-filters"><label>Search fields<input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Field name or crop"/></label><label>Evidence status<select value={filter} onChange={event=>setFilter(event.target.value)}><option value="all">All fields</option><option value="needs_inspection">Needs inspection</option><option value="image_too_old">Image too old</option><option value="not_enough_data">Not enough usable data</option><option value="awaiting_analysis">Awaiting first analysis</option><option value="no_unusual_change">No unusual change detected</option></select></label><label className="checkbox-label"><input type="checkbox" checked={includeDemo} onChange={event=>setIncludeDemo(event.target.checked)}/>Show demo & public parcels</label></div>
        {visible.length?<div className="field-grid">{visible.map(field=>{
          const status=assessment(field); const observation=field.latestObservation;
          return <Link key={field.id} to={`/fields/${field.id}/${status.state==='needs_inspection'?'history':'map'}`} className="field-card"><div className="field-card-top"><div><span className={`evidence-status status-${status.state}`}>{icons[status.state]} {status.title}</span><h3>{field.name}</h3><small>{field.crop||'Crop unknown'} · {field.area_hectares} ha</small></div><span className="card-arrow" aria-hidden="true">↗</span></div><p>{status.explanation}</p><dl className="evidence-facts"><div><dt>Acquired</dt><dd>{observation?.observed_on||'No verified image'}</dd></div><div><dt>Usable field coverage</dt><dd>{observation?.valid_coverage_percent!=null?`${observation.valid_coverage_percent}%`:'Unavailable'}</dd></div></dl>{field.isDemo&&<p className="demo-label">Demo / public boundary · current crop unverified</p>}{field.processing?.some(scene=>scene.processing_status==='processing')&&<p role="status">Image processing in progress</p>}<footer>{status.nextAction} →</footer></Link>;
        })}</div>:<div className="dashboard-state"><h2>{fields.length?'No fields match this view':'No fields added yet'}</h2><p>Save a field boundary, then find a usable satellite image. Demo parcels are hidden by default.</p><button className="primary-action" onClick={()=>setAdding(true)}>{fields.length?'+ Add field':'Add your first field'}</button></div>}
      </section>
      <details className="evidence-help"><summary>How to read satellite evidence</summary><p>Coverage describes usable pixels inside your field. Scene cloud cover describes the much larger satellite scene. Poor coverage does not mean unhealthy crops.</p><p>NDVI describes vegetation, not a particular disease. Harvest, maturity, bare soil and mixed pixels can change it. NDMI is not a soil-moisture percentage. NDRE is not a fertilizer prescription.</p><Link to="/datasets">Explore datasets</Link></details>
    </>}
    {loading&&<div className="dashboard-state" role="status">Loading fields…</div>}
    {adding&&<AddFieldWizard onComplete={fieldId=>{setAdding(false);navigate(`/fields/${fieldId}/map`);}} onCancel={()=>setAdding(false)}/>}
  </main>;
}
