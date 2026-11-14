/** Product heuristics, not agronomic validation. All accepted evidence is boundary/version scoped. */
export interface EvidencePolicy {
  minCoverage: number; minPixels: number; freshDays: number; declineThreshold: number;
  searchDays: number; candidateLimit: number; maxAttempts: number;
  /** Two images further apart than this are not compared: crop stage changes too much in between. */
  compareDays: number;
}
export const defaultPolicy: EvidencePolicy = {
  minCoverage: 70, minPixels: 10, freshDays: 14, declineThreshold: 0.1,
  searchDays: 90, candidateLimit: 100, maxAttempts: 6, compareDays: 30,
};
export type Provenance = 'user_reported' | 'measured_imagery' | 'public_boundary' | 'demo' | 'legacy_unverified';
export type SceneStatus = 'discovered' | 'queued' | 'processing' | 'processed' | 'rejected' | 'failed';
export type AttentionState = 'needs_inspection' | 'no_unusual_change' | 'image_too_old' | 'not_enough_data' | 'awaiting_analysis';
/** Share (percent) of clear field pixels in each NDVI range. Ranges describe greenness, not crop health. */
export interface NdviClasses { bare: number; low: number; moderate: number; high: number }
export const NDVI_CLASS_BREAKS = { low: 0.2, moderate: 0.4, high: 0.6 } as const;
export interface Observation {
  scene_id: string | null; observed_on: string; acquired_at?: string | null;
  ndvi_value: number | string | null; ndmi_value?: number | string | null; ndre_value?: number | string | null;
  cloud_cover: number | null; valid_coverage_percent: number | string | null; valid_pixel_count: number | null;
  source: string; provenance: Provenance; boundary_version: number; accepted: boolean;
  inspection_geojson?: Record<string,unknown>|null; affected_coverage_percent?:number|string|null;
  calculation_version?: string; quality_reason?: string | null;
  /** Sentinel-2 MGRS tile (for example 43RGK). Reflectance differs between overlapping tiles. */
  tile_id?: string | null;
  ndvi_classes?: NdviClasses | null;
}
export type SeasonStage = 'unknown' | 'before_sowing' | 'establishment' | 'growing' | 'maturity' | 'after_harvest';
export interface CropSeason { plantingDate?: string | null; harvestDate?: string | null }
export interface Assessment {
  state: AttentionState; title: string; explanation: string; nextAction: string;
  ageDays: number | null; change: number | null; comparableObservations: number;
  /** Crop stage at the latest image, from the sowing/harvest dates the farmer entered. */
  stage?: SeasonStage;
  /** A large NDVI drop that the recorded crop calendar explains (maturity or harvest). */
  expectedDecline?: boolean;
}
export const numeric = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '' || (typeof value !== 'number' && typeof value !== 'string')) return null;
  const result = Number(value); return Number.isFinite(result) ? result : null;
};
const DAY = 86400000;
const dayTime = (value: unknown): number | null => {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value !== 'string' || !value) return null;
  const time = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  return Number.isFinite(time) ? time : null;
};
/**
 * Crop stage from the sowing and harvest dates entered for the field. Windows are deliberately simple:
 * 30 days after sowing (establishment), 30 days before harvest (maturity) and 45 days after harvest.
 * Dates far outside the observation are treated as an old season, never as the current one.
 */
export function seasonStage(season: CropSeason | null | undefined, observedOn: string): SeasonStage {
  const observed = dayTime(observedOn);
  if (observed === null) return 'unknown';
  const planting = dayTime(season?.plantingDate), harvest = dayTime(season?.harvestDate);
  if (planting !== null && harvest !== null && harvest <= planting) return 'unknown';
  if (harvest !== null) {
    if (observed > harvest) return observed - harvest <= 45 * DAY ? 'after_harvest' : 'unknown';
    if (harvest - observed <= 30 * DAY && (planting === null || observed >= planting)) return 'maturity';
  }
  if (planting !== null) {
    if (observed < planting) return planting - observed <= 60 * DAY ? 'before_sowing' : 'unknown';
    if (observed - planting <= 30 * DAY) return 'establishment';
    if (harvest !== null || observed - planting <= 240 * DAY) return 'growing';
  }
  return 'unknown';
}
export function qualityReason(observation: Pick<Observation, 'ndvi_value' | 'valid_coverage_percent' | 'valid_pixel_count'>, policy = defaultPolicy): string | null {
  const ndvi = numeric(observation.ndvi_value), coverage = numeric(observation.valid_coverage_percent), pixels = numeric(observation.valid_pixel_count);
  if (ndvi === null || ndvi < -1 || ndvi > 1) return 'Vegetation measurement unavailable';
  if (coverage === null || pixels === null) return 'Field-level image quality is unverified';
  if (coverage < policy.minCoverage || pixels < policy.minPixels) return 'Not enough usable field pixels';
  return null;
}
/** Days between two acquisitions, or null when either date is unreadable. */
export function daysApart(newer: Observation, older: Observation): number | null {
  const a = dayTime(newer.acquired_at || newer.observed_on), b = dayTime(older.acquired_at || older.observed_on);
  return a === null || b === null ? null : Math.abs(a - b) / DAY;
}
/**
 * An earlier image can be compared only when it measures the same boundary with the same method,
 * comes from the same Sentinel-2 tile (when both are known) and is recent enough for the crop stage
 * not to have changed completely.
 */
