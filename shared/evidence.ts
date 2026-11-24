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
  /** Crop stage at the latest image: from the sowing/harvest dates the farmer entered, else from a regional reference window. */
  stage?: SeasonStage;
  /** Where `stage` came from. 'regional_reference' is a regional estimate, never the farmer's own dates. */
  stageSource?: 'saved_dates' | 'regional_reference';
  /** A large NDVI drop that the recorded crop calendar explains (maturity or harvest). */
  expectedDecline?: boolean;
  /** The saved sowing/harvest dates do not place this image in the current season (old, or harvest not after sowing). */
  datesOutdated?: boolean;
  /** Latest NDVI against this field's own earlier seasons (same time of year). Present only with 2+ earlier years. Context, not a diagnosis. */
  baseline?: BaselineComparison;
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
 * True when saved crop dates exist but cannot belong to the season being observed: harvest was more than 45 days ago,
 * sowing is more than 60 days ahead, sowing was over 240 days ago with no harvest date, or harvest is not after sowing.
 * Without this, an out-of-date calendar makes ripening or harvest look like crop stress.
 */
export function cropDatesOutdated(season: CropSeason | null | undefined, observedOn: string): boolean {
  const observed = dayTime(observedOn), planting = dayTime(season?.plantingDate), harvest = dayTime(season?.harvestDate);
  if (observed === null || (planting === null && harvest === null)) return false;
  if (planting !== null && harvest !== null && harvest <= planting) return true;
  if (harvest !== null && observed - harvest > 45 * DAY) return true;
  if (planting !== null && planting - observed > 60 * DAY) return true;
  return planting !== null && harvest === null && observed - planting > 240 * DAY;
}
/**
 * Whether the saved sowing / harvest dates can be used for TODAY's advice. 'missing' when neither date was entered (the crop stage then falls back to a
 * regional calendar or stays unknown), 'outdated' when the dates belong to another season (see cropDatesOutdated), otherwise 'ok'.
 * Unlike cropDatesOutdated this looks at today, not at an image date, so a notice can appear before any alert exists.
 */
export type CropDatesStatus = 'ok' | 'missing' | 'outdated';
export function cropDatesStatus(season: CropSeason | null | undefined, today: string = new Date().toISOString().slice(0, 10)): CropDatesStatus {
  const planting = dayTime(season?.plantingDate), harvest = dayTime(season?.harvestDate);
  if (planting === null && harvest === null) return 'missing';
  return cropDatesOutdated(season, today) ? 'outdated' : 'ok';
}
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
/** A regional sowing and harvest window by calendar month (1-12) from the reviewed reference calendar. Not a record of what was planted. */
export interface ReferenceWindow { plantingStartMonth: number; plantingEndMonth: number; harvestStartMonth: number; harvestEndMonth: number }
const validMonth = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 12;
export function validReferenceWindow(window: Partial<Record<keyof ReferenceWindow, unknown>> | null | undefined): window is ReferenceWindow {
  return Boolean(window) && validMonth(window!.plantingStartMonth) && validMonth(window!.plantingEndMonth)
    && validMonth(window!.harvestStartMonth) && validMonth(window!.harvestEndMonth);
}
/**
 * Crop stage from a regional window. The whole planting window counts as sowing, establishment runs 30 days past its end,
 * "maturity" starts 30 days before the harvest window and lasts through it, and "after harvest" lasts 45 days. Outside
 * the season (more than 60 days before sowing or 45 days after harvest) the stage is unknown.
 */
