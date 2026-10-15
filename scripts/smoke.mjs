import 'dotenv/config';
import assert from 'node:assert/strict';
const base=`http://127.0.0.1:${process.env.API_PORT || 3001}/api`;
const web=`http://127.0.0.1:${process.env.WEB_PORT || 5173}`;
const engine=process.env.PYTHON_ENGINE_URL || 'http://127.0.0.1:8000';
const request=async(path,method='GET',body)=> {
  const response=await fetch(`${base}${path}`,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  assert.ok(response.ok,`${method} ${path}: ${response.status} ${response.ok?'':await response.text()}`);
  return response.status===204?null:response.json();
};
assert.equal((await fetch(web)).status,200);
assert.equal((await fetch(`${web}/api/health`)).status,200);
assert.equal((await fetch(`${engine.replace(/\/$/, '')}/health`)).status,200);
assert.equal((await fetch(`${base}/fields/invalid/weather`)).status,400);
const before=await request('/fields');

let id;
try {
  const field=await request('/fields','POST',{name:'Temporary local smoke test',crop:'Wheat',boundary_geojson:{type:'Polygon',coordinates:[[[77,28],[77.01,28],[77.01,28.01],[77,28.01],[77,28]]]},planting_date:'2026-09-01',harvest_date:'2026-12-01'});
  id=field.id;
  await request(`/fields/${id}`,'PATCH',{expected_yield_tons:12});
  const renamed=await request(`/fields/${id}`,'PATCH',{name:'Renamed temporary field'});
  assert.equal(renamed.planting_date.slice(0,10),'2026-09-01');
  assert.equal(renamed.harvest_date.slice(0,10),'2026-12-01');
  assert.equal(Number(renamed.expected_yield_tons),12);
  const cleared=await request(`/fields/${id}`,'PATCH',{planting_date:null,harvest_date:null,expected_yield_tons:null});
  assert.equal(cleared.planting_date,null);assert.equal(cleared.harvest_date,null);assert.equal(cleared.expected_yield_tons,null);
} finally {if(id)await request(`/fields/${id}`,'DELETE');}
assert.equal((await request('/fields')).length,before.length);
console.log('Native smoke test passed: frontend, proxy, engine, validation and field create/update/delete; existing field count retained.');
