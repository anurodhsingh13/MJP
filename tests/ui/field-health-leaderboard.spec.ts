import { test, expect } from '@playwright/test';
import { setup, seed, previous } from './fixtures';

test('field comparison shows only verified observations and exports original data', async ({ page }) => {
  const state = await setup(page);
  state.fields.push({
    ...seed, id: '00000000-0000-0000-0000-000000000088',
    name: 'Waiting field', latestObservation: null, previousObservation: null,
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Which field should I check?' })).toBeVisible();
  await expect(page.locator('.health-leaderboard-row')).toHaveCount(2);
  await expect(page.locator('.health-leaderboard')).toContainText('90%');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download comparison CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('terrascope-field-comparison.csv');
  await expect(page.locator('.health-leaderboard')).toContainText('A satellite change');
  expect(state.errors).toEqual([]);
});

test('mismatched observation processing versions cannot be compared', async ({ page }) => {
  const state = await setup(page);
  state.fields[0].previousObservation = { ...previous, calculation_version: 'v1' };
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Which field should I check?' })).toBeVisible();
  const row = page.locator('.health-leaderboard-row').first();
  await expect(row.locator('.health-leaderboard-value b')).toHaveText('—');
  expect(state.errors).toEqual([]);
});
