import {test,expect} from '@playwright/test';

const fieldId='00000000-0000-0000-0000-000000000091';
const field={id:fieldId,name:'Photo Test Field',crop:'Wheat',area_hectares:1,health_score:null,ndvi_average:null,canopy_coverage:0,health_delta:null,last_observation:null,latitude:null,longitude:null,planting_date:null,harvest_date:null,expected_yield_tons:null};

test('failed scouting upload keeps notes, selected photo, and restores text draft after reload',async({page})=>{
 await page.route('**/api/auth/session',route=>route.fulfill({json:{mode:'local',user:null}}));
 await page.route('**/api/fields',route=>route.fulfill({json:[field]}));
 await page.route('**/api/fields/**',route=>{
  const url=route.request().url();
  const method=route.request().method();
  if(method==='POST'&&url.endsWith('/scouting'))return route.fulfill({status:503,json:{error:'Temporary upload failure'}});
  if(url.endsWith('/scouting'))return route.fulfill({json:{cases:[],diagnosis:{status:'unavailable'}}});
  return route.fulfill({json:[]});
 });
 await page.goto('/fields/'+fieldId+'/history');
 const photo=page.locator('#scouting-photo');
 await expect(photo).toBeVisible();
 await page.getByRole('textbox',{name:'Symptoms'}).fill('Yellow leaf tips');
 await page.getByRole('textbox',{name:'Notes',exact:true}).fill('Check again tomorrow');
 await photo.setInputFiles({name:'leaf.jpg',mimeType:'image/jpeg',buffer:Buffer.from([255,216,255,217])});
 await page.getByRole('button',{name:'Save scouting note'}).click();
 await expect(page.getByText(/Photo could not be saved/)).toBeVisible();
 expect(await photo.evaluate(el=>(el as HTMLInputElement).files?.length)).toBe(1);
 await expect(page.getByRole('textbox',{name:'Symptoms'})).toHaveValue('Yellow leaf tips');
 await page.reload();
 await expect(page.getByRole('textbox',{name:'Symptoms'})).toHaveValue('Yellow leaf tips');
 await expect(page.getByRole('textbox',{name:'Notes',exact:true})).toHaveValue('Check again tomorrow');
});
