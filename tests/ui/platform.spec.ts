import {test,expect} from '@playwright/test';
import {setup,id} from './fixtures';
import {demoForecast} from '../../shared/forecast';

test('demo forecast, independent processed layers and synthetic report labels work without providers',async({page})=>{
 await page.goto('/?demo=1');
 const forecast=page.getByRole('region',{name:'Seven-day forecast',exact:true}).first();await expect(forecast.locator('.forecast-days article')).toHaveCount(7);
 await expect(forecast).toContainText('Synthetic demo forecast');
 await page.getByRole('heading',{name:'Wheat North',exact:true}).getByRole('link').click();
 await page.getByRole('link',{name:'Field map',exact:true}).click();
 const comparison=page.getByRole('region',{name:'Processed satellite image comparison',exact:true});
 await expect(comparison.locator('.open-field-map')).toHaveCount(2);await expect(comparison).toContainText('Illustrative demo layers');
 const before=comparison.getByLabel('Before acquisition',{exact:true});const after=comparison.getByLabel('After acquisition',{exact:true});
 const current=await after.inputValue();await before.selectOption(current);await expect(comparison.getByRole('alert')).toContainText('Choose two different');
 await page.getByRole('link',{name:'Field report',exact:true}).click();
 await expect(page.getByText('Synthetic demo report — these are fictional records, not real satellite evidence.',{exact:true})).toBeVisible();
 const appendix=page.getByRole('region',{name:'Additional monitoring report',exact:true});await expect(appendix).toContainText('All report values and forecasts are synthetic demo fixtures.');
});

test('forecast failure is separate from historical data and retry is functional',async({page})=>{
 await setup(page);let fail=true;
 await page.route(`**/api/fields/${id}/forecast`,route=>fail?route.fulfill({status:502,json:{error:'Unavailable'}}):route.fulfill({json:demoForecast()}));
 await page.goto(`/fields/${id}/overview`);const forecast=page.getByRole('region',{name:'Seven-day forecast',exact:true});
 await expect(forecast).toContainText('Forecast unavailable.');fail=false;await forecast.getByRole('button',{name:'Retry forecast',exact:true}).click();
 await expect(forecast.locator('.forecast-days article')).toHaveCount(7);
 await page.setViewportSize({width:320,height:568});await forecast.scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});

test('offline draft retains text in this tab and retries the same identity on reconnect',async({page})=>{
 await setup(page);let attempts=0;const keys:string[]=[];
 await page.route(`**/api/fields/${id}/events`,route=>{
  if(route.request().method()==='GET')return route.fulfill({json:[]});const body=route.request().postDataJSON();keys.push(body.client_key);attempts++;
  return attempts===1?route.fulfill({status:503,json:{error:'Retry'}}):route.fulfill({status:201,json:{id:'saved-draft',...body}});
 });
 await page.goto(`/fields/${id}/history`);const draft=page.getByRole('region',{name:'Offline note draft',exact:true});
 await draft.getByLabel('Draft note',{exact:true}).fill('Irrigation outlet needs a field visit.');await draft.getByRole('button',{name:'Sync draft now',exact:true}).click();
 await expect(draft.getByRole('alert')).toContainText('draft is retained');await page.reload();
 await expect(draft.getByLabel('Draft note',{exact:true})).toHaveValue('Irrigation outlet needs a field visit.');
 await page.evaluate(()=>window.dispatchEvent(new Event('offline')));await draft.getByLabel('Sync automatically when this tab reconnects',{exact:true}).check();
 await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect(draft.getByRole('status')).toContainText('Draft synced');
 expect(keys).toHaveLength(2);expect(keys[0]).toBe(keys[1]);
});

test('browser permission is requested only by explicit notification opt-in and denial is respected',async({page})=>{
 await page.addInitScript(()=>{Reflect.set(window,'permissionRequests',0);class FakeNotification{static permission='default';static async requestPermission(){Reflect.set(window,'permissionRequests',Number(Reflect.get(window,'permissionRequests'))+1);return 'denied';}}Object.defineProperty(window,'Notification',{value:FakeNotification,configurable:true});});
 await setup(page);await page.goto('/');expect(await page.evaluate(()=>Reflect.get(window,'permissionRequests'))).toBe(0);
 await page.getByLabel(/Notifications, \d+ unread/).click();const panel=page.getByRole('region',{name:'Notifications',exact:true});
 await panel.getByText('Notification preferences',{exact:true}).click();await panel.getByRole('button',{name:'Enable browser notifications',exact:true}).click();
 await expect(panel).toContainText('Permission was not granted');expect(await page.evaluate(()=>Reflect.get(window,'permissionRequests'))).toBe(1);
});

test('opt-in demo conversations persist and can be cleared',async({page})=>{
 await page.goto('/?demo=1');await page.getByRole('button',{name:'Ask crop assistant',exact:true}).click();
 const chat=page.getByRole('region',{name:'Crop assistant chat',exact:true});await chat.getByLabel('Save conversation history',{exact:true}).check();
 await chat.getByRole('button',{name:'Why is NDVI decreasing?',exact:true}).click();await expect(chat.locator('.assistant-answer-message')).toHaveCount(1);
 await page.reload();await page.getByRole('button',{name:'Ask crop assistant',exact:true}).click();await chat.getByLabel('Save conversation history',{exact:true}).check();await expect(chat.locator('.assistant-answer-message')).toHaveCount(1);
 await chat.getByRole('button',{name:'Clear all saved history',exact:true}).click();await expect(chat.locator('.assistant-answer-message')).toHaveCount(0);
});
