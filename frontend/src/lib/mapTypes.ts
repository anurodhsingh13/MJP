export type FieldMapProps = {
  latitude: number;
  longitude: number;
  fieldName?: string;
  zoom?: number;
  stressGeojson?: Record<string, unknown> | null;
  boundaryGeojson?: Record<string, unknown> | null;
  overlay?: { image: string; bounds: { north: number; south: number; east: number; west: number } } | null;
  opacity?: number;
  tileUrl?: string | null;
  /** Short name of the index drawn by `tileUrl`, shown in the map attribution. Defaults to NDVI. */
  layerLabel?: string;
};
