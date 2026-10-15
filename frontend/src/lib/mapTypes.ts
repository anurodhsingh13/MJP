export type FieldMapProps = {
  latitude: number;
  longitude: number;
  fieldName?: string;
  zoom?: number;
  stressGeojson?: Record<string, unknown> | null;
  boundaryGeojson?: Record<string, unknown> | null;
  overlay?: { image: string; bounds: { north: number; south: number; east: number; west: number } } | null;
  tileUrl?: string | null;
};
