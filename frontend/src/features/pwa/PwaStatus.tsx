import {useEffect,useState} from 'react';import {usePreferences} from '../../lib/preferencesContext';
export function PwaStatus(){
 const {t}=usePreferences();const [online,setOnline]=useState(navigator.onLine);const [update,setUpdate]=useState<ServiceWorker|null>(null);
 useEffect(()=>{
  const network=()=>setOnline(navigator.onLine);
  window.addEventListener('online',network);window.addEventListener('offline',network);
  let active=true;
  if(import.meta.env.PROD&&'serviceWorker' in navigator){void navigator.serviceWorker.register('/sw.js').then(registration=>{
   if(!active)return;if(registration.waiting)setUpdate(registration.waiting);
   registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(active&&worker.state==='installed'&&navigator.serviceWorker.controller)setUpdate(worker);});});
  }).catch(()=>{/* Browser operation continues if installation is unavailable. */});}
  return()=>{active=false;window.removeEventListener('online',network);window.removeEventListener('offline',network);};
 },[]);
 return <div className="pwa-status no-print" aria-live="polite">{!online&&<span role="status">{t('Offline · new records and forecasts need a connection. Note drafts stay in this tab.','ऑफ़लाइन · नई जानकारी के लिए इंटरनेट चाहिए। नोट ड्राफ़्ट इसी टैब में रहेंगे।')}</span>}{update&&<button type="button" onClick={()=>{if(window.confirm(t('Reload to update? Unsaved form edits may be lost.','अपडेट के लिए पेज खोलें? बिना सेव किए बदलाव खो सकते हैं।'))){update.postMessage({type:'ACTIVATE_UPDATE'});navigator.serviceWorker.addEventListener('controllerchange',()=>window.location.reload(),{once:true});}}}>{t('Update available','अपडेट उपलब्ध है')}</button>}</div>;
}
