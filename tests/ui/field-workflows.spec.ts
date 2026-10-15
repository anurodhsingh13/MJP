import { expect, test } from '@playwright/test';

const fieldId = '00000000-0000-0000-0000-000000000201';
const boundary = {
  type: 'Polygon',
  coordinates: [[[77, 28], [77.01, 28], [77.01, 28.01], [77, 28.01], [77, 28]]],
};
const currentObservation = {
  scene_id: 'accepted-b',
  observed_on: '2026-10-12',
  ndvi_value: 0.62,
  valid_coverage_percent: 87,
  valid_pixel_count: 870,
  cloud_cover: 18,
  source: 'Copernicus Sentinel-2',
  provenance: 'measured_imagery',
  accepted: true,
  boundary_version: 2,
  calculation_version: 'sentinel-reflectance-scl-v2',
};

test('onboarding preserves a saved field after rejected processing and retries via newest-first processing', async ({ page }) => {
  let fieldSaves = 0;
  let processingCalls = 0;
  let savedPayload:Record<string,unknown>|undefined;
  const requestedPaths: string[] = [];
  const savedField = {
    id: fieldId, name: 'North block', crop: 'Wheat', area_hectares: 1.2,
    latitude: 28, longitude: 77, boundary_geojson: boundary, boundary_version: 1,
    latestObservation: null, last_observation: null,
  };
  await page.route('https://tile.openstreetmap.org/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"/> '}));
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    requestedPaths.push(`${request.method()} ${path}`);
    if (path === '/api/auth/session') return route.fulfill({ json: { mode: 'local', user: null } });
    if (path === '/api/fields' && request.method() === 'POST') {
      fieldSaves += 1;
      savedPayload=request.postDataJSON();
      return route.fulfill({ status: 201, json: { id: fieldId } });
    }
    if (path === '/api/fields') return route.fulfill({ json: fieldSaves ? [savedField] : [] });
    if (path.endsWith('/ingest/sentinel-scenes')) return route.fulfill({ json: { source: 'Copernicus Sentinel-2', imported: 2 } });
    if (path.endsWith('/ndvi/process-latest')) {
      processingCalls += 1;
      if (processingCalls === 1) {
        return route.fulfill({ json: {
          accepted: false,
          attempts: [
            { sceneId: 'newest-cloudy', status: 'rejected', reason: 'Not enough usable field pixels' },
            { sceneId: 'older-low-coverage', status: 'rejected', reason: 'Not enough usable field pixels' },
          ],
          message: 'No usable image accepted. Your previous observation is unchanged.',
        } });
      }
      return route.fulfill({ json: {
        accepted: true,
        sceneId: 'older-usable',
        validCoverage: 82,
        attempts: [
          { sceneId: 'newest-cloudy', status: 'rejected', reason: 'Not enough usable field pixels' },
          { sceneId: 'older-usable', status: 'processed' },
        ],
      } });
    }
    if (path.endsWith('/scenes')) return route.fulfill({ json: [] });
    return route.fulfill({ json: [] });
  });

  await page.route('https://tile.openstreetmap.org/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"/>'}));
  await page.goto('/');
  await page.getByRole('button', { name: '+ Add field' }).click();
  await page.getByLabel('Field Name').fill('North block');
  await page.getByLabel('Crop Type').fill('Wheat');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  const drawMap = page.locator('.boundary-map');
  await expect(drawMap).toBeVisible();
  for (const [index, position] of [{x:70,y:70},{x:170,y:70},{x:170,y:170}].entries()) {
    await drawMap.click({ position });
    await expect(page.locator('.boundary-tools')).toContainText(`${index+1} point`);
  }
  await page.getByRole('button', { name: 'Finish boundary' }).click();
  await page.getByRole('button', { name: 'Review' }).click();
  await page.getByRole('button', { name: 'Save & Analyse Field' }).click();

  await expect(page.getByRole('status')).toContainText('Field boundary saved');
  await expect(page.getByRole('alert')).toContainText('No usable image accepted');
  await expect(page.getByRole('button', { name: 'Retry Satellite Processing' })).toBeVisible();
  expect(fieldSaves).toBe(1);
  expect(savedPayload?.planting_date).toBeNull();
  expect(savedPayload?.harvest_date).toBeNull();
  expect(processingCalls).toBe(1);

  await page.getByRole('button', { name: 'Retry Satellite Processing' }).click();
  await expect(page.getByRole('heading', { name: 'North block' })).toBeVisible();
  expect(fieldSaves).toBe(1);
  expect(processingCalls).toBe(2);
  expect(requestedPaths.some(path => path.includes('/ndvi/from-scene/'))).toBeFalsy();
  expect(requestedPaths.filter(path => path.includes('/ndvi/process-latest'))).toHaveLength(2);
});

