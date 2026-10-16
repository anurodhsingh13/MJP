import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const launcher = fileURLToPath(new URL('./local.mjs', import.meta.url));

async function fixture(overrides, exercise) {
  const root = await mkdtemp(join(tmpdir(), 'chm-launcher-'));
  const bin = join(root, 'bin');
  const log = join(root, 'pg-requests.jsonl');
  await mkdir(bin);
  await writeFile(join(root, 'empty.env'), '');
  await writeFile(join(bin, 'pg_ctl'), `#!/usr/bin/env node
import {appendFileSync} from 'node:fs';
const args=process.argv.slice(2);
appendFileSync(process.env.CHM_LAUNCHER_TEST_LOG, JSON.stringify(args)+'\\n');
if(args.includes('status'))process.exit(process.env.CHM_LAUNCHER_PG_RUNNING==='1'?0:3);
if(process.env.CHM_LAUNCHER_PG_FAIL==='1'){console.error('Fixture PostgreSQL start failure');process.exit(1);}
`, { mode: 0o755 });
  const env = {
    ...process.env,
    DOTENV_CONFIG_PATH: join(root, 'empty.env'),
    LOCAL_PG_BIN: bin,
    LOCAL_PG_DATA: join(root, 'data'),
    DATABASE_URL: 'postgres://fixture@127.0.0.1:5435/chm_launcher_test',
    CHM_LAUNCHER_TEST_LOG: log,
    CHM_LAUNCHER_PG_RUNNING: '',
    CHM_LAUNCHER_PG_FAIL: '',
    AUTH_MODE: 'required', WEB_HOST: '127.0.0.1', WEB_PORT: '5173', API_PORT: '3001', PYTHON_ENGINE_URL: 'http://127.0.0.1:8000',
    ...overrides,
  };
  const requests = async () => {
    try { return (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  };
  try { await exercise(() => run(process.execPath, [launcher, 'database'], { env }), requests, root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test('migration preparation starts only the configured database without requiring app schema or Python', async () => {
  await fixture({}, async (start, requests, root) => {
    const result = await start();
    assert.match(result.stdout, /PostgreSQL is running/);
    const calls = await requests();
    assert.equal(calls.length, 2);
    assert.ok(calls[0].includes('status'));
    assert.ok(calls[1].includes('start'));
    assert.equal(calls[1][calls[1].indexOf('-D') + 1], join(root, 'data'));
    assert.equal(calls[1][calls[1].indexOf('-o') + 1], '-h 127.0.0.1 -p 5435');
  });
});

test('migration preparation reuses an already running managed database', async () => {
  await fixture({ CHM_LAUNCHER_PG_RUNNING: '1' }, async (start, requests) => {
    await start();
    const calls = await requests();
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes('status'));
  });
});

test('migration preparation reports a database start failure with a nonzero exit', async () => {
  await fixture({ CHM_LAUNCHER_PG_FAIL: '1' }, async start => {
    await assert.rejects(start, error => error.code === 1 && /Local PostgreSQL start failed/.test(error.stderr));
  });
});

test('migration preparation leaves externally managed PostgreSQL alone', async () => {
  await fixture({ LOCAL_PG_BIN: '' }, async (start, requests) => {
    await start();
    assert.deepEqual(await requests(), []);
  });
});
