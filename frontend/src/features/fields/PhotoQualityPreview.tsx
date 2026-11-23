import {useEffect,useState} from 'react';
import {Camera,CheckCircle2,AlertTriangle,Leaf} from 'lucide-react';
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
type LeafCheck={status:'answered'|'not_sure'|'photo_quality'|'unavailable';label:string|null;confidence:number|null;probabilities:Record<string,number>|null;issues:string[];suggestions:string[];disclaimer:string|null};
const leafNames:Record<string,[string,string]>={'Healthy':['Healthy','स्वस्थ'],'Early Blight':['Early blight','अर्ली ब्लाइट'],'Late Blight':['Late blight','लेट ब्लाइट']};
export function PhotoQualityPreview({fieldId,file}:{fieldId:string;file:File|null}){
 const {t}=usePreferences();
 const [busy,setBusy]=useState(false);
 const [result,setResult]=useState<Assessment|null>(null);
 const [error,setError]=useState('');
 const [leaf,setLeaf]=useState<LeafCheck|null>(null);
 const [leafBusy,setLeafBusy]=useState(false);
 const [leafError,setLeafError]=useState('');
 useEffect(()=>{setResult(null);setError('');setLeaf(null);setLeafError('');},[fieldId,file]);
 async function checkLeaf(){
  if(!file||leafBusy)return;
  if(file.size>5*1024*1024||!['image/jpeg','image/png','image/webp'].includes(file.type)){
   setLeafError(t('Choose a JPEG, PNG or WebP smaller than 5 MB.','5 MB से छोटी JPEG, PNG या WebP फ़ोटो चुनें।'));return;
  }
  setLeafBusy(true);setLeafError('');setLeaf(null);
  try{
   const image=await new Promise<string>((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>typeof reader.result==='string'?resolve(reader.result):reject(new Error('Invalid photo'));
    reader.onerror=()=>reject(new Error('File read failed'));reader.readAsDataURL(file);
   });
   const response=await fetch('/api/fields/'+encodeURIComponent(fieldId)+'/scouting/leaf-check',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image})
   });
   if(!response.ok)throw new Error('Leaf check failed');
   const data=await response.json() as LeafCheck;
   if(!['answered','not_sure','photo_quality','unavailable'].includes(data.status))throw new Error('Unexpected response');
   setLeaf(data);
  }catch{setLeafError(t('Unable to run the leaf check. You can still save your scouting note.','पत्ती जाँच नहीं हो सकी। आप अपना नोट फिर भी सेव कर सकते हैं।'));}
  finally{setLeafBusy(false);}
 }
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
  <button type="button" className="leaf-check-button" onClick={()=>void checkLeaf()} disabled={leafBusy}><Leaf size={16}/>{leafBusy?t('Checking leaf…','पत्ती जाँच रहे हैं…'):t('Experimental: check potato leaf','प्रयोगात्मक: आलू की पत्ती जाँचें')}</button>
  {leafError&&<p role="alert">{leafError}</p>}
  {leaf&&<div className="photo-quality-result" role="status">
   {leaf.status==='unavailable'&&<strong><AlertTriangle size={17}/>{t('The leaf model is not installed on this server.','यह मॉडल इस सर्वर पर उपलब्ध नहीं है।')}</strong>}
   {leaf.status==='photo_quality'&&<><strong><AlertTriangle size={17}/>{t('Photo not suitable for the leaf check. Retake it.','यह फ़ोटो पत्ती जाँच के लिए उपयुक्त नहीं है। दोबारा लें।')}</strong>
    {leaf.issues.length>0&&<ul>{leaf.issues.map(issue=><li key={issue}>{issueCopy[issue]?t(...issueCopy[issue]):issue}</li>)}</ul>}</>}
   {leaf.status==='not_sure'&&<strong><AlertTriangle size={17}/>{t('Not sure. Retake a close, clear photo of one leaf, or ask an agronomist.','पक्का नहीं। एक पत्ती की पास से साफ़ फ़ोटो दोबारा लें, या कृषि विशेषज्ञ से पूछें।')}</strong>}
   {leaf.status==='answered'&&leaf.label&&<><strong>{leaf.label==='Healthy'?<CheckCircle2 size={17}/>:<AlertTriangle size={17}/>}
    {t('Model suggests: ','मॉडल का अनुमान: ')}{t(...(leafNames[leaf.label]??[leaf.label,leaf.label]))}</strong>
    {leaf.probabilities&&<small>{Object.entries(leaf.probabilities).map(([name,p])=>t(...(leafNames[name]??[name,name]))+' '+Math.round(p*100)+'%').join(' · ')}</small>}</>}
   {leaf.status!=='unavailable'&&<p>{t('Experimental. Trained on public potato leaf photos from Uttar Pradesh and not yet tested on field photos from this app. It is not a diagnosis. Confirm symptoms in the field with an agronomist before any treatment.','प्रयोगात्मक। उत्तर प्रदेश की सार्वजनिक आलू-पत्ती फ़ोटो पर प्रशिक्षित, इस ऐप की खेत की फ़ोटो पर अभी परखा नहीं गया। यह निदान नहीं है। इलाज से पहले खेत में कृषि विशेषज्ञ से पुष्टि करें।')}</p>}
  </div>}
 </div>;
}