export function referenceStage(window: ReferenceWindow | null | undefined, observedOn: string): SeasonStage {
  const observed = dayTime(observedOn);
  if (observed === null || !validReferenceWindow(window)) return 'unknown';
  const { plantingStartMonth: ps, plantingEndMonth: pe, harvestStartMonth: hs, harvestEndMonth: he } = window;
  const year = new Date(observed).getUTCFullYear();
  for (const seasonYear of [year - 1, year]) {
    const start = Date.UTC(seasonYear, ps - 1, 1);
    const plantingEndYear = pe >= ps ? seasonYear : seasonYear + 1;
    const plantingEnd = Date.UTC(plantingEndYear, pe, 0);                  // last day of the planting-end month
    const harvestStartYear = hs > pe ? plantingEndYear : plantingEndYear + 1;
    const harvestStart = Date.UTC(harvestStartYear, hs - 1, 1);
    const harvestEnd = Date.UTC(he >= hs ? harvestStartYear : harvestStartYear + 1, he, 0);
    if (observed < start - 60 * DAY || observed > harvestEnd + 45 * DAY) continue;
    if (observed < start) return 'before_sowing';
    if (observed <= plantingEnd + 30 * DAY) return 'establishment';
    if (observed < harvestStart - 30 * DAY) return 'growing';
    if (observed <= harvestEnd) return 'maturity';
    return 'after_harvest';
  }
  return 'unknown';
}
/** Stage from the farmer's own dates when they fit the season, otherwise from the regional reference when one is given. */
export function resolveStage(season: CropSeason | null | undefined, reference: ReferenceWindow | null | undefined, observedOn: string): { stage: SeasonStage; source: 'saved_dates' | 'regional_reference' } {
  const saved = seasonStage(season, observedOn);
  if (saved !== 'unknown') return { stage: saved, source: 'saved_dates' };
  const regional = referenceStage(reference, observedOn);
  return regional === 'unknown' ? { stage: 'unknown', source: 'saved_dates' } : { stage: regional, source: 'regional_reference' };
}
/** An earlier-season reading of the same field, used only to describe what is usual at this time of year. */
export interface BaselinePoint { observed_on: string; ndvi_value: number | string | null }
/** low/high are the earlier years' window medians (they decide whether the years agree); min/max are the lowest and highest single readings in the window (they set the VCI range). */
export interface SeasonalBaseline { expected: number; low: number; high: number; min: number; max: number; years: number }
/** How the latest NDVI sits against the field's own earlier seasons. Context only: it never decides a visit. */
export interface BaselineComparison {
  expected: number; difference: number; years: number; reliable: boolean; belowUsual: boolean;
  /** Vegetation Condition Index, 0-100: where the latest NDVI sits between the lowest (0) and highest (100) usual value for this field at this time of year. Null without 3+ earlier years, a usable range, or a reliable baseline. */
  vci: number | null;
}
/** Product heuristics: ±15 days around the same calendar date, at least 2 earlier years, and earlier years must agree within 0.2. */
export const BASELINE = { windowDays: 15, minYears: 2, maxSpread: 0.2, vciMinYears: 3, vciMinRange: 0.1 } as const;
/** VCI = (NDVI - lowest) / (highest - lowest) x 100 (Kogan's Vegetation Condition Index), clamped to 0-100, using the lowest and highest single earlier reading near this date. Measured on 7 fields' 8 years: the latest value fell inside this range 86% of the time, against 61% when yearly medians set the range. */
export function vegetationConditionIndex(ndvi: number, low: number, high: number): number | null {
  if (![ndvi, low, high].every(Number.isFinite) || Number((high - low).toFixed(4)) < BASELINE.vciMinRange) return null;
  return Number(Math.max(0, Math.min(100, (ndvi - low) / (high - low) * 100)).toFixed(1));
}
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const round4 = (value: number) => Number(value.toFixed(4));
/**
 * What this field's NDVI usually is around `observedOn`, from earlier years only. Each earlier year counts once (its median in the
 * window), so a year with many images does not outweigh the others. Returns null with fewer than 2 earlier years.
 */
