import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Request,Response} from 'express';
import {saveScouting} from './scoutingController.ts';

test('scouting rejects unsupported inspection labels before accessing storage or the database',async()=>{
 for(const invalid of [
  {observation_category:'disease_diagnosis',growth_stage:'vegetative',severity:'moderate'},
  {observation_category:'visual_symptom',growth_stage:'fruiting-outside-list',severity:'moderate'},
  {observation_category:'visual_symptom',growth_stage:'vegetative',severity:'extreme'},
 ]){
  let status=200;
  let payload:unknown;
  await saveScouting({
   params:{fieldId:'00000000-0000-0000-0000-000000000001'},
   body:{client_key:'00000000-0000-0000-0000-000000000002',observed_on:'2026-10-15',...invalid},
  } as unknown as Request,{
   status(code:number){status=code;return this;},
   json(value:unknown){payload=value;},
  } as unknown as Response);
  assert.equal(status,400);
  assert.deepEqual(payload,{error:'Choose a supported observation category, growth stage and severity'});
 }
});
