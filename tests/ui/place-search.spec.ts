import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { setup } from './fixtures';

const nominatim = '**/nominatim.openstreetmap.org/search**';
const google = '**/api/places/search**';

const googleHit = { latitude: 26.2209, longitude: 81.2555, address: 'Raebareli, Uttar Pradesh, India', box: { south: 26.19, north: 26.28, west: 81.2, east: 81.28 } };
const osmRows = [
  { lat: '26.2300', lon: '81.2400', display_name: 'Raebareli (same town, 1.5 km away), Uttar Pradesh, India' },
  { lat: '26.4000', lon: '81.3000', display_name: 'Raebareli Road, Lucknow, Uttar Pradesh, India' },
  { lat: 'bad', lon: '81', display_name: 'Broken row is ignored' },
];

async function openBoundaryStep(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Add New Field/ }).first().click();
  await page.getByLabel(/Field name/i).fill('Search test field');
  await page.getByLabel(/Crop/i).first().fill('Rice');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Find the farm area')).toBeVisible();
}

async function search(page: Page, text: string) {
  const box = page.locator('.field-location-search').getByRole('searchbox');
  await box.fill(text);
  await page.locator('.field-location-search').getByRole('button', { name: 'Search' }).click();
}

test('place search lists Google\'s best match first, then other OpenStreetMap matches, without duplicates', async ({ page }) => {
  await setup(page);
  const asked: string[] = [];
  await page.route(google, route => { asked.push(new URL(route.request().url()).searchParams.get('q') ?? ''); return route.fulfill({ json: { results: [googleHit] } }); });
  await page.route(nominatim, route => route.fulfill({ json: osmRows }));
  await openBoundaryStep(page);
  const button = page.locator('.field-location-search').getByRole('button', { name: 'Search' });
  await expect(button).toBeDisabled();
  await search(page, 'Raebareli');
  const results = page.getByRole('list', { name: 'Matching places' });
  await expect(results.getByRole('button')).toHaveCount(2);
  await expect(results.getByRole('button').first()).toHaveText('Raebareli, Uttar Pradesh, India');
  await expect(results.getByRole('button').nth(1)).toContainText('Raebareli Road');
  await results.getByRole('button').first().click();
  await expect(page.locator('.field-location-search').getByRole('status')).toHaveText('Raebareli, Uttar Pradesh, India');
  await expect(results).toHaveCount(0);
  expect(asked).toEqual(['Raebareli']);
  // The farmer sees only places and a search box: no service names, notices or technical wording.
  await expect(page.locator('.field-location-search')).not.toContainText(/nominatim|OpenStreetMap|Google|provider|API/i);
});

test('place search still works when Google is down: OpenStreetMap results are shown', async ({ page }) => {
  await setup(page);
  await page.route(google, route => route.fulfill({ status: 502, json: { error: 'Place search is unavailable right now', code: 'provider_unavailable' } }));
  await page.route(nominatim, route => route.fulfill({ json: osmRows }));
  await openBoundaryStep(page);
  await search(page, 'Raebareli');
  await expect(page.getByRole('list', { name: 'Matching places' }).getByRole('button')).toHaveCount(2);
});

test('place search still works when OpenStreetMap is down: Google results are shown', async ({ page }) => {
  await setup(page);
  await page.route(google, route => route.fulfill({ json: { results: [googleHit] } }));
  await page.route(nominatim, route => route.fulfill({ status: 503, body: 'busy' }));
  await openBoundaryStep(page);
  await search(page, 'Raebareli');
  await expect(page.getByRole('list', { name: 'Matching places' }).getByRole('button')).toHaveText(['Raebareli, Uttar Pradesh, India']);
});

test('place search explains clearly when nothing is found or both services are down', async ({ page }) => {
  await setup(page);
  let mode: 'empty' | 'down' = 'empty';
  await page.route(google, route => mode === 'empty' ? route.fulfill({ json: { results: [] } }) : route.fulfill({ status: 502, json: { error: 'x' } }));
  await page.route(nominatim, route => mode === 'empty' ? route.fulfill({ json: [] }) : route.fulfill({ status: 503, body: 'busy' }));
  await openBoundaryStep(page);
  await search(page, 'Nowhereville');
  await expect(page.getByRole('alert').filter({ hasText: 'No place found' })).toBeVisible();
  mode = 'down';
  await page.locator('.field-location-search').getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Search is unavailable right now' })).toBeVisible();
  await expect(page.locator('.field-location-search').getByRole('button', { name: 'Search' })).toBeEnabled();
});

test('dashboard map search always finishes and never leaves the button stuck', async ({ page }) => {
  await setup(page);
  await page.route(google, route => route.fulfill({ json: { results: [googleHit] } }));
  await page.route(nominatim, route => route.fulfill({ json: osmRows }));
  await page.goto('/');
  const form = page.locator('.fh-search');
  await form.getByRole('textbox').fill('Raebareli');
  const button = form.getByRole('button');
  await button.click();
  await expect(button).toHaveText('Search');
  await expect(button).toBeEnabled();
  await expect(page.getByText(/Search is unavailable|No place found/)).toHaveCount(0);
});
