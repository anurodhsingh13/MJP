import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessEvidence,comparablePair,cropDatesOutdated,observationTile,qualityReason,referenceStage,resolveStage,seasonStage,validNdviClasses,validReferenceWindow,vegetationScore, type Observation} from '../../../shared/evidence.ts';
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

test('tile comes from the scene id when it was not stored, so other tiles are still not compared',()=>{
 const base={...observation,tile_id:null};
 const latest={...base,scene_id:'gee-20261118T051109_20261118T052016_T44RNP',observed_on:'2026-11-18',acquired_at:'2026-11-18T05:30:00Z'};
 const sameTile={...base,scene_id:'gee-20261024T050851_20261024T052036_T44RNP',observed_on:'2026-10-24',acquired_at:'2026-10-24T05:30:00Z'};
 const otherTile={...base,scene_id:'gee-20261103T050951_20261103T051737_T44RNQ',observed_on:'2026-11-03',acquired_at:'2026-11-03T05:30:00Z'};
 assert.equal(observationTile(latest),'44RNP');
 assert.equal(observationTile({tile_id:'43RGK',scene_id:'x'}),'43RGK');
 assert.equal(observationTile({tile_id:null,scene_id:'es-S2B_43RGK_20261111_0_L2A'}),'43RGK');
 assert.equal(observationTile({tile_id:null,scene_id:'unknown'}),null);
 const [,previous]=comparablePair([latest,otherTile,sameTile]);
 assert.equal(previous?.observed_on,'2026-10-24');
 assert.equal(comparablePair([latest,otherTile])[1],null);
});
const riceWindow={plantingStartMonth:7,plantingEndMonth:8,harvestStartMonth:11,harvestEndMonth:12};
const wheatWindow={plantingStartMonth:10,plantingEndMonth:11,harvestStartMonth:4,harvestEndMonth:5};
test('a regional window places an image in the crop season',()=>{
 assert.equal(referenceStage(riceWindow,'2026-04-01'),'unknown');
 assert.equal(referenceStage(riceWindow,'2026-06-21'),'before_sowing');
 assert.equal(referenceStage(riceWindow,'2026-07-26'),'establishment');
 assert.equal(referenceStage(riceWindow,'2026-09-10'),'establishment');
 assert.equal(referenceStage(riceWindow,'2026-10-20'),'maturity');
 assert.equal(referenceStage(riceWindow,'2026-11-13'),'maturity');
 assert.equal(referenceStage(riceWindow,'2027-01-10'),'after_harvest');
 assert.equal(referenceStage(riceWindow,'2027-03-01'),'unknown');
 // A window that crosses the new year: wheat sown Oct-Nov, harvested Apr-May of the next year.
 assert.equal(referenceStage(wheatWindow,'2026-11-20'),'establishment');
 assert.equal(referenceStage(wheatWindow,'2027-01-15'),'growing');
 assert.equal(referenceStage(wheatWindow,'2027-03-10'),'maturity');
 assert.equal(referenceStage(wheatWindow,'2027-06-10'),'after_harvest');
 assert.equal(referenceStage({plantingStartMonth:12,plantingEndMonth:1,harvestStartMonth:5,harvestEndMonth:6},'2026-01-15'),'establishment');
 assert.equal(referenceStage({plantingStartMonth:12,plantingEndMonth:1,harvestStartMonth:5,harvestEndMonth:6},'2026-05-10'),'maturity');
});
test('a bad or missing regional window never produces a stage',()=>{
 assert.equal(referenceStage(null,'2026-10-12'),'unknown');
 assert.equal(referenceStage(undefined,'2026-10-12'),'unknown');
 assert.equal(referenceStage({...riceWindow,harvestEndMonth:13},'2026-10-12'),'unknown');
 assert.equal(referenceStage({...riceWindow,plantingStartMonth:0},'2026-10-12'),'unknown');
 assert.equal(referenceStage(riceWindow,'not a date'),'unknown');
 assert.equal(validReferenceWindow({...riceWindow,plantingEndMonth:2.5}),false);
 assert.equal(validReferenceWindow(riceWindow),true);
});
test("the farmer's own dates win; the regional window fills in only when they cannot place the image",()=>{
 const own={plantingDate:'2026-08-01',harvestDate:'2026-12-30'};
 assert.deepEqual(resolveStage(own,riceWindow,'2026-10-12'),{stage:'growing',source:'saved_dates'});
 const old={plantingDate:'2023-06-11',harvestDate:'2023-12-11'};
 assert.deepEqual(resolveStage(old,riceWindow,'2026-10-12'),{stage:'maturity',source:'regional_reference'});
 assert.deepEqual(resolveStage(null,riceWindow,'2026-10-12'),{stage:'maturity',source:'regional_reference'});
 assert.deepEqual(resolveStage(old,null,'2026-10-12'),{stage:'unknown',source:'saved_dates'});
 assert.deepEqual(resolveStage(old,riceWindow,'2027-03-01'),{stage:'unknown',source:'saved_dates'});
});
test('a drop in the regional harvest window is explained as a regional estimate; a drop outside it is still flagged',()=>{
 const current={...observation,ndvi_value:.35};
 const previous={...observation,observed_on:'2026-10-02',acquired_at:'2026-10-02T10:00:00Z'};
 const old={plantingDate:'2023-06-11',harvestDate:'2023-12-11'};
 const rice=assessEvidence(current,previous,undefined,now,old,riceWindow);
 assert.equal(rice.state,'no_unusual_change');
 assert.equal(rice.expectedDecline,true);
 assert.equal(rice.stage,'maturity');
 assert.equal(rice.stageSource,'regional_reference');
 assert.equal(rice.datesOutdated,true);
 assert.match(rice.explanation,/regional estimate/);
 // The same curve in a wheat calendar is not a harvest: it stays an inspection signal.
 const wheat=assessEvidence(current,previous,undefined,now,old,wheatWindow);
 assert.equal(wheat.state,'needs_inspection');
 assert.equal(wheat.expectedDecline,undefined);
 assert.equal(wheat.stageSource,'regional_reference');
 // Without any reference nothing changes from before.
 const none=assessEvidence(current,previous,undefined,now,old);
 assert.equal(none.state,'needs_inspection');
 assert.equal(none.stage,'unknown');
 assert.equal(none.stageSource,undefined);
 // In-season saved dates still decide and are reported as the farmer's own.
 const own=assessEvidence(current,previous,undefined,now,{plantingDate:'2026-08-01',harvestDate:'2026-12-30'},riceWindow);
 assert.equal(own.stageSource,'saved_dates');
 assert.equal(own.stage,'growing');
});
