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
 const responseReceived=page.waitForResponse(response=>response.url().includes('/api/fields/'+fieldId+'/scouting')&&response.request().method()==='POST');
 finishUpload?.();
 await uploadResponseSent;
 const response=await responseReceived;
 expect(response.status()).toBe(201);
 // Give the browser a task boundary after resolving the upload response so React's
 // async continuation can run before checking for stale updates.
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 await expect(notes).toHaveValue('Keep this second field draft');
 await expect(page.getByText('Photo and field note saved.')).toHaveCount(0);
 await expect.poll(()=>page.evaluate(id=>sessionStorage.getItem('terrascope:scouting-draft:'+id),otherId)).toContain('Keep this second field draft');
});

test('A-B-A navigation ignores old upload completion and keeps restored draft',async({page})=>{
 const otherId='00000000-0000-0000-0000-000000000096';
 let uploadStarted!:()=>void;
 const started=new Promise<void>(resolve=>{uploadStarted=resolve;});
 let release!:()=>void;
 const blocked=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/auth/session',route=>route.fulfill({json:{mode:'local',user:null}}));
 await page.route('**/api/fields',route=>route.fulfill({json:[field,{...field,id:otherId,name:'Other Field'}]}));
 await page.route('**/api/fields/**',async route=>{
  const url=route.request().url();
  if(route.request().method()==='POST'&&url.endsWith('/scouting')){
   uploadStarted();
   await blocked;
   return route.fulfill({status:201,json:{id:'00000000-0000-0000-0000-000000000097',field_id:fieldId,photos:[]}});
  }
  if(url.endsWith('/scouting'))return route.fulfill({json:{cases:[],diagnosis:{status:'unavailable'}}});
  return route.fulfill({json:[]});
 });
 const navigate=async(id:string)=>page.evaluate(id=>{history.pushState({},'', '/fields/'+id+'/history');window.dispatchEvent(new PopStateEvent('popstate'));},id);
 await page.goto('/fields/'+fieldId+'/history');
 const notes=page.locator('.scouting-panel textarea').nth(1);
 await expect(notes).toBeVisible();
 await notes.fill('Original A draft');
 await page.locator('#scouting-photo').setInputFiles({name:'leaf.jpg',mimeType:'image/jpeg',buffer:Buffer.from([255,216,255,217])});
 await page.getByRole('button',{name:'Save scouting note'}).click();
 await started;
 await navigate(otherId);
 await expect(notes).toBeVisible();
 await navigate(fieldId);
 await expect(notes).toHaveValue('Original A draft');
 const responseReceived=page.waitForResponse(response=>response.url().includes('/api/fields/'+fieldId+'/scouting')&&response.request().method()==='POST');
 release();
 await responseReceived;
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 await expect(notes).toHaveValue('Original A draft');
 await expect(page.getByText('Photo and field note saved.')).toHaveCount(0);
 await expect.poll(()=>page.evaluate(id=>sessionStorage.getItem('terrascope:scouting-draft:'+id),fieldId)).toContain('Original A draft');
});

test('late diary event response cannot overwrite the next field',async({page})=>{
 const otherId='00000000-0000-0000-0000-000000000098';
 let started!:()=>void;
 const requestStarted=new Promise<void>(resolve=>{started=resolve;});
 let release!:()=>void;
 const blocked=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/auth/session',route=>route.fulfill({json:{mode:'local',user:null}}));
 await page.route('**/api/fields',route=>route.fulfill({json:[field,{...field,id:otherId,name:'Second Field'}]}));
 await page.route('**/api/fields/**',async route=>{
  const url=route.request().url();
  if(route.request().method()==='POST'&&url.endsWith('/events')){
   started();
   await blocked;
   return route.fulfill({status:201,json:{id:'00000000-0000-0000-0000-000000000099',field_id:fieldId,event_type:'irrigation',event_date:'2026-10-19',notes:'First field only'}});
  }
  if(url.endsWith('/scouting'))return route.fulfill({json:{cases:[],diagnosis:{status:'unavailable'}}});
  return route.fulfill({json:[]});
 });
 await page.goto('/fields/'+fieldId+'/history');
 const form=page.locator('.diary-form form');
 await expect(form).toBeVisible();
 await form.locator('select').selectOption('irrigation');
 await form.locator('input[type="date"]').fill('2026-10-19');
 await form.locator('textarea').fill('First field only');
 await form.getByRole('button',{name:'Save Event'}).click();
 await requestStarted;
 await page.evaluate(id=>{history.pushState({},'', '/fields/'+id+'/history');window.dispatchEvent(new PopStateEvent('popstate'));},otherId);
 await expect(form).toBeVisible();
 await form.locator('textarea').fill('Second field pending note');
 const responseReceived=page.waitForResponse(response=>response.url().includes('/api/fields/'+fieldId+'/events')&&response.request().method()==='POST');
 release();
 await responseReceived;
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 await expect(form.locator('textarea')).toHaveValue('Second field pending note');
 await expect(page.getByText('First field only')).toHaveCount(0);
});

