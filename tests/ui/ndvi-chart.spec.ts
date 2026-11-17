import { expect, test } from '@playwright/test';
import { setup, id, latest, forecastFixture } from './fixtures';

const day = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const reading = (daysAgo: number, ndvi: number, index: number) => ({ ...latest, scene_id: `chart-${index}`, observed_on: day(daysAgo), ndvi_value: ndvi });

test('NDVI chart labels the colours, every dot value, and reports the latest fall even after an earlier rise', async ({ page }) => {
  await setup(page);
  // Rises from 0.18 to 0.55, then falls to 0.29: first-vs-last alone would wrongly say "increased".
  const observations = [[48, .18], [38, .31], [28, .47], [18, .55], [8, .41], [3, .29]].map(([ago, value], position) => reading(ago, value, position));
  await page.route(`**/api/fields/${id}/ndvi`, route => route.fulfill({ json: observations }));
  await page.goto(`/fields/${id}/analysis`);
  const section = page.locator('.vegetation-trends');
  await expect(section.getByText('Greenness fell in the latest picture')).toBeVisible();
  await expect(section).toContainText('Now 0.29');
  await expect(section).toContainText('before 0.41');
  await expect(section.locator('.vc-now')).toContainText('Sparse or weak green');
  const key = section.getByRole('list', { name: 'What the colours mean' });
  for (const name of ['Dense, healthy green', 'Moderate green', 'Sparse or weak green', 'Bare soil / almost no crop']) await expect(key).toContainText(name);
  await expect(key).toContainText('Each dot = one satellite picture');
  const chart = section.locator('.vegetation-chart');
  for (const value of ['0.18', '0.31', '0.47', '0.55', '0.41', '0.29']) await expect(chart.getByText(value, { exact: true }).first()).toBeVisible();
  await expect(chart).toContainText('Date of satellite picture');
});

test('water signal view explains what the number means and zooms to the data', async ({ page }) => {
  await setup(page);
  const observations = [[30, .05], [20, .2], [10, .14], [3, .08]].map(([ago, value], position) => ({ ...reading(ago, .5, position), ndmi_value: value }));
  await page.route(`**/api/fields/${id}/ndvi`, route => route.fulfill({ json: observations }));
  await page.goto(`/fields/${id}/analysis`);
  await page.getByLabel('Show on chart').selectOption('ndmi_value');
  const section = page.locator('.vegetation-trends');
  await expect(section.getByText('Water signal fell in the latest picture')).toBeVisible();
  await expect(section).toContainText('Higher number = more water in the plants');
  await expect(section).toContainText('compare with your own earlier dates');
  await expect(section.locator('.vegetation-chart')).toContainText('Water signal (higher = more water)');
  await expect(section.locator('.farmer-chart-footnote')).not.toContainText('NDVI');
});

test('past weather shows a plain summary and labelled charts', async ({ page }) => {
  await setup(page);
  const rain = [0, 3.2, 12, 0, 24, 6, 0, 0, 1.1, 0];
  await page.route(`**/api/fields/${id}/weather`, route => route.fulfill({ json: rain.map((value, position) => ({ id: `w${position}`, observed_on: day(10 - position), precipitation_mm: value, temperature_c: 25 + position, source: 'NASA POWER' })) }));
  await page.goto(`/fields/${id}/analysis`);
  await page.getByText('Past weather near this field').click();
  const charts = page.locator('.wx-charts');
  await expect(charts).toContainText('Total rain');
  await expect(charts).toContainText('46 mm'); // 3.2 + 12 + 24 + 6 + 1.1 = 46.3
  await expect(charts).toContainText('5 rainy days (1 mm or more)');
  await expect(charts.locator('.wx-stat').filter({ hasText: 'Wettest day' })).toContainText('24 mm');
  await expect(charts.getByRole('img', { name: /Average daily temperature/ })).toBeVisible();
  await expect(charts.getByText('Rain each day (mm)')).toBeVisible();
  await expect(charts.getByText('Heavy rain (20 mm or more)')).toBeVisible();
});

