import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geocodeUrl, geocodingKey, normaliseGeocode, PlaceProviderError } from './places.ts';
import { googleCurrentToCurrent, googleCurrentUrl } from './googleWeather.ts';

const result = (address: string, lat: number, lng: number, viewport = true) => ({
  formatted_address: address,
  geometry: { location: { lat, lng }, ...(viewport ? { viewport: { northeast: { lat: lat + .05, lng: lng + .05 }, southwest: { lat: lat - .05, lng: lng - .05 } } } : {}) },
});

test('geocoding results become picker entries with a map box', () => {
  const hits = normaliseGeocode({ status: 'OK', results: [result('Raebareli, Uttar Pradesh, India', 26.22, 81.25)] });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].address, 'Raebareli, Uttar Pradesh, India');
  const box = hits[0].box!;
  for (const [actual, expected] of [[box.south, 26.17], [box.north, 26.27], [box.west, 81.2], [box.east, 81.3]]) assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} vs ${expected}`);
});

test('geocoding drops malformed rows, clips long text and limits the list', () => {
  const raw = { status: 'OK', results: [
    result('Valid one', 20, 80, false),
    { formatted_address: 'No geometry' },
    result('Impossible latitude', 123, 80),
    { formatted_address: 'Bad numbers', geometry: { location: { lat: 'x', lng: 80 } } },
    result('A'.repeat(500) + '\u0007', 21, 81),
    result('Three', 22, 82), result('Four', 23, 83), result('Five', 24, 84), result('Six', 25, 85),
  ] };
  const hits = normaliseGeocode(raw, 3);
  assert.deepEqual(hits.map(hit => hit.address.length), [9, 200, 5]);
  assert.equal(hits[0].box, undefined);
  assert.equal('box' in hits[0], false);
});

test('a whole-country fallback result is not offered as a place', () => {
  const country = { ...result('India', 20.59, 78.96), types: ['country', 'political'] };
  const town = { ...result('Raebareli, Uttar Pradesh, India', 26.22, 81.25), types: ['locality', 'political'] };
  assert.deepEqual(normaliseGeocode({ status: 'OK', results: [country] }), []);
  assert.deepEqual(normaliseGeocode({ status: 'OK', results: [country, town] }).map(hit => hit.address), ['Raebareli, Uttar Pradesh, India']);
});

test('no matches is an empty list, but a denied or malformed answer is a provider error', () => {
  assert.deepEqual(normaliseGeocode({ status: 'ZERO_RESULTS', results: [] }), []);
  for (const raw of [{ status: 'REQUEST_DENIED', error_message: 'secret key text' }, { status: 'OVER_QUERY_LIMIT' }, { status: 'OK' }, null, 'nope']) {
    assert.throws(() => normaliseGeocode(raw), (error: unknown) => error instanceof PlaceProviderError && !/secret/.test(error.message));
  }
});

test('geocoding uses a dedicated key first, then the weather key, and ignores placeholders', () => {
  assert.equal(geocodingKey({ GOOGLE_GEOCODING_API_KEY: 'geo-key', GOOGLE_WEATHER_API_KEY: 'weather-key' } as NodeJS.ProcessEnv), 'geo-key');
  assert.equal(geocodingKey({ GOOGLE_WEATHER_API_KEY: ' weather-key ' } as NodeJS.ProcessEnv), 'weather-key');
  assert.equal(geocodingKey({ GOOGLE_GEOCODING_API_KEY: 'your-key-here', GOOGLE_WEATHER_API_KEY: 'weather-key' } as NodeJS.ProcessEnv), 'weather-key');
  assert.equal(geocodingKey({} as NodeJS.ProcessEnv), '');
});

test('geocode request is India-biased and encodes the query', () => {
  const url = new URL(geocodeUrl('Rampur & more', 'k'));
  assert.equal(url.hostname, 'maps.googleapis.com');
  assert.equal(url.searchParams.get('address'), 'Rampur & more');
  assert.equal(url.searchParams.get('components'), 'country:IN');
  assert.equal(url.searchParams.get('region'), 'in');
});

test('google current conditions map onto the shared forecast "current" block', () => {
  const current = googleCurrentToCurrent({ currentTime: '2026-11-17T16:16:02.615794381Z', temperature: { unit: 'CELSIUS', degrees: 17.5 }, relativeHumidity: 77, precipitation: { qpf: { quantity: 0 } }, wind: { speed: { value: 5 } } });
  assert.deepEqual(current, { time: '2026-11-17T16:16:02.615794381Z', temperature_2m: 17.5, relative_humidity_2m: 77, precipitation: 0, wind_speed_10m: 5 });
});

test('google current conditions reject unusable payloads instead of inventing values', () => {
  assert.equal(googleCurrentToCurrent(null), null);
  assert.equal(googleCurrentToCurrent({ currentTime: 'not a date', temperature: { degrees: 20 } }), null);
  assert.equal(googleCurrentToCurrent({ currentTime: '2026-11-17T16:00:00Z', temperature: { degrees: 400 } }), null);
  assert.equal(googleCurrentToCurrent({ currentTime: '2026-11-17T16:00:00Z' }), null);
  const partial = googleCurrentToCurrent({ currentTime: '2026-11-17T16:00:00Z', temperature: { degrees: 20 }, relativeHumidity: 140 });
  assert.equal(partial?.relative_humidity_2m, null);
  assert.equal(partial?.precipitation, null);
});

test('google current conditions request is metric and carries the location', () => {
  const url = new URL(googleCurrentUrl('k', 26.23, 81.24));
  assert.equal(url.hostname, 'weather.googleapis.com');
  assert.equal(url.searchParams.get('unitsSystem'), 'METRIC');
  assert.equal(url.searchParams.get('location.latitude'), '26.23');
});
