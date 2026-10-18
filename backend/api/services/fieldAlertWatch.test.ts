import test from 'node:test';
import assert from 'node:assert/strict';
import {pendingWatchNotices,unseenWatchNotices} from '../../../frontend/src/lib/fieldAlertWatch.ts';

test('only open unresolved satellite alerts and overdue visits appear',()=>{
 const alerts=[{id:'a',title:'Inspect imagery',action_status:'open',resolved:false},
 {id:'b',title:'Already seen',action_status:'acknowledged',resolved:false},
 {id:'c',title:'Closed',action_status:'open',resolved:true}] as Parameters<typeof pendingWatchNotices>[2];
 const tasks=[{id:'d',title:'Inspect field',status:'open',due_on:'2026-10-18'},
 {id:'e',title:'Future visit',status:'open',due_on:'2026-10-30'},
 {id:'f',title:'Done',status:'resolved',due_on:'2026-10-17'}] as Parameters<typeof pendingWatchNotices>[3];
 const notices=pendingWatchNotices('field1','North field',alerts,tasks,'2026-10-19');
 assert.equal(notices.length,2);
 assert.deepEqual(notices.map(item=>item.key),['alert:field1:a','visit:field1:d']);
 assert.deepEqual(unseenWatchNotices(notices,new Set(['alert:field1:a'])).map(n=>n.key),['visit:field1:d']);
});
test('notifications are scoped to field and action type',()=>{
 const one=pendingWatchNotices('one','One',[{id:'x',title:'Risk',action_status:'open',resolved:false} as Parameters<typeof pendingWatchNotices>[2][number]],[], '2026-10-19');
 const two=pendingWatchNotices('two','Two',[{id:'x',title:'Risk',action_status:'open',resolved:false} as Alert],[], '2026-10-19');
 assert.notEqual(one[0]?.key,two[0]?.key);
});
