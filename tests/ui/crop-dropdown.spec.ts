import {test,expect} from '@playwright/test';
import {setup} from './fixtures';

test('crop type is a dropdown, needs a choice, and Other accepts a typed crop',async({page},info)=>{
 const state=await setup(page);state.fields=[];
 await page.goto('/');
 await page.getByRole('button',{name:'Add New Field'}).click();
 const crop=page.getByLabel('Crop Type');
 await expect(crop).toHaveJSProperty('tagName','SELECT');
 const labels=await crop.locator('option').allTextContents();
 for(const expected of ['Wheat','Rice','Maize','Potato','Mustard'])expect(labels).toContain(expected);
 await page.getByLabel('Field Name').selectOption('__other');await page.getByLabel('Other field name').fill('Dropdown field');
 await page.getByRole('button',{name:'Next',exact:true}).click();          // no crop chosen: stays on step 1
 await expect(page.getByText('Step 1 of 4')).toBeVisible();
 await crop.selectOption('Rice');
 await expect(page.getByLabel('Other crop name')).toHaveCount(0);
 await page.locator('.wizard-content').screenshot({path:info.outputPath('crop-dropdown.png')});
 await crop.selectOption('__other');
 await page.getByLabel('Other crop name').fill('Barley');
 await page.getByRole('button',{name:'Next',exact:true}).click();
 await expect(page.getByText('Step 2 of 4')).toBeVisible();
});

test('field name is a dropdown with presets and shows step progress',async({page},info)=>{
 const state=await setup(page);state.fields=[];
 await page.goto('/');
 await page.getByRole('button',{name:'Add New Field'}).click();
 const name=page.getByLabel('Field Name');
 await expect(name).toHaveJSProperty('tagName','SELECT');
 const labels=await name.locator('option').allTextContents();
 for(const expected of ['North block','South block','Main field','Other (type name)'])expect(labels).toContain(expected);
 await expect(page.locator('.wizard-progress span.on')).toHaveCount(1);
 await page.locator('.wizard-content').screenshot({path:info.outputPath('name-dropdown-empty.png')});
 await name.selectOption('South block');
 await page.getByLabel('Crop Type').selectOption('Potato');
 await page.getByRole('button',{name:'Next',exact:true}).click();
 await expect(page.getByText('Step 2 of 4')).toBeVisible();
 await expect(page.locator('.wizard-progress span.on')).toHaveCount(2);
 await page.getByRole('button',{name:'Next',exact:true}).click();
 await page.getByRole('button',{name:'Back',exact:true}).click();
 await page.locator('.wizard-content').screenshot({path:info.outputPath('name-dropdown-step2.png')});
});
