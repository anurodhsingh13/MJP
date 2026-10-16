import {test,expect} from '@playwright/test';
import {setup} from './fixtures';

test('signed-in account and notification bell share the top header on desktop and mobile',async({page})=>{
 await setup(page);
 await page.route('**/api/auth/session',route=>route.fulfill({json:{mode:'required',user:{id:'header-user',email:'farmer@example.invalid'}}}));
 await page.goto('/');
 const header=page.locator('header.preferences-bar');
 const profile=header.getByLabel('Your account',{exact:true});
 const bell=header.getByLabel(/Notifications, \d+ unread/);
 await expect(profile).toBeVisible();await expect(bell).toBeVisible();
 await profile.click();await expect(header.getByText('farmer@example.invalid',{exact:true})).toBeVisible();
 await header.getByLabel('Name for your greeting').fill('Tushar');
 await header.getByRole('button',{name:'Save name'}).click();
 await expect(profile).toContainText('Tushar');
 await page.keyboard.press('Escape');await expect(header.getByText('farmer@example.invalid',{exact:true})).not.toBeVisible();
 await bell.click();
 const notifications=header.getByRole('region',{name:'Notifications',exact:true});
 await expect(notifications.getByText('Test field',{exact:true})).toBeVisible();
 await notifications.getByRole('button',{name:'Mark all read'}).click();
 await expect(header.getByLabel('Notifications, 0 unread',{exact:true})).toBeVisible();
 await page.reload();
 await expect(header.getByLabel('Notifications, 0 unread',{exact:true})).toBeVisible();
 await page.setViewportSize({width:320,height:568});
 await bell.click();await expect(notifications).toBeVisible();
 const bounds=await notifications.boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(320);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await page.keyboard.press('Escape');
 await profile.click();await expect(header.getByRole('button',{name:'Sign out'})).toBeVisible();
 await page.screenshot({path:test.info().outputPath('header-mobile.png')});
});

test('notification links open the relevant field and failures offer retry',async({page})=>{
 const state=await setup(page);await page.goto('/');
 await page.getByLabel(/Notifications, \d+ unread/).click();
 const panel=page.getByRole('region',{name:'Notifications',exact:true});
 await panel.getByRole('link').first().click();
 await expect(page).toHaveURL(/\/fields\/.*\/map/);
 await expect(panel).not.toBeVisible();
 state.fail.add('GET /api/fields');
 await page.reload();
 await page.getByLabel(/Notifications, \d+ unread/).click();
 await expect(panel.getByRole('alert')).toContainText('could not refresh');
 state.fail.clear();await panel.getByRole('button',{name:'Retry',exact:true}).click();
 await expect(panel.getByRole('alert')).toHaveCount(0);
});
