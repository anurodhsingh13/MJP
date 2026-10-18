import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isScoutingDraftDate} from '../../../frontend/src/features/fields/scoutingDraft.ts';

test('restores valid scouting calendar dates saved before refresh',()=>{
 assert.equal(isScoutingDraftDate('2026-10-19'),true);
 assert.equal(isScoutingDraftDate('2026-02-28'),true);
});
test('rejects malformed, escaped and nonexistent saved dates',()=>{
 for(const value of ['2026-02-30','2026-13-01','2026-1-1','\\d{4}-10-19',null,42])assert.equal(isScoutingDraftDate(value),false);
});
