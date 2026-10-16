import {test,expect} from '@playwright/test';
test('standalone showcase exposes 24 farms and no backend is required',async({page})=>{
 await page.goto('/?demo=1');
 await expect(page.getByRole('heading',{name:'Your farm. Your next step.'})).toBeVisible();
 await expect(page.locator('.farmer-field-card')).toHaveCount(24);
 await expect(page.locator('.farmer-field-card').first()).toContainText('Visit this field');
 const data=await page.evaluate(async()=>{
  const fields=await (await fetch('/api/fields')).json();
  const id=fields[0].id;
  return {fields,weather:await(await fetch('/api/fields/'+id+'/weather')).json(),
   scenes:await(await fetch('/api/fields/'+id+'/scenes')).json(),
   ndvi:await(await fetch('/api/fields/'+id+'/ndvi')).json(),
   events:await(await fetch('/api/fields/'+id+'/events')).json(),
   tasks:await(await fetch('/api/fields/'+id+'/tasks')).json()};
 });
 expect(data.fields).toHaveLength(24);expect(data.weather).toHaveLength(90);
 expect(data.scenes.length).toBeGreaterThan(0);
 expect(data.ndvi.length).toBeGreaterThan(0);
 expect(data.events.length).toBeGreaterThan(0);
 expect(data.tasks.length).toBeGreaterThan(0);
});
test('showcase dataset catalog includes six additional sources',async({page})=>{
 await page.goto('/?demo=1');
 await page.goto('/datasets');
 await expect(page.getByRole('heading',{name:'Soil Moisture Grid'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Satellite Scene Collection'})).toBeVisible();
});
test('showcase mode can be switched off without changing persisted field data',async({page})=>{
 await page.goto('/?demo=1');await expect(page.locator('.farmer-field-card')).toHaveCount(24);
 await page.goto('/?demo=0');
 expect(await page.evaluate(()=>sessionStorage.getItem('terrascope-showcase'))).toBe('0');
});
