import { setOptions } from '@googlemaps/js-api-loader';
let configured = false;
export type GoogleService = 'map';
const failed: Record<GoogleService, boolean> = { map: false };
/**
 * Remember that one Google service rejected this key, so later screens skip just that service instead of waiting again.
 * Only the map is tracked: place search goes through our server, so it does not depend on this browser key.
 */
export function markGoogleFailed(service: GoogleService) { failed[service] = true; }
export function googleFailed(service: GoogleService) { return failed[service]; }
export function configureMaps(key: string) {
  if (configured) return;
  setOptions({ key, v: 'weekly' });
  configured = true;
}
