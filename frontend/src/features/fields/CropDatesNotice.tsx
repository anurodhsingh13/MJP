import {cropDatesStatus} from '../../../../shared/evidence';
import type {DatabaseField} from '../../lib/api';
import {usePreferences} from '../../lib/preferencesContext';
import './crop-dates-notice.css';

/** Shown on the field Overview while the saved sowing / harvest dates are missing or belong to another season: the advice depends on them. */
export function CropDatesNotice({field,onEdit}:{field:DatabaseField;onEdit?:()=>void}){
 const {t}=usePreferences();
 const status=cropDatesStatus({plantingDate:field.planting_date,harvestDate:field.harvest_date});
 if(status==='ok')return null;
 const missing=status==='missing';
 return <section className={`crop-dates-notice ${status}`} aria-label={t('Sowing and harvest dates','बुवाई और कटाई की तारीख़ें')}>
  <div>
   <strong>{missing?t('Add your sowing and harvest dates','अपनी बुवाई और कटाई की तारीख़ें जोड़ें'):t('Your sowing and harvest dates are not for this season','आपकी बुवाई और कटाई की तारीख़ें इस मौसम की नहीं हैं')}</strong>
   <p>{missing
    ?t('The advice depends on them. Without dates we cannot tell a ripening or harvested crop from a stressed one. An approximate date is fine.','सलाह इन्हीं पर निर्भर है। बिना तारीख़ के पकती या कटी फ़सल और तनाव वाली फ़सल में फ़र्क़ नहीं कर पाते। अंदाज़ी तारीख़ भी चलेगी।')
    :t('Old dates make ripening or harvest look like crop stress. Update them for the crop you are growing now.','पुरानी तारीख़ों से पकना या कटाई फ़सल के तनाव जैसी दिख सकती है। अभी उगाई जा रही फ़सल की तारीख़ें डालें।')}</p>
  </div>
  {onEdit&&<button type="button" onClick={onEdit}>{t('Update dates','तारीख़ें बदलें')}</button>}
 </section>;
}
