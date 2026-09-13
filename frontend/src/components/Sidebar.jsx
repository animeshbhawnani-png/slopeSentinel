import React from 'react';

const NAV_ITEMS = [
  { path: '/overview', label: 'Overview', icon: 'grid_view' },
  { path: '/terrain', label: 'Terrain (DepthWizard)', icon: 'landscape' },
  { path: '/change', label: 'Change Detection', icon: 'history_toggle_off' },
  { path: '/risk', label: 'Risk Analysis', icon: 'warning' },
  { path: '/3d', label: '3D Terrain Surface', icon: 'view_in_ar' },
  { path: '/simulation', label: 'Simulation Scenario', icon: 'cyclone' },
  { path: '/validation', label: 'Validation Benchmark', icon: 'verified' },
];

export default function Sidebar({ currentPath, onNavigate }) {
  return (
    <aside className="fixed left-0 top-0 h-full w-72 bg-surface-container-lowest border-r border-outline-variant/60 z-50 flex flex-col justify-between select-none">
      <div className="flex flex-col">
        {/* Brand Header */}
        <div className="px-space-md py-space-md border-b border-outline-variant/40 bg-surface-container-low/40">
          <div className="flex items-center gap-space-sm mb-space-xs">
            <div className="w-7 h-7 rounded-DEFAULT bg-secondary-container/80 border border-primary/40 flex items-center justify-center text-primary shadow-[0_0_10px_rgba(95,217,209,0.15)]">
              <span className="material-symbols-outlined text-[18px]">terrain</span>
            </div>
            <div className="flex flex-col">
              <span className="font-headline-sm text-headline-sm uppercase tracking-wider text-primary font-semibold">SlopeSentinel</span>
              <span className="font-label-sm text-label-sm text-on-surface-variant/80 tracking-tight leading-none uppercase">HIMALAYAN TERRAIN INTELLIGENCE</span>
            </div>
          </div>
          <p className="font-label-sm text-[10px] text-tertiary-fixed-dim/70 tracking-tight pl-0.5">
            From static terrain to living terrain intelligence
          </p>
        </div>

        {/* Section Label */}
        <div className="px-space-md pt-space-md pb-space-xs flex items-center justify-between">
          <span className="font-label-sm text-label-sm uppercase text-outline tracking-widest">Mission Modules</span>
        </div>

        {/* Navigation Items */}
        <nav className="flex flex-col px-space-xs space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const isActive = currentPath === item.path;
            return (
              <a
                key={item.path}
                href={item.path}
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate(item.path);
                }}
                className={`flex items-center gap-space-sm px-space-sm py-2 rounded-DEFAULT transition-colors font-label-md text-label-md text-left w-full ${
                  isActive
                    ? 'bg-secondary-container text-primary border-l-2 border-primary font-semibold'
                    : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">{item.icon}</span>
                <span className="truncate">{item.label}</span>
              </a>
            );
          })}
        </nav>
      </div>

      {/* System Status Footer */}
      <div className="p-space-md border-t border-outline-variant/40 bg-surface-container-lowest/80">
        <div className="flex items-center justify-between p-space-xs rounded-DEFAULT bg-surface-container-low border border-outline-variant/40 mb-space-xs">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            <span className="font-label-sm text-label-sm text-on-surface font-medium uppercase tracking-wider">SYS: LOCAL / READY</span>
          </div>
          <span className="font-label-sm text-[9px] text-tertiary px-1 py-0.5 rounded-DEFAULT bg-surface-container-high border border-outline-variant/40">ONLINE</span>
        </div>
        <div className="flex items-center justify-between text-on-surface-variant px-0.5">
          <span className="font-label-sm text-label-sm text-outline tracking-tight">CALIBRATION</span>
          <span className="font-label-sm text-label-sm text-secondary tracking-wide">DepthWizard Core v1.4</span>
        </div>
      </div>
    </aside>
  );
}
