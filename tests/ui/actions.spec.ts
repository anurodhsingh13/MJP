import { test, expect, type Page } from '@playwright/test';

const browserErrors = new WeakMap<Page, string[]>();
test.afterEach(async ({ page }) => { expect(browserErrors.get(page) || [], 'Unhandled browser errors').toEqual([]); });

const id = '00000000-0000-0000-0000-000000000001';
const seed: any = { id, name: 'Test field', crop: 'Wheat', area_hectares: 10, latitude:28, longitude:77,
  boundary_geojson:{type:'Polygon',coordinates:[[[77,28],[77.01,28],[77.01,28.01],[77,28.01],[77,28]]]},
  planting_date:'2026-09-01', harvest_date:'2026-12-01', last_observation:null, expected_yield_tons:null };

async function setup(page: Page) {
  const errors: string[] = []; browserErrors.set(page, errors); page.on('pageerror', error => errors.push(error.message));
  const state = { fields:[{...seed}], events:[] as any[], scenes:[] as any[], alerts:[{id:'alert-1',title:'Stress detected',scene_id:'scene-1',resolved:false,severity:'high'}],
    fail: new Set<string>(), calls: [] as string[], created:0 };
  await page.route('**/api/**', async route => {
    const req=route.request(), url=new URL(req.url()), path=url.pathname;
    const action=`${req.method()} ${path}`;state.calls.push(action+url.search);
    if(state.fail.has(action)) return route.fulfill({status:503,json:{error:'Service temporarily unavailable'}});
    let body:any={};
    if(path==='/api/fields') {
      if(req.method()==='POST') { state.created++; const field={...seed,...req.postDataJSON()}; state.fields.push(field); body=field; }
      else body=state.fields;
    } else if(path.endsWith('/events')) {
      if(req.method()==='POST') { const event={id:'event-1',...req.postDataJSON()};state.events.push(event);body=event; }
      else body=state.events;
    } else if(path.includes('/events/')) { state.events=[]; return route.fulfill({status:204}); }
    else if(path.endsWith('/resolve')) {state.alerts=state.alerts.map(a=>({...a,resolved:true}));}
    else if(path.endsWith('/alerts')) body=state.alerts;
    else if(path.endsWith('/ingest/sentinel-scenes')) {state.scenes=[{scene_id:'scene-1',observed_at:'2026-10-01',cloud_cover:5},{scene_id:'scene-2',observed_at:'2026-09-25',cloud_cover:10}];body={imported:2};}
    else if(path.endsWith('/scenes')) body=state.scenes;
    else if(path.includes('/ndvi/from-scene/')) body={ndvi:.7,validCoverage:90};
    else if(path.endsWith('/ndvi/analysis')) body={status:'insufficient_data',statusLabel:'Not enough data',summary:'Two observations required.'};
    else if(path.endsWith('/ingest/weather')) body={imported:7};
    else if(path.endsWith('/ndvi')||path.endsWith('/weather')) body=[];
    else if(path==='/api/assistant') body={answer:'Review field moisture.'};
    else if(path===`/api/fields/${id}`) {
      if(req.method()==='DELETE') {state.fields=[];return route.fulfill({status:204});}
      Object.assign(state.fields[0],req.postDataJSON());body=state.fields[0];
    }
    await route.fulfill({json:body});
  });
  // Replace the external Maps SDK only. Real UI controls and API requests still run in Chrome.
  await page.addInitScript(() => {
    class Path {
      points:any[]=[];listeners:Function[]=[];
      constructor(points:any[]){this.points=points.map(p=>({lat:()=>p.lat,lng:()=>p.lng}));}
      getLength(){return this.points.length;}getAt(i:number){return this.points[i];}
      addListener(_name:string,fn:Function){this.listeners.push(fn);}
      push(p:any){this.points.push(p);this.listeners.forEach(fn=>fn());}
      pop(){this.points.pop();this.listeners.forEach(fn=>fn());}
      clear(){this.points=[];this.listeners.forEach(fn=>fn());}
    }
    class Map {
      data={setStyle(){},forEach(){},remove(){},addGeoJson(){return [{setProperty(){}}];}};
      overlayMapTypes={clear(){},push(){}};
      constructor(public element:HTMLElement){element.style.minHeight='320px';element.setAttribute('aria-label','Test map');}
      addListener(name:string,fn:Function){if(name==='click')this.element.addEventListener('click',e=>fn({latLng:{lat:()=>28+e.offsetY/10000,lng:()=>77+e.offsetX/10000}}));}
      setCenter(){}setZoom(){}
    }
    class Polygon {path:Path;constructor(options:any){this.path=new Path(options.paths);}getPath(){return this.path;}setMap(){} }
    const maps:any={Map,Polygon,AdvancedMarkerElement:class {},ImageMapType:class {},Size:class {},spherical:{computeArea(){return 10000;}}};
    maps.importLibrary=async()=>maps;
    (window as any).google={maps};
  });
  return state;
}