test('late photo-note deletion does not remove notes from another field',async({page})=>{
 const otherId='00000000-0000-0000-0000-0000000000a1';
 const caseId='00000000-0000-0000-0000-0000000000a2';
 let started!:()=>void,release!:()=>void;
 const pending=new Promise<void>(resolve=>{started=resolve;});
 const blocked=new Promise<void>(resolve=>{release=resolve;});
 page.on('dialog',dialog=>dialog.accept());
 await page.route('**/api/auth/session',route=>route.fulfill({json:{mode:'local',user:null}}));
 await page.route('**/api/fields',route=>route.fulfill({json:[field,{...field,id:otherId,name:'Other Field'}]}));
 await page.route('**/api/fields/**',async route=>{
  const url=route.request().url();
  if(route.request().method()==='DELETE'&&url.endsWith('/scouting/'+caseId)){started();await blocked;return route.fulfill({status:204,body:''});}
  if(url.endsWith('/scouting'))return route.fulfill({json:{cases:url.includes(otherId)?[{id:'00000000-0000-0000-0000-0000000000a3',observed_on:'2026-10-19',notes:'Other field note',photos:[]}]:[{id:caseId,observed_on:'2026-10-19',notes:'Original field note',photos:[]}]}});
  return route.fulfill({json:[]});
 });
 await page.goto('/fields/'+fieldId+'/history');
 await expect(page.getByText('Original field note')).toBeVisible();
 await page.getByRole('button',{name:'Delete photo note'}).click();
 await pending;
 await page.evaluate(id=>{history.pushState({},'', '/fields/'+id+'/history');window.dispatchEvent(new PopStateEvent('popstate'));},otherId);
 await expect(page.getByText('Other field note')).toBeVisible();
 const responded=page.waitForResponse(response=>response.request().method()==='DELETE'&&response.url().endsWith('/scouting/'+caseId));
 release();
 await responded;
 await expect(page.getByText('Other field note')).toBeVisible();
});

test('late task status update cannot change a different field task',async({page})=>{
 const otherId='00000000-0000-0000-0000-0000000000b1';
 const firstTask='00000000-0000-0000-0000-0000000000b2';
 const secondTask='00000000-0000-0000-0000-0000000000b3';
 let started!:()=>void,release!:()=>void;
 const pending=new Promise<void>(resolve=>{started=resolve;});
 const blocked=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/auth/session',route=>route.fulfill({json:{mode:'local',user:null}}));
 await page.route('**/api/fields',route=>route.fulfill({json:[field,{...field,id:otherId,name:'Other Field'}]}));
 await page.route('**/api/fields/**',async route=>{
  const url=route.request().url();
  if(route.request().method()==='PATCH'&&url.includes(firstTask)){started();await blocked;return route.fulfill({status:200,json:{id:firstTask,status:'resolved'}});}
  if(url.endsWith('/tasks'))return route.fulfill({json:url.includes(otherId)?[{id:secondTask,title:'Second field check',status:'open',due_on:null}]:[{id:firstTask,title:'First field check',status:'open',due_on:null}]});
  if(url.endsWith('/scouting'))return route.fulfill({json:{cases:[]}});
  return route.fulfill({json:[]});
 });
 await page.goto('/fields/'+fieldId+'/history');
 const first=page.getByRole('combobox',{name:/Task state for First field check/});
 await expect(first).toBeVisible();
 await first.selectOption('resolved');
 await pending;
 await page.evaluate(id=>{history.pushState({},'', '/fields/'+id+'/history');window.dispatchEvent(new PopStateEvent('popstate'));},otherId);
 const second=page.getByRole('combobox',{name:/Task state for Second field check/});
 await expect(second).toHaveValue('open');
 const responseReceived=page.waitForResponse(response=>response.url().includes(firstTask)&&response.request().method()==='PATCH');
 release();
 const response=await responseReceived;
 expect(response.status()).toBe(200);
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 await expect(second).toHaveValue('open');
 await expect(second).toBeEnabled();
 await expect(page.getByText('Some diary records could not be loaded.')).toHaveCount(0);
});
