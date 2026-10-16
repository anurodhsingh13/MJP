import {test} from 'node:test';
import assert from 'node:assert/strict';
import {authRouter} from './auth.ts';
import {saveScouting} from '../controllers/scoutingController.ts';
import type {Request,Response,NextFunction} from 'express';

test('login and registration reject missing or null JSON without touching the database',async()=>{
  for(const action of ['login','register'])for(const body of [undefined,null,{},[],42]){
    let status=200;let payload:unknown;
    const response={status(code:number){status=code;return this;},json(value:unknown){payload=value;}};
    await new Promise<void>((resolve,reject)=>{
      response.json=(value:unknown)=>{payload=value;resolve();};
      authRouter({method:'POST',url:'/'+action,body} as Request,response as unknown as Response,((error:unknown)=>error?reject(error):resolve()) as NextFunction);
    });
    assert.equal(status,400);assert.ok(payload);
  }
});

test('scouting rejects a missing photo payload before accessing storage or the database',async()=>{
  for(const body of [undefined,null,{},[]]){
    let status=200;
    const response={status(code:number){status=code;return this;},json(){}};
    await saveScouting({body} as Request,response as unknown as Response);
    assert.equal(status,400);
  }
});

test('profile validation bounds optional fields and keeps names as plain text',async()=>{
 const {validateProfile}=await import('../../../shared/profile.ts');
 assert.equal(validateProfile({name:'  Asha Patel  '}).name,'Asha Patel');
 assert.equal(validateProfile({name:''}).name,'');
 for(const value of [null,[],{name:22},{name:'a'.repeat(61)},{phone:'wrong'},{bio:'a'.repeat(501)}])assert.throws(()=>validateProfile(value));
});

test('profile endpoints require a signed-in account and never accept a requested owner id',async()=>{
 const {pool}=await import('../db/pool.ts');
 const original=pool.query;let values:unknown[]|undefined;
 pool.query=(async(_sql:unknown,args:unknown[])=>{values=args;return {rows:[{id:'current-account',email:'owner@example.invalid',profile:JSON.parse(args[0] as string)}]};}) as unknown as typeof pool.query;
 const invoke=async(url:string,body:unknown,account:unknown)=>{
  let status=200;let payload:unknown;
  await new Promise<void>((resolve,reject)=>{
   const response={locals:{account},status(code:number){status=code;return this;},json(value:unknown){payload=value;resolve();}};
   authRouter({method:url==='/profile'?'PATCH':'POST',url,body} as Request,response as unknown as Response,((error:unknown)=>error?reject(error):resolve()) as NextFunction);
  });return {status,payload};
 };
 try{
  assert.equal((await invoke('/profile',{name:'Asha'},null)).status,401);
  assert.equal((await invoke('/password',{currentPassword:'old',newPassword:'test-password-long'},null)).status,401);
  const account={id:'current-account',email:'owner@example.invalid',profile:{farmName:'Existing farm'}};
  assert.equal((await invoke('/profile',{name:123},account)).status,400);
  assert.equal((await invoke('/profile',null,account)).status,400);
  assert.equal((await invoke('/profile',{name:'Asha',id:'someone-else'},account)).status,200);
  assert.equal(values?.[1],'current-account');assert.equal(JSON.parse(values?.[0] as string).farmName,'Existing farm');
 }finally{pool.query=original;}
});
