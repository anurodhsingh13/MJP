export type PlaceBox = { south: number; north: number; west: number; east: number };
export type PlaceHit = { latitude: number; longitude: number; address: string; box?: PlaceBox };

/** Google answered, but not with usable places (denied, over quota, invalid request). Carries only Google's status code. */
export class PlaceProviderError extends Error {
  readonly status: string;
  constructor(status: string) { super('Place provider request failed'); this.status = status; }
}

const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
type LatLng = { lat?: unknown; lng?: unknown };

/** Server-side key for Google Geocoding: a dedicated key when set, otherwise the Google Weather key (same Google project). */
export function geocodingKey(env: NodeJS.ProcessEnv = process.env): string {
  for (const candidate of [env.GOOGLE_GEOCODING_API_KEY, env.GOOGLE_WEATHER_API_KEY]) {
    const value = candidate?.trim();
    if (value && !/^(your[-_ ]|placeholder|changeme|replace[-_ ]|example)/i.test(value)) return value;
  }
  return '';
}

/** India-focused forward geocoding request. The key is added by the caller's URL only and never returned to the browser. */
export function geocodeUrl(query: string, key: string): string {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.search = new URLSearchParams({ address: query, region: 'in', components: 'country:IN', key }).toString();
  return url.href;
}

/** Google Geocoding response -> a short list of places a farmer can pick from. Anything malformed is dropped. */
export function normaliseGeocode(raw: unknown, limit = 5): PlaceHit[] {
  const data = raw as { status?: unknown; results?: unknown } | null;
  if (data?.status === 'ZERO_RESULTS') return [];
  if (data?.status !== 'OK' || !Array.isArray(data.results)) throw new PlaceProviderError(String(data?.status ?? 'INVALID_RESPONSE'));
  const hits: PlaceHit[] = [];
  for (const item of data.results) {
    const result = item as { types?: unknown; formatted_address?: unknown; geometry?: { location?: LatLng; viewport?: { northeast?: LatLng; southwest?: LatLng } } };
    // For unknown words Google falls back to the whole country ("India"), which cannot locate a field: skip it.
    if (Array.isArray(result.types) && result.types.includes('country')) continue;
    const latitude = finite(result.geometry?.location?.lat), longitude = finite(result.geometry?.location?.lng);
    if (latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;
    const north = finite(result.geometry?.viewport?.northeast?.lat), east = finite(result.geometry?.viewport?.northeast?.lng);
    const south = finite(result.geometry?.viewport?.southwest?.lat), west = finite(result.geometry?.viewport?.southwest?.lng);
    const box = north !== null && east !== null && south !== null && west !== null && south < north && west <= east ? { south, north, west, east } : undefined;
    const address = typeof result.formatted_address === 'string' ? result.formatted_address.replace(/\p{Cc}+/gu, ' ').trim().slice(0, 200) : '';
    hits.push({ latitude, longitude, address, ...(box ? { box } : {}) });
    if (hits.length >= limit) break;
  }
  return hits;
}
