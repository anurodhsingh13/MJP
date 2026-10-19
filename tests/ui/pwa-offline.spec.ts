import {test,expect} from '@playwright/test';
test('offline fallback explains limits without showing private field data',async({page})=>{
 await page.goto('/offline.html');
 await expect(page.getByRole('heading',{name:'You’re offline / आप ऑफ़लाइन हैं',exact:true})).toBeVisible();
 await expect(page.getByText('Reconnect to sign in', {exact:false})).toBeVisible();
 await expect(page.locator('main p').nth(1)).toBeVisible();
 await expect(page.getByRole('link',{name:'Reconnect / फिर खोलें'})).toBeVisible();
});
