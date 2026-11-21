import type { Request, Response } from 'express';
import { providerJson } from '../services/provider.ts';
import { geocodeUrl, geocodingKey, normaliseGeocode, PlaceProviderError } from '../services/places.ts';

/** GET /api/places/search?q=... : Google Geocoding for village/town search, called server-side so the key stays private. */
export async function searchPlaces(request: Request, response: Response) {
  const raw = typeof request.query.q === 'string' ? request.query.q : '';
  const query = raw.replace(/\p{Cc}+/gu, ' ').trim();
  if (query.length < 2 || query.length > 120) { response.status(400).json({ error: 'Type 2 to 120 characters to search' }); return; }
  const key = geocodingKey();
  if (!key) { response.status(503).json({ error: 'Place search is not configured', code: 'not_configured' }); return; }
  try {
    const results = normaliseGeocode(await providerJson(geocodeUrl(query, key), {}, 8000));
    response.setHeader('Cache-Control', 'private, max-age=300');
    response.json({ results });
  } catch (error) {
    // Never include the Google URL (it carries the key) in logs or responses.
    console.error('GET /api/places/search failed:', error instanceof PlaceProviderError ? error.status : 'provider unavailable');
    response.status(502).json({ error: 'Place search is unavailable right now', code: 'provider_unavailable' });
  }
}
