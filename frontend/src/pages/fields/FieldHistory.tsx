import { useState, useEffect, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { loadFieldEvents, createFieldEvent, deleteFieldEvent, loadScouting, saveScouting, loadFieldTasks, updateFieldTask, type ScoutingCase } from '../../lib/api';

function EventNotes({ event }: { event: { event_type: string; notes: string | null } }) {
  let source: Record<string, unknown> | null = null;
  if (event.event_type === 'dataset_import' && event.notes) {
    try {
      const parsed: unknown = JSON.parse(event.notes);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) source = parsed as Record<string, unknown>;
    } catch { /* Keep plain notes when the import format is not JSON. */ }
  }
  if (source) return <div style={{ fontSize: '.9rem', color: '#4b5563', overflowWrap: 'anywhere' }}>
    <p>{String(source.dataset || 'Public dataset')} · boundary year {String(source.boundary_year || 'unknown')} · {String(source.license || 'see source')}</p>
    <p>{String(source.warning || '')}</p>
    {typeof source.source_url === 'string' && source.source_url.startsWith('https://') && <a href={source.source_url} target="_blank" rel="noreferrer">Dataset source and attribution ↗</a>}
  </div>;
  return <p style={{ margin: 0, color: '#6b7280', fontSize: '.9rem', overflowWrap: 'anywhere' }}>{event.notes || 'No notes provided'}</p>;
}

