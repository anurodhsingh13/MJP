/** Product heuristics, not agronomic validation. All accepted evidence is boundary/version scoped. */
export interface EvidencePolicy {
  minCoverage: number; minPixels: number; freshDays: number; declineThreshold: number;
  searchDays: number; candidateLimit: number; maxAttempts: number;
}
export const defaultPolicy: EvidencePolicy = {
  minCoverage: 70, minPixels: 10, freshDays: 14, declineThreshold: 0.1,
  searchDays: 90, candidateLimit: 100, maxAttempts: 6,
};
export type Provenance = 'user_reported' | 'measured_imagery' | 'public_boundary' | 'demo' | 'legacy_unverified';
export type SceneStatus = 'discovered' | 'queued' | 'processing' | 'processed' | 'rejected' | 'failed';
export type AttentionState = 'needs_inspection' | 'no_unusual_change' | 'image_too_old' | 'not_enough_data' | 'awaiting_analysis';
export interface Observation {
  scene_id: string | null; observed_on: string; acquired_at?: string | null;
  ndvi_value: number | string | null; ndmi_value?: number | string | null; ndre_value?: number | string | null;
  cloud_cover: number | null; valid_coverage_percent: number | string | null; valid_pixel_count: number | null;
  source: string; provenance: Provenance; boundary_version: number; accepted: boolean;
  inspection_geojson?: Record<string,unknown>|null; affected_coverage_percent?:number|string|null;
  calculation_version?: string; quality_reason?: string | null;
}
export interface Assessment {
  state: AttentionState; title: string; explanation: string; nextAction: string;
  ageDays: number | null; change: number | null; comparableObservations: number;
}
export const numeric = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '' || (typeof value !== 'number' && typeof value !== 'string')) return null;
  const result = Number(value); return Number.isFinite(result) ? result : null;
};
export function qualityReason(observation: Pick<Observation, 'ndvi_value' | 'valid_coverage_percent' | 'valid_pixel_count'>, policy = defaultPolicy): string | null {
  const ndvi = numeric(observation.ndvi_value), coverage = numeric(observation.valid_coverage_percent), pixels = numeric(observation.valid_pixel_count);
  if (ndvi === null || ndvi < -1 || ndvi > 1) return 'Vegetation measurement unavailable';
  if (coverage === null || pixels === null) return 'Field-level image quality is unverified';
  if (coverage < policy.minCoverage || pixels < policy.minPixels) return 'Not enough usable field pixels';
  return null;
}
export function assessEvidence(latest: Observation | null, previous: Observation | null, policy = defaultPolicy, now = Date.now()): Assessment {
  const result: Assessment = { state: 'awaiting_analysis', title: 'Awaiting first analysis', explanation: 'No accepted satellite measurement for this boundary.', nextAction: 'Find a usable image', ageDays: null, change: null, comparableObservations: 0 };
  if (!latest) return result;
  const acquired = Date.parse(latest.acquired_at || latest.observed_on);
  result.ageDays = Number.isFinite(acquired) ? Math.floor((now - acquired) / 86400000) : null;
  const reason = qualityReason(latest, policy);
  if (!latest.accepted || latest.provenance !== 'measured_imagery' || reason || result.ageDays === null || result.ageDays < 0) {
    return { ...result, state: 'not_enough_data', title: 'Not enough usable data', explanation: reason || 'The measurement has not been verified for this boundary.', nextAction: 'Try another image' };
  }
  result.comparableObservations = 1;
  if (previous && previous.accepted && previous.provenance === 'measured_imagery' && previous.boundary_version === latest.boundary_version && previous.calculation_version === latest.calculation_version && previous.observed_on < latest.observed_on && !qualityReason(previous, policy)) {
    result.change = Number((numeric(latest.ndvi_value)! - numeric(previous.ndvi_value)!).toFixed(4));
    result.comparableObservations = 2;
  }
  if (result.ageDays > policy.freshDays) return { ...result, state: 'image_too_old', title: 'Image too old', explanation: `Last usable image is ${result.ageDays} days old. Current crop condition is unknown.`, nextAction: 'Find a newer image' };
  if (result.change !== null && result.change <= -policy.declineThreshold) return { ...result, state: 'needs_inspection', title: 'Needs inspection', explanation: 'Vegetation decreased since the previous comparable image. Harvest, maturity, bare soil, or crop stress may explain this.', nextAction: 'Plan a field visit' };
  if (result.change === null) return { ...result, state: 'not_enough_data', title: 'Not enough usable data', explanation: 'One usable image is available. A comparable earlier image is needed to assess change.', nextAction: 'Review the image' };
  return { ...result, state: 'no_unusual_change', title: 'No unusual change detected', explanation: 'No large decrease between these two usable images. This does not rule out crop problems.', nextAction: 'Continue monitoring' };
}
/** Experimental display only: coverage affects acceptance, never this score. */
export function vegetationScore(ndvi: number, ndmi: number | null): number {
  const clamp = (x: number) => Math.max(0, Math.min(100, x));
  const greenness = clamp((ndvi - .15) / .65 * 100);
  return Math.round(.75 * greenness + .25 * (ndmi === null ? greenness : clamp((ndmi + .2) / .7 * 100)));
}
