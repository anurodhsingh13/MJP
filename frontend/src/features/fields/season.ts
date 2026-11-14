import type { DatabaseField } from '../../lib/api';
import { usePreferences } from '../../lib/preferencesContext';
import { seasonStage, type SeasonStage } from '../../../../shared/evidence';

/** Crop-stage words for the stage the farmer's own sowing/harvest dates imply. */
export function useStageLabel() {
  const { t } = usePreferences();
  return (stage: SeasonStage) => ({
    unknown: t('Crop stage unknown', 'फ़सल की अवस्था पता नहीं'),
    before_sowing: t('Before sowing', 'बुवाई से पहले'),
    establishment: t('Establishment (first 30 days)', 'शुरुआती बढ़त (पहले 30 दिन)'),
    growing: t('Growing season', 'बढ़वार का समय'),
    maturity: t('Maturity (last 30 days before harvest)', 'पकने का समय (कटाई से पहले 30 दिन)'),
    after_harvest: t('After harvest', 'कटाई के बाद'),
  })[stage];
}

/** True when the recorded season ended long ago (or no dates exist), so stage-aware checks cannot help. */
export function seasonDatesOutdated(field: Pick<DatabaseField, 'planting_date' | 'harvest_date'>, today = new Date().toISOString().slice(0, 10)) {
  return seasonStage({ plantingDate: field.planting_date, harvestDate: field.harvest_date }, today) === 'unknown';
}

