/** Date persisted in a tab-scoped scouting draft. */
export function isScoutingDraftDate(value:unknown):value is string{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const parsed=new Date(value);
 return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
}
