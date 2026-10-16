import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {Bell,CheckCheck,CalendarCheck,TriangleAlert,CloudSun} from 'lucide-react';
import {loadFields,type DatabaseField} from '../../lib/api';
import {fieldAssessment} from '../../lib/fieldCopy';
import {usePreferences} from '../../lib/preferencesContext';
import {useDisclosureDismiss} from '../../lib/useDisclosureDismiss';

type Notice={id:string;field:string;title:string;href:string;kind:'visit'|'task'|'job'};
export function Notifications({accountId}:{accountId:string}){
 const {t}=usePreferences();
 const disclosure=useDisclosureDismiss();
 const [fields,setFields]=useState<DatabaseField[]>([]);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState(false);
 const [refresh,setRefresh]=useState(0);
 const storageKey='terrascope:read-notifications:'+accountId;
 const [read,setRead]=useState<string[]>(()=>{try{const saved:unknown=JSON.parse(localStorage.getItem(storageKey)||'[]');return Array.isArray(saved)?saved.filter((id):id is string=>typeof id==='string'):[];}catch{return [];}});
 useEffect(()=>{
  let active=true;
  const update=()=>{void loadFields().then(value=>{if(active){setFields(value);setError(false);}}).catch(()=>{if(active)setError(true);}).finally(()=>{if(active)setLoading(false);});};
  update();const timer=window.setInterval(update,60000);window.addEventListener('focus',update);
  return()=>{active=false;window.clearInterval(timer);window.removeEventListener('focus',update);};
 },[refresh]);
 const notices:Notice[]=fields.filter(field=>!field.isDemo&&field.provenance!=='demo'&&field.provenance!=='public_boundary').flatMap(field=>{
  const entries:Notice[]=[];
  if(fieldAssessment(field).state==='needs_inspection')entries.push({id:`visit:${field.id}:${field.latest_scene_id||field.latestObservation?.scene_id||field.last_observation||''}:${field.boundary_version||1}`,field:field.name,title:t('A field visit is recommended','खेत की जाँच करें'),href:`/fields/${field.id}/map`,kind:'visit'});
  if(Number(field.dueTasks)>0)entries.push({id:`task:${field.id}:${field.dueTasks}:${new Date().toLocaleDateString('en-CA')}`,field:field.name,title:t(`${field.dueTasks} planned tasks due`,`${field.dueTasks} तय काम बाकी`),href:`/fields/${field.id}/overview#planned-tasks`,kind:'task'});
  if(field.latestJob?.status==='failed')entries.push({id:`job:${field.latestJob.id}`,field:field.name,title:t('Image or weather update needs a retry','तस्वीर या मौसम अपडेट फिर करें'),href:`/fields/${field.id}/overview`,kind:'job'});
  return entries;
 });
 const unread=notices.filter(item=>!read.includes(item.id)).length;
 const markRead=(ids:string[])=>{const next=[...new Set([...read,...ids])].slice(-500);setRead(next);try{localStorage.setItem(storageKey,JSON.stringify(next));}catch{/* Keep this session usable without storage. */}};
 return <details className="header-disclosure notification-menu" ref={disclosure} onToggle={event=>{if(event.currentTarget.open)setRefresh(value=>value+1);}}>
  <summary className="header-icon-button" aria-label={t(`Notifications, ${unread} unread`,`सूचनाएँ, ${unread} नई`)}><Bell size={21} aria-hidden="true"/>{unread>0&&<span className="notification-count" aria-hidden="true">{unread>99?'99+':unread}</span>}</summary>
  <section className="header-popover notification-popover" aria-label={t('Notifications','सूचनाएँ')}>
   <div className="notification-heading"><div><strong>{t('Notifications','सूचनाएँ')}</strong><small aria-live="polite">{t(`${unread} unread`,`${unread} नई`)}</small></div>{unread>0&&<button type="button" className="notification-read-all" onClick={()=>markRead(notices.map(item=>item.id))}><CheckCheck size={16} aria-hidden="true"/>{t('Mark all read','सब पढ़ा हुआ करें')}</button>}</div>
   {loading&&<p role="status">{t('Loading notifications…','सूचनाएँ लोड हो रही हैं…')}</p>}
   {error&&<p role="alert">{t('Notifications could not refresh.','सूचनाएँ अपडेट नहीं हुईं।')} <button type="button" onClick={()=>setRefresh(value=>value+1)}>{t('Retry','फिर कोशिश करें')}</button></p>}
   {!loading&&!error&&!notices.length&&<div className="notification-empty"><Bell size={26} aria-hidden="true"/><strong>{t('You’re all caught up','अभी कोई नया काम नहीं')}</strong><p>{t('Field visits, due tasks and failed updates will appear here.','खेत की जाँच, बाकी काम और रुके अपडेट यहाँ दिखेंगे।')}</p></div>}
   <ul className="notification-list">{notices.map(item=>{const Icon=item.kind==='task'?CalendarCheck:item.kind==='job'?CloudSun:TriangleAlert;return <li key={item.id}><Link className={read.includes(item.id)?'notification-item':'notification-item is-unread'} to={item.href} onClick={()=>{markRead([item.id]);if(disclosure.current)disclosure.current.open=false;}}><span className={`notification-symbol notice-${item.kind}`}><Icon size={18} aria-hidden="true"/></span><span><strong>{item.field}</strong><small>{item.title}</small></span>{!read.includes(item.id)&&<i className="notification-unread-dot" aria-label={t('Unread','नई')}/>}</Link></li>;})}</ul>
  </section>
 </details>;
}