test('forecast charts summarise rain and heat and label each day', async ({ page }) => {
  await setup(page);
  const days = [[33, 22, 0], [35, 23, 2.5], [34, 23, 18], [31, 22, 26], [30, 21, 6], [32, 22, 0], [33, 22, 0]]
    .map(([maxC, minC, rainMm], position) => ({ date: day(-position), minC, maxC, rainMm, rainChance: 40, humidity: 70, windKph: 10 }));
  await page.route(`**/api/fields/${id}/forecast`, route => route.fulfill({ json: { ...forecastFixture(), days } }));
  await page.goto(`/fields/${id}/overview`);
  await page.getByText('Temperature and rainfall charts').click();
  const charts = page.locator('.wx-charts');
  await expect(charts.locator('.wx-stat').filter({ hasText: 'Rain in the next 7 days' })).toContainText('53 mm');
  await expect(charts.locator('.wx-stat').filter({ hasText: 'Hottest day' })).toContainText('35°C');
  await expect(charts.locator('.wx-stat').filter({ hasText: 'Coolest night' })).toContainText('21°C');
  await expect(charts.getByText('Daytime high', { exact: true })).toBeVisible();
  await expect(charts.getByText('Night low', { exact: true })).toBeVisible();
  await expect(charts.getByText('26 mm', { exact: true }).first()).toBeVisible();
});

test('with only one picture the chart says why it has no line and links to adding earlier pictures', async ({ page }) => {
  await setup(page);
  await page.route(`**/api/fields/${id}/ndvi`, route => route.fulfill({ json: [reading(3, .29, 0)] }));
  await page.goto(`/fields/${id}/analysis`);
  const section = page.locator('.vegetation-trends');
  const note = section.getByRole('status').filter({ hasText: 'Only 1 satellite picture so far' });
  await expect(note).toContainText('at least 2 pictures');
  await expect(section).toContainText('1 picture');
  await expect(section).not.toContainText('1 pictures');
  await note.getByRole('link', { name: /Add earlier pictures/ }).click();
  await expect(page.locator('#season-history')).toBeInViewport();
});

test('NDVI chart shows the change between pictures, picture reliability on hover, and the rain in between', async ({ page }) => {
  await setup(page);
  const observations = [[40, .2], [30, .34], [20, .52], [10, .41]].map(([ago, value], position) => ({ ...reading(ago, value, position), affected_coverage_percent: 18, valid_coverage_percent: 92, cloud_cover: 7 }));
  const rain = Array.from({ length: 42 }, (_, position) => ({ id: `r${position}`, observed_on: day(41 - position), precipitation_mm: position === 12 ? 20 : position === 30 ? 4.5 : 0, temperature_c: 27, source: 'NASA POWER' }));
  await page.route(`**/api/fields/${id}/ndvi`, route => route.fulfill({ json: observations }));
  await page.route(`**/api/fields/${id}/weather`, route => route.fulfill({ json: rain }));
  await page.setViewportSize({ width: 1100, height: 1000 });
  await page.goto(`/fields/${id}/analysis`);
  const section = page.locator('.vegetation-trends');
  const chart = section.locator('.vegetation-chart');
  // Change on each segment: +0.14, +0.18, -0.11 (all at least 0.03).
  for (const delta of ['▲ 0.14', '▲ 0.18', '▼ 0.11']) await expect(chart.getByText(delta, { exact: true })).toBeVisible();
  const rainBox = section.locator('.vc-rain');
  await expect(rainBox).toContainText('Rain between these pictures');
  await expect(rainBox).toContainText('25 mm'); // 20 + 4.5 = 24.5, shown rounded
  await expect(rainBox).toContainText('does not prove the cause');
  await expect(rainBox).toContainText('Dashed lines mark the satellite picture dates');
  await chart.scrollIntoViewIfNeeded();
  const box = await chart.boundingBox();
  await page.mouse.move(box!.x + box!.width - 60, box!.y + box!.height / 2);
  await expect(page.locator('.vc-tip')).toContainText('Field clearly visible: 92%');
  await expect(page.locator('.vc-tip')).toContainText('Weak-looking part of the field: 18%');
});
