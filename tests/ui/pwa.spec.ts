import {test,expect} from '@playwright/test';
test.use({baseURL:'http://127.0.0.1:5176'});
test('production PWA has an offline public shell and never caches private API data',async({page,context})=>{
 await page.route('**/api/**',route=>route.fulfill({json:new URL(route.request().url()).pathname==='/api/auth/session'?{mode:'local',user:null}:[]}));
 await page.goto('/');
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
 await expect.poll(()=>page.evaluate(()=>Boolean(navigator.serviceWorker.controller))).toBeTruthy();
 const manifest=await page.evaluate(async()=>await(await fetch('/manifest.webmanifest')).json());expect(manifest.display).toBe('standalone');expect(manifest.icons).toHaveLength(2);
 await page.evaluate(async()=>{await fetch('/api/private-test');});
 const keys=await page.evaluate(async()=>{const result:string[]=[];for(const name of await caches.keys())for(const request of await(await caches.open(name)).keys())result.push(request.url);return result;});
 expect(keys.some(url=>url.includes('/api/'))).toBe(false);expect(keys.some(url=>url.endsWith('/offline.html'))).toBe(true);
 await context.setOffline(true);await page.goto('/help');await expect(page.getByRole('heading',{name:'You’re offline / आप ऑफ़लाइन हैं',exact:true})).toBeVisible();
 await expect(page.locator('body')).not.toContainText('private-test');await context.setOffline(false);
});
