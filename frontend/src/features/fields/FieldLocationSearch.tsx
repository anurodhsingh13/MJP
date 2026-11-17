import {useId,useState} from 'react';
import type {FormEvent} from 'react';
import {usePreferences} from '../../lib/preferencesContext';
import {searchPlaces} from '../../lib/placeSearch';
import type {PlaceHit} from '../../lib/placeSearch';

/** Village/town search for the field boundary step: Google Geocoding (via our server) plus OpenStreetMap matches. */
export function FieldLocationSearch({onSelect}:{onSelect:(location:{latitude:number;longitude:number;address:string})=>void}){
 const {t}=usePreferences();
 const inputId=useId();
 const [query,setQuery]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 const [results,setResults]=useState<PlaceHit[]>([]);
 async function search(event:FormEvent){
  event.preventDefault();
  const text=query.trim();
  if(text.length<2||busy)return;
  setBusy(true);setError('');setMessage('');setResults([]);
  try{
   const hits=await searchPlaces(text);
   if(hits.length)setResults(hits);
   else setError(t('No place found. Try the village name with district or state.','जगह नहीं मिली। गाँव के साथ ज़िला या राज्य लिखकर देखें।'));
  }catch{setError(t('Search is unavailable right now. You can still mark the field on the map.','अभी खोज उपलब्ध नहीं। आप नक्शे पर खेत की सीमा बना सकते हैं।'));}
  finally{setBusy(false);}
 }
 function choose(hit:PlaceHit){
  onSelect({latitude:hit.latitude,longitude:hit.longitude,address:hit.address});setResults([]);
  setMessage(hit.address||t('Location selected. Mark the field corners on the map.','स्थान चुन लिया। नक्शे पर खेत के कोने बनाएँ।'));
 }
 return <div className="field-location-search"><label htmlFor={inputId}>{t('Find the farm area','खेत का इलाका खोजें')}</label>
  <form className="field-location-free" role="search" onSubmit={event=>void search(event)}>
   <input id={inputId} type="search" value={query} maxLength={120} onChange={event=>setQuery(event.target.value)} placeholder={t('Search village, town or nearby landmark','गाँव, कस्बा या पास की जगह खोजें')}/>
   <button type="submit" disabled={busy||query.trim().length<2}>{busy?'…':t('Search','खोजें')}</button>
  </form>
  {results.length>0&&<ul className="field-location-results" aria-label={t('Matching places','मिलते-जुलते स्थान')}>{results.map(hit=><li key={`${hit.latitude},${hit.longitude},${hit.address}`}><button type="button" onClick={()=>choose(hit)}>{hit.address||`${hit.latitude.toFixed(4)}, ${hit.longitude.toFixed(4)}`}</button></li>)}</ul>}
  {message&&<small role="status">{message}</small>}{error&&<small role="alert">{error}</small>}</div>;
}
