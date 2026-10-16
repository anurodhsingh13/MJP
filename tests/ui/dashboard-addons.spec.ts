import {test,expect} from '@playwright/test';
test('dashboard preserves existing fields and shows all eight additive panels in standalone demo',async({page})=>{
 await page.goto('/?demo=1');
 await expect(page.locator('.farmer-field-card')).toHaveCount(8);
 const addons=page.getByRole('region',{name:'Farm insights and previews'});
 await expect(addons).toBeVisible();
 for(const heading of ['All fields on one map','Weather · last 7 days','Crop insights','Compare two satellite dates','Recent field activity','Upcoming field visits','Ask Sarvam AI','Crop photo gallery']){
  await expect(addons.getByRole('heading',{name:heading})).toBeVisible();
 }
 await expect(addons.locator('.addon-map .leaflet-interactive').first()).toBeVisible();
 await expect(addons.locator('.addon-weather-days>div')).toHaveCount(7);
 await expect(addons.locator('.addon-insight').first()).toContainText('NDVI');
 await expect(addons.locator('.addon-comparison-images .addon-satellite-tile')).toHaveCount(2);
 await expect(addons.locator('.addon-gallery-grid img')).toHaveCount(4);
});

test('dashboard quick question opens existing AI chat and prefills a question',async({page})=>{
 await page.goto('/?demo=1');
 await page.getByRole('button',{name:'Explain NDVI in simple terms'}).click();
 await expect(page.getByRole('region',{name:'Crop assistant chat'})).toBeVisible();
 await expect(page.getByRole('textbox',{name:'Your question'})).toHaveValue('Explain NDVI in simple terms');
});

test('dashboard image comparison changes when different field is selected',async({page})=>{
 await page.goto('/?demo=1');
 const area=page.locator('.addon-comparison');
 await expect(area).toContainText('Wheat North');
 await area.getByLabel('Field').selectOption({label:'Rice East'});
 await expect(area).toContainText('Rice East');
 await expect(area.locator('.addon-satellite-tile')).toHaveCount(2);
});
