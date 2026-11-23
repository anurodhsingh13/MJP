import { expect, test } from '@playwright/test';
import { setup, id, latest, previous } from './fixtures';

test('NDVI comparison shows two dated maps with Vs, one shared colour scale and the change', async ({ page }) => {
  await setup(page);
  await page.goto(`/fields/${id}/map`);
  const section = page.getByRole('region', { name: 'Processed satellite image comparison', exact: true });
  await section.scrollIntoViewIfNeeded();

  const panels = section.locator('.ndvi-panel');
  await expect(panels).toHaveCount(2);
  await expect(section.locator('.ndvi-badge').first()).toContainText(/\(a\) Before · /);
  await expect(section.locator('.ndvi-badge').nth(1)).toContainText(/\(b\) After · /);
  await expect(section.locator('.ndvi-vs')).toHaveCount(1);
  await expect(section.locator('.open-field-map')).toHaveCount(2);

  // Fixtures: before 0.75, after 0.50.
  await expect(panels.first()).toContainText('NDVI 0.75');
  await expect(panels.nth(1)).toContainText('NDVI 0.50');
  await expect(section.locator('.ndvi-change')).toContainText('-0.250');
  await expect(section.locator('.ndvi-change')).toContainText('Less green');

  // One scale for both dates: a single legend, running from -0.2 to 1 (the engine's fixed range).
  const scale = section.locator('.ndvi-scale');
  await expect(scale).toHaveCount(1);
  await expect(scale).toContainText('Same colour scale on both dates');
  const ticks = await scale.locator('.ndvi-scale-ticks span').allTextContents();
  expect(ticks[0]).toBe('-0.2');
  expect(ticks.at(-1)).toBe('1');
});

test('NDVI comparison stacks on a phone without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await setup(page);
  await page.goto(`/fields/${id}/map`);
  const section = page.getByRole('region', { name: 'Processed satellite image comparison', exact: true });
  await section.scrollIntoViewIfNeeded();
  const boxes = await section.locator('.ndvi-panel').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect()));
  expect(boxes[1].top).toBeGreaterThan(boxes[0].bottom - 1);            // second map is below the first
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

const withIndices = (ndmiNewer: number | null) => [
  { ...previous, ndre_value: .35, ndmi_value: .10 },
  { ...latest, ndre_value: .22, ndmi_value: ndmiNewer },
];

test('NDRE and NDMI comparisons use their own tiles, scale and change figure', async ({ page }, info) => {
  await setup(page);
  await page.route(`**/api/fields/${id}/ndvi`, route => route.fulfill({ json: withIndices(.18) }));
  const tileRequests: string[] = [];
  page.on('request', request => { const u = new URL(request.url()); if (u.pathname.includes('/tiles/')) tileRequests.push(u.pathname + u.search); });
  await page.goto(`/fields/${id}/map`);
  const section = page.getByRole('region', { name: 'Processed satellite image comparison', exact: true });
  await section.scrollIntoViewIfNeeded();
  const picker = section.getByRole('group', { name: 'Index shown on both maps' });
  await expect(picker.getByRole('button', { name: /NDVI/ })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => tileRequests.length).toBeGreaterThan(0);
  expect(tileRequests.every(url => !url.includes('index='))).toBe(true);                 // NDVI keeps its original URL

  tileRequests.length = 0;
  await picker.getByRole('button', { name: /NDRE/ }).click();
  await expect(picker.getByRole('button', { name: /NDRE/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(section.locator('.ndvi-panel').first()).toContainText('NDRE 0.35');
  await expect(section.locator('.ndvi-panel').nth(1)).toContainText('NDRE 0.22');
  await expect(section.locator('.ndvi-change')).toContainText('-0.130');
  await expect(section.locator('.ndvi-change')).toContainText('Paler leaves');
  const ndreTicks = await section.locator('.ndvi-scale-ticks span').allTextContents();
  expect([ndreTicks[0], ndreTicks.at(-1)]).toEqual(['-0.1', '0.6']);
  await expect.poll(() => tileRequests.some(url => url.endsWith('index=ndre'))).toBe(true);
  expect(tileRequests.some(url => url.includes('index=ndmi'))).toBe(false);
  await section.screenshot({ path: info.outputPath('ndre.png') });

  tileRequests.length = 0;
  await picker.getByRole('button', { name: /NDMI/ }).click();
  await expect(section.locator('.ndvi-change')).toContainText('+0.080');
  await expect(section.locator('.ndvi-change')).toContainText('More water in the canopy');
  await expect(section).toContainText('not soil moisture');
  const ndmiTicks = await section.locator('.ndvi-scale-ticks span').allTextContents();
  expect([ndmiTicks[0], ndmiTicks.at(-1)]).toEqual(['-0.4', '0.6']);
  await expect.poll(() => tileRequests.some(url => url.endsWith('index=ndmi'))).toBe(true);
  await section.screenshot({ path: info.outputPath('ndmi.png') });

  await picker.getByRole('button', { name: /NDVI/ }).click();                             // back to NDVI: same figures as before
  await expect(section.locator('.ndvi-change')).toContainText('-0.250');
});

test('a missing NDMI value says so instead of inventing a change', async ({ page }) => {
  await setup(page);
  await page.route(`**/api/fields/${id}/ndvi`, route => route.fulfill({ json: withIndices(null) }));
  await page.goto(`/fields/${id}/map`);
  const section = page.getByRole('region', { name: 'Processed satellite image comparison', exact: true });
  await section.getByRole('group', { name: 'Index shown on both maps' }).getByRole('button', { name: /NDMI/ }).click();
  await expect(section.locator('.ndvi-change')).toHaveCount(0);
  await expect(section).toContainText('NDMI values were not stored for one of these images');
  await expect(section.locator('.ndvi-panel').nth(1)).toContainText('NDMI —');
});
