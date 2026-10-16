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
