import { test, expect } from '@playwright/test';

test('AI assistant appears and answers a Hindi crop question in demo mode',async({page})=>{
 await page.goto('/?demo=1');
 const launcher=page.getByRole('button',{name:'Ask crop assistant'});
 await expect(launcher).toBeVisible();
 await launcher.click();
 const panel=page.getByRole('region',{name:'Crop assistant chat'});
 await expect(panel).toBeVisible();
 await expect(panel).toContainText('Example answers');
 await page.getByRole('button',{name:'Why is NDVI decreasing?'}).click();
 await expect(panel).toContainText('NDVI');
 await expect(panel).toContainText('vegetation greenness');
 await page.getByRole('button',{name:'Close assistant'}).click();
 await expect(panel).not.toBeVisible();
});

test('AI assistant receives selected crop field context',async({page})=>{
 await page.goto('/?demo=1');
 await page.getByRole('link',{name:'Wheat North'}).first().click();
 await expect(page).toHaveURL(/\/fields\/.*\/overview/);
 await page.getByRole('button',{name:'Ask crop assistant'}).click();
 await page.getByRole('button',{name:'Explain the weather data'}).click();
 const panel=page.getByRole('region',{name:'Crop assistant chat'});
 await expect(panel).toContainText('Wheat North');
 await expect(panel).toContainText('temperature');
});