test('same-date map scenes select exact latest evidence and keep scene/boundary evidence aligned through refresh', async ({ page }) => {
  const field = {
    id: fieldId, name: 'River field', crop: 'Wheat', area_hectares: 3,
    latitude: 28, longitude: 77, boundary_geojson: boundary, boundary_version: 2,
    last_observation: '2026-10-12', latestObservation: currentObservation,
  };
  let sceneReads = 0;
  await page.route('https://tile.openstreetmap.org/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"/>'}));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/session') return route.fulfill({ json: { mode: 'local', user: null } });
    if (path === '/api/fields') return route.fulfill({ json: [field] });
    if (path.endsWith('/scenes')) {
      sceneReads += 1;
      return route.fulfill({ json: [
        { scene_id: 'newer-id', observed_at: '2026-10-12T12:00:00Z', cloud_cover: 2, processing_status: 'rejected' },
        { scene_id: 'accepted-b', observed_at: '2026-10-12T09:00:00Z', cloud_cover: 18, processing_status: 'processed' },
        { scene_id: 'historical-a', observed_at: '2026-10-12T08:00:00Z', cloud_cover: 8, processing_status: 'processed' },
        { scene_id: 'older-boundary', observed_at: '2026-10-12T06:00:00Z', cloud_cover: 5, processing_status: 'processed' },
      ] });
    }
    if (path.endsWith('/ndvi')) return route.fulfill({ json: [
      currentObservation,
      { ...currentObservation, scene_id: 'newer-id', valid_coverage_percent: 21, valid_pixel_count: 210, accepted: false, quality_reason: 'Not enough usable field pixels' },
      { ...currentObservation, scene_id: 'historical-a', valid_coverage_percent: 65, valid_pixel_count: 650 },
      { ...currentObservation, scene_id: 'older-boundary', boundary_version: 1, valid_coverage_percent: 99, valid_pixel_count: 990 },
    ] });
    if (path.endsWith('/ndvi/process-latest')) return route.fulfill({ json: {
      accepted: false,
      attempts: [{ sceneId: 'newer-id', status: 'rejected' }],
      message: 'No usable image accepted. Your previous observation is unchanged.',
    } });
    return route.fulfill({ json: [] });
  });

  await page.goto(`http://127.0.0.1:5175/fields/${fieldId}/map`);
  const observationSelect = page.getByLabel('Select Observation:');
  await expect(observationSelect).toHaveValue('accepted-b');
  const evidence = page.getByRole('region', { name: 'Selected image evidence' });
  await expect(evidence).toContainText('Latest accepted observation');
  await expect(evidence).toContainText('Scene ID: accepted-b');
  await expect(evidence).toContainText('87%');
  await expect(evidence).toContainText('Current field boundary version: 2');

  await observationSelect.selectOption('newer-id');
  await expect(evidence).toContainText('Not accepted for crop-health evidence');
  await expect(evidence).toContainText('21%');
  await expect(evidence).toContainText('Not accepted: Not enough usable field pixels');

  await observationSelect.selectOption('older-boundary');
  await expect(evidence).toContainText('Not analysed for the current boundary');
  await expect(evidence).toContainText('Usable field coverage: Unavailable');
  await expect(evidence).toContainText('Selected evidence boundary version: Unavailable');

  await observationSelect.selectOption('historical-a');
  await expect(evidence).toContainText('Historical accepted observation');
  await page.getByRole('button', { name: 'Find & Process Best Recent Scene' }).click();
  await expect(page.locator('.field-map-panel > [role="alert"]')).toContainText('No usable image accepted');
  await expect(observationSelect).toHaveValue('historical-a');
  expect(sceneReads).toBeGreaterThanOrEqual(2);
});
