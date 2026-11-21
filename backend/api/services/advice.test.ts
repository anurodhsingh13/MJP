import test from 'node:test';
import assert from 'node:assert/strict';
import { decideVisit } from '../../../shared/advice.ts';
import type { Assessment } from '../../../shared/evidence.ts';
import { parseCropAdvice } from './ai/geminiProvider.ts';

const base: Assessment = { state: 'no_unusual_change', title: '', explanation: '', nextAction: '', ageDays: 3, change: 0, comparableObservations: 2, stage: 'growing' };

test('NDVI drop means visit within 3 days', () => {
  const result = decideVisit({ assessment: { ...base, state: 'needs_inspection', change: -0.15 }, latestNdvi: 0.45 });
  assert.deepEqual([result.visit, result.when, result.reasons], ['yes', 'within_3_days', ['ndvi_drop']]);
});
test('low NDVI on a growing crop means visit this week; seasonal ripening does not', () => {
  assert.equal(decideVisit({ assessment: base, latestNdvi: 0.22 }).when, 'this_week');
  assert.equal(decideVisit({ assessment: { ...base, stage: 'maturity', expectedDecline: true }, latestNdvi: 0.22 }).visit, 'no');
  assert.equal(decideVisit({ assessment: { ...base, stage: 'establishment' }, latestNdvi: 0.22 }).visit, 'no');
});
test('healthy NDVI needs no urgent visit', () => {
  const result = decideVisit({ assessment: base, latestNdvi: 0.62, photoUrgency: 'monitor' });
  assert.deepEqual([result.visit, result.when, result.reasons], ['no', 'routine', ['all_clear']]);
});
test('model photo urgency can raise but never lower the decision', () => {
  assert.equal(decideVisit({ assessment: base, latestNdvi: 0.62, photoUrgency: 'ask_expert' }).when, 'within_3_days');
  assert.equal(decideVisit({ assessment: base, latestNdvi: 0.62, highLikelihoodIssue: true }).when, 'this_week');
  const urgent = decideVisit({ assessment: { ...base, state: 'needs_inspection' }, latestNdvi: 0.5, photoUrgency: 'monitor' });
  assert.equal(urgent.when, 'within_3_days');
});
test('missing or old imagery asks the farmer to visit only if concerned', () => {
  for (const state of ['not_enough_data', 'image_too_old', 'awaiting_analysis'] as const) {
    const result = decideVisit({ assessment: { ...base, state }, latestNdvi: null });
    assert.deepEqual([result.visit, result.reasons], ['if_concerned', ['no_fresh_imagery']]);
  }
});
test('advice parser keeps only schema fields and ignores photo symptoms without a photo', () => {
  const raw = JSON.stringify({ summary: 'S', photo_seen: ['yellow spots'], urgency: 'check_soon', precautions: ['a', 5, 'b'], check_in_field: ['c'],
    possible_issues: [{ name: 'Leaf blight', likelihood: 'high', reason: 'r' }, { name: 'X', likelihood: 'certain', reason: 'r' }, { likelihood: 'low' }], extra: '<script>' });
  const withPhoto = parseCropAdvice(raw, true);
  assert.deepEqual(withPhoto.photoSeen, ['yellow spots']);
  assert.deepEqual(withPhoto.precautions, ['a', 'b']);
  assert.deepEqual(withPhoto.possibleIssues.map(item => [item.name, item.likelihood]), [['Leaf blight', 'high'], ['X', 'low']]);
  assert.deepEqual(parseCropAdvice(raw, false).photoSeen, []);
  assert.equal(parseCropAdvice('{"urgency":"bogus"}', false).urgency, 'ask_expert');
  assert.throws(() => parseCropAdvice('not json', false), /could not be read/);
});

test('urgency is blamed on the photo only when a photo was really analysed', () => {
  const noPhoto = decideVisit({ assessment: base, latestNdvi: 0.62, photoUrgency: 'check_soon', photoUsed: false });
  assert.deepEqual(noPhoto.reasons, ['advice_urgent']);
  const withPhoto = decideVisit({ assessment: base, latestNdvi: 0.62, photoUrgency: 'check_soon', photoUsed: true });
  assert.deepEqual(withPhoto.reasons, ['photo_urgent']);
  assert.deepEqual(decideVisit({ assessment: base, latestNdvi: 0.62, photoUrgency: 'check_soon' }).reasons, ['advice_urgent']);
});
