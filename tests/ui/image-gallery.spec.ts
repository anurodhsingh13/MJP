import {test,expect} from '@playwright/test';
test('photo references show in standalone demo dashboard and image gallery',async({page})=>{
 await page.goto('/?demo=1');
 await expect(page.locator('.field-crop-photo img')).toHaveCount(24);
 await page.getByRole('link',{name:'Crop & satellite photos'}).click();
 await expect(page).toHaveURL(/\/gallery/);
 await expect(page.locator('.crop-gallery-card')).toHaveCount(7);
 await expect(page.getByRole('heading',{name:'Satellite NDVI mosaic'})).toBeVisible();
 await expect(page.locator('.crop-gallery-card a[href^="https://"]')).toHaveCount(14);
});
test('field overview provides crop image source reference',async({page})=>{
 await page.goto('/?demo=1');
 await page.getByRole('heading',{name:'Wheat North',exact:true}).getByRole('link').click();
 await expect(page.locator('.field-overview-photo img')).toHaveCount(1);
 await expect(page.locator('.field-overview-photo a')).toHaveAttribute('href',/unsplash\.com/);
});
