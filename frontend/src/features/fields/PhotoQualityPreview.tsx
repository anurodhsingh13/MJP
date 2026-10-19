import {useEffect,useState} from 'react';
import {Camera,CheckCircle2,AlertTriangle} from 'lucide-react';
import {usePreferences} from '../../lib/preferencesContext';
import './photo-quality-preview.css';

type Assessment={status:'ready_for_scouting'|'needs_review';issues:string[];suggestions:string[];width:number;height:number;metrics:{brightness:number;contrast:number;edge_detail:number};disclaimer:string};
const issueCopy:Record<string,[string,string]>={
 low_resolution:['Photo resolution is low. Move closer and use a higher-resolution image.','तस्वीर की क्वालिटी कम है। पास से और स्पष्ट फ़ोटो लें।'],
 underexposed:['The photo looks dark. Take another in daylight.','तस्वीर अंधेरी है। दिन की रोशनी में फ़ोटो लें।'],
 overexposed:['The photo appears too bright. Avoid direct glare.','तस्वीर बहुत उजली है। तेज चमक से बचें।'],
 low_contrast:['Details are hard to distinguish. Use a clear background.','तस्वीर का विवरण साफ़ नहीं है। साफ़ पृष्ठभूमि रखें।'],
 possible_blur:['The image may be blurry. Hold the camera steady and refocus.','तस्वीर धुंधली हो सकती है। कैमरा स्थिर रखें और फ़ोकस करें।']
};
export function PhotoQualityPreview({fieldId,file}:{fieldId:string;file:File|null}){
 const {t}=usePreferences();
 const [busy,setBusy]=useState(false);
 const [result,setResult]=useState<Assessment|null>(null);
 const [error,setError]=useState('');
 useEffect(()=>{setResult(null);setError('');},[fieldId,file]);
 async function inspect(){
  if(!file||busy)return;
  if(file.size>5*1024*1024||!['image/jpeg','image/png','image/webp'].includes(file.type)){
   setError(t('Choose a JPEG, PNG or WebP smaller than 5 MB.','5 MB से छोटी JPEG, PNG या WebP फ़ोटो चुनें।'));return;
  }
  setBusy(true);setError('');setResult(null);
  try{
   const image=await new Promise<string>((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>typeof reader.result==='string'?resolve(reader.result):reject(new Error('Invalid photo'));
    reader.onerror=()=>reject(new Error('File read failed'));reader.readAsDataURL(file);
   });
   const response=await fetch('/api/fields/'+encodeURIComponent(fieldId)+'/scouting/quality-preview',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image})
   });
   if(!response.ok)throw new Error('Quality check failed');
   const data=await response.json() as Assessment;
   if(!Array.isArray(data.issues)||!Array.isArray(data.suggestions))throw new Error('Unexpected response');
   setResult(data);
  }catch{setError(t('Unable to check photo quality. You can still save your scouting note.','फ़ोटो क्वालिटी नहीं जाँच सके। आप अपना नोट फिर भी सेव कर सकते हैं।'));}
  finally{setBusy(false);}
 }
 if(!file)return null;
 return <div className="photo-quality-check" aria-label={t('Photo capture quality check','फ़ोटो गुणवत्ता जाँच')}>
  <button type="button" onClick={()=>void inspect()} disabled={busy}><Camera size={16}/>{busy?t('Checking image…','फ़ोटो जाँच रहे हैं…'):t('Check photo quality before saving','सेव करने से पहले फ़ोटो क्वालिटी जाँचें')}</button>
  {error&&<p role="alert">{error}</p>}
  {result&&<div className="photo-quality-result" role="status">
   <strong>{result.status==='ready_for_scouting'?<CheckCircle2 size={17}/>:<AlertTriangle size={17}/>}
    {result.status==='ready_for_scouting'?t('Image looks clear enough for a scouting record','फ़ोटो खेत के रिकॉर्ड के लिए पर्याप्त साफ़ है'):t('Consider retaking this photo','यह फ़ोटो दोबारा लेने पर विचार करें')}</strong>
   <small>{result.width} × {result.height} px</small>
   {result.issues.length>0&&<ul>{result.issues.map(issue=><li key={issue}>{issueCopy[issue]?t(...issueCopy[issue]):issue}</li>)}</ul>}
   <p>{t('This checks image capture quality only. It does not identify disease, pests or crop health.','यह सिर्फ़ फ़ोटो की क्वालिटी जाँच है; बीमारी, कीट या फ़सल की सेहत की पहचान नहीं।')}</p>
  </div>}
 </div>;
}
