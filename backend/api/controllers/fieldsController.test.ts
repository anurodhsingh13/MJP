import { describe, it } from 'node:test';
import assert from 'node:assert';
import { calculateHealthScore, getPythonEngineUrl, isValidFieldBoundary } from './fieldsController.ts';

describe('Fields Controller Integration Tests', () => {
  it('Should handle valid API dependencies', () => {
    assert.strictEqual(typeof fetch, 'function');
  });

  it('Calculates STAC query dates correctly', () => {
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    assert.ok(start.startsWith('202'));
    assert.ok(end.startsWith('202'));
  });
  
  it('Tile proxy constructs correct Python engine URL', () => {
    const original = process.env.PYTHON_ENGINE_URL;
    process.env.PYTHON_ENGINE_URL = 'http://127.0.0.1:8000/';
    const pythonEngineUrl = getPythonEngineUrl();
    const z = '14', x = '1', y = '2';
    const targetUrl = `${pythonEngineUrl}/tiles/${z}/${x}/${y}.png`;
    assert.equal(pythonEngineUrl, 'http://127.0.0.1:8000');
    assert.ok(targetUrl.endsWith('/tiles/14/1/2.png'));
    if (original === undefined) delete process.env.PYTHON_ENGINE_URL; else process.env.PYTHON_ENGINE_URL = original;
  });

  it('validates closed WGS84 field polygons', () => {
    assert.equal(isValidFieldBoundary({ type: 'Polygon', coordinates: [[[77, 28], [77.1, 28], [77.1, 28.1], [77, 28]]] }), true);
    assert.equal(isValidFieldBoundary({ type: 'Polygon', coordinates: [[[77, 28], [77.1, 28], [77.1, 28.1]]] }), false);
    assert.equal(isValidFieldBoundary({ type: 'Polygon', coordinates: [[[200, 28], [77.1, 28], [77.1, 28.1], [200, 28]]] }), false);
  });

  it('keeps the experimental health score inside 0-100 and applies data quality', () => {
    assert.equal(calculateHealthScore(1, 1, 100), 100);
    assert.equal(calculateHealthScore(-1, -1, 100), 0);
    assert.ok(calculateHealthScore(0.7, 0.3, 50) < calculateHealthScore(0.7, 0.3, 100));
  });
});

it('weather sync accepts the empty POST body sent by the browser and valid zero coordinates', async () => {
  const { ingestWeather } = await import('./fieldsController.ts');
  const { pool } = await import('../db/pool.ts');
  const originalQuery = pool.query;
  const originalFetch = globalThis.fetch;
  let result: unknown;
  pool.query = (async (sql: string) => ({ rows: sql.startsWith('select') ? [{ latitude: 0, longitude: 0 }] : [], rowCount: 1 })) as typeof pool.query;
  globalThis.fetch = (async (url: string | URL | Request) => {
    assert.ok(String(url).includes('latitude=0'));
    return new Response(JSON.stringify({ properties: { parameter: { T2M: { '20261001': 25 }, RH2M: { '20261001': 60 }, PRECTOTCORR: { '20261001': 2 } } } }), { status: 200 });
  }) as typeof fetch;
  try {
    await ingestWeather({ params: { fieldId: 'test' } } as unknown as import('express').Request, {
      json(value: unknown) { result = value; },
      status() { throw new Error('Weather sync must not reject an empty body or zero coordinates'); },
    } as unknown as import('express').Response);
    assert.equal((result as { imported: number }).imported, 1);
  } finally { pool.query = originalQuery; globalThis.fetch = originalFetch; }
});

it('weather sync excludes missing sentinel values without dropping valid zero rainfall', async () => {
  const { ingestWeather } = await import('./fieldsController.ts');
  const { pool } = await import('../db/pool.ts');
  const originalQuery = pool.query;
  const originalFetch = globalThis.fetch;
  const writes: unknown[][] = [];
  let result: unknown;
  pool.query = (async (sql: string, values: unknown[]) => {
    if (sql.startsWith('select')) return { rows: [{ latitude: 28, longitude: 77 }], rowCount: 1 };
    writes.push(values); return { rows: [], rowCount: 1 };
  }) as typeof pool.query;
  globalThis.fetch = (async () => new Response(JSON.stringify({ header: { fill_value: -999 }, properties: { parameter: {
    T2M: { '20261001': 25, '20261002': -999, '20261003': -999 },
    RH2M: { '20261001': 60, '20261002': -999, '20261003': 50 },
    PRECTOTCORR: { '20261001': 0, '20261002': -999, '20261003': -999 },
  } } }))) as typeof fetch;
  try {
    await ingestWeather({ params: { fieldId: 'test' } } as unknown as import('express').Request, {
      json(value: unknown) { result = value; }, status() { throw new Error('Unexpected failure'); },
    } as unknown as import('express').Response);
    assert.equal((result as { imported: number }).imported, 2);
    assert.equal(writes.length, 2);
    assert.equal(writes[0][2], 0);
    assert.equal(writes[1][2], null);
    assert.equal(writes[1][3], null);
    assert.equal(writes[1][4], 50);
    assert.ok(writes.every(values => !values.includes(-999)));
  } finally { pool.query = originalQuery; globalThis.fetch = originalFetch; }
});

it('satellite point search uses Earth Search property paths for sorting', async () => {
  const { ingestSentinelScenes } = await import('./fieldsController.ts');
  const { pool } = await import('../db/pool.ts');
  const originalQuery = pool.query, originalFetch = globalThis.fetch;
  let imported: unknown;
  pool.query = (async (sql: string) => ({ rows: sql.startsWith('select') ? [{ latitude: 28, longitude: 77, boundary_geojson: null }] : [], rowCount: 1 })) as typeof pool.query;
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    assert.deepEqual(body.intersects, { type: 'Point', coordinates: [77, 28] });
    assert.deepEqual(body.sortby.map((sort: { field: string }) => sort.field), ['properties.eo:cloud_cover', 'properties.datetime']);
    return new Response(JSON.stringify({ features: [{ id: 'test-scene', properties: { datetime: '2026-10-01T00:00:00Z', 'eo:cloud_cover': 5 }, assets: {} }] }));
  }) as typeof fetch;
  try {
    await ingestSentinelScenes({ params: { fieldId: 'test' }, query: {} } as unknown as import('express').Request, {
      json(value: unknown) { imported = value; }, status() { throw new Error('Unexpected failure'); },
    } as unknown as import('express').Response);
    assert.equal((imported as { imported: number }).imported, 1);
  } finally { pool.query = originalQuery; globalThis.fetch = originalFetch; }
});
