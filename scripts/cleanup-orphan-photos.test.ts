import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isCandidate} from './cleanup-orphan-photos.ts';

test('only old UUID JPEG files qualify for the orphan audit',()=>{
 const valid='00000000-0000-0000-0000-000000000001.jpg';
 const week=7*24*60*60*1000;
 assert.equal(isCandidate(valid,week,week),true);
 assert.equal(isCandidate(valid,week-1,week),false);
 assert.equal(isCandidate('../'+valid,week,week),false);
 assert.equal(isCandidate('file.png',week,week),false);
 assert.equal(isCandidate(valid,Number.NaN,week),false);
});
