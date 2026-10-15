import { setOptions } from '@googlemaps/js-api-loader';
let configured = false;
export function configureMaps(key: string) {
  if (configured) return;
  setOptions({ key, v: 'weekly' });
  configured = true;
}
