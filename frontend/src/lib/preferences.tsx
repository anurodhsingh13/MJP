import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Leaf, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PreferencesContext, usePreferenceState, usePreferences, type Language, type AreaUnit } from './preferencesContext';

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const value = usePreferenceState();
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}
export function PreferencesBar({children}:{children?:ReactNode}) {
  const { t, language, unit, setLanguage, setUnit } = usePreferences();
  const [dark, setDark] = useState(() => { try { return localStorage.getItem('terrascope.theme') === 'dark'; } catch { return false; } });
  useEffect(() => { document.documentElement.dataset.tsTheme = dark ? 'dark' : 'light'; try { localStorage.setItem('terrascope.theme', dark ? 'dark' : 'light'); } catch { /* theme still applies this session */ } }, [dark]);
  return <header className="preferences-bar no-print">
    <NavLink to="/" className="brand"><Leaf aria-hidden="true" size={30} className="brand-leaf"/><b>TerraScope</b></NavLink>
    <nav className="top-nav" aria-label={t('Main navigation', 'मुख्य नेविगेशन')}>
      <NavLink to="/" end>{t('Dashboard', 'डैशबोर्ड')}</NavLink>
      <NavLink to="/reports">{t('Reports', 'रिपोर्ट')}</NavLink>
      <NavLink to="/datasets">{t('Datasets', 'डेटासेट')}</NavLink>
      <NavLink to="/help">{t('Help', 'मदद')}</NavLink>
    </nav>
    <div className="preference-controls">
      <label><span className="sr-only-sm">{t('Language', 'भाषा')}</span><select aria-label="Language / भाषा" value={language} onChange={event => setLanguage(event.target.value as Language)}><option value="en">English</option><option value="hi">हिंदी</option></select></label>
      <label>{t('Area unit', 'क्षेत्रफल की इकाई')}<select aria-label={t('Area unit', 'क्षेत्रफल की इकाई')} value={unit} onChange={event => setUnit(event.target.value as AreaUnit)}><option value="ha">{t('Hectares', 'हेक्टेयर')}</option><option value="acre">{t('Acres', 'एकड़')}</option><option value="m2">{t('Square metres', 'वर्ग मीटर')}</option></select></label>
    </div>
    {children && <div className="header-account-actions"><button type="button" className="theme-toggle" onClick={() => setDark(value => !value)} aria-label={dark ? t('Switch to light mode', 'लाइट मोड') : t('Switch to dark mode', 'डार्क मोड')} title={t('Toggle dark / light mode', 'डार्क / लाइट मोड')}>{dark ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}</button>{children}</div>}
  </header>;
}
