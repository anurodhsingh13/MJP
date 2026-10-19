export const observationCategories = [
  'general_observation',
  'visual_symptom',
  'pest_observed',
  'water_related',
  'growth_stage',
  'other',
  'unknown',
] as const;

export const growthStages = [
  'emergence',
  'vegetative',
  'flowering',
  'fruiting',
  'maturity',
  'harvested',
  'unknown',
] as const;

export const observationSeverities = [
  'mild',
  'moderate',
  'severe',
  'unknown',
  'not_applicable',
] as const;

export type ObservationCategory = typeof observationCategories[number];
export type GrowthStage = typeof growthStages[number];
export type ObservationSeverity = typeof observationSeverities[number];

export type InspectionMetadata = {
  observation_category: ObservationCategory;
  growth_stage: GrowthStage;
  severity: ObservationSeverity;
  provenance: 'owner_reported';
  verification_status: 'unverified'|'expert_verified';
};
