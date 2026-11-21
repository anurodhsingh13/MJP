// SYNTHETIC data: checks the scoring logic only. Not ground truth, never report these numbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, parseCsv, wilson } from './evaluate-ndvi-alerts.mjs';

const img = (field, day, ndvi) => ({ field_id: field, observed_on: day, acquired_at: day + 'T05:00:00Z', ndvi_value: String(ndvi), valid_coverage_percent: '100', valid_pixel_count: '50', boundary_version: '1', tile_id: '43RGK', planting_date: '', harvest_date: '' });
const visit = (field, day, label, extra = {}) => ({ field_id: field, observed_at: day, condition_label: label, consent_status: 'granted', reviewed_by: 'agronomist', ...extra });

const ndvi = [
  img('drop-sick', '2026-10-01', 0.7), img('drop-sick', '2026-10-10', 0.5),
  img('steady-ok', '2026-10-01', 0.7), img('steady-ok', '2026-10-10', 0.69),
  img('steady-sick', '2026-10-01', 0.7), img('steady-sick', '2026-10-10', 0.68),
  img('drop-ok', '2026-10-01', 0.7), img('drop-ok', '2026-10-10', 0.55),
  img('old', '2026-08-01', 0.7), img('old', '2026-08-10', 0.69),
];
const visits = [
  visit('drop-sick', '2026-10-12', 'stressed'), visit('steady-ok', '2026-10-12', 'healthy'),
  visit('steady-sick', '2026-10-12', 'symptomatic'), visit('drop-ok', '2026-10-12', 'healthy'),
  visit('old', '2026-10-12', 'stressed'), visit('none', '2026-10-12', 'healthy'),
  visit('drop-sick', '2026-10-12', 'stressed', { consent_status: 'not_granted' }),
  visit('drop-sick', '2026-10-12', 'stressed', { reviewed_by: '' }),
  visit('drop-sick', '2026-10-12', 'unknown'),
];

test('confusion matrix and skips', () => {
  const r = evaluate(visits, ndvi);
  assert.deepEqual(r.cells, { tp: 1, fn: 1, fp: 1, tn: 1 });
  assert.deepEqual(r.undecided, { positive: 1, negative: 1 });
  assert.equal(r.skipped.no_consent, 1); assert.equal(r.skipped.not_reviewed, 1); assert.equal(r.skipped.label_not_usable, 1);
  assert.equal(r.sensitivity_decided.value, 0.5);
  assert.ok(Math.abs(r.sensitivity_strict.value - 1 / 3) < 1e-9);
  assert.equal(r.precision.value, 0.5);
});

test('imagery after the visit is never used', () => {
  const r = evaluate([visit('drop-sick', '2026-10-05', 'stressed')], ndvi);
  assert.equal(r.rows[0].outcome, 'no_decision');
});

test('csv parser handles quotes and CRLF; wilson interval sane', () => {
  assert.deepEqual(parseCsv('a,b\r\n1,"x,""y"""\r\n'), [{ a: '1', b: 'x,"y"' }]);
  const [lo, hi] = wilson(5, 10); assert.ok(lo > 0.2 && hi < 0.8);
});
