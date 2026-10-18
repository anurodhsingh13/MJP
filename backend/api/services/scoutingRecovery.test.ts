import {test} from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {shouldRemoveFailedUploadPhoto,duplicateScoutingCleanupKey,rollbackBeforeCommit,reconcileScoutingCommit,storedJpegReadable} from './scoutingRecovery.ts';

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

test('uncertain commit is confirmed only when read-back finds the record',async()=>{
 const record={id:'case-1',photos:[{id:'photo-1'}]};
 assert.deepEqual(await reconcileScoutingCommit(async()=>record),{status:'committed',value:record});
 assert.deepEqual(await reconcileScoutingCommit(async()=>null),{status:'unknown'});
});
test('database outage during reconciliation remains unknown',async()=>{
 assert.deepEqual(await reconcileScoutingCommit(async()=>{throw new Error('connection lost');}),{status:'unknown'});
});

test('commit recovery requires photo evidence and rejects incomplete cases',async()=>{
 const complete=(value:{id:string;photos:Array<{id:string}>})=>value.photos.some(photo=>typeof photo.id==='string');
 const missing={id:'case-2',photos:[] as Array<{id:string}>};
 assert.deepEqual(await reconcileScoutingCommit(async()=>missing,complete),{status:'unknown'});
 const present={id:'case-2',photos:[{id:'photo-2'}]};
 assert.deepEqual(await reconcileScoutingCommit(async()=>present,complete),{status:'committed',value:present});
});

test('recovered JPEG must exist and have valid JPEG boundary bytes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'scouting-recovery-'));
 const key='00000000-0000-0000-0000-000000000001.jpg';
 try{
  assert.equal(await storedJpegReadable(root,key),false);
  assert.equal(await storedJpegReadable(root,'../invalid.jpg'),false);
  await writeFile(join(root,key),Buffer.from('not jpeg'));
  assert.equal(await storedJpegReadable(root,key),false);
  await writeFile(join(root,key),Buffer.from([255,216,255,224,0,0,255,217]));
  assert.equal(await storedJpegReadable(root,key),true);
  assert.equal(await storedJpegReadable(root,key,640,480),true);
  assert.equal(await storedJpegReadable(root,key,0,480),false);
  assert.equal(await storedJpegReadable(root,key,640,-1),false);
  assert.equal(await storedJpegReadable(root,key,10001,480),false);
 }finally{await rm(root,{recursive:true,force:true});}
});
