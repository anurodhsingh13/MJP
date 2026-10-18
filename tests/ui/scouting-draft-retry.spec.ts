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
 await expect.poll(()=>page.evaluate(id=>sessionStorage.getItem('terrascope:scouting-draft:'+id),fieldId)).not.toBeNull();
 await page.reload();
 await expect(page.getByRole('textbox',{name:'Symptoms'})).toHaveValue('Yellow leaf tips');
 await expect(page.getByRole('textbox',{name:'Notes',exact:true})).toHaveValue('Check again tomorrow');
});

test('retry after temporary failure saves once and clears the draft',async({page})=>{
 await page.route('**/api/auth/session',route=>route.fulfill({json:{mode:'local',user:null}}));
 await page.route('**/api/fields',route=>route.fulfill({json:[field]}));
 let attempts=0;
 const savedBodies:Array<{client_key?:string;notes?:string}>=[];
 await page.route('**/api/fields/**',async route=>{
  const url=route.request().url();
  if(route.request().method()==='POST'&&url.endsWith('/scouting')){
   attempts++;
   const body=route.request().postDataJSON() as {client_key:string;notes:string};
   if(attempts===1)return route.fulfill({status:503,json:{error:'Temporary failure'}});
   savedBodies.push(body);
   return route.fulfill({status:201,json:{id:'00000000-0000-0000-0000-000000000092',field_id:fieldId,client_key:body.client_key,observed_on:'2026-10-19',notes:body.notes,symptoms:'',photos:[]}});
  }
  if(url.endsWith('/scouting'))return route.fulfill({json:{cases:[],diagnosis:{status:'unavailable'}}});
  return route.fulfill({json:[]});
 });
 await page.goto('/fields/'+fieldId+'/history');
 await page.locator('.scouting-panel textarea').nth(1).fill('Retry this observation');
 await page.locator('#scouting-photo').setInputFiles({name:'leaf.jpg',mimeType:'image/jpeg',buffer:Buffer.from([255,216,255,217])});
 await page.getByRole('button',{name:'Save scouting note'}).click();
 await expect(page.getByText(/Photo could not be saved/)).toBeVisible();
 const retryKey=await page.evaluate(id=>JSON.parse(sessionStorage.getItem('terrascope:scouting-draft:'+id)??'{}').client_key as string,fieldId);
 await page.getByRole('button',{name:'Save scouting note'}).click();
 await expect(page.getByText('Photo and field note saved.')).toBeVisible();
 expect(attempts).toBe(2);
 expect(savedBodies[0]?.client_key).toBe(retryKey);
 await expect(page.locator('.scouting-panel textarea').nth(1)).toHaveValue('');
 await expect.poll(()=>page.evaluate(id=>sessionStorage.getItem('terrascope:scouting-draft:'+id),fieldId)).toBeNull();
});
