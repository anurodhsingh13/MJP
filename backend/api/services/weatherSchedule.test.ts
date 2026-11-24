import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ??= 'postgresql://user:pass@127.0.0.1:5432/none';
const { weatherWindow, PUBLISH_LAG_DAYS } = await import('./weatherSchedule.ts');
const NOW = Date.parse('2026-11-24T10:00:00Z');

test('a field with no weather gets the last 60 published days', () => {
  assert.deepEqual(weatherWindow(null, NOW), { start: '20260922', end: '20261121' });
});

test('a field that is up to date refetches only the last two days (late corrections)', () => {
  assert.deepEqual(weatherWindow('2026-11-21', NOW), { start: '20261119', end: '20261121' });
});

test('a long gap is caught up, capped at 90 days', () => {
  assert.deepEqual(weatherWindow('2026-09-01', NOW), { start: '20260830', end: '20261121' });
  assert.equal(weatherWindow('2025-01-01', NOW).start, '20260826');
});

test('the window never ends after the publish lag and never starts after it ends', () => {
  const window = weatherWindow('2026-11-24', NOW);
  assert.equal(window.end, '20261121');
  assert.ok(window.start <= window.end);
  assert.equal(PUBLISH_LAG_DAYS, 3);
});
