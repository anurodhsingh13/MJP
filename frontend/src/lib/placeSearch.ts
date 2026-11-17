export type PlaceBox = { south: number; north: number; west: number; east: number };
export type PlaceHit = { latitude: number; longitude: number; address: string; box?: PlaceBox };

const finite = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function cleanHit(raw: { latitude?: unknown; longitude?: unknown; address?: unknown; box?: Partial<Record<keyof PlaceBox, unknown>> }): PlaceHit | null {
  const latitude = finite(raw.latitude), longitude = finite(raw.longitude);
  if (latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const south = finite(raw.box?.south), north = finite(raw.box?.north), west = finite(raw.box?.west), east = finite(raw.box?.east);
  const box = south !== null && north !== null && west !== null && east !== null && south < north && west <= east ? { south, north, west, east } : undefined;
  return { latitude, longitude, address: String(raw.address ?? '').slice(0, 200), ...(box ? { box } : {}) };
}

/** Google Geocoding through our own server (the Google key never reaches the browser). */
async function googlePlaces(query: string, signal: AbortSignal): Promise<PlaceHit[]> {
  const response = await fetch(`/api/places/search?q=${encodeURIComponent(query)}`, { signal });
  if (!response.ok) throw new Error('Google place search unavailable');
  const body = await response.json() as { results?: unknown };
  return (Array.isArray(body.results) ? body.results : []).map(item => cleanHit(item as never)).filter((hit): hit is PlaceHit => hit !== null);
}

/** OpenStreetMap Nominatim: several villages with the same name, each with district and state. */
async function openStreetMapPlaces(query: string, signal: AbortSignal): Promise<PlaceHit[]> {
  const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=in&q=${encodeURIComponent(query)}`, { signal });
  if (!response.ok) throw new Error('OpenStreetMap place search unavailable');
  const rows = await response.json() as Array<{ lat?: string; lon?: string; display_name?: string; boundingbox?: string[] }>;
  return (Array.isArray(rows) ? rows : []).map(row => {
    const [south, north, west, east] = row.boundingbox ?? [];
    return cleanHit({ latitude: row.lat, longitude: row.lon, address: row.display_name, box: { south, north, west, east } });
  }).filter((hit): hit is PlaceHit => hit !== null);
}

const kmBetween = (a: PlaceHit, b: PlaceHit) => {
  const rad = Math.PI / 180;
  const h = Math.sin((b.latitude - a.latitude) * rad / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin((b.longitude - a.longitude) * rad / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

/**
 * Village/town search. Google's best match comes first, then OpenStreetMap's other matches (many villages share a name),
 * without listing the same place twice. Works when either service is down; fails only when both are.
 */
export async function searchPlaces(query: string): Promise<PlaceHit[]> {
  const signal = AbortSignal.timeout(12000);
  const [google, openStreetMap] = await Promise.allSettled([googlePlaces(query, signal), openStreetMapPlaces(query, signal)]);
  const hits: PlaceHit[] = google.status === 'fulfilled' ? [...google.value] : [];
  if (openStreetMap.status === 'fulfilled') for (const hit of openStreetMap.value) if (!hits.some(existing => kmBetween(existing, hit) < 3)) hits.push(hit);
  if (!hits.length && google.status === 'rejected' && openStreetMap.status === 'rejected') throw new Error('Search unavailable');
  return hits.slice(0, 6);
}
