import type { Request, Response } from 'express';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pool } from '../db/pool.ts';
import { assessEvidence, numeric, type Observation } from '../../../shared/evidence.ts';
import { decideVisit } from '../../../shared/advice.ts';
import { evidencePolicy } from '../services/policy.ts';
import { referenceWindowsByField } from '../services/referenceCalendar.ts';
import { baselinePointsByField } from '../services/baselineReadings.ts';
import { assistantBudget, geminiConfigured } from '../services/assistantBudget.ts';
import { generateCropAdvice, ProviderError } from '../services/ai/geminiProvider.ts';
import { actor, hashToken } from '../services/auth.ts';

const storage = resolve(process.env.PHOTO_STORAGE_DIR || '.local/scouting-photos');
const round = (value: unknown, digits = 3) => { const n = numeric(value); return n === null ? null : Number(n.toFixed(digits)); };

/**
 * One on-demand call: NDVI evidence + latest field photo -> possible issues, precautions and a visit decision.
 * The visit decision is computed from measured evidence (shared/advice.ts); the model can only raise it.
 */
export async function getCropAdvice(request: Request, response: Response) {
  const fieldId = String(request.params.fieldId);
  const account = actor(response);
  if (!account) { response.status(401).json({ error: 'Sign in to use crop advice' }); return; }
  const language = request.body?.languageCode === 'hi-IN' ? 'hi-IN' : 'en-IN';
  try {
    const field = (await pool.query(
      'select name,crop,planting_date,harvest_date,boundary_version from public.fields where id=$1 and owner_id=$2', [fieldId, account.id])).rows[0];
    if (!field) { response.status(404).json({ error: 'Field not found' }); return; }
    const policy = evidencePolicy();
    const observations = (await pool.query<Observation>(`select * from public.vegetation_indices where field_id=$1
      and accepted and provenance='measured_imagery' and boundary_version=$2 and valid_coverage_percent >= $3 and valid_pixel_count >= $4
      order by observed_on desc,acquired_at desc limit 6`, [fieldId, field.boundary_version, policy.minCoverage, policy.minPixels])).rows;
    const latest = observations[0] ?? null;
    const previous = observations.find(item => latest && item.observed_on < latest.observed_on) ?? null;
    const reference = (await referenceWindowsByField(pool, [{ id: fieldId, crop: field.crop }])).get(fieldId) ?? null;
    const baselinePoints = (await baselinePointsByField(pool, [fieldId])).get(fieldId) ?? null;
    const assessment = assessEvidence(latest, previous, policy, Date.now(), { plantingDate: field.planting_date, harvestDate: field.harvest_date }, reference, baselinePoints);
    const latestNdvi = latest ? numeric(latest.ndvi_value) : null;
    const evidence = {
      ndvi: latest ? {
        latest: round(latest.ndvi_value), observedOn: latest.observed_on, ndmi: round(latest.ndmi_value), ndre: round(latest.ndre_value),
        zoneSharePercent: latest.ndvi_classes ?? null, affectedAreaPercent: round(latest.affected_coverage_percent, 1),
        history: observations.map(item => ({ date: item.observed_on, ndvi: round(item.ndvi_value) })),
      } : null,
      assessment: { state: assessment.state, change: assessment.change, imageAgeDays: assessment.ageDays, expectedSeasonalDecline: assessment.expectedDecline ?? false, cropDatesOutdated: assessment.datesOutdated ?? false, cropStage: assessment.stage ?? 'unknown', cropStageBasis: assessment.stageSource ?? 'none', seasonalBaseline: assessment.baseline ?? null },
    };
    if (!latest) {
      response.json({ evidence, visit: decideVisit({ assessment, latestNdvi }), advice: null, photoUsed: false, reason: 'no_ndvi' });
      return;
    }
    if (!geminiConfigured()) { response.status(503).json({ error: 'Gemini AI is not configured' }); return; }
    const grant = assistantBudget.acquire(account.id || hashToken(request.ip || 'unknown'));
    if (!grant.allowed) {
      response.setHeader('Retry-After', String(grant.retryAfter));
      response.status(429).json({ error: 'Too many AI requests. Please wait before asking again.', retryAfterSeconds: grant.retryAfter });
      return;
    }
    try {
      const weather = (await pool.query('select observed_on,temperature_c,precipitation_mm,humidity_percent from public.weather_observations where field_id=$1 order by observed_on desc limit 7', [fieldId])).rows;
      const scouting = (await pool.query(`select observed_on,observation_category,growth_stage,severity,symptoms from public.scouting_cases
        where field_id=$1 order by observed_on desc,created_at desc limit 3`, [fieldId])).rows;
      const photoRow = (await pool.query<{ storage_key: string; observed_on: string }>(`select p.storage_key,c.observed_on from public.scouting_photos p
        join public.scouting_cases c on c.id=p.case_id where c.field_id=$1 order by c.observed_on desc,p.created_at desc limit 1`, [fieldId])).rows[0];
      let image: { bytes: Buffer; mime: 'jpeg' } | null = null;
      if (photoRow && /^[a-f0-9-]{36}\.jpg$/.test(photoRow.storage_key)) {
        try { image = { bytes: await readFile(resolve(storage, photoRow.storage_key)), mime: 'jpeg' }; } catch { image = null; }
      }
      const { advice, model } = await generateCropAdvice({
        crop: field.crop || 'unknown', plantingDate: field.planting_date, harvestDate: field.harvest_date, cropStage: assessment.stage, regionalCalendarMonths: reference,
        ...evidence, recentWeather: weather, farmerScoutingNotes: scouting, photoDate: image ? photoRow.observed_on : null,
      }, image, language);
      const visit = decideVisit({ assessment, latestNdvi, photoUrgency: advice.urgency, photoUsed: Boolean(image), highLikelihoodIssue: advice.possibleIssues.some(item => item.likelihood === 'high') });
      response.json({ evidence, visit, advice, photoUsed: Boolean(image), photoDate: image ? photoRow.observed_on : null, model, languageCode: language });
    } finally { grant.release(); }
  } catch (error) {
    console.error('POST /api/fields/:id/advice failed');
    const safe = error instanceof ProviderError ? error : new ProviderError('unavailable', 'Crop advice is unavailable', 503);
    if (safe.retryAfterSeconds) response.setHeader('Retry-After', String(safe.retryAfterSeconds));
    response.status(safe.status).json({ error: safe.message, code: safe.code, retryAfterSeconds: safe.retryAfterSeconds });
  }
}
