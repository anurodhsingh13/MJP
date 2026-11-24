import {test,expect} from '@playwright/test';
import {assessEvidence} from '../../shared/evidence';
import {setup,id,seed,day} from './fixtures';

const withDates=(planting:string|null,harvest:string|null)=>({...seed,planting_date:planting,harvest_date:harvest,latestObservation:null,previousObservation:null,assessment:assessEvidence(null,null)});

test('overview asks for sowing and harvest dates when they are missing, and the button opens the edit form',async({page})=>{
 const state=await setup(page);state.fields=[withDates(null,null)];
 await page.goto(`/fields/${id}/overview`);
 const notice=page.locator('.crop-dates-notice');
 await expect(notice).toContainText('Add your sowing and harvest dates');
 await expect(notice).toHaveClass(/missing/);
 await notice.getByRole('button',{name:'Update dates'}).click();
 await expect(page.getByRole('dialog',{name:'Manage field'})).toBeVisible();
});

test('overview warns when the saved dates belong to another season',async({page})=>{
 const state=await setup(page);state.fields=[withDates('2023-06-11','2023-12-11')];
 await page.goto(`/fields/${id}/overview`);
 const notice=page.locator('.crop-dates-notice');
 await expect(notice).toContainText('not for this season');
 await expect(notice).toHaveClass(/outdated/);
});

test('no notice when the dates are for the current season',async({page})=>{
 const state=await setup(page);state.fields=[withDates(day(60),day(-90))];
 await page.goto(`/fields/${id}/overview`);
 await expect(page.locator('.field-overview')).toBeVisible();
 await expect(page.locator('.crop-dates-notice')).toHaveCount(0);
});

test('wizard explains why dates matter, stays optional, and warns about an earlier season',async({page})=>{
 const state=await setup(page);state.fields=[];
 await page.goto('/');
 await page.getByRole('button',{name:'Add New Field'}).click();
 await page.getByLabel('Field Name').selectOption('__other');await page.getByLabel('Other field name').fill('Dates field');
 await page.getByLabel('Crop Type').selectOption('Wheat');
 await page.getByRole('button',{name:'Next',exact:true}).click();
 await expect(page.getByText('Step 2 of 4')).toBeVisible();
 await expect(page.getByText('ripening or harvested crop from a stressed one',{exact:false})).toBeVisible();
 await expect(page.getByRole('status').filter({hasText:'another season'})).toHaveCount(0);
 await page.getByLabel('Planting date').fill('2023-06-11');
 await page.getByLabel('Expected harvest date').fill('2023-12-11');
 await expect(page.getByRole('status').filter({hasText:'another season'})).toBeVisible();
 await page.getByLabel('Planting date').fill(day(30));
 await page.getByLabel('Expected harvest date').fill(day(-120));
 await expect(page.getByRole('status').filter({hasText:'another season'})).toHaveCount(0);
 await page.getByRole('button',{name:'Next',exact:true}).click();        // still allowed: dates are recommended, not required
 await expect(page.getByText('Step 3 of 4')).toBeVisible();
});
