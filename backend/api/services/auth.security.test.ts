import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Request,Response,NextFunction} from 'express';
import {requireAccount,requireField,sameOrigin} from './auth.ts';
import {pool} from '../db/pool.ts';

function mockResponse(account:{id:string;email:string}|null=null){
 const result={statusCode:200,body:null as unknown,headers:{} as Record<string,string>,locals:{account},
  status(code:number){this.statusCode=code;return this;},
  json(body:unknown){this.body=body;return this;},
  setHeader(name:string,value:string){this.headers[name]=value;}
 };
 return result;
}
const account={id:'00000000-0000-0000-0000-000000000001',email:'owner@example.test'};
const fieldId='00000000-0000-0000-0000-000000000002';
test('production-mode endpoints reject unauthenticated requests',()=>{
 const previous=process.env.AUTH_MODE;
 process.env.AUTH_MODE='required';
 try{
  const response=mockResponse();let nextCalled=false;
  requireAccount({} as Request,response as unknown as Response,(()=>{nextCalled=true;}) as NextFunction);
  assert.equal(response.statusCode,401);assert.equal(nextCalled,false);
 }finally{if(previous===undefined)delete process.env.AUTH_MODE;else process.env.AUTH_MODE=previous;}
});
test('field middleware rejects malformed IDs before DB lookup',async()=>{
 const previous=process.env.AUTH_MODE;process.env.AUTH_MODE='required';
 try{
  const response=mockResponse(account);let nextCalled=false;
  await requireField({params:{fieldId:'not-a-uuid'}} as unknown as Request,response as unknown as Response,(()=>{nextCalled=true;}) as NextFunction);
  assert.equal(response.statusCode,400);assert.equal(nextCalled,false);
 }finally{if(previous===undefined)delete process.env.AUTH_MODE;else process.env.AUTH_MODE=previous;}
});
test('a different owner cannot access another field',async()=>{
 const previous=process.env.AUTH_MODE;process.env.AUTH_MODE='required';
 const original=pool.query;
 const queries:unknown[][]=[];
 try{
  pool.query=(async (...args:unknown[])=>{
   queries.push(args);
   return {rows:[],rowCount:0};
  }) as typeof pool.query;
  const response=mockResponse(account);let nextCalled=false;
  await requireField({params:{fieldId}} as unknown as Request,response as unknown as Response,(()=>{nextCalled=true;}) as NextFunction);
  assert.equal(response.statusCode,404);assert.equal(nextCalled,false);
  assert.equal(queries.length,1);
  assert.match(String(queries[0][0]),/owner_id=\$2/);
  assert.deepEqual(queries[0][1],[fieldId,account.id]);
 }finally{pool.query=original;if(previous===undefined)delete process.env.AUTH_MODE;else process.env.AUTH_MODE=previous;}
});
test('cross-origin mutations are rejected',()=>{
 const response=mockResponse(account);let nextCalled=false;
 const request={method:'POST',hostname:'terrascope.example',get:(header:string)=>header==='origin'?'https://other.example':header==='host'?'terrascope.example':undefined} as unknown as Request;
 sameOrigin(request,response as unknown as Response,(()=>{nextCalled=true;}) as NextFunction);
 assert.equal(response.statusCode,403);assert.equal(nextCalled,false);
});
