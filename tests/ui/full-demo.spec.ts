import {test,expect} from '@playwright/test';

test('full demo populates every field workspace with local images and useful histories',async({page})=>{
 await page.goto('/?demo=1');
 await expect(page.locator('.farmer-field-card')).toHaveCount(24);
 const summary=await page.evaluate(async()=>{
  const fields=await(await fetch('/api/fields')).json();
  return Promise.all(fields.map(async(field:{id:string;harvest_date:string;expected_yield_tons:number})=>{
   const records=await Promise.all(['ndvi','weather','events','tasks','jobs','scouting'].map(async section=>(await fetch(`/api/fields/${field.id}/${section}`)).json()));
   return {id:field.id,harvest:field.harvest_date,yield:field.expected_yield_tons,counts:records.slice(0,5).map(items=>items.length),photos:records[5].cases.length};
  }));
 });
 expect(summary).toHaveLength(24);
 for(const field of summary){expect(field.harvest).toBeTruthy();expect(field.yield).toBeGreaterThan(0);expect(field.counts[1]).toBe(90);expect(field.counts[2]).toBe(12);expect(field.counts[3]).toBeGreaterThanOrEqual(4);expect(field.counts[4]).toBe(2);expect(field.photos).toBe(3);}
 expect(summary.filter(field=>field.counts[0]===18)).toHaveLength(23);
 const id=summary[0].id;
 await page.goto(`/fields/${id}/history`);
 const photos=page.getByAltText('Saved crop scouting photo');
 await expect(photos).toHaveCount(3);
 await photos.first().scrollIntoViewIfNeeded();
 await expect(photos.first()).toHaveJSProperty('naturalWidth',1000);
 await page.goto('/gallery');
 await expect(page.locator('.crop-gallery-card')).toHaveCount(7);
 for(const image of await page.locator('.crop-gallery-card img').all()){
  await image.scrollIntoViewIfNeeded();
  await expect.poll(()=>image.evaluate(element=>(element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
 }
});

test('demo edits and scouting deletion survive reload without using the real API',async({page})=>{
 await page.goto('/?demo=1');
 const changed=await page.evaluate(async()=>{
  const fields=await(await fetch('/api/fields')).json();
  const field=fields[0];
  const empty=fields.find((item:{latestObservation:unknown})=>!item.latestObservation);
  await fetch(`/api/fields/${empty.id}/jobs`,{method:'POST',body:JSON.stringify({kind:'satellite'})});
  const processed=await(await fetch(`/api/fields/${empty.id}`)).json();
  if(!processed.latestObservation?.accepted)throw new Error('Demo image processing did not populate the field');
  await fetch('/api/fields/'+field.id,{method:'PATCH',body:JSON.stringify({name:'Edited demo farm'})});
  const cases=(await(await fetch(`/api/fields/${field.id}/scouting`)).json()).cases;
  await fetch(`/api/fields/${field.id}/scouting/${cases[0].id}`,{method:'DELETE'});
  return field.id;
 });
 await page.reload();
 await expect(page.getByRole('heading',{name:'Edited demo farm',exact:true})).toBeVisible();
 expect(await page.evaluate(async id=>(await(await fetch(`/api/fields/${id}/scouting`)).json()).cases.length,changed)).toBe(2);
});