test('dashboard retry, empty state, add wizard navigation and all boundary controls', async ({page}) => {
  const state=await setup(page);state.fields=[];
  state.fail.add('GET /api/fields');await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Service unavailable');
  state.fail.clear();await page.getByRole('button',{name:'Retry',exact:true}).click();
  await page.getByRole('button',{name:'Add your first field'}).click();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'+ Add field',exact:true}).click();
  await page.getByLabel('Field Name').fill('New field');await page.getByLabel('Crop Type').fill('Wheat');
  await page.getByRole('button',{name:'Next',exact:true}).click();
  await page.getByRole('button',{name:'Back',exact:true}).click();
  await page.getByRole('button',{name:'Next',exact:true}).click();
  await page.getByLabel('Planting Date').fill('2026-09-01');
  await page.getByRole('button',{name:'Next',exact:true}).click();
  const map=page.getByLabel('Test map');
  for(const p of [{x:40,y:40},{x:100,y:40},{x:100,y:100}])await map.click({position:p});
  await page.getByRole('button',{name:'Undo point'}).click();
  await expect(page.getByRole('button',{name:'Finish boundary'})).toBeDisabled();
  await page.getByRole('button',{name:'Clear',exact:true}).click();
  for(const p of [{x:40,y:40},{x:100,y:40},{x:100,y:100}])await map.click({position:p});
  await page.getByRole('button',{name:'Finish boundary'}).click();
  await page.getByRole('button',{name:'Review',exact:true}).click();
  await page.getByRole('button',{name:'Back',exact:true}).click();
  await page.getByRole('button',{name:'Review',exact:true}).click();
  state.fail.add(`POST /api/fields/${id}/ingest/sentinel-scenes`);
  await page.getByRole('button',{name:'Save & Analyse Field'}).click();
  await expect(page.getByRole('alert')).toContainText('Service temporarily unavailable');
  await expect(page.getByRole('button',{name:'Open saved field'})).toBeVisible();
  state.fail.clear();await page.getByRole('button',{name:'Retry Satellite Processing'}).click();
  await expect(page).toHaveURL(new RegExp(`/fields/${id}/map`));expect(state.created).toBe(1);
});

test('field manage cancel/save/delete, navigation and mobile layout', async ({page})=>{
  await setup(page);await page.goto('/');await page.getByRole('link',{name:/Test field/}).click();
  await page.getByRole('button',{name:'Manage field',exact:true}).click();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'Manage field',exact:true}).click();
  await page.getByLabel('Name',{exact:true}).fill('Renamed');
  await page.getByRole('button',{name:'Save changes'}).click();await expect(page.getByRole('heading',{name:'Renamed'})).toBeVisible();
  for(const tab of ['Health Analysis','Events & History','Satellite Map'])await page.getByRole('link',{name:tab,exact:true}).click();
  await page.setViewportSize({width:390,height:844});await page.getByRole('link',{name:'Events & History',exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
  await page.getByRole('button',{name:'Manage field',exact:true}).click();
  page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Delete field',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Delete field',exact:true}).click();await expect(page).toHaveURL('/');
});

