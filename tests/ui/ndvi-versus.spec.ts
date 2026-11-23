import { expect, test } from '@playwright/test';
import { setup, id } from './fixtures';

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
