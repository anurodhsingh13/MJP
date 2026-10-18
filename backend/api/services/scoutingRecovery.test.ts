import {test} from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {shouldRemoveFailedUploadPhoto,duplicateScoutingCleanupKey,rollbackBeforeCommit,reconcileScoutingCommit,storedJpegReadable,jpegDimensions,jpegHasScan,storedJpegDecodes} from './scoutingRecovery.ts';

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
  const jpeg=Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAADAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDkKKKK908U/9k=','base64');
  await writeFile(join(root,key),jpeg);
  assert.deepEqual(jpegDimensions(jpeg),{width:2,height:3});
  assert.equal(jpegHasScan(jpeg),true);
  const scanOffset=jpeg.indexOf(Buffer.from([255,218]));
  assert.ok(scanOffset>0);
  const scanLength=jpeg.readUInt16BE(scanOffset+2);
  const emptyScan=Buffer.concat([jpeg.subarray(0,scanOffset+2+scanLength),Buffer.from([255,217])]);
  assert.equal(jpegHasScan(emptyScan),false);
  const malformedScan=Buffer.from(jpeg);
  malformedScan[scanOffset+2]=255;
  malformedScan[scanOffset+3]=255;
  assert.equal(jpegHasScan(malformedScan),false);
  assert.equal(await storedJpegReadable(root,key),true);
  assert.equal(await storedJpegReadable(root,key),true);
  assert.equal(await storedJpegReadable(root,key,2,3),true);
  assert.equal(await storedJpegReadable(root,key,0,3),false);
  assert.equal(await storedJpegReadable(root,key,2,-1),false);
  assert.equal(await storedJpegReadable(root,key,10001,3),false);
  assert.equal(await storedJpegReadable(root,key,3,2),false);
  assert.equal(jpegDimensions(Buffer.from([255,216,255,217])),null);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('Pillow-backed recovery rejects corrupt JPEG, decoder outage and wrong dimensions',async()=>{
 const root=await mkdtemp(join(tmpdir(),'scouting-decoder-'));
 const key='00000000-0000-0000-0000-000000000001.jpg';
 const originalFetch=globalThis.fetch;
 try{
  await writeFile(join(root,key),Buffer.from([255,216,1,2,3,255,217]));
  globalThis.fetch=(async()=>new Response(JSON.stringify({width:2,height:3,image:'sanitized-jpeg'}),{status:200,headers:{'Content-Type':'application/json'}})) as typeof fetch;
  assert.equal(await storedJpegDecodes(root,key,2,3,'http://localhost:8000'),true);
  assert.equal(await storedJpegDecodes(root,key,3,2,'http://localhost:8000'),false);
  globalThis.fetch=(async()=>new Response(JSON.stringify({width:2,height:3}),{status:200,headers:{'Content-Type':'application/json'}})) as typeof fetch;
  assert.equal(await storedJpegDecodes(root,key,2,3,'http://localhost:8000'),false);
  assert.equal(await storedJpegDecodes(root,key,0,3,'http://localhost:8000'),false);
  globalThis.fetch=(async()=>new Response('unreadable',{status:422})) as typeof fetch;
  assert.equal(await storedJpegDecodes(root,key,2,3,'http://localhost:8000'),false);
  globalThis.fetch=(async()=>{throw new Error('engine offline');}) as typeof fetch;
  assert.equal(await storedJpegDecodes(root,key,2,3,'http://localhost:8000'),false);
 }finally{globalThis.fetch=originalFetch;await rm(root,{recursive:true,force:true});}
});
