import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthGate } from './features/auth/AuthGate';
import { PreferencesBar, PreferencesProvider } from './lib/preferences';
import { usePreferences } from './lib/preferencesContext';

const Datasets = lazy(() => import('./pages/datasets/Datasets').then(module => ({ default: module.Datasets })));
const Dashboard = lazy(() => import('./pages/dashboard/Dashboard').then(module => ({ default: module.Dashboard })));
const FieldLayout = lazy(() => import('./pages/fields/FieldLayout').then(module => ({ default: module.FieldLayout })));
const FieldMap = lazy(() => import('./pages/fields/FieldMap').then(module => ({ default: module.FieldMap })));
const FieldAnalysis = lazy(() => import('./pages/fields/FieldAnalysis').then(module => ({ default: module.FieldAnalysis })));
const FieldHistory = lazy(() => import('./pages/fields/FieldHistory').then(module => ({ default: module.FieldHistory })));
const FieldOverview = lazy(() => import('./pages/fields/FieldOverview').then(module => ({ default: module.FieldOverview })));
const FieldReport = lazy(() => import('./pages/fields/FieldReport').then(module => ({ default: module.FieldReport })));
const Reports = lazy(() => import('./pages/fields/FieldReport').then(module => ({ default: module.Reports })));
const Help = lazy(() => import('./pages/help/Help').then(module => ({ default: module.Help })));

function LoadingWorkspace() {
  const {t}=usePreferences();
  return <div className="dashboard-shell" role="status">{t('Loading TerraScope…','TerraScope खोल रहे हैं…')}</div>;
}

export default function App() {
  return (
    <BrowserRouter>
      <PreferencesProvider>
      <PreferencesBar/>
      <AuthGate>
        <Suspense fallback={<LoadingWorkspace/>}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/datasets" element={<Datasets />} />
            <Route path="/help" element={<Help />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/fields/:fieldId" element={<FieldLayout />}>
              <Route index element={<Navigate to="overview" replace />} />
              <Route path="overview" element={<FieldOverview />} />
              <Route path="map" element={<FieldMap />} />
              <Route path="analysis" element={<FieldAnalysis />} />
              <Route path="history" element={<FieldHistory />} />
              <Route path="report" element={<FieldReport />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </AuthGate>
      </PreferencesProvider>
    </BrowserRouter>
  );
}
