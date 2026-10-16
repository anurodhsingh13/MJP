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

test('farmer sees urgent fields first and can find a field',async({page})=>{
  await page.goto('/');
  const cards=page.locator('.farmer-field-card');
  await expect(cards).toHaveCount(5);
  await expect(cards.first()).toContainText('TEST Wheat');
  await expect(cards.nth(1)).toContainText('TEST Rice');
  await page.getByPlaceholder('Search your fields or crops').fill('Mustard');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('TEST Mustard');
});

test('advanced filters can isolate missing imagery',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Filters'}).click();
  await page.getByLabel('Show fields').selectOption('data');
  const cards=page.locator('.farmer-field-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText('TEST Mustard');
  await expect(cards.nth(1)).toContainText('TEST New field');
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

test('attention section retains inspection, due visits and missing-imagery priorities together',async({page})=>{
  await page.goto('/');
  const priority=page.locator('.farmer-priority');
  await expect(priority).toContainText('TEST Wheat');
  await expect(priority).toContainText('TEST Rice');
  await expect(priority).toContainText('TEST Mustard');
  await expect(priority).toContainText('4 fields need attention');
});
