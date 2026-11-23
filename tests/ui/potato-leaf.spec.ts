import {expect,test} from '@playwright/test';
import {existsSync,readFileSync,statSync,readdirSync} from 'node:fs';
import {join,basename} from 'node:path';

// Drives the real UI with real PLDD-UP test photos. The leaf-check request is forwarded to the running engine
// (http://127.0.0.1:8000), so the trained model answers. Everything else on the API is mocked.
test.use({baseURL:'http://127.0.0.1:5175'});
const id='00000000-0000-0000-0000-000000000171';
const root=join(process.cwd(),'.local/datasets/up/pldd-up');
const engine='http://127.0.0.1:8000/classify-potato-leaf';

function testPhotos(label:string){
 const manifest=JSON.parse(readFileSync(join(root,'processed/training-manifest.json'),'utf8').replace(/^\uFEFF/,'')) as {images:{split:string;label:string;relative_path:string}[]};
 const byName=new Map<string,string>();
 const walk=(dir:string)=>{for(const e of readdirSync(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())walk(p);else byName.set(e.name,p);}};
 walk(join(root,'extracted'));
 return manifest.images.filter(s=>s.split==='test'&&s.label===label).map(s=>byName.get(basename(s.relative_path))!).filter(p=>p&&statSync(p).size<5*1024*1024).slice(0,40);
}

async function mockApi(page:import('@playwright/test').Page){
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(path==='/api/auth/session')return route.fulfill({json:{mode:'local',user:null}});
  if(path==='/api/fields')return route.fulfill({json:[{id,name:'Potato field',crop:'Potato',area_hectares:2,latitude:27,longitude:79,planting_date:null,harvest_date:null}]});
  if(path.endsWith('/scouting/leaf-check')){
   const {image}=request.postDataJSON() as {image:string};
   const upstream=await fetch(engine,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:image.slice(image.indexOf(',')+1)})});
   if(upstream.status===503)return route.fulfill({json:{status:'unavailable'}});
   return route.fulfill({status:upstream.status,json:await upstream.json()});
  }
  if(path.endsWith('/scouting')&&request.method()==='GET')return route.fulfill({json:{cases:[],diagnosis:{status:'unavailable',provider:null,reason:'No configured provider'}}});
  return route.fulfill({json:[]});
 });
}
async function engineSays(file:string){
 const r=await fetch(engine,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:readFileSync(file).toString('base64')})});
 return await r.json() as {status:string;label?:string};
}
async function firstAnswered(label:string){
 for(const file of testPhotos(label)){const r=await engineSays(file);if(r.status==='answered'&&r.label===label)return file;}
 return null;
}

test.beforeEach(async({page})=>{
 test.skip(!existsSync(join(root,'processed/training-manifest.json')),'PLDD-UP dataset not present on this machine');
 const health=await fetch('http://127.0.0.1:8000/health').catch(()=>null);
 test.skip(!health?.ok,'engine is not running');
 await mockApi(page);
 await page.goto(`/fields/${id}/history`);
 await expect(page.getByRole('heading',{name:'Field diary'})).toBeVisible();
});

for(const label of ['Early Blight','Healthy']){
 test(`leaf check names ${label} in the browser and says it is not a diagnosis`,async({page},info)=>{
  const file=await firstAnswered(label);
  test.skip(!file,`no confidently classified ${label} test photo found`);
  await page.getByLabel('Crop photo').setInputFiles(file!);
  await page.getByRole('button',{name:'Experimental: check potato leaf'}).click();
  const shown={'Early Blight':'Early blight','Healthy':'Healthy'}[label]!;
  await expect(page.getByText(new RegExp('Model suggests: '+shown))).toBeVisible();
  await expect(page.getByText(/not a diagnosis/i)).toBeVisible();
  await expect(page.getByText(/diagnosed as/i)).toHaveCount(0);
  await page.locator('.photo-quality-check').screenshot({path:info.outputPath(`leaf-${label.replace(' ','-')}.png`)});
 });
}

test('leaf check refuses a dark photo instead of guessing',async({page},info)=>{
 const dark=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=640;const x=c.getContext('2d')!;x.fillStyle='#0a0a0a';x.fillRect(0,0,640,640);return c.toDataURL('image/jpeg').split(',')[1];});
 await page.getByLabel('Crop photo').setInputFiles({name:'dark.jpg',mimeType:'image/jpeg',buffer:Buffer.from(dark,'base64')});
 await page.getByRole('button',{name:'Experimental: check potato leaf'}).click();
 await expect(page.getByText('Photo not suitable for the leaf check. Retake it.')).toBeVisible();
 await expect(page.getByText(/Model suggests/)).toHaveCount(0);
 await page.locator('.photo-quality-check').screenshot({path:info.outputPath('leaf-dark.png')});
});
