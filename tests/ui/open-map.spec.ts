import { test, expect } from '@playwright/test';
test.use({baseURL:'http://127.0.0.1:5175'});
const id='00000000-0000-0000-0000-000000000099';
const png=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#bacf9c"/></svg>');

test('map works without a Google key and selects the last processed observation',async({page})=>{
  await page.route('https://fonts.googleapis.com/**',route=>route.abort());
  const browserErrors:string[]=[];
  page.on('pageerror',error=>browserErrors.push(error.message));
  const googleRequests:string[]=[];
  page.on('request',request=>{if(request.url().includes('maps.googleapis.com'))googleRequests.push(request.url());});
  await page.route('https://tile.openstreetmap.org/**',route=>route.fulfill({contentType:'image/svg+xml',body:png}));
  await page.route('**/api/**',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/auth/session')return route.fulfill({json:{mode:'local',user:null}});
    if(path.endsWith('.png'))return route.fulfill({contentType:'image/svg+xml',body:png});
    if(path==='/api/fields')return route.fulfill({json:[{id,name:'Public demo: test parcel',crop:'Unknown',latitude:17.2589,longitude:77.6401,area_hectares:2.81,last_observation:'2026-10-12',latest_scene_id:'processed',latestObservation:{scene_id:'processed',observed_on:'2026-10-12',ndvi_value:.62,valid_coverage_percent:87,valid_pixel_count:870,cloud_cover:2,source:'Copernicus Sentinel-2',provenance:'measured_imagery',accepted:true,boundary_version:1,calculation_version:'v2'},boundary_version:1,boundary_geojson:{type:'Polygon',coordinates:[[[77.639,17.258],[77.641,17.258],[77.641,17.26],[77.639,17.26],[77.639,17.258]]]}}]});
    if(path.endsWith('/scenes'))return route.fulfill({json:[{scene_id:'older',observed_at:'2026-09-27T00:00:00Z',cloud_cover:0},{scene_id:'processed',observed_at:'2026-10-12T00:00:00Z',cloud_cover:2}]});
    return route.fulfill({json:[]});
  });
  await page.setViewportSize({width:390,height:844});
  await page.goto(`/fields/${id}/map`);
  await expect(page.getByLabel('Image date')).toHaveValue('processed');
  await expect(page.getByLabel('Field map of Public demo: test parcel')).toBeVisible();
  await expect(page.getByText(/OpenStreetMap basemap/)).toBeVisible();
  await expect(page.getByRole('link',{name:'OpenStreetMap',exact:true})).toBeVisible();
  await expect(page.locator('.leaflet-overlay-pane path').first()).toBeVisible();
  await expect(page.locator('.leaflet-tile-loaded').first()).toBeVisible();
  await expect(page.getByText(/Google Maps is not configured/)).toHaveCount(0);
  expect(googleRequests).toEqual([]);
  const before=await page.locator('.leaflet-tile').first().getAttribute('src');
  await page.getByRole('button',{name:'Zoom in',exact:true}).click();
  await expect(page.locator('.leaflet-tile').first()).not.toHaveAttribute('src',before||'');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
  await page.getByRole('link',{name:'Back to Dashboard'}).click();
  await expect(page.getByRole('heading',{name:'My fields'})).toBeVisible();
  expect(browserErrors).toEqual([]);
});
