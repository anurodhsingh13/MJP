import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

type Scenario = { name:string; state:string; dueTasks:number };
const { scenarios } = JSON.parse(readFileSync('tests/fixtures/demo-scenarios.json','utf8')) as {scenarios:Scenario[]};
const fields = scenarios.map((scenario,index) => ({
  id: `fixture-${index}`, name: `TEST ${scenario.name}`, crop:scenario.name,
  area_hectares:1, provenance:'user_reported', isDemo:false, dueTasks:scenario.dueTasks,
  planting_date:null, harvest_date:null, latestObservation:null, previousObservation:null,
  latestJob:null, assessment:{state:scenario.state,title:scenario.state,explanation:'Synthetic test data only',nextAction:'Inspect',ageDays:null,change:null,comparableObservations:0},
}));

test.beforeEach(async ({page}) => {
  await page.route('**/api/auth/session',route=>route.fulfill({json:{mode:'local',user:null}}));
  await page.route('**/api/fields',route=>route.fulfill({json:fields}));
});

test('farmer sees urgent fields first',async({page})=>{
  await page.goto('/');
  const cards=page.locator('.fh-field');
  await expect(cards).toHaveCount(5);
  // Inspection signal, then due visits, then fields waiting for a picture, then routine fields.
  await expect(cards.nth(0)).toContainText('TEST Wheat');
  await expect(cards.nth(1)).toContainText('TEST Rice');
  await expect(cards.nth(2)).toContainText('TEST Mustard');
  await expect(cards.nth(3)).toContainText('TEST New field');
  await expect(cards.nth(4)).toContainText('TEST Maize');
});

test('mobile navigation is visible and reaches reports',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  const nav=page.getByRole('navigation',{name:'Main mobile navigation'});
  await expect(nav).toBeVisible();
  await expect(nav.getByRole('link',{name:'Home'})).toBeVisible();
  await expect(nav.getByRole('link',{name:'Fields'})).toBeVisible();
  await expect(nav.getByRole('link',{name:'Reports'})).toBeVisible();
  await expect(nav.getByRole('link',{name:'Help'})).toBeVisible();
});

test('attention card shows the most urgent field and the summary counts inspection signals',async({page})=>{
  await page.goto('/');
  const attention=page.locator('.fh-attention');
  await expect(attention).toContainText('TEST Wheat');
  await expect(attention).toContainText('Action Required');
  const summary=page.getByRole('region',{name:'Farm summary'});
  await expect(summary.locator('article').nth(0).locator('strong')).toHaveText('5');
  await expect(summary.locator('article').nth(2).locator('strong')).toHaveText('1');
});
