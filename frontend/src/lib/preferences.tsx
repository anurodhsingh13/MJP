import type { ReactNode } from 'react';
import { PreferencesContext, usePreferenceState, usePreferences, type Language, type AreaUnit } from './preferencesContext';

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const value = usePreferenceState();
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}
export function PreferencesBar() {
  const { t, language, unit, setLanguage, setUnit } = usePreferences();
  return <div className="preferences-bar no-print">
    <a href="/" className="brand">TerraScope<span>{t('Your field companion', 'आपके खेत का साथी')}</span></a>
    <div className="preference-controls">
      <label>{t('Language', 'भाषा')}<select aria-label="Language / भाषा" value={language} onChange={event => setLanguage(event.target.value as Language)}><option value="en">English</option><option value="hi">हिंदी</option></select></label>
      <label>{t('Area unit', 'क्षेत्रफल की इकाई')}<select aria-label={t('Area unit', 'क्षेत्रफल की इकाई')} value={unit} onChange={event => setUnit(event.target.value as AreaUnit)}><option value="ha">{t('Hectares', 'हेक्टेयर')}</option><option value="acre">{t('Acres', 'एकड़')}</option></select></label>
    </div>
  </div>;
}
