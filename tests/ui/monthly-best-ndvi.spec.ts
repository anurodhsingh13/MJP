import { expect, test } from '@playwright/test';
import { setup, id, latest } from './fixtures';

// Fixed dates so the month grouping is deterministic. The latest reading must stay inside the default 90-day window only
// for the trend chart; the monthly comparison uses every accepted reading, so older months still appear.
const at = (day: string, ndvi: number, index: number) => ({ ...latest, scene_id: `m-${index}`, observed_on: day, ndvi_value: ndvi, boundary_version: 1 });
const readings = [
  at('2026-06-04', .31, 0), at('2026-06-24', .38, 1),                 // June best 0.38 (not the first picture)
  at('2026-07-09', .52, 2), at('2026-07-29', .58, 3),                 // July best 0.58
  at('2026-08-13', .81, 4), at('2026-08-23', .74, 5),                 // August best 0.81 = greenest month
  /* September: no clear picture at all */
  at('2026-10-08', .66, 6),                                           // October best 0.66
];

test('monthly best NDVI picks the greenest clear picture per month, flags the best month and leaves gaps empty', async ({ page }, info) => {
  await setup(page);
  await page.route(`**/api/fields/${id}/ndvi`, route => route.fulfill({ json: readings }));
  await page.goto(`/fields/${id}/analysis`);
  const section = page.locator('.monthly-best');
  await expect(section.getByRole('heading', { name: 'Best NDVI of each month' })).toBeVisible();

  await expect(section.locator('.mb-tile.best')).toContainText('August 2026');
  await expect(section.locator('.mb-tile.best')).toContainText('0.81');
  const chips = section.getByRole('list', { name: 'Month by month change' });
  await expect(chips.getByRole('listitem')).toHaveCount(5);              // Jun, Jul, Aug, Sep (empty), Oct
  await expect(chips).toContainText('0.38');                              // June best, not 0.31
  await expect(chips).toContainText('0.58');                              // July best, not 0.52
  await expect(chips).not.toContainText('0.74');                          // August's weaker picture is not shown
  await expect(chips.locator('li.is-best')).toContainText('Aug');
  await expect(chips.locator('li.is-best')).toContainText('Best');
  await expect(chips).toContainText('no clear picture');                  // September stays empty, not guessed
  // October is compared with August (the previous month that has data): 0.66 - 0.81 = -0.15
  await expect(section.locator('.mb-tile.down')).toContainText('-0.15');
  await expect(section.locator('.mb-tile.down')).toContainText('vs August 2026');
  await expect(section.locator('.mb-chart svg')).toBeVisible();
  await section.scrollIntoViewIfNeeded();
  await section.screenshot({ path: info.outputPath('monthly-best.png') });
});

test('monthly comparison says it needs two months when only one month has pictures', async ({ page }) => {
  await setup(page);
  await page.route(`**/api/fields/${id}/ndvi`, route => route.fulfill({ json: [at('2026-10-08', .66, 0), at('2026-10-20', .7, 1)] }));
  await page.goto(`/fields/${id}/analysis`);
  const section = page.locator('.monthly-best');
  await expect(section.locator('.mb-tile.best')).toContainText('0.70');
  await expect(section).toContainText('Need two months with clear pictures');
});

test('monthly comparison fits a 360px phone without sideways scrolling', async ({ page }, info) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await setup(page);
  await page.route(`**/api/fields/${id}/ndvi`, route => route.fulfill({ json: readings }));
  await page.goto(`/fields/${id}/analysis`);
  const section = page.locator('.monthly-best');
  await expect(section.locator('.mb-chart svg')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await section.scrollIntoViewIfNeeded();
  await section.screenshot({ path: info.outputPath('monthly-best-phone.png') });
});
