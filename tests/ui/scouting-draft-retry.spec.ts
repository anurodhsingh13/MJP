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
 await page.locator('.scouting-panel textarea').nth(0).fill('Yellow leaf tips');
 await page.locator('.scouting-panel textarea').nth(1).fill('Check again tomorrow');
 await photo.setInputFiles({name:'leaf.jpg',mimeType:'image/jpeg',buffer:Buffer.from([255,216,255,217])});
 await page.getByRole('button',{name:'Save scouting note'}).click();
 await expect(page.getByText(/Photo could not be saved/)).toBeVisible();
 expect(await photo.evaluate(el=>(el as HTMLInputElement).files?.length)).toBe(1);
 await expect(page.locator('.scouting-panel textarea').nth(0)).toHaveValue('Yellow leaf tips');
 await expect.poll(()=>page.evaluate(id=>sessionStorage.getItem('terrascope:scouting-draft:'+id),fieldId)).not.toBeNull();
 await page.reload();
 await expect(page.locator('.scouting-panel textarea').nth(0)).toBeVisible();
 await expect(page.locator('.scouting-panel textarea').nth(0)).toHaveValue('Yellow leaf tips');
 await expect(page.locator('.scouting-panel textarea').nth(1)).toHaveValue('Check again tomorrow');
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
 await expect(page.locator('.scouting-panel textarea').nth(1)).toBeVisible();
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

test('photo-only draft keeps retry key and clearing draft removes stale notes',async({page})=>{
 await page.route('**/api/auth/session',route=>route.fulfill({json:{mode:'local',user:null}}));
 await page.route('**/api/fields',route=>route.fulfill({json:[field]}));
 await page.route('**/api/fields/**',route=>route.fulfill({json:route.request().url().endsWith('/scouting')?{cases:[]}:[]}));
 await page.goto('/fields/'+fieldId+'/history');
 const notes=page.locator('.scouting-panel textarea').nth(1);
 await expect(notes).toBeVisible();
 await notes.fill('Temporary note');
 await expect.poll(()=>page.evaluate(id=>sessionStorage.getItem('terrascope:scouting-draft:'+id),fieldId)).toContain('Temporary note');
 await notes.fill('');
 await expect.poll(()=>page.evaluate(id=>sessionStorage.getItem('terrascope:scouting-draft:'+id),fieldId)).toBeNull();
 await page.locator('#scouting-photo').setInputFiles({name:'leaf.jpg',mimeType:'image/jpeg',buffer:Buffer.from([255,216,255,217])});
 await expect.poll(()=>page.evaluate(id=>sessionStorage.getItem('terrascope:scouting-draft:'+id),fieldId)).not.toBeNull();
 const saved=await page.evaluate(id=>JSON.parse(sessionStorage.getItem('terrascope:scouting-draft:'+id)??'{}') as {client_key?:string},fieldId);
 expect(saved.client_key).toMatch(/^[0-9a-f-]{36}$/i);
});

test('scouting drafts remain isolated between fields during navigation',async({page})=>{
 const otherId='00000000-0000-0000-0000-000000000093';
 const otherField={...field,id:otherId,name:'Second Test Field'};
 await page.route('**/api/auth/session',route=>route.fulfill({json:{mode:'local',user:null}}));
 await page.route('**/api/fields',route=>route.fulfill({json:[field,otherField]}));
 await page.route('**/api/fields/**',route=>{
  const url=route.request().url();
  if(url.endsWith('/scouting'))return route.fulfill({json:{cases:[],diagnosis:{status:'unavailable'}}});
  return route.fulfill({json:[]});
 });
 await page.goto('/fields/'+fieldId+'/history');
 const notes=page.locator('.scouting-panel textarea').nth(1);
 await expect(notes).toBeVisible();
 await notes.fill('Only first field observation');
 await expect.poll(()=>page.evaluate(id=>sessionStorage.getItem('terrascope:scouting-draft:'+id),fieldId)).toContain('Only first field observation');
 await page.goto('/fields/'+otherId+'/history');
 await expect(notes).toBeVisible();
 await expect(notes).toHaveValue('');
 await notes.fill('Only second field observation');
 await expect.poll(()=>page.evaluate(id=>sessionStorage.getItem('terrascope:scouting-draft:'+id),otherId)).toContain('Only second field observation');
 await page.goto('/fields/'+fieldId+'/history');
 await expect(notes).toHaveValue('Only first field observation');
 await page.goto('/fields/'+otherId+'/history');
 await expect(notes).toHaveValue('Only second field observation');
});

test('late photo upload from another field cannot overwrite current draft',async({page})=>{
 const otherId='00000000-0000-0000-0000-000000000094';
 const otherField={...field,id:otherId,name:'Other Field'};
 let releaseUpload: (()=>void)|undefined;
 const uploadStarted=new Promise<void>(resolve=>{releaseUpload=resolve;});
 let finishUpload: (()=>void)|undefined;
 const uploadBlocked=new Promise<void>(resolve=>{finishUpload=resolve;});
 let uploadResponded: (()=>void)|undefined;
 const uploadResponseSent=new Promise<void>(resolve=>{uploadResponded=resolve;});
 await page.route('**/api/auth/session',route=>route.fulfill({json:{mode:'local',user:null}}));
 await page.route('**/api/fields',route=>route.fulfill({json:[field,otherField]}));
 await page.route('**/api/fields/**',async route=>{
  const url=route.request().url();
  if(route.request().method()==='POST'&&url.endsWith('/scouting')){
   releaseUpload?.();
   await uploadBlocked;
   await route.fulfill({status:201,json:{id:'00000000-0000-0000-0000-000000000095',field_id:fieldId,photos:[]}});
   uploadResponded?.();
   return;
  }
  if(url.endsWith('/scouting'))return route.fulfill({json:{cases:[],diagnosis:{status:'unavailable'}}});
  return route.fulfill({json:[]});
 });
 await page.goto('/fields/'+fieldId+'/history');
 await expect(page.locator('#scouting-photo')).toBeVisible();
 await page.locator('#scouting-photo').setInputFiles({name:'leaf.jpg',mimeType:'image/jpeg',buffer:Buffer.from([255,216,255,217])});
 await page.getByRole('button',{name:'Save scouting note'}).click();
 await uploadStarted;
 // SPA navigation keeps the in-flight request alive; page.goto would reload and cancel it.
 await page.evaluate(id=>{history.pushState({},'', '/fields/'+id+'/history');window.dispatchEvent(new PopStateEvent('popstate'));},otherId);
 const notes=page.locator('.scouting-panel textarea').nth(1);
 await expect(notes).toBeVisible();
 await notes.fill('Keep this second field draft');
 await expect.poll(()=>page.evaluate(id=>sessionStorage.getItem('terrascope:scouting-draft:'+id),otherId)).toContain('Keep this second field draft');
 finishUpload?.();
 await uploadResponseSent;
 await expect(notes).toHaveValue('Keep this second field draft');
 await expect(page.getByText('Photo and field note saved.')).toHaveCount(0);
 await expect.poll(()=>page.evaluate(id=>sessionStorage.getItem('terrascope:scouting-draft:'+id),otherId)).toContain('Keep this second field draft');
});
