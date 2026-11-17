const read = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * Google Weather "current conditions" -> the `current` block the shared forecast parser reads (Open-Meteo field names),
 * so the forecast panel can show "Right now" even when Google Weather is the forecast provider. Null when unusable.
 */
export function googleCurrentToCurrent(value: unknown): { time: string; temperature_2m: number | null; relative_humidity_2m: number | null; precipitation: number | null; wind_speed_10m: number | null } | null {
  const data = value as { currentTime?: unknown; temperature?: { degrees?: unknown }; relativeHumidity?: unknown; precipitation?: { qpf?: { quantity?: unknown } }; wind?: { speed?: { value?: unknown } } } | null;
  if (!data || typeof data.currentTime !== 'string' || !Number.isFinite(Date.parse(data.currentTime))) return null;
  const temperature = read(data.temperature?.degrees);
  if (temperature === null || temperature < -100 || temperature > 70) return null;
  const humidity = read(data.relativeHumidity);
  return {
    time: data.currentTime,
    temperature_2m: temperature,
    relative_humidity_2m: humidity !== null && humidity >= 0 && humidity <= 100 ? humidity : null,
    precipitation: read(data.precipitation?.qpf?.quantity),
    wind_speed_10m: read(data.wind?.speed?.value),
  };
}

export function googleCurrentUrl(key: string, latitude: number, longitude: number): string {
  const url = new URL('https://weather.googleapis.com/v1/currentConditions:lookup');
  url.search = new URLSearchParams({ key, 'location.latitude': String(latitude), 'location.longitude': String(longitude), unitsSystem: 'METRIC' }).toString();
  return url.href;
}
