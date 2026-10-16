import {test} from 'node:test';
import assert from 'node:assert/strict';
import {toCsv} from '../../../shared/exports.ts';
test('CSV preserves real zeros and negative measurements while neutralizing spreadsheet formulas in user text',()=>{
 const csv=toCsv([['field','reading','unknown'],['=HYPERLINK("bad")',-.3,null],['\t +cmd',0,'line one\nline "two"']]);
 assert.ok(csv.startsWith('\ufeff'));
 assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'));
 assert.ok(csv.includes('"-0.3",""'));
 assert.ok(csv.includes('"\'\t +cmd","0","line one\nline ""two"""'));
});
