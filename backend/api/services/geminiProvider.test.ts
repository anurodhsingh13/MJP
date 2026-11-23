import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateGemini,generateCropAdvice,ProviderError,DEFAULT_FALLBACK_MODEL} from './ai/geminiProvider.ts';
// Existing tests count calls to the main model; the fallback model has its own tests below.
process.env.GEMINI_FALLBACK_MODEL='';
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
  await assert.rejects(generateGemini('system', [{ role: 'user', content: 'hi' }], { fetcher, retryDelaysMs: [1, 1], fallbackModels: [] }),
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
    assert.equal(seen[0], 60000);                       // the overall budget
    assert.deepEqual(seen, [60000, 18000]);             // plus one per-attempt limit (30 % of the budget)
  } finally { AbortSignal.timeout = realTimeout; }
}));


const ok = (text: string) => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] }), { status: 200 });
const busy = () => new Response(JSON.stringify({ error: { status: 'UNAVAILABLE' } }), { status: 503 });
const modelOf = (url: unknown) => /models\/([^:]+):generateContent/.exec(String(url))![1];
async function withFallbackEnv(value: string | undefined, run: () => Promise<void>) {
  const previous = process.env.GEMINI_FALLBACK_MODEL;
  if (value === undefined) delete process.env.GEMINI_FALLBACK_MODEL; else process.env.GEMINI_FALLBACK_MODEL = value;
  try { await run(); } finally { if (previous === undefined) delete process.env.GEMINI_FALLBACK_MODEL; else process.env.GEMINI_FALLBACK_MODEL = previous; }
}

test('when the main model stays overloaded, the fallback model answers', async () => withKey(async () => {
  const seen: string[] = [];
  const fetcher = (async (url: unknown) => { seen.push(modelOf(url)); return modelOf(url) === 'backup-model' ? ok('from backup') : busy(); }) as typeof fetch;
  const result = await generateGemini('system', [{ role: 'user', content: 'hi' }], { fetcher, retryDelaysMs: [1, 1], fallbackModels: ['backup-model'] });
  assert.equal(result.answer, 'from backup');
  assert.equal(result.model, 'backup-model');                         // the reply says which model really answered
  assert.deepEqual(seen, [process.env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite', process.env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite', process.env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite', 'backup-model']);
}));

test('if the fallback is busy too, the user gets the clear busy message after a bounded number of calls', async () => withKey(async () => {
  let calls = 0;
  const fetcher = (async () => { calls++; return busy(); }) as typeof fetch;
  await assert.rejects(generateGemini('system', [{ role: 'user', content: 'hi' }], { fetcher, retryDelaysMs: [1, 1], fallbackModels: ['backup-model'] }),
    error => error instanceof ProviderError && error.code === 'provider_unavailable' && /busy right now/.test(error.message));
  assert.equal(calls, 3 + 2);                                          // main: 1 + 2 retries; fallback: 1 + 1 retry
}));

test('real errors never fall back to another model', async () => withKey(async () => {
  for (const status of [400, 401, 403, 404, 429]) {
    let calls = 0;
    const fetcher = (async () => { calls++; return new Response('{}', { status }); }) as typeof fetch;
    await assert.rejects(generateGemini('system', [{ role: 'user', content: 'hi' }], { fetcher, retryDelaysMs: [1, 1], fallbackModels: ['backup-model'] }), ProviderError);
    assert.equal(calls, 1, `status ${status}`);
  }
}));

test('a fallback that is also unknown or invalid is ignored; the main model name is never repeated', async () => withKey(async () => {
  const seen: string[] = [];
  const main = process.env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite';
  const fetcher = (async (url: unknown) => { seen.push(modelOf(url)); return busy(); }) as typeof fetch;
  await assert.rejects(generateGemini('system', [{ role: 'user', content: 'hi' }], { fetcher, retryDelaysMs: [], fallbackModels: [main, '../evil', 'bad name', 'ok-one'] }), ProviderError);
  assert.deepEqual(seen, [main, 'ok-one']);
}));

test('the fallback comes from GEMINI_FALLBACK_MODEL, uses the built-in default when unset, and is off when empty', async () => withKey(async () => {
  const run = async () => { const seen: string[] = []; const fetcher = (async (url: unknown) => { seen.push(modelOf(url)); return busy(); }) as typeof fetch;
    await assert.rejects(generateGemini('system', [{ role: 'user', content: 'hi' }], { fetcher, retryDelaysMs: [] }), ProviderError); return seen.slice(1); };
  await withFallbackEnv(undefined, async () => assert.deepEqual(await run(), [DEFAULT_FALLBACK_MODEL]));
  await withFallbackEnv('first, second', async () => assert.deepEqual(await run(), ['first', 'second']));
  await withFallbackEnv('', async () => assert.deepEqual(await run(), []));
}));

test('a fallback model that hangs is cut off quickly and the user still sees the clear busy message', async () => withKey(async () => {
  const started = Date.now();
  const fetcher = ((url: unknown, init?: RequestInit) => modelOf(url) === 'slow-backup'
    ? hangUntilAborted(init?.signal)
    : Promise.resolve(busy())) as typeof fetch;
  await assert.rejects(generateGemini('system', [{ role: 'user', content: 'hi' }], { fetcher, retryDelaysMs: [1, 1], fallbackModels: ['slow-backup'], fallbackTimeoutMs: 40, timeoutMs: 30000 }),
    error => error instanceof ProviderError && error.code === 'provider_unavailable' && /busy right now/.test(error.message));
  assert.ok(Date.now() - started < 3000);
}));

/** Like the real fetch: never answers, but rejects at once if its signal is already aborted or aborts later. */
const hangUntilAborted = (signal?: AbortSignal | null) => new Promise<Response>((_resolve, reject) => {
  const abort = () => reject(new DOMException('aborted', 'AbortError'));
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort);
});
const dropped = () => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) });

