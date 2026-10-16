import { test, expect } from '@playwright/test';
import { setup, id, seed, latest, previous } from './fixtures';

/**
 * End-to-end browser journey using labelled synthetic observations.
 * This checks navigation and honest evidence messaging, not satellite raster accuracy.
 */
test('farmer opens a flagged field, reviews two-image NDVI change, and reaches the report', async ({ page }) => {
  const state = await setup(page);
  state.fields = [{ ...seed, name: 'DEMO Wheat field', crop: 'Wheat' }];
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'DEMO Wheat field' })).toBeVisible();
  await page.getByRole('link', { name: 'Open field' }).click();
  await expect(page).toHaveURL(new RegExp(`/fields/${id}/overview`));
  await page.goto(`/fields/${id}/analysis`);
  await expect(page.getByRole('heading', { name: 'Changes over time' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Picture comparison summary' })).toContainText('less green');
  await expect(page.getByRole('region', { name: 'Picture comparison summary' })).toContainText('field visit');
  await page.getByText('Advanced: measurements and experimental score').click();
  await expect(page.getByRole('region', { name: 'Two-date comparison' })).toContainText('NDVI change');
  await expect(page.getByRole('region', { name: 'Two-date comparison' })).toContainText((Number(latest.ndvi_value) - Number(previous.ndvi_value)).toFixed(3));
  await page.getByRole('link', { name: 'Open report' }).click();
  await expect(page).toHaveURL(new RegExp(`/fields/${id}/report`));
  expect(state.errors).toEqual([]);
});

test('unavailable imagery is not presented as a healthy crop', async ({ page }) => {
  const state = await setup(page);
  state.fields = [{ ...seed, name: 'DEMO No image field', latestObservation: null, previousObservation: null, assessment: { state:'awaiting_analysis', title:'Awaiting first analysis', explanation:'No accepted satellite measurement for this boundary.', nextAction:'Find a usable image', ageDays:null, change:null, comparableObservations:0 } }];
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'DEMO No image field' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Let’s get a clearer picture' })).toBeVisible();
  await expect(page.locator('.unknown-message')).toContainText('cannot tell');
  expect(state.errors).toEqual([]);
});
