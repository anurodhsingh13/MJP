import { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type Language = 'en' | 'hi';
export type AreaUnit = 'ha' | 'acre';
const storageKey = 'terrascope.preferences.v1';
function readPreferences(): { language: Language; unit: AreaUnit } {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    return { language: saved.language === 'hi' ? 'hi' : 'en', unit: saved.unit === 'acre' ? 'acre' : 'ha' };
  } catch { return { language: 'en', unit: 'ha' }; }
}
export function usePreferenceState() {
  const [preferences, setPreferences] = useState(readPreferences);
  const { language, unit } = preferences;
  const locale = language === 'hi' ? 'hi-IN' : 'en-IN';
  useEffect(() => {
    document.documentElement.lang = language;
    try { localStorage.setItem(storageKey, JSON.stringify(preferences)); } catch { /* Preferences still work when storage is disabled. */ }
  }, [preferences, language]);
  const t = useCallback((english: string, hindi: string) => language === 'hi' ? hindi : english, [language]);
  return {
    language, unit, locale, t,
    setLanguage: (value: Language) => setPreferences(current => ({ ...current, language: value })),
    setUnit: (value: AreaUnit) => setPreferences(current => ({ ...current, unit: value })),
    date: (value?: string | null) => {
      if (!value) return t('Not available', 'उपलब्ध नहीं');
      const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
      return Number.isFinite(date.getTime()) ? date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }) : t('Not available', 'उपलब्ध नहीं');
    },
    area: (value: unknown) => {
      if (value == null || value === '' || !Number.isFinite(Number(value))) return t('Area unknown', 'क्षेत्रफल अज्ञात');
      const amount = Number(value) * (unit === 'acre' ? 2.4710538147 : 1);
      return `${amount.toLocaleString(locale, { maximumFractionDigits: 2 })} ${unit === 'acre' ? t('acres', 'एकड़') : t('ha', 'हेक्टेयर')}`;
    },
  };
}
export const PreferencesContext = createContext<ReturnType<typeof usePreferenceState> | null>(null);
export function usePreferences() {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error('PreferencesProvider is required');
  return value;
}