test('a dropped connection is retried like a 503 and then succeeds', async () => withKey(async () => {
  let calls = 0;
  const fetcher = (async () => { calls++; if (calls < 3) throw dropped(); return ok('after the blip'); }) as typeof fetch;
  const result = await generateGemini('system', [{ role: 'user', content: 'hi' }], { fetcher, retryDelaysMs: [1, 1], fallbackModels: [] });
  assert.equal(result.answer, 'after the blip');
  assert.equal(calls, 3);
}));

test('a connection that keeps failing ends in the "could not be reached" message after a bounded number of tries', async () => withKey(async () => {
  let calls = 0;
  const fetcher = (async () => { calls++; throw dropped(); }) as typeof fetch;
  await assert.rejects(generateGemini('system', [{ role: 'user', content: 'hi' }], { fetcher, retryDelaysMs: [1, 1], fallbackModels: [] }),
    error => error instanceof ProviderError && error.code === 'network' && error.status === 503 && /could not be reached/.test(error.message) && !/ECONNRESET/.test(error.message));
  assert.equal(calls, 3);
}));

test('when the main model cannot be reached, the fallback model gets a chance', async () => withKey(async () => {
  const seen: string[] = [];
  const fetcher = (async (url: unknown) => { seen.push(modelOf(url)); if (modelOf(url) === 'backup-model') return ok('backup answered'); throw dropped(); }) as typeof fetch;
  const result = await generateGemini('system', [{ role: 'user', content: 'hi' }], { fetcher, retryDelaysMs: [1, 1], fallbackModels: ['backup-model'] });
  assert.equal(result.answer, 'backup answered');
  assert.equal(seen.filter(name => name === 'backup-model').length, 1);
}));

test('a 503 from the main model followed by a network blip on the fallback is still reported as busy', async () => withKey(async () => {
  const fetcher = (async (url: unknown) => { if (modelOf(url) === 'backup-model') throw dropped(); return busy(); }) as typeof fetch;
  await assert.rejects(generateGemini('system', [{ role: 'user', content: 'hi' }], { fetcher, retryDelaysMs: [1, 1], fallbackModels: ['backup-model'] }),
    error => error instanceof ProviderError && error.code === 'provider_unavailable' && /busy right now/.test(error.message));
}));

test('the overall time budget still ends in a timeout, not an endless retry', async () => withKey(async () => {
  const started = Date.now();
  const fetcher = ((_url: unknown, init?: RequestInit) => hangUntilAborted(init?.signal)) as typeof fetch;
  await assert.rejects(generateGemini('system', [{ role: 'user', content: 'hi' }], { fetcher, timeoutMs: 30, retryDelaysMs: [1, 1], fallbackModels: ['backup-model'] }),
    error => error instanceof ProviderError && error.code === 'timeout' && error.status === 504);
  assert.ok(Date.now() - started < 2000);
}));

test('a hung attempt is cut off and retried, instead of using the whole time budget', async () => withKey(async () => {
  const started = Date.now(); let calls = 0;
  const fetcher = ((_url: unknown, init?: RequestInit) => { calls++; return calls === 1 ? hangUntilAborted(init?.signal) : Promise.resolve(ok('second attempt answered')); }) as typeof fetch;
  const result = await generateGemini('system', [{ role: 'user', content: 'hi' }], { fetcher, retryDelaysMs: [1, 1], fallbackModels: [], attemptTimeoutMs: 40, timeoutMs: 30000 });
  assert.equal(result.answer, 'second attempt answered');
  assert.equal(calls, 2);
  assert.ok(Date.now() - started < 2000);                                  // not 30 s
}));

test('every attempt hanging ends in "could not be reached" after the attempts, not after the whole budget', async () => withKey(async () => {
  const started = Date.now(); let calls = 0;
  const fetcher = ((_url: unknown, init?: RequestInit) => { calls++; return hangUntilAborted(init?.signal); }) as typeof fetch;
  await assert.rejects(generateGemini('system', [{ role: 'user', content: 'hi' }], { fetcher, retryDelaysMs: [1, 1], fallbackModels: [], attemptTimeoutMs: 30, timeoutMs: 30000 }),
    error => error instanceof ProviderError && error.code === 'network' && /could not be reached/.test(error.message));
  assert.equal(calls, 3);
  assert.ok(Date.now() - started < 2000);
}));
