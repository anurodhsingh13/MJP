import type {Alert,FieldTask} from './api';
export type WatchNotice={key:string;field:string;title:string;kind:'alert'|'visit'};
export function pendingWatchNotices(fieldId:string,fieldName:string,alerts:Alert[],tasks:FieldTask[],today:string):WatchNotice[]{
 const warnings=alerts.filter(item=>!item.resolved&&item.action_status==='open'&&typeof item.id==='string')
  .map(item=>({key:'alert:'+fieldId+':'+item.id,field:fieldName,title:item.title,kind:'alert' as const}));
 const due=tasks.filter(item=>item.status==='open'&&typeof item.due_on==='string'&&item.due_on.length===10&&item.due_on<=today)
  .map(item=>({key:'visit:'+fieldId+':'+item.id,field:fieldName,title:item.title,kind:'visit' as const}));
 return [...warnings,...due];
}
export function unseenWatchNotices(all:WatchNotice[],seen:ReadonlySet<string>){
 return all.filter(item=>!seen.has(item.key));
}
