import { expect, test } from '@playwright/test';
import { setup, id } from './fixtures';

const advice = {
  evidence: { ndvi: { latest: 0.31, observedOn: '2026-11-13', ndmi: null, zoneSharePercent: null, affectedAreaPercent: 18.5, history: [] }, assessment: { state: 'needs_inspection', change: -0.14, imageAgeDays: 4 } },
  visit: { visit: 'yes', when: 'within_3_days', reasons: ['ndvi_drop', 'photo_urgent'] },
  advice: { summary: 'Greenness fell and the photo shows spotting.', photoSeen: ['Brown spots on lower leaves'], urgency: 'check_soon',
    possibleIssues: [{ name: 'Leaf blight', likelihood: 'medium', reason: 'Spots plus a drop in NDVI after humid weather.' }],
    precautions: ['Inspect the underside of several leaves.'], checkInField: ['Count affected plants in 5 spots.'] },
  photoUsed: true, photoDate: '2026-11-12', model: 'fixture',
};

test('crop advice shows visit decision, possible problems and precautions from NDVI and photo', async ({ page }) => {
  await setup(page);
  const bodies: Array<{ languageCode?: string }> = [];
  await page.route(`**/api/fields/${id}/advice`, route => { bodies.push(route.request().postDataJSON()); return route.fulfill({ json: advice }); });
  await page.goto(`/fields/${id}/overview`);
  const panel = page.getByRole('region', { name: 'Crop health advice' });
  await expect(panel).toContainText('sends this field');
  await panel.getByRole('button', { name: 'Get advice' }).click();
  await expect(panel).toContainText('Yes — visit the field within 3 days');
  await expect(panel).toContainText('Greenness (NDVI) fell since the last comparable image.');
  await expect(panel).toContainText('0.31');
  await expect(panel).toContainText('Brown spots on lower leaves');
  await expect(panel).toContainText('Leaf blight');
  await expect(panel).toContainText('not a diagnosis');
  await expect(panel).toContainText('Inspect the underside of several leaves.');
  expect(bodies).toEqual([{ languageCode: 'en-IN' }]);
});

test('crop advice failure is shown and can be retried', async ({ page }) => {
  await setup(page);
  let fail = true;
  await page.route(`**/api/fields/${id}/advice`, route => fail
    ? route.fulfill({ status: 503, json: { error: 'Gemini AI is not configured' } }) : route.fulfill({ json: { ...advice, visit: { visit: 'no', when: 'routine', reasons: ['all_clear'] } } }));
  await page.goto(`/fields/${id}/overview`);
  const panel = page.getByRole('region', { name: 'Crop health advice' });
  await panel.getByRole('button', { name: 'Get advice' }).click();
  await expect(panel.getByRole('alert')).toContainText('not configured');
  fail = false;
  await panel.getByRole('button', { name: 'Get advice' }).click();
  await expect(panel).toContainText('No urgent visit needed');
});
