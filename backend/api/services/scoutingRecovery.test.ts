import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shouldRemoveFailedUploadPhoto,duplicateScoutingCleanupKey,rollbackBeforeCommit} from './scoutingRecovery.ts';

test('before commit, failed uploads remove newly written file',()=>{
 assert.equal(shouldRemoveFailedUploadPhoto(true,false),true);
 assert.equal(shouldRemoveFailedUploadPhoto(false,false),false);
});
test('attempted commit always preserves file until a DB reconciliation',()=>{
 assert.equal(shouldRemoveFailedUploadPhoto(true,true),false);
 assert.equal(shouldRemoveFailedUploadPhoto(false,true),false);
});
test('cleanup accepts only generated JPEG storage keys',()=>{
 assert.equal(duplicateScoutingCleanupKey('00000000-0000-0000-0000-000000000001.jpg'),'00000000-0000-0000-0000-000000000001.jpg');
 assert.equal(duplicateScoutingCleanupKey('../../secret'),null);
 assert.equal(duplicateScoutingCleanupKey(undefined),null);
});

test('pre-commit transaction failure injects exactly one rollback',async()=>{
 const statements:string[]=[];
 const rolledBack=await rollbackBeforeCommit(async sql=>{statements.push(sql);return undefined;},false);
 assert.equal(rolledBack,true);
 assert.deepEqual(statements,['rollback']);
});
test('uncertain commit outcome never attempts rollback',async()=>{
 const statements:string[]=[];
 const rolledBack=await rollbackBeforeCommit(async sql=>{statements.push(sql);return undefined;},true);
 assert.equal(rolledBack,false);
 assert.deepEqual(statements,[]);
});
test('failed rollback is reported without hiding original transaction outcome',async()=>{
 const errors:unknown[]=[];
 const failure=new Error('injected rollback failure');
 const result=await rollbackBeforeCommit(async()=>{throw failure;},false,error=>errors.push(error));
 assert.equal(result,false);
 assert.deepEqual(errors,[failure]);
});
