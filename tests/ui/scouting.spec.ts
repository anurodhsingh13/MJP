import {expect,test} from '@playwright/test';

test.use({baseURL:'http://127.0.0.1:5175'});
const id='00000000-0000-0000-0000-000000000161';
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/hZsAAAAASUVORK5CYII=','base64');

test('scouting photo remains retryable and never fabricates a diagnosis',async({page})=>{
 let failFirst=true;const keys:string[]=[];
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(path==='/api/auth/session')return route.fulfill({json:{mode:'local',user:null}});
  if(path==='/api/fields')return route.fulfill({json:[{id,name:'Scouting field',crop:'Wheat',area_hectares:2,latitude:28,longitude:77,planting_date:null,harvest_date:null}]});
  if(path.endsWith('/events'))return route.fulfill({json:[]});
  if(path.endsWith('/scouting')&&request.method()==='GET')return route.fulfill({json:{cases:[],diagnosis:{status:'unavailable',provider:null,reason:'No configured provider'}}});
  if(path.endsWith('/tasks'))return route.fulfill({json:[]});
  if(path.endsWith('/scouting')&&request.method()==='POST'){
   const body=request.postDataJSON() as {client_key:string;image:string};keys.push(body.client_key);
   expect(body.image).toMatch(/^data:image\/png;base64,/);
   if(failFirst){failFirst=false;return route.fulfill({status:503,json:{error:'Photo could not be saved. Keep your draft and retry.'}});}
   return route.fulfill({status:201,json:{id:'case-1',observed_on:'2026-10-15',crop:'Wheat',symptoms:'Leaf spots',notes:'North row',diagnosis_status:'unavailable',diagnosis:{status:'unavailable'},photos:[{id:'00000000-0000-0000-0000-000000000162',width:1,height:1,quality:'needs_review'}]}});
  }
  if(path.includes('/photos/'))return route.fulfill({status:200,contentType:'image/png',body:image});
  return route.fulfill({json:[]});
 });
 await page.goto(`/fields/${id}/history`);
 await expect(page.getByRole('heading',{name:'Events & History'})).toBeVisible();
 await page.getByLabel('Scouting observation date').fill('2026-10-15');
 await page.getByLabel('Symptoms').fill('Leaf spots');
 await page.getByLabel('Notes').last().fill('North row');
 await page.getByLabel('Crop photo').setInputFiles({name:'crop.png',mimeType:'image/png',buffer:image});
 await page.getByRole('button',{name:'Save scouting note'}).click();
 await expect(page.getByRole('alert')).toContainText('Keep your draft and retry');
 await expect(page.getByLabel('Symptoms')).toHaveValue('Leaf spots');
 await page.getByRole('button',{name:'Save scouting note'}).click();
 await expect(page.getByText('Diagnosis unavailable. No disease, confidence or treatment has been inferred.')).toBeVisible();
 await expect(page.getByAltText(/Farmer scouting photo/)).toBeVisible();
 expect(keys).toHaveLength(2);expect(keys[0]).toBe(keys[1]);
});