test('history retries and event save/delete errors are recoverable',async({page})=>{
  const state=await setup(page);state.fail.add(`GET /api/fields/${id}/events`);await page.goto(`/fields/${id}/history`);
  await expect(page.getByRole('alert')).toBeVisible();state.fail.clear();await page.getByRole('button',{name:'Retry loading history'}).click();
  await page.getByLabel('Date',{exact:true}).fill('2026-10-01');await page.getByLabel('Notes (Optional)').fill('Test event');
  state.fail.add(`POST /api/fields/${id}/events`);await page.getByRole('button',{name:'Save Event'}).click();await expect(page.getByRole('alert')).toBeVisible();
  state.fail.clear();await page.getByRole('button',{name:'Save Event'}).click();await expect(page.getByText('Test event',{exact:true})).toBeVisible();
  state.fail.add(`DELETE /api/fields/${id}/events/event-1`);page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Delete',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();
  state.fail.clear();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Delete',exact:true}).click();await expect(page.getByText('No events recorded for this field.')).toBeVisible();
});

test('analysis retries, language, weather sync and assistant failures/success',async({page})=>{
  const state=await setup(page);state.fail.add(`GET /api/fields/${id}/ndvi/analysis`);await page.goto(`/fields/${id}/analysis`);
  await expect(page.getByRole('alert')).toBeVisible();state.fail.clear();await page.getByRole('button',{name:'Retry analysis'}).click();
  await expect(page.getByText('Two observations required.')).toBeVisible();
  await page.locator('select').selectOption('hi-IN');await expect(page.getByText('Two observations required.')).toBeVisible();
  expect(state.calls.some(c=>c.includes('language=hi-IN'))).toBeTruthy();
  state.fail.add(`POST /api/fields/${id}/ingest/weather`);await page.getByRole('button',{name:'Sync Weather Data'}).click();await expect(page.getByRole('status')).toContainText('Service temporarily unavailable');
  state.fail.clear();await page.getByRole('button',{name:'Sync Weather Data'}).click();await expect(page.getByRole('status')).toContainText('7 observations imported');
  await expect(page.getByRole('button',{name:'Ask AI'})).toBeDisabled();
  await page.getByRole('textbox',{name:'Question for field assistant'}).fill('How is my field?');
  state.fail.add('POST /api/assistant');await page.getByRole('button',{name:/Ask|Send/}).click();await expect(page.getByRole('alert')).toContainText('Service temporarily unavailable');await expect(page.getByText('Answer:',{exact:true})).toHaveCount(0);
  state.fail.clear();await page.getByRole('button',{name:/Ask|Send/}).click();await expect(page.getByText('Review field moisture.')).toBeVisible();
});

test('satellite processing, observation selection and alert resolution recover from failure',async({page})=>{
  const state=await setup(page);state.fail.add(`POST /api/fields/${id}/ingest/sentinel-scenes`);await page.goto(`/fields/${id}/map`);
  const process=page.getByRole('button',{name:'Find & Process Best Recent Scene'});await process.click();await expect(page.getByText('Service temporarily unavailable',{exact:true})).toBeVisible();
  state.fail.clear();await process.click();await expect(page.getByRole('status')).toContainText('Analysis complete');
  await page.locator('select').selectOption('scene-2');await expect(page.getByRole('button',{name:'Mark resolved'})).toHaveCount(0);
  await page.locator('select').selectOption('scene-1');state.fail.add(`PATCH /api/fields/${id}/alerts/alert-1/resolve`);await page.getByRole('button',{name:'Mark resolved'}).click();await expect(page.getByText('Unable to resolve alert',{exact:true})).toBeVisible();
  state.fail.clear();await page.getByRole('button',{name:'Mark resolved'}).click();await expect(page.getByRole('button',{name:'Mark resolved'})).toHaveCount(0);
  await page.getByRole('link',{name:'Back to Dashboard'}).click();await expect(page).toHaveURL('/');
});

