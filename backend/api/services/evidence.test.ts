import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessEvidence,comparablePair,cropDatesOutdated,qualityReason,seasonStage,validNdviClasses,vegetationScore, type Observation} from '../../../shared/evidence.ts';
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

test('images from different Sentinel-2 tiles or too far apart are not compared',()=>{
 const current={...observation,ndvi_value:.4,tile_id:'43RGK'};
 const previous={...observation,observed_on:'2026-10-05',acquired_at:'2026-10-05T10:00:00Z',tile_id:'43RGK'};
 assert.equal(assessEvidence(current,previous,undefined,now).state,'needs_inspection');
 // Same pass, overlapping tile: separately corrected reflectance must not create a "decline".
 assert.equal(assessEvidence(current,{...previous,tile_id:'43RGL'},undefined,now).change,null);
 // Legacy rows without a tile remain comparable.
 assert.equal(assessEvidence(current,{...previous,tile_id:null},undefined,now).change,-.3);
 const old={...previous,observed_on:'2026-08-20',acquired_at:'2026-08-20T10:00:00Z'};
 const far=assessEvidence(current,old,undefined,now);
 assert.equal(far.change,null);
 assert.equal(far.state,'not_enough_data');
 assert.match(far.explanation,/too far apart/);
});
test('the comparable pair skips other tiles and keeps the most recent fair comparison',()=>{
 const latest={...observation,observed_on:'2026-10-12',tile_id:'43RGK'};
 const otherTile={...observation,observed_on:'2026-10-11',acquired_at:'2026-10-11T10:00:00Z',tile_id:'43RGL'};
 const sameTile={...observation,observed_on:'2026-10-07',acquired_at:'2026-10-07T10:00:00Z',tile_id:'43RGK'};
 const [first,second]=comparablePair([otherTile,sameTile,latest]);
 assert.equal(first?.observed_on,'2026-10-12');
 assert.equal(second?.observed_on,'2026-10-07');
 assert.deepEqual(comparablePair([]),[null,null]);
});
test('crop stage comes only from current-season dates',()=>{
 const season={plantingDate:'2025-11-10',harvestDate:'2026-04-10'};
 assert.equal(seasonStage(season,'2025-11-25'),'establishment');
 assert.equal(seasonStage(season,'2026-01-20'),'growing');
 assert.equal(seasonStage(season,'2026-03-25'),'maturity');
 assert.equal(seasonStage(season,'2026-04-30'),'after_harvest');
 // Dates from an old season never explain today's image.
 assert.equal(seasonStage(season,'2026-10-12'),'unknown');
 assert.equal(seasonStage({plantingDate:'2026-04-01',harvestDate:'2026-03-01'},'2026-03-20'),'unknown');
 assert.equal(seasonStage(null,'2026-03-20'),'unknown');
});
test('a decline near the recorded harvest is reported as expected, not as an inspection signal',()=>{
 const current={...observation,ndvi_value:.35};
 const previous={...observation,observed_on:'2026-10-02',acquired_at:'2026-10-02T10:00:00Z'};
 const ripening=assessEvidence(current,previous,undefined,now,{plantingDate:'2026-06-20',harvestDate:'2026-10-30'});
 assert.equal(ripening.state,'no_unusual_change');
 assert.equal(ripening.expectedDecline,true);
 assert.equal(ripening.stage,'maturity');
 const midSeason=assessEvidence(current,previous,undefined,now,{plantingDate:'2026-08-01',harvestDate:'2026-12-30'});
 assert.equal(midSeason.state,'needs_inspection');
 assert.equal(midSeason.expectedDecline,undefined);
});
test('NDVI zone shares must be four valid percentages',()=>{
 assert.deepEqual(validNdviClasses({bare:10,low:20,moderate:30,high:40}),{bare:10,low:20,moderate:30,high:40});
 assert.equal(validNdviClasses({bare:10,low:20,moderate:30,high:10}),null);
 assert.equal(validNdviClasses({bare:-1,low:21,moderate:40,high:40}),null);
 assert.equal(validNdviClasses(null),null);
});

test('crop dates from an old season are flagged, so a harvest drop is not presented as plain crop stress',()=>{
 const current={...observation,ndvi_value:.35};
 const previous={...observation,observed_on:'2026-10-02',acquired_at:'2026-10-02T10:00:00Z'};
 const old=assessEvidence(current,previous,undefined,now,{plantingDate:'2023-06-11',harvestDate:'2023-12-11'});
 assert.equal(old.state,'needs_inspection');
 assert.equal(old.datesOutdated,true);
 assert.match(old.explanation,/Update the crop dates/);
 const none=assessEvidence(current,previous,undefined,now,null);
 assert.equal(none.datesOutdated,undefined);
 const fresh=assessEvidence(current,previous,undefined,now,{plantingDate:'2026-08-01',harvestDate:'2026-12-30'});
 assert.equal(fresh.datesOutdated,undefined);
 assert.equal(cropDatesOutdated({harvestDate:'2027-03-01'},'2026-10-12'),false);
 assert.equal(cropDatesOutdated({plantingDate:'2026-05-01',harvestDate:'2026-04-01'},'2026-10-12'),true);
 assert.equal(cropDatesOutdated({plantingDate:'2026-01-01'},'2026-10-12'),true);
});
