import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shouldRemoveFailedUploadPhoto,duplicateScoutingCleanupKey} from './scoutingRecovery.ts';

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
