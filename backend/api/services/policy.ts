import { defaultPolicy, type EvidencePolicy } from '../../../shared/evidence.ts';
export function evidencePolicy(): EvidencePolicy {
  const setting = (name: string, fallback: number, min: number, max: number) => {
    const value = Number(process.env[name] ?? fallback);
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${name}`);
    return value;
  };
  return {
    minCoverage: setting('EVIDENCE_MIN_COVERAGE', defaultPolicy.minCoverage, 1, 100),
    minPixels: Math.ceil(setting('EVIDENCE_MIN_PIXELS', defaultPolicy.minPixels, 1, 1000000)),
    freshDays: setting('EVIDENCE_FRESH_DAYS', defaultPolicy.freshDays, 1, 365),
    declineThreshold: setting('EVIDENCE_DECLINE_THRESHOLD', defaultPolicy.declineThreshold, .001, 2),
    searchDays: Math.floor(setting('SATELLITE_SEARCH_DAYS', defaultPolicy.searchDays, 1, 365)),
    candidateLimit: Math.floor(setting('SATELLITE_CANDIDATE_LIMIT', defaultPolicy.candidateLimit, 1, 100)),
    maxAttempts: Math.floor(setting('SATELLITE_MAX_ATTEMPTS', defaultPolicy.maxAttempts, 1, 10)),
  };
}
