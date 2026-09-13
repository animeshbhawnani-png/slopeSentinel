import React from 'react';

export default function Header() {
  return (
    <header className="fixed top-0 left-72 right-0 h-16 bg-surface-container-low/90 backdrop-blur-md border-b border-outline-variant/60 z-40 flex items-center justify-between px-space-lg">
      <div className="flex items-center gap-space-md">
        <div className="flex items-center gap-space-xs font-label-md text-label-md text-on-surface">
          <span className="material-symbols-outlined text-primary text-[18px]">location_on</span>
          <span className="text-outline">LOCATION:</span>
          <span className="font-semibold text-on-surface">Nainital, Uttarakhand</span>
        </div>
        <div className="hidden xl:flex items-center gap-space-xs">
          <span className="px-2 py-0.5 bg-surface-container-high border border-outline-variant/40 rounded-DEFAULT font-label-sm text-label-sm text-tertiary-fixed-dim">
            29.3803° N, 79.4636° E
          </span>
          <span className="px-2 py-0.5 bg-surface-container-high border border-outline-variant/40 rounded-DEFAULT font-label-sm text-label-sm text-secondary">
            2,084m ALT
          </span>
        </div>
      </div>

      <div className="flex items-center gap-space-md">
        {/* User Profile */}
        <div className="flex items-center gap-2 border-l border-outline-variant/40 pl-space-md">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shadow-[0_0_8px_rgba(95,217,209,0.3)]">
            <span className="material-symbols-outlined text-on-primary text-[18px]">person</span>
          </div>
        </div>
      </div>
    </header>
  );
}
