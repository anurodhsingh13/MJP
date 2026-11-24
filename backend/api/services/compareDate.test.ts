import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ??= 'postgresql://user:pass@127.0.0.1:5432/none';
const { rankScenesForDate, parseDateRequest } = await import('./compareDate.ts');
const DAY = 86400000;
const NOW = Date.parse('2026-11-24T12:00:00Z');
const scene = (id: string, iso: string, cloud: number | null = 5, rejected = false) => ({ scene_id: id, observed_at: iso, cloud_cover: cloud, tile_id: null, rejected });

test('closest acquisition wins, clearer breaks ties', () => {
  const target = Date.parse('2026-10-10T12:00:00Z');
  const ranked = rankScenesForDate([
    scene('far', '2026-10-14T05:00:00Z', 0), scene('near-cloudy', '2026-10-09T05:00:00Z', 30), scene('near-clear', '2026-10-11T05:00:00Z', 2),
  ], target, null);
  assert.deepEqual(ranked.map(item => item.scene_id), ['near-clear', 'near-cloudy', 'far']);
  const tie = rankScenesForDate([scene('cloudy', '2026-10-10T05:00:00Z', 20), scene('clear', '2026-10-10T05:00:00Z', 3)], target, null);
  assert.deepEqual(tie.map(item => item.scene_id), ['clear', 'cloudy']);
});

test('scenes beyond the radius, rejected scenes and scenes on or after the comparison date are dropped', () => {
  const target = Date.parse('2026-10-10T12:00:00Z');
  const ranked = rankScenesForDate([
    scene('too-far', '2026-09-01T05:00:00Z'), scene('rejected', '2026-10-10T05:00:00Z', 1, true),
    scene('after-latest', '2026-10-12T05:00:00Z'), scene('ok', '2026-10-08T05:00:00Z'),
  ], target, Date.parse('2026-10-12T00:00:00Z'));
  assert.deepEqual(ranked.map(item => item.scene_id), ['ok']);
});

test('date request validation', () => {
  assert.equal(parseDateRequest({ date: '2026-10-10' }, NOW).date, '2026-10-10');
  assert.throws(() => parseDateRequest({ date: '2026-11-24' }, NOW), /past/);      // today
  assert.throws(() => parseDateRequest({ date: '2027-01-01' }, NOW), /past/);      // future
  assert.throws(() => parseDateRequest({ date: '2020-01-01' }, NOW), /2 years/);
  assert.throws(() => parseDateRequest({ date: '2026-02-31' }, NOW), /valid/);
  assert.throws(() => parseDateRequest({ date: 'yesterday' }, NOW), /valid/);
  assert.throws(() => parseDateRequest({ date: '2026-10-10', before: '2026-10-10' }, NOW), /earlier/);
  assert.equal(parseDateRequest({ date: '2026-10-09', before: '2026-10-10' }, NOW).beforeMs, Date.parse('2026-10-10T00:00:00Z'));
  assert.ok(Math.abs(parseDateRequest({ date: '2026-10-10' }, NOW).targetMs - Date.parse('2026-10-10T12:00:00Z')) < DAY);
});
