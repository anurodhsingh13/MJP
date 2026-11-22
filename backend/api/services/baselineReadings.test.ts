import {test} from 'node:test';
import assert from 'node:assert/strict';
import {baselinePointsByField} from './baselineReadings.ts';

const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const fake=(rows:Record<string,unknown>[],table:string|null='field_ndvi_baseline')=>({
 calls:[] as {text:string;values?:unknown[]}[],
 async query(text:string,values?:unknown[]){this.calls.push({text,values});return text.includes('to_regclass')?{rows:[{table_name:table}]}:{rows};},
});

test('earlier readings are grouped per field and carry only date and NDVI',async()=>{
 const db=fake([{field_id:A,observed_on:'2025-10-10',ndvi_value:'0.61'},{field_id:A,observed_on:'2024-10-12',ndvi_value:'0.55'},{field_id:B,observed_on:'2025-06-01',ndvi_value:'0.2'}]);
 const result=await baselinePointsByField(db,[A,B]);
 assert.deepEqual(result.get(A),[{observed_on:'2025-10-10',ndvi_value:'0.61'},{observed_on:'2024-10-12',ndvi_value:'0.55'}]);
 assert.equal(result.get(B)?.length,1);
 const query=db.calls[1];
 assert.match(query.text,/boundary_version = b\.boundary_version/);
 assert.deepEqual(query.values,[[A,B],70,10]);
});

test('no table, no fields or a database error mean no baseline, never a failure',async()=>{
 assert.equal((await baselinePointsByField(fake([{field_id:A,observed_on:'2025-10-10',ndvi_value:.6}],null),[A])).size,0);
 const db=fake([]);
 assert.equal((await baselinePointsByField(db,[])).size,0);
 assert.equal(db.calls.length,0);
 const broken={async query():Promise<never>{throw new Error('down');}};
 assert.equal((await baselinePointsByField(broken,[A])).size,0);
});