export function FieldHistory() {
  const { field } = useOutletContext<{ field: any }>();
  const [events, setEvents] = useState<any[]>([]);
  const [scoutingCases,setScoutingCases]=useState<ScoutingCase[]>([]);
  const [tasks,setTasks]=useState<Array<{id:string;title:string;due_on:string|null;status:'open'|'acknowledged'|'action_taken'|'resolved'}>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [scoutingLoading,setScoutingLoading]=useState(true);
  const [scoutingError,setScoutingError]=useState('');
  const [scoutingSaving,setScoutingSaving]=useState(false);
  const [scoutingSymptoms,setScoutingSymptoms]=useState('');
  const [scoutingNotes,setScoutingNotes]=useState('');
  const [scoutingImage,setScoutingImage]=useState<File|null>(null);
  const [scoutingDate,setScoutingDate]=useState(()=>new Date().toISOString().slice(0,10));
  const [scoutingKey,setScoutingKey]=useState(()=>crypto.randomUUID());
  const [taskError,setTaskError]=useState('');
  const refreshEvents = useCallback(async () => {
    setLoading(true); setError('');
    try { setEvents(await loadFieldEvents(field.id)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to load history'); }
    finally { setLoading(false); }
  }, [field.id]);
  
  const [type, setType] = useState('planting');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    let cancelled = false;
    loadFieldEvents(field.id).then(data => { if (!cancelled) setEvents(data); })
      .catch(caught => { if (!cancelled) setError(caught.message || 'Unable to load history'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [field.id]);

  useEffect(()=>{
    let cancelled=false;
    loadScouting(field.id).then(scouting=>{if(!cancelled)setScoutingCases(scouting.cases);})
      .catch(caught=>{if(!cancelled)setScoutingError(caught instanceof Error?caught.message:'Unable to load scouting notes');})
      .finally(()=>{if(!cancelled)setScoutingLoading(false);});
    loadFieldTasks(field.id).then(loadedTasks=>{if(!cancelled)setTasks(loadedTasks);})
      .catch(caught=>{if(!cancelled)setTaskError(caught instanceof Error?caught.message:'Unable to load follow-up tasks');});
    return()=>{cancelled=true;};
  },[field.id]);

  const handleScoutingSave=async(event:React.FormEvent)=>{
    event.preventDefault();
    if(!scoutingImage||scoutingSaving)return;
    if(scoutingImage.size>5*1024*1024){setScoutingError('Choose a JPEG, PNG or WebP photo smaller than 5 MB.');return;}
    setScoutingSaving(true);setScoutingError('');
    try{
      const image=await new Promise<string>((resolve,reject)=>{
        const reader=new FileReader();reader.onload=()=>typeof reader.result==='string'?resolve(reader.result):reject(new Error('Unable to read the selected photo'));reader.onerror=()=>reject(new Error('Unable to read the selected photo'));reader.readAsDataURL(scoutingImage);
      });
      const saved=await saveScouting(field.id,{client_key:scoutingKey,observed_on:scoutingDate,crop:field.crop&&field.crop!=='Unknown'?field.crop:undefined,symptoms:scoutingSymptoms,notes:scoutingNotes,image});
      if(saved.id)setScoutingCases(current=>[saved,...current.filter(item=>item.id!==saved.id)]);
      setScoutingImage(null);setScoutingSymptoms('');setScoutingNotes('');setScoutingDate(new Date().toISOString().slice(0,10));setScoutingKey(crypto.randomUUID());
      const input=document.getElementById('scouting-photo') as HTMLInputElement|null;if(input)input.value='';
      try{setTasks(await loadFieldTasks(field.id));setTaskError('');}
      catch(caught){setTaskError(caught instanceof Error?caught.message:'Unable to refresh follow-up tasks');}
    }catch(caught){setScoutingError(caught instanceof Error?caught.message:'Photo and scouting note could not be saved. Retry without closing this form.');}
    finally{setScoutingSaving(false);}
  };

  const changeTask=async(id:string,status:'open'|'acknowledged'|'action_taken'|'resolved')=>{
    setTaskError('');
    try{await updateFieldTask(field.id,id,status);setTasks(current=>current.map(task=>task.id===id?{...task,status}:task));}
    catch(caught){setTaskError(caught instanceof Error?caught.message:'Unable to update follow-up task');}
  };

  const handleAddEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!type || !date || saving) return;
    setSaving(true); setError('');
    try {
      const created = await createFieldEvent(field.id, type, date, notes);
      setEvents(current => [...current, created].sort((a, b) => b.event_date.localeCompare(a.event_date)));
      setType('planting');
      setDate('');
      setNotes('');

    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to add event');
    } finally { setSaving(false); }
  };

  if (loading) return <div style={{ padding: '2rem' }}>Loading history...</div>;

  return (
    <div className="field-columns">
      <div>
        <h2 style={{ marginTop: 0 }}>Events & History</h2>
        {error && <div role="alert">{error} <button type="button" onClick={refreshEvents}>Retry loading history</button></div>}
        {events.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {events.map(ev => (
              <div className="history-event" key={ev.id} style={{ padding: '1rem', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', display: 'flex', justifyContent: 'space-between' }}>
                <div>
                  <h4 style={{ margin: '0 0 0.25rem 0', textTransform: 'capitalize' }}>{ev.event_type.replace('_', ' ')}</h4>
                  <EventNotes event={ev} />
                </div>
                <div style={{ color: '#4b5563', fontWeight: '500' }}>
                  {new Date(ev.event_date).toLocaleDateString()}
                  <button type="button" disabled={saving || deleting !== null} onClick={async () => {
                    if (!window.confirm('Delete this field event?')) return;
                    setDeleting(ev.id); setError('');
                    try {
                      await deleteFieldEvent(field.id, ev.id);
                      setEvents(current => current.filter(item => item.id !== ev.id));
                    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to delete event'); }
                    finally { setDeleting(null); }
                  }} style={{ display:'block', marginTop:'.5rem', border:0, background:'none', color:'#b91c1c', padding:0 }}>{deleting === ev.id ? 'Deleting…' : 'Delete'}</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ color: '#6b7280' }}>No events recorded for this field.</p>
        )}
      </div>

      <div style={{ background: '#f9fafb', padding: '1.5rem', borderRadius: '8px', border: '1px solid #e5e7eb', height: 'fit-content' }}>
        <h3 style={{ marginTop: 0 }}>Log New Event</h3>
        <form onSubmit={handleAddEvent} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            Event Type
            <select value={type} onChange={e => setType(e.target.value)} style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #d1d5db' }}>
              <option value="planting">Planting</option>
              <option value="fertilizer">Fertilizer Application</option>
              <option value="irrigation">Irrigation</option>
              <option value="pesticide">Pesticide Application</option>
              <option value="harvest">Harvest</option>
              <option value="scouting">Field Scouting</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            Date
            <input type="date" required value={date} onChange={e => setDate(e.target.value)} style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #d1d5db' }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            Notes (Optional)
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #d1d5db', resize: 'vertical' }} />
          </label>
          <button type="submit" disabled={saving || deleting !== null} style={{ background: '#4d7c0f', color: 'white', padding: '0.75rem', borderRadius: '4px', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>
            {saving ? 'Saving…' : 'Save Event'}
          </button>
        </form>
      </div>
      <section aria-labelledby="scouting-title">
        <h2 id="scouting-title">Photo scouting</h2>
        <p>Record what you see in the field. No crop diagnosis provider is configured; the app will not infer a disease or treatment from your photo.</p>
        <form onSubmit={handleScoutingSave} style={{display:'grid',gap:'.75rem',maxWidth:620}}>
          <label>Observation date<input aria-label="Scouting observation date" type="date" required max={new Date().toISOString().slice(0,10)} value={scoutingDate} onChange={event=>setScoutingDate(event.target.value)}/></label>
          {field.crop&&field.crop!=='Unknown'&&<p>Crop: {field.crop}</p>}
          <label>Symptoms<textarea value={scoutingSymptoms} maxLength={4000} onChange={event=>setScoutingSymptoms(event.target.value)} rows={2}/></label>
          <label>Notes<textarea value={scoutingNotes} maxLength={4000} onChange={event=>setScoutingNotes(event.target.value)} rows={3}/></label>
          <label>Crop photo<input id="scouting-photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" required onChange={event=>setScoutingImage(event.target.files?.[0]??null)}/></label>
          {scoutingError&&<p role="alert">{scoutingError}</p>}
          <button type="submit" disabled={scoutingSaving||!scoutingImage}>{scoutingSaving?'Saving photo and field note…':'Save scouting note'}</button>
        </form>
        <p role="status">Diagnosis unavailable: no licensed, validated provider is configured. Photo quality review is not a crop diagnosis.</p>
        {scoutingLoading?<p>Loading scouting notes…</p>:scoutingCases.length===0?<p>No photos or scouting notes recorded for this field.</p>:scoutingCases.map(item=>(
          <article key={item.id} style={{display:'grid',gap:'.5rem',padding:'1rem',marginTop:'1rem',border:'1px solid #536b36',borderRadius:8}}>
            <h3 style={{margin:0}}>Field note · {new Date(`${item.observed_on}T00:00:00`).toLocaleDateString()}</h3>
            {item.crop&&<p>Reported crop: {item.crop}</p>}
            {item.symptoms&&<p>Symptoms: {item.symptoms}</p>}
            {item.notes&&<p>Notes: {item.notes}</p>}
            {item.photos?.map(photo=><div key={photo.id}>
              <img alt={`Farmer scouting photo, quality review: ${photo.quality}`} loading="lazy" style={{maxWidth:'min(100%,420px)',height:'auto',borderRadius:8}} src={`/api/fields/${field.id}/scouting/${item.id}/photos/${photo.id}`}/>
              <p>Photo quality: {photo.quality}. Not a diagnosis.</p>
            </div>)}
            <p>Diagnosis unavailable. No disease, confidence or treatment has been inferred.</p>
          </article>
        ))}
      </section>
      <section aria-labelledby="tasks-title">
        <h2 id="tasks-title">Follow-up tasks</h2>
        {taskError&&<p role="alert">{taskError}</p>}
        {tasks.length===0?<p>No follow-up tasks are open for this field.</p>:tasks.map(task=><article key={task.id} style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:12,padding:'12px 0',borderBottom:'1px solid #536b36'}}>
          <span>{task.title}{task.due_on?` · due ${task.due_on}`:''}</span>
          <label>State<select aria-label={`Task state for ${task.title}`} value={task.status} onChange={event=>void changeTask(task.id,event.target.value as typeof task.status)}>
            <option value="open">Open</option><option value="acknowledged">Acknowledged</option><option value="action_taken">Action taken</option><option value="resolved">Resolved</option>
          </select></label>
          {task.status==='resolved'&&<small>Resolved is a task state; it does not verify crop recovery.</small>}
        </article>)}
      </section>
    </div>
  );
}
