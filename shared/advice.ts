import type { Assessment } from './evidence.ts';

export type AdviceUrgency = 'monitor' | 'check_soon' | 'ask_expert';
export type VisitReason = 'ndvi_drop' | 'low_ndvi_growing' | 'photo_urgent' | 'advice_urgent' | 'likely_issue' | 'no_fresh_imagery' | 'all_clear';
export interface VisitDecision {
  /** yes = go to the field; if_concerned = imagery is not enough to say; no = routine monitoring is enough. */
  visit: 'yes' | 'if_concerned' | 'no';
  when: 'within_3_days' | 'this_week' | 'routine';
  reasons: VisitReason[];
}

/** Below this NDVI a crop that should be growing is unusually sparse. A screening threshold, not a diagnosis. */
export const LOW_GROWING_NDVI = 0.3;

/**
 * Field-visit decision from measured evidence only. It never comes from the language model:
 * the model may add a photo urgency and issue likelihoods, which can only raise (never lower) the urgency.
 */
export function decideVisit(input: {
  assessment: Assessment;
  latestNdvi: number | null;
  photoUrgency?: AdviceUrgency | null;
  /** True only when a field photo was actually analysed. Without one, urgency is not attributed to a photo. */
  photoUsed?: boolean;
  highLikelihoodIssue?: boolean;
}): VisitDecision {
  const { assessment, latestNdvi, photoUrgency, photoUsed = false, highLikelihoodIssue } = input;
  const urgentReason: VisitReason = photoUsed ? 'photo_urgent' : 'advice_urgent';
  const reasons: VisitReason[] = [];
  let when: VisitDecision['when'] = 'routine';
  const raise = (level: VisitDecision['when']) => {
    const order = ['routine', 'this_week', 'within_3_days'] as const;
    if (order.indexOf(level) > order.indexOf(when)) when = level;
  };
  if (assessment.state === 'needs_inspection') { reasons.push('ndvi_drop'); raise('within_3_days'); }
  if (assessment.state === 'no_unusual_change' && !assessment.expectedDecline && assessment.stage === 'growing'
    && latestNdvi !== null && latestNdvi < LOW_GROWING_NDVI) { reasons.push('low_ndvi_growing'); raise('this_week'); }
  if (photoUrgency === 'ask_expert') { reasons.push(urgentReason); raise('within_3_days'); }
  else if (photoUrgency === 'check_soon') { reasons.push(urgentReason); raise('this_week'); }
  if (highLikelihoodIssue) { reasons.push('likely_issue'); raise('this_week'); }
  if (reasons.length) return { visit: 'yes', when, reasons };
  if (assessment.state === 'not_enough_data' || assessment.state === 'image_too_old' || assessment.state === 'awaiting_analysis') {
    return { visit: 'if_concerned', when: 'this_week', reasons: ['no_fresh_imagery'] };
  }
  return { visit: 'no', when: 'routine', reasons: ['all_clear'] };
}
