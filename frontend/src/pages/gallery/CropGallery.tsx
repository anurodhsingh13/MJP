import { Link } from 'react-router-dom';
import { cropPhotos } from '../../lib/cropPhotos';
import { usePreferences } from '../../lib/preferencesContext';
const photos=[
 {key:'wheat',title:'Wheat field',hindi:'गेहूँ का खेत',kind:'crop'},
 {key:'rice',title:'Rice seedlings',hindi:'धान के पौधे',kind:'crop'},
 {key:'paddy',title:'Paddy landscape',hindi:'धान का खेत',kind:'crop'},
 {key:'harvest',title:'Ripening crops',hindi:'पकती फ़सल',kind:'crop'},
 {key:'satellite',title:'Satellite NDVI mosaic',hindi:'सैटेलाइट NDVI तस्वीर',kind:'satellite'},
] as const;
export function CropGallery(){
 const {t}=usePreferences();
 return <main className="dashboard-shell crop-gallery">
  <Link className="back-link" to="/">← {t('Back to fields','खेतों पर वापस')}</Link>
  <header><span className="eyebrow">{t('VISUAL EXAMPLES','तस्वीरों के उदाहरण')}</span><h1>{t('Crop & satellite image gallery','फ़सल और सैटेलाइट तस्वीरें')}</h1><p>{t('Explore photos and an NDVI illustration. These reference images are not pictures of your saved fields.','फ़सल की फ़ोटो और NDVI उदाहरण देखें। ये आपके सेव किए खेतों की तस्वीरें नहीं हैं।')}</p></header>
  <div className="crop-gallery-grid">{photos.map(item=>{
   const photo=cropPhotos[item.key];
   return <article className="crop-gallery-card" key={item.key}>
    <a href={photo.source} target="_blank" rel="noreferrer" aria-label={t('Open original source','मूल स्रोत खोलें')+': '+item.title}><img src={photo.src} alt={photo.alt} loading="lazy" onError={event => { event.currentTarget.style.display='none'; }}/></a>
    <div><small>{item.kind==='crop'?t('Crop photograph','फ़सल तस्वीर'):t('Vegetation index example','वनस्पति सूचकांक उदाहरण')}</small><h2>{t(item.title,item.hindi)}</h2><a href={photo.source} target="_blank" rel="noreferrer">{t('Image source ↗','तस्वीर का स्रोत ↗')}</a></div>
   </article>;
  })}</div>
 </main>;
}
