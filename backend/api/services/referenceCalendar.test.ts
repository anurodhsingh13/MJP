import {test} from 'node:test';
import assert from 'node:assert/strict';
import {referenceWindowsByField} from './referenceCalendar.ts';

const row=(field_id:string,crop:string,ps=7,pe=8,hs=11,he=12)=>({field_id,crop,planting_start_month:ps,planting_end_month:pe,harvest_start_month:hs,harvest_end_month:he});
const fake=(rows:Record<string,unknown>[],table:string|null='fao_crop_calendar_references')=>({
 calls:[] as string[],
 async query(text:string){this.calls.push(text);return text.includes('to_regclass')?{rows:[{table_name:table}]}:{rows};},
});
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';

test('a field gets the reference window for its own crop, whatever the capitalisation',async()=>{
 const db=fake([row(A,'Rice'),row(B,'Wheat',10,11,4,5)]);
 const result=await referenceWindowsByField(db,[{id:A,crop:'rice'},{id:B,crop:' WHEAT '}]);
 assert.deepEqual(result.get(A),{plantingStartMonth:7,plantingEndMonth:8,harvestStartMonth:11,harvestEndMonth:12});
 assert.deepEqual(result.get(B),{plantingStartMonth:10,plantingEndMonth:11,harvestStartMonth:4,harvestEndMonth:5});
});

test('a reference for a different crop is never used',async()=>{
 const result=await referenceWindowsByField(fake([row(A,'Wheat',10,11,4,5)]),[{id:A,crop:'rice'}]);
 assert.equal(result.size,0);
 assert.equal((await referenceWindowsByField(fake([row(A,'Rice')]),[{id:A,crop:null}])).size,0);
});

test('rows with invalid months are ignored and the first valid matching row wins',async()=>{
 const result=await referenceWindowsByField(fake([row(A,'Rice',7,13,11,12),row(A,'Rice',6,7,10,11),row(A,'Rice',1,2,3,4)]),[{id:A,crop:'Rice'}]);
 assert.deepEqual(result.get(A),{plantingStartMonth:6,plantingEndMonth:7,harvestStartMonth:10,harvestEndMonth:11});
});

test('no table, no fields or a database error all mean no reference, never a failure',async()=>{
 assert.equal((await referenceWindowsByField(fake([row(A,'Rice')],null),[{id:A,crop:'Rice'}])).size,0);
 const db=fake([]);
 assert.equal((await referenceWindowsByField(db,[])).size,0);
 assert.equal(db.calls.length,0);
 const broken={async query():Promise<never>{throw new Error('down');}};
 assert.equal((await referenceWindowsByField(broken,[{id:A,crop:'Rice'}])).size,0);
});
