import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { askAssistant } from './assistantController.ts';

async function invoke(body: unknown) {
  let status = 200;
  let payload: any;
  const response = { status(code: number) { status = code; return this; }, json(value: unknown) { payload = value; } };
  await askAssistant({ body } as Request, response as Response);
  return { status, payload };
}

test('assistant produces a visible answer with direct-answer generation settings', async () => {
  const key = process.env.SARVAM_API_KEY;
  const original = globalThis.fetch;
  process.env.SARVAM_API_KEY = 'test-key';
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    assert.equal(body.reasoning_effort, null);
    assert.equal(body.max_tokens, 1024);
    assert.match(body.messages[1].content, /No field was selected/);
    return new Response(JSON.stringify({ model: 'sarvam-105b', choices: [{ finish_reason: 'stop', message: { content: ' नमस्ते! ' } }] }));
  }) as typeof fetch;
  try {
    const { status, payload } = await invoke({ message: 'Hello', languageCode: 'hi-IN' });
    assert.equal(status, 200); assert.equal(payload.answer, 'नमस्ते!'); assert.equal(payload.languageCode, 'hi-IN');
  } finally { globalThis.fetch = original; if (key === undefined) delete process.env.SARVAM_API_KEY; else process.env.SARVAM_API_KEY = key; }
});

test('assistant does not expose hidden reasoning as an answer and reports rate limits', async () => {
  const key = process.env.SARVAM_API_KEY;
  const original = globalThis.fetch;
  process.env.SARVAM_API_KEY = 'test-key';
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'Internal reasoning' } }] }))) as typeof fetch;
    const empty = await invoke({ message: 'Hello' });
    assert.equal(empty.status, 502); assert.match(empty.payload.error, /shorter question/); assert.equal(empty.payload.answer, undefined);
    globalThis.fetch = (async () => new Response('{}', { status: 429 })) as typeof fetch;
    const limited = await invoke({ message: 'Hello' });
    assert.equal(limited.status, 429); assert.match(limited.payload.error, /limit/);
  } finally { globalThis.fetch = original; if (key === undefined) delete process.env.SARVAM_API_KEY; else process.env.SARVAM_API_KEY = key; }
});

test('assistant rejects malformed user input without calling the provider', async () => {
  const key = process.env.SARVAM_API_KEY;
  const original = globalThis.fetch;
  process.env.SARVAM_API_KEY = 'test-key';
  globalThis.fetch = (async () => { throw new Error('Must not call Sarvam for invalid input'); }) as typeof fetch;
  try {
    for (const body of [undefined, { message: 42 }, { message: 'Hello', fieldId: 'bad' }, { message: 'Hello', languageCode: {} }]) {
      assert.equal((await invoke(body)).status, 400);
    }
  } finally { globalThis.fetch = original; if (key === undefined) delete process.env.SARVAM_API_KEY; else process.env.SARVAM_API_KEY = key; }
});