export function seasonalBaseline(points: BaselinePoint[] | null | undefined, observedOn: string): SeasonalBaseline | null {
  const target = dayTime(observedOn);
  if (target === null || !points?.length) return null;
  const year = new Date(target).getUTCFullYear();
  const perYear = new Map<number, number[]>();
  for (const point of points) {
    const time = dayTime(point.observed_on), value = numeric(point.ndvi_value);
    if (time === null || value === null) continue;
    const date = new Date(time);
    if (date.getUTCFullYear() >= year) continue;
    if (Math.abs(Date.UTC(year, date.getUTCMonth(), date.getUTCDate()) - target) > BASELINE.windowDays * DAY) continue;
    perYear.set(date.getUTCFullYear(), [...(perYear.get(date.getUTCFullYear()) ?? []), value]);
  }
  if (perYear.size < BASELINE.minYears) return null;
  const yearly = [...perYear.values()].map(median), all = [...perYear.values()].flat();
  return { expected: round4(median(yearly)), low: round4(Math.min(...yearly)), high: round4(Math.max(...yearly)), min: round4(Math.min(...all)), max: round4(Math.max(...all)), years: yearly.length };
}
export function compareToBaseline(ndvi: number | null, baseline: SeasonalBaseline | null, policy = defaultPolicy): BaselineComparison | null {
  if (ndvi === null || !baseline) return null;
  const difference = round4(ndvi - baseline.expected);
  const reliable = baseline.high - baseline.low <= BASELINE.maxSpread;
  const vci = reliable && baseline.years >= BASELINE.vciMinYears ? vegetationConditionIndex(ndvi, baseline.min, baseline.max) : null;
  return { expected: baseline.expected, difference, years: baseline.years, reliable, belowUsual: reliable && difference <= -policy.declineThreshold, vci };
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
/** Sentinel-2 tile of an observation: the stored value, else the tile named at the end of its scene id (older rows have none stored). */
export function observationTile(observation: Pick<Observation, 'tile_id' | 'scene_id'>): string | null {
  if (observation.tile_id) return observation.tile_id;
  const fromScene = /_T?(\d{2}[C-X][A-Z]{2})(?:_|$)/.exec(observation.scene_id ?? '');
  return fromScene ? fromScene[1] : null;
}
export function isComparable(latest: Observation, previous: Observation, policy = defaultPolicy): boolean {
  if (!previous.accepted || previous.provenance !== 'measured_imagery' || qualityReason(previous, policy)) return false;
  if (previous.boundary_version !== latest.boundary_version || previous.calculation_version !== latest.calculation_version) return false;
  if (!(previous.observed_on < latest.observed_on)) return false;
  const latestTile = observationTile(latest), previousTile = observationTile(previous);
  if (latestTile && previousTile && latestTile !== previousTile) return false;
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
export function assessEvidence(latest: Observation | null, previous: Observation | null, policy = defaultPolicy, now = Date.now(), season?: CropSeason | null, reference?: ReferenceWindow | null, baselinePoints?: BaselinePoint[] | null): Assessment {
  const result: Assessment = { state: 'awaiting_analysis', title: 'Awaiting first analysis', explanation: 'No accepted satellite measurement for this boundary.', nextAction: 'Find a usable image', ageDays: null, change: null, comparableObservations: 0 };
  if (!latest) return result;
  const acquired = Date.parse(latest.acquired_at || latest.observed_on);
  result.ageDays = Number.isFinite(acquired) ? Math.floor((now - acquired) / 86400000) : null;
  const resolved = resolveStage(season, reference, latest.observed_on);
  result.stage = resolved.stage;
  if (resolved.stage !== 'unknown') result.stageSource = resolved.source;
  // "Outdated" is about the farmer's own saved dates, whether or not a regional reference then supplies the stage.
  if (seasonStage(season, latest.observed_on) === 'unknown' && cropDatesOutdated(season, latest.observed_on)) result.datesOutdated = true;
  const reason = qualityReason(latest, policy);
  if (!latest.accepted || latest.provenance !== 'measured_imagery' || reason || result.ageDays === null || result.ageDays < 0) {
    return { ...result, state: 'not_enough_data', title: 'Not enough usable data', explanation: reason || 'The measurement has not been verified for this boundary.', nextAction: 'Try another image' };
  }
  result.comparableObservations = 1;
  const baseline = compareToBaseline(numeric(latest.ndvi_value), seasonalBaseline(baselinePoints, latest.observed_on), policy);
  if (baseline) result.baseline = baseline;
  const tooFarApart = Boolean(previous && !isComparable(latest, previous, policy) && previous.observed_on < latest.observed_on && (daysApart(latest, previous) ?? 0) > (policy.compareDays ?? defaultPolicy.compareDays));
  if (previous && isComparable(latest, previous, policy)) {
    result.change = Number((numeric(latest.ndvi_value)! - numeric(previous.ndvi_value)!).toFixed(4));
    result.comparableObservations = 2;
  }
  if (result.ageDays > policy.freshDays) return { ...result, state: 'image_too_old', title: 'Image too old', explanation: `Last usable image is ${result.ageDays} days old. Current crop condition is unknown.`, nextAction: 'Find a newer image' };
  if (result.change !== null && result.change <= -policy.declineThreshold) {
    if (result.stage === 'maturity' || result.stage === 'after_harvest') {
      return { ...result, state: 'no_unusual_change', expectedDecline: true, title: 'Expected seasonal decline',
        explanation: result.stageSource === 'regional_reference'
          ? (result.stage === 'maturity'
            ? 'Greenness fell around the usual harvest time for this region (a regional estimate, not your own dates). Ripening crops lose greenness; visit only if the crop is not yet ready for harvest, and add your own sowing and harvest dates for a better check.'
            : 'Greenness fell after the usual harvest time for this region (a regional estimate, not your own dates). Bare or harvested ground can explain the drop; add your own sowing and harvest dates for a better check.')
          : result.stage === 'maturity'
          ? 'Greenness fell within 30 days of the recorded harvest date. Ripening crops lose greenness; visit only if the crop is not yet ready for harvest.'
          : 'Greenness fell after the recorded harvest date. Bare or harvested ground explains the drop; update the crop dates for the next season.',
        nextAction: 'Continue monitoring' };
    }
    return { ...result, state: 'needs_inspection', title: 'Needs inspection', explanation: 'Vegetation decreased since the previous comparable image. Harvest, maturity, bare soil, or crop stress may explain this.' + (result.datesOutdated ? ' The saved sowing and harvest dates do not match this season, so ripening or harvest cannot be ruled out. Update the crop dates.' : ''), nextAction: 'Plan a field visit' };
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