test('wizard close/keyboard and saved-field exit remain usable after satellite failure',async({page})=>{
  const state=await setup(page);await page.goto('/');
  await expect(page.getByRole('region',{name:'Farm summary'})).toContainText('Pending');
  const add=page.getByRole('button',{name:'+ Add field',exact:true});await add.click();
  await page.keyboard.press('Shift+Tab');await expect(page.getByRole('button',{name:'Next',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(add).toBeFocused();
  await add.click();await page.getByRole('button',{name:'Close add field'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await add.click();await page.getByLabel('Field Name').fill('Another field');await page.getByLabel('Crop Type').fill('Rice');await page.getByRole('button',{name:'Next',exact:true}).click();
  await page.getByLabel('Planting Date').fill('2026-09-01');await page.getByRole('button',{name:'Next',exact:true}).click();
  for(const p of [{x:40,y:40},{x:100,y:40},{x:100,y:100}])await page.getByLabel('Test map').click({position:p});
  await page.getByRole('button',{name:'Finish boundary'}).click();await page.getByRole('button',{name:'Review',exact:true}).click();
  state.fail.add(`POST /api/fields/${id}/ingest/sentinel-scenes`);await page.getByRole('button',{name:'Save & Analyse Field'}).click();await page.getByRole('button',{name:'Open saved field'}).click();
  await expect(page).toHaveURL(new RegExp(`/fields/${id}/map`));
  await page.getByRole('button',{name:'Manage field',exact:true}).click();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('failed map SDK load exposes a working retry action',async({page})=>{
  await setup(page);
  await page.addInitScript(()=>{(window as any).google.maps.importLibrary=async()=>{throw new Error('Test SDK failure');};});
  await page.goto(`/fields/${id}/map`);await expect(page.getByRole('button',{name:'Retry map'})).toBeVisible();
  await page.evaluate(()=>{(window as any).google.maps.importLibrary=async()=>(window as any).google.maps;});
  await page.getByRole('button',{name:'Retry map'}).click();await expect(page.getByLabel('Test map')).toBeVisible();
});


test('point-only satellite records do not pretend to provide field NDVI', async ({page}) => {
  const state = await setup(page); state.fields[0].boundary_geojson = null;
  state.scenes = [{scene_id:'scene-1',observed_at:'2026-10-01',cloud_cover:5}];
  await page.goto(`/fields/${id}/map`);
  await expect(page.getByText(/No field boundary saved/)).toBeVisible();
  await expect(page.getByRole('button',{name:'Find & Process Best Recent Scene'})).toBeDisabled();
  await expect(page.locator('select')).toBeEnabled();
});

test('dataset catalog navigation, search, status filters and demo provenance are clear', async ({page}) => {
  const state = await setup(page);
  await page.goto('/');await page.getByRole('link',{name:'Explore datasets'}).click();
  await expect(page.getByRole('heading',{name:'Project datasets'})).toBeVisible();
  await expect(page.getByRole('status')).toContainText('9 sources');
  await page.getByLabel('Search datasets').fill('soil');await expect(page.getByRole('heading',{name:'ISRIC SoilGrids'})).toBeVisible();
  await page.getByLabel('Integration status').selectOption('Connected');await expect(page.getByText('No sources match this search.',{exact:false})).toBeVisible();
  await page.getByLabel('Search datasets').fill('');await expect(page.getByRole('status')).toContainText('2 sources');
  await page.getByRole('link',{name:'Back to Dashboard',exact:false}).click();
  state.fields[0].name='Public demo: India parcel test';
  state.events=[{id:'source-event',event_type:'dataset_import',event_date:'2026-10-15',notes:JSON.stringify({dataset:'FTW India',boundary_year:2016,license:'CC BY 4.0',warning:'Historical benchmark, not current farm ground truth',source_url:'https://source.coop/kerner-lab/fields-of-the-world-india/boundaries_india_2016.parquet'})}];
  await page.setViewportSize({width:390,height:844});await page.goto(`/fields/${id}/history`);
  await expect(page.getByText(/Public benchmark demo: boundary recorded in 2016/)).toBeVisible();
  await expect(page.getByRole('link',{name:'Dataset source and attribution',exact:false})).toHaveAttribute('href', /source.coop/);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
});
