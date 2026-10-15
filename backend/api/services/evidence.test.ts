import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessEvidence,qualityReason,vegetationScore, type Observation} from '../../../shared/evidence.ts';
const now=Date.parse('2026-10-15T12:00:00Z');
const observation:Observation={scene_id:'test',observed_on:'2026-10-12',acquired_at:'2026-10-12T10:00:00Z',ndvi_value:.7,ndmi_value:.3,cloud_cover:0,valid_coverage_percent:90,valid_pixel_count:500,source:'Sentinel-2',provenance:'measured_imagery',boundary_version:1,accepted:true,calculation_version:'v2'};
test('quality and crop score are separate even for identical measurements',()=>{
 assert.equal(vegetationScore(.7,.3),81);
 assert.equal(qualityReason({...observation,valid_coverage_percent:20}),'Not enough usable field pixels');
 assert.equal(qualityReason(observation),null);
 assert.equal(assessEvidence({...observation,valid_coverage_percent:20},null,undefined,now).state,'not_enough_data');
});
test('missing, stale, unverified and one-image evidence never imply a healthy crop',()=>{
 assert.equal(assessEvidence(null,null,undefined,now).state,'awaiting_analysis');
 assert.equal(assessEvidence({...observation,provenance:'legacy_unverified'},null,undefined,now).state,'not_enough_data');
 assert.equal(assessEvidence({...observation,observed_on:'2026-08-01',acquired_at:null},null,undefined,now).state,'image_too_old');
 assert.equal(assessEvidence(observation,null,undefined,now).state,'not_enough_data');
 assert.equal(assessEvidence({...observation,valid_coverage_percent:null},null,undefined,now).state,'not_enough_data');
});
test('zero is a real measurement; change requires comparable boundary, method and earlier day',()=>{
 const current={...observation,ndvi_value:0};
 const previous={...observation,observed_on:'2026-10-01',acquired_at:'2026-10-01T10:00:00Z'};
 assert.equal(assessEvidence(current,previous,undefined,now).change,-.7);
 assert.equal(assessEvidence(current,previous,undefined,now).state,'needs_inspection');
 assert.equal(assessEvidence(current,{...previous,boundary_version:2},undefined,now).change,null);
 assert.equal(assessEvidence(current,{...previous,calculation_version:'v1'},undefined,now).change,null);
 assert.equal(assessEvidence(current,current,undefined,now).change,null);
});
