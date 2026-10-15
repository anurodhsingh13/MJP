import { useState, useEffect, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { loadFieldEvents, createFieldEvent, deleteFieldEvent } from '../../lib/api';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
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
              <div key={ev.id} style={{ padding: '1rem', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', display: 'flex', justifyContent: 'space-between' }}>
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
    </div>
  );
}