export function isComparable(latest: Observation, previous: Observation, policy = defaultPolicy): boolean {
  if (!previous.accepted || previous.provenance !== 'measured_imagery' || qualityReason(previous, policy)) return false;
  if (previous.boundary_version !== latest.boundary_version || previous.calculation_version !== latest.calculation_version) return false;
  if (!(previous.observed_on < latest.observed_on)) return false;
  if (latest.tile_id && previous.tile_id && latest.tile_id !== previous.tile_id) return false;
  const gap = daysApart(latest, previous);
  return gap !== null && gap <= (policy.compareDays ?? defaultPolicy.compareDays);
}
/** Latest accepted image and the most recent earlier image that is fair to compare with it. */
export function comparablePair(observations: Observation[], policy = defaultPolicy): [Observation | null, Observation | null] {
  const ordered = [...observations].sort((a, b) => b.observed_on.localeCompare(a.observed_on) || String(b.acquired_at ?? '').localeCompare(String(a.acquired_at ?? '')));
  const latest = ordered[0] ?? null;
  if (!latest) return [null, null];
  return [latest, ordered.slice(1).find(item => isComparable(latest, item, policy)) ?? null];
}
export function assessEvidence(latest: Observation | null, previous: Observation | null, policy = defaultPolicy, now = Date.now(), season?: CropSeason | null): Assessment {
  const result: Assessment = { state: 'awaiting_analysis', title: 'Awaiting first analysis', explanation: 'No accepted satellite measurement for this boundary.', nextAction: 'Find a usable image', ageDays: null, change: null, comparableObservations: 0 };
  if (!latest) return result;
  const acquired = Date.parse(latest.acquired_at || latest.observed_on);
  result.ageDays = Number.isFinite(acquired) ? Math.floor((now - acquired) / 86400000) : null;
  result.stage = seasonStage(season, latest.observed_on);
  const reason = qualityReason(latest, policy);
  if (!latest.accepted || latest.provenance !== 'measured_imagery' || reason || result.ageDays === null || result.ageDays < 0) {
    return { ...result, state: 'not_enough_data', title: 'Not enough usable data', explanation: reason || 'The measurement has not been verified for this boundary.', nextAction: 'Try another image' };
  }
  result.comparableObservations = 1;
  const tooFarApart = Boolean(previous && !isComparable(latest, previous, policy) && previous.observed_on < latest.observed_on && (daysApart(latest, previous) ?? 0) > (policy.compareDays ?? defaultPolicy.compareDays));
  if (previous && isComparable(latest, previous, policy)) {
    result.change = Number((numeric(latest.ndvi_value)! - numeric(previous.ndvi_value)!).toFixed(4));
    result.comparableObservations = 2;
  }
  if (result.ageDays > policy.freshDays) return { ...result, state: 'image_too_old', title: 'Image too old', explanation: `Last usable image is ${result.ageDays} days old. Current crop condition is unknown.`, nextAction: 'Find a newer image' };
  if (result.change !== null && result.change <= -policy.declineThreshold) {
    if (result.stage === 'maturity' || result.stage === 'after_harvest') {
      return { ...result, state: 'no_unusual_change', expectedDecline: true, title: 'Expected seasonal decline',
        explanation: result.stage === 'maturity'
          ? 'Greenness fell within 30 days of the recorded harvest date. Ripening crops lose greenness; visit only if the crop is not yet ready for harvest.'
          : 'Greenness fell after the recorded harvest date. Bare or harvested ground explains the drop; update the crop dates for the next season.',
        nextAction: 'Continue monitoring' };
    }
    return { ...result, state: 'needs_inspection', title: 'Needs inspection', explanation: 'Vegetation decreased since the previous comparable image. Harvest, maturity, bare soil, or crop stress may explain this.', nextAction: 'Plan a field visit' };
  }
  if (result.change === null) return { ...result, state: 'not_enough_data', title: 'Not enough usable data',
    explanation: tooFarApart
      ? `The previous usable image is more than ${policy.compareDays ?? defaultPolicy.compareDays} days older, too far apart to compare crop change.`
      : 'One usable image is available. A comparable earlier image is needed to assess change.',
    nextAction: 'Review the image' };
  return { ...result, state: 'no_unusual_change', title: 'No unusual change detected', explanation: 'No large decrease between these two usable images. This does not rule out crop problems.', nextAction: 'Continue monitoring' };
}
/** Experimental display only: coverage affects acceptance, never this score. */
export function vegetationScore(ndvi: number, ndmi: number | null): number {
  const clamp = (x: number) => Math.max(0, Math.min(100, x));
  const greenness = clamp((ndvi - .15) / .65 * 100);
  return Math.round(.75 * greenness + .25 * (ndmi === null ? greenness : clamp((ndmi + .2) / .7 * 100)));
}
/** Validates an engine-reported NDVI class split: four finite percentages that add up to ~100. */
export function validNdviClasses(value: unknown): NdviClasses | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const keys = ['bare', 'low', 'moderate', 'high'] as const;
  const numbers = keys.map(key => numeric(candidate[key]));
  if (numbers.some(item => item === null || item < 0 || item > 100)) return null;
  const total = (numbers as number[]).reduce((sum, item) => sum + item, 0);
  if (Math.abs(total - 100) > 1.5) return null;
  return { bare: numbers[0]!, low: numbers[1]!, moderate: numbers[2]!, high: numbers[3]! };
}
