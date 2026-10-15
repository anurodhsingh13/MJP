import {after,test} from 'node:test';
import assert from 'node:assert';
import { app } from '../app.ts';
import { EventEmitter } from 'node:events';

const priorAuthMode=process.env.AUTH_MODE;
process.env.AUTH_MODE='local';
after(()=>{if(priorAuthMode===undefined)delete process.env.AUTH_MODE;else process.env.AUTH_MODE=priorAuthMode;});

// Inject a synthetic request directly into Express without any network socket.
// This approach calls app(req, res) directly, just like Express does internally.
function callApp(method: string, path: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    try {
      // Minimal mock request that satisfies Express 5
      const req = Object.assign(new EventEmitter(), {
        method,
        url: path,
        path,
        headers: { host: 'localhost' },
        socket: { remoteAddress: '127.0.0.1', encrypted: false },
        connection: { encrypted: false },
        httpVersionMajor: 1,
        httpVersionMinor: 1,
        httpVersion: '1.1',
        complete: true,
        readable: false,
        rawHeaders: [],
        trailers: {},
        rawTrailers: [],
        setTimeout: () => req,
        resume: () => req,
        pipe: () => req,
      }) as unknown as import('http').IncomingMessage;

      let statusCode = 200;
      const headers: Record<string, string> = {};
      const chunks: Buffer[] = [];
      let ended = false;

      const res = Object.assign(new EventEmitter(), {
        statusCode,
        statusMessage: 'OK',
        headersSent: false,
        writable: true,
        setHeader(name: string, value: string) { headers[name.toLowerCase()] = value; return res; },
        getHeader(name: string) { return headers[name.toLowerCase()]; },
        removeHeader(name: string) { delete headers[name.toLowerCase()]; },
        writeHead(code: number) { statusCode = code; (res as unknown as Record<string, unknown>).statusCode = code; return res; },
        write(chunk: string | Buffer) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          return true;
        },
        end(chunk?: string | Buffer) {
          if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          if (!ended) {
            ended = true;
            const raw = Buffer.concat(chunks).toString('utf8');
            try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
            catch { resolve({ status: res.statusCode, body: raw }); }
          }
          return res;
        },
        json(data: unknown) {
          this.end(JSON.stringify(data));
          return res;
        },
      }) as unknown as import('http').ServerResponse;

      (app as unknown as (req: unknown, res: unknown) => void)(req, res);
    } catch (err) {
      reject(err);
    }
  });
}

test('API root explains where to find health status', async () => {
  const { status, body } = await callApp('GET', '/');
  assert.equal(status, 200);
  assert.deepEqual(body, { service: 'TerraScope API', health: '/api/health' });
});

test('malformed field IDs are rejected before querying the database', async () => {
  const { status, body } = await callApp('GET', '/api/fields/not-a-uuid/weather');
  assert.equal(status, 400);
  assert.deepEqual(body, { error: 'fieldId must be a valid UUID' });
});

test('malformed alert IDs are rejected before applying a mutation', async () => {
  const { status, body } = await callApp('PATCH', '/api/fields/00000000-0000-0000-0000-000000000001/alerts/invalid/resolve');
  assert.equal(status, 400);
  assert.deepEqual(body, { error: 'alertId must be a valid UUID' });
});
