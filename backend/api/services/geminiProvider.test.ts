import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateGemini,generateCropAdvice,ProviderError} from './ai/geminiProvider.ts';
test('Gemini contract parses visible text and safely handles failures',async()=>{
 const previous=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY='test-key';
 const invoke=(payload:unknown,status=200,headers?:Record<string,string>)=>generateGemini('System',[{role:'user',content:'Question'},{role:'assistant',content:'Earlier answer'}],{fetcher:(async(_url,init)=>{
  const body=JSON.parse(String(init?.body));assert.equal(body.contents[1].role,'model');assert.equal(body.systemInstruction.parts[0].text,'System');
  return Response.json(payload,{status,headers});
 }) as typeof fetch});
 try{
  const result=await invoke({candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'SECRET'},{text:'Visible answer'}]}}]});assert.equal(result.answer,'Visible answer');
  for(const [payload,status,code] of [
   [{error:{details:[{reason:'API_KEY_INVALID'}]}},400,'invalid_credentials'],[{},401,'invalid_credentials'],[{},403,'permission_denied'],[{},404,'model_unavailable'],[{},429,'rate_limited'],[{},500,'provider_unavailable'],
   [{promptFeedback:{blockReason:'SAFETY'}},200,'blocked'],[{candidates:[{finishReason:'MAX_TOKENS'}]},200,'incomplete'],[{},200,'empty_output'],
   [{candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'SECRET'}]}}]},200,'empty_output'],
  ] as const){await assert.rejects(invoke(payload,status),error=>error instanceof ProviderError&&error.code===code&&!error.message.includes('SECRET'));}
  await assert.rejects(invoke({},429,{'Retry-After':'120'}),error=>error instanceof ProviderError&&error.retryAfterSeconds===120);
  await assert.rejects(generateGemini('S',[],{timeoutMs:1,fetcher:((_url,init)=>new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(Error())))) as typeof fetch}),error=>error instanceof ProviderError&&error.code==='timeout');
 }finally{if(previous===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=previous;}
});

async function withKey(run: () => Promise<void>) {
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  try { await run(); } finally { if (previous === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous; }
}

test('a temporary Gemini overload is retried and then succeeds', async () => withKey(async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return calls < 3
      ? new Response(JSON.stringify({ error: { status: 'UNAVAILABLE', message: 'high demand' } }), { status: 503 })
      : new Response(JSON.stringify({ modelVersion: 'm', candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'hello' }] } }] }), { status: 200 });
  }) as typeof fetch;
  const result = await generateGemini('system', [{ role: 'user', content: 'hi' }], { fetcher, retryDelaysMs: [1, 1] });
  assert.equal(result.answer, 'hello');
  assert.equal(calls, 3);
}));

test('a persistent Gemini overload gives a clear "busy" message, not a configuration hint', async () => withKey(async () => {
  let calls = 0;
  const fetcher = (async () => { calls++; return new Response('{}', { status: 503 }); }) as typeof fetch;
  await assert.rejects(generateGemini('system', [{ role: 'user', content: 'hi' }], { fetcher, retryDelaysMs: [1, 1] }),
    error => error instanceof ProviderError && error.code === 'provider_unavailable' && /busy right now/.test(error.message) && !/configuration/.test(error.message));
  assert.equal(calls, 3);
}));

test('real errors such as a bad key or quota are not retried', async () => withKey(async () => {
  for (const status of [400, 401, 403, 404, 429]) {
    let calls = 0;
    const fetcher = (async () => { calls++; return new Response('{}', { status }); }) as typeof fetch;
    await assert.rejects(generateGemini('system', [{ role: 'user', content: 'hi' }], { fetcher, retryDelaysMs: [1, 1] }));
    assert.equal(calls, 1, `status ${status}`);
  }
}));

test('crop advice uses a 60 s time budget so slow structured answers are not cut off', async () => withKey(async () => {
  const seen: number[] = [];
  const realTimeout = AbortSignal.timeout.bind(AbortSignal);
  AbortSignal.timeout = ((ms: number) => { seen.push(ms); return realTimeout(ms); }) as typeof AbortSignal.timeout;
  try {
    const fetcher = (async () => new Response(JSON.stringify({ modelVersion: 'm', candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ summary: 's', possible_issues: [], precautions: ['p'], check_in_field: [], photo_seen: [], urgency: 'monitor' }) }] } }] }), { status: 200 })) as typeof fetch;
    const { advice } = await generateCropAdvice({ crop: 'Rice' }, null, 'en-IN', { fetcher });
    assert.equal(advice.precautions[0], 'p');
    assert.deepEqual(seen, [60000]);
  } finally { AbortSignal.timeout = realTimeout; }
}));
