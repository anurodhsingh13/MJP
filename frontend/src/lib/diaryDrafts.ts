/** Device-local field diary drafts. Never store images, credentials, or synced records. */
export type DiaryDraft={id:string;fieldId:string;eventType:string;eventDate:string;notes:string;savedAt:string};
const prefix='terrascope:diary-drafts:v1:';
const valid=(value:unknown):value is DiaryDraft=>{
 if(!value||typeof value!=='object')return false;
 const d=value as Record<string,unknown>;
 return typeof d.id==='string'&&/^[0-9a-f-]{36}$/i.test(d.id)&&typeof d.fieldId==='string'&&/^[0-9a-f-]{36}$/i.test(d.fieldId)
  &&typeof d.eventType==='string'&&['planting','fertilizer','irrigation','pesticide','scouting','harvest','other'].includes(d.eventType)
  &&typeof d.eventDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d.eventDate)
  &&typeof d.notes==='string'&&d.notes.length<=4000&&typeof d.savedAt==='string';
};
export function readDiaryDrafts(fieldId:string):DiaryDraft[]{
 try{const value=JSON.parse(localStorage.getItem(prefix+fieldId)||'[]') as unknown;
  return Array.isArray(value)?value.filter(valid).filter(item=>item.fieldId===fieldId).slice(0,30):[];
 }catch{return [];}
}
export function writeDiaryDrafts(fieldId:string,drafts:DiaryDraft[]):boolean{
 try{localStorage.setItem(prefix+fieldId,JSON.stringify(drafts.filter(valid).filter(draft=>draft.fieldId===fieldId).slice(0,30)));return true;}
 catch{return false;}
}
export function eraseDiaryDrafts(fieldId:string):boolean{
 try{localStorage.removeItem(prefix+fieldId);return true;}catch{return false;}
}
