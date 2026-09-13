import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import { ActiveCaseProvider } from './context/ActiveCaseContext';

import OverviewPage from './pages/OverviewPage';
import DepthWizardPage from './pages/DepthWizardPage';
import ChangeDetectionPage from './pages/ChangeDetectionPage';
import RiskAnalysisPage from './pages/RiskAnalysisPage';
import ThreeDTerrainPage from './pages/ThreeDTerrainPage';
import SimulationPage from './pages/SimulationPage';
import ValidationPage from './pages/ValidationPage';

const normalizePath = (path) => {
  const clean = (path || '').toLowerCase().replace(/\/+$/, '');
  if (!clean || clean === '/overview') return '/overview';
  if (clean === '/terrain' || clean === '/terrain-depthwizard') return '/terrain';
  if (clean === '/change' || clean === '/change-detection') return '/change';
  if (clean === '/risk' || clean === '/risk-analysis') return '/risk';
  if (clean === '/3d' || clean === '/3d-terrain' || clean === '/3d-terrain-surface') return '/3d';
  if (clean === '/simulation' || clean === '/simulation-scenario') return '/simulation';
  if (clean === '/validation' || clean === '/validation-benchmark') return '/validation';
  return '/overview';
};

export default function App() {
  const [currentPath, setCurrentPath] = useState(() => {
    return normalizePath(window.location.pathname);
  });
  const navigate = (toPath) => {
    const target = normalizePath(toPath);
    if (window.location.pathname !== target) {
      window.history.pushState({}, '', target);
    }
    setCurrentPath(target);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  useEffect(() => {
    const initial = normalizePath(window.location.pathname);
    if (window.location.pathname === '/' || window.location.pathname === '') {
      window.history.replaceState({}, '', '/overview');
    }
    const handlePopState = () => {
      setCurrentPath(normalizePath(window.location.pathname));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const renderActivePage = () => {
    switch (currentPath) {
      case '/overview':
        return <OverviewPage onNavigate={navigate} />;
      case '/terrain':
        return <DepthWizardPage onNavigate={navigate} />;
      case '/change':
        return <ChangeDetectionPage onNavigate={navigate} />;
      case '/risk':
        return <RiskAnalysisPage onNavigate={navigate} />;
      case '/3d':
        return <ThreeDTerrainPage onNavigate={navigate} />;
      case '/simulation':
        return <SimulationPage onNavigate={navigate} />;
      case '/validation':
        return <ValidationPage onNavigate={navigate} />;
      default:
        return <OverviewPage onNavigate={navigate} />;
    }
  };

  return (
    <ActiveCaseProvider>
      <div className="min-h-screen bg-background font-body-md text-on-surface antialiased flex">
        {/* Fixed Left Navigation Sidebar */}
        <Sidebar 
          currentPath={currentPath} 
          onNavigate={navigate}
        />

        {/* Main App Workspace */}
        <div className="pl-72 flex-1 flex flex-col min-h-screen">
          {/* Top Fixed Bar */}
          <Header />

          {/* Dynamic Page Container */}
          <main className="w-full pt-16 bg-background min-h-screen text-on-surface flex flex-col">
            {renderActivePage()}
          </main>
        </div>
      </div>
    </ActiveCaseProvider>
  );
}
