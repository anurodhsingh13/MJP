import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessEvidence,type Observation} from '../../../shared/evidence.ts';

type Scenario={key:string;name:string;latestNdvi:number|null;previousNdvi:number|null;coverage:number|null;pixels:number|null;latestDaysAgo:number|null;previousDaysAgo:number|null;expectedState:string};
const fixture=JSON.parse(readFileSync(new URL('../../../tests/fixtures/extended-farmer-scenarios.json',import.meta.url),'utf8')) as {dataset:string;warning:string;referenceTime:string;scenarios:Scenario[]};
const now=Date.parse(fixture.referenceTime);
const day=(n:number)=>new Date(now-n*86400000).toISOString().slice(0,10);
function make(s:Scenario,kind:'latest'|'previous'):Observation|null {
 const days=kind==='latest'?s.latestDaysAgo:s.previousDaysAgo,value=kind==='latest'?s.latestNdvi:s.previousNdvi;
 if(days===null||value===null)return null;
 return {scene_id:`SYNTHETIC-${s.key}-${kind}`,observed_on:day(days),acquired_at:new Date(now-days*86400000).toISOString(),
 ndvi_value:value,cloud_cover:0,valid_coverage_percent:s.coverage,valid_pixel_count:s.pixels,
 source:'SYNTHETIC UNIT TEST',provenance:'measured_imagery',accepted:true,
 boundary_version:kind==='previous'&&s.key==='boundary-changed'?1:2,
 calculation_version:kind==='previous'&&s.key==='method-changed'?'older-algorithm':'fixture-v1'};
}
test('fictional scenarios have explicit identity and cannot be mistaken for live data',()=>{
 assert.match(fixture.warning,/FICTIONAL/);
 assert.equal(fixture.scenarios.length,15);
 assert.equal(new Set(fixture.scenarios.map(s=>s.key)).size,15);
});
for(const scenario of fixture.scenarios){
 test(`synthetic decision case: ${scenario.key}`,()=>{
  const actual=assessEvidence(make(scenario,'latest'),make(scenario,'previous'),undefined,now);
  assert.equal(actual.state,scenario.expectedState,`${scenario.key}: ${actual.explanation}`);
  if(['awaiting_analysis','not_enough_data','image_too_old'].includes(actual.state))assert.notEqual(actual.title,'No unusual change detected');
  assert.ok(actual.nextAction.length>0);
 });
}
