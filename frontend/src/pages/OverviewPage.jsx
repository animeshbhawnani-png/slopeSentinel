import React from 'react';
import { useActiveCase } from '../context/ActiveCaseContext';

export default function OverviewPage({ onNavigate }) {
  const { activeCase } = useActiveCase();
  
  const hasRecon = !!activeCase?.reconstruction;
  const reconImage = activeCase?.reconstruction?.source_image || activeCase?.reconstruction?.input_image;
  const reconName = activeCase?.reconstruction?.metadata?.original_filename || 'Active_DepthWizard_Observation.png';
  
  const hasChange = !!activeCase?.change_outputs;
  const changeCount = activeCase?.change_outputs?.changed_regions?.length || 0;
  
  const hasRegion = !!activeCase?.selected_region;
  const region = activeCase?.selected_region;
  
  const hasRisk = !!activeCase?.risk_outputs;
  const risk = activeCase?.risk_outputs;

  const isCaseActive = hasRecon || hasChange || hasRegion;

  // Empty state early return if completely blank
  if (!isCaseActive) {
    return (
      <div className="p-space-lg lg:p-margin-desktop flex flex-col items-center justify-center min-h-[75vh] gap-space-lg text-center">
        <div className="w-24 h-24 rounded-full bg-surface-container-high flex items-center justify-center text-primary shadow-inner">
          <span className="material-symbols-outlined text-[48px]">landscape</span>
        </div>
        <div className="space-y-3">
          <h1 className="font-headline-lg text-headline-lg text-on-surface font-semibold tracking-tight uppercase">NO ACTIVE TERRAIN CASE</h1>
          <p className="font-body-md text-body-md text-on-surface-variant max-w-lg mx-auto">
            Start by uploading a terrain observation through DepthWizard.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-4 pt-space-md w-full max-w-2xl justify-center">
          <button 
            onClick={() => onNavigate('/terrain')}
            className="px-6 py-3 rounded-DEFAULT bg-primary text-on-primary font-label-md text-label-md font-bold uppercase tracking-wider shadow-[0_0_16px_rgba(126,246,237,0.3)] hover:bg-primary/90 transition-all flex items-center justify-center gap-2"
          >
            <span>OPEN DEPTHWIZARD</span>
            <span className="material-symbols-outlined text-[18px]">add_photo_alternate</span>
          </button>
          <button 
            onClick={() => onNavigate('/change')}
            className="px-6 py-3 rounded-DEFAULT bg-surface-container-high text-secondary hover:bg-surface-container-highest font-label-md text-label-md font-bold uppercase tracking-wider transition-colors border border-outline-variant/30 flex items-center justify-center gap-2"
          >
            <span>CHANGE DETECTION</span>
          </button>
          <button 
            onClick={() => onNavigate('/validation')}
            className="px-6 py-3 rounded-DEFAULT bg-transparent text-on-surface-variant hover:text-on-surface font-label-md text-label-md font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-2"
          >
            <span>VALIDATION BENCHMARK</span>
          </button>
        </div>
      </div>
    );
  }

  // Calculate statuses for Workflow progression
  const stepObserve = hasRecon ? 'COMPLETE' : 'READY';
  const stepReconstruct = hasRecon ? 'COMPLETE' : 'NOT READY';
  const stepCompare = hasChange ? 'COMPLETE' : (hasRecon ? 'READY' : 'NOT READY');
  const stepSelect = hasRegion ? 'COMPLETE' : (hasChange ? 'READY' : 'NOT READY');
  const stepAssess = hasRisk ? 'COMPLETE' : (hasRegion ? 'READY' : 'NOT READY');
  const stepSimulate = hasRegion ? 'READY' : 'SELECT REGION FIRST';

  const riskClassification = risk?.classification || 'Not assessed';
  const riskIndicator = risk?.risk_score != null ? risk.risk_score : '—';

  return (
    <div className="p-space-lg lg:p-margin-desktop flex flex-col gap-space-lg">
      {/* Title & Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-space-md">
        <div className="flex flex-col">
          <div className="flex items-center gap-space-xs mb-space-xs">
            <span className="px-2 py-0.5 rounded-DEFAULT bg-surface-container-high text-tertiary font-label-sm text-label-sm tracking-wider uppercase">
              {activeCase?.active_case_id ? `CASE: ${activeCase.active_case_id}` : 'ACTIVE CASE'}
            </span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight font-semibold">
            Terrain Intelligence Overview
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant max-w-2xl">
            Monitor terrain change and prioritize areas for investigation.
          </p>
        </div>
      </div>

      {/* 4-Card Summary Grid */}
      <div className="grid grid-cols-1 gap-space-md md:grid-cols-4">
        {/* Card 1 */}
        <div className="rounded-lg bg-surface-container-low p-space-md flex flex-col justify-between shadow-md relative overflow-hidden group border border-outline-variant/40">
          <span className="font-label-sm text-label-sm uppercase tracking-widest text-outline mb-space-sm">ACTIVE OBSERVATION</span>
          <span className="font-display text-[1.5rem] leading-none text-on-surface font-semibold my-1 truncate">
            {hasRecon ? 'LOADED' : '—'}
          </span>
          <p className="font-label-sm text-label-sm text-on-surface-variant mt-space-xs truncate">
            {hasRecon ? reconName : 'No active observation'}
          </p>
        </div>

        {/* Card 2 */}
        <div className="rounded-lg bg-surface-container-low p-space-md flex flex-col justify-between shadow-md relative overflow-hidden group border border-outline-variant/40">
          <span className="font-label-sm text-label-sm uppercase tracking-widest text-outline mb-space-sm">CANDIDATE REGIONS</span>
          <span className="font-display text-[1.5rem] leading-none text-tertiary font-semibold my-1">
            {hasChange ? changeCount : '—'}
          </span>
          <p className="font-label-sm text-label-sm text-on-surface-variant mt-space-xs">
            {hasChange ? 'Detected change clusters' : 'No change analysis'}
          </p>
        </div>

        {/* Card 3 */}
        <div className="rounded-lg bg-surface-container-low p-space-md flex flex-col justify-between shadow-md relative overflow-hidden group border border-outline-variant/40">
          <span className="font-label-sm text-label-sm uppercase tracking-widest text-outline mb-space-sm">RISK INDICATOR</span>
          <span className={`font-display text-[1.5rem] leading-none font-semibold my-1 ${hasRisk ? 'text-error' : 'text-on-surface'}`}>
            {riskIndicator}
          </span>
          <p className="font-label-sm text-label-sm text-on-surface-variant mt-space-xs truncate">
            {riskClassification}
          </p>
        </div>

        {/* Card 4 */}
        <div className="rounded-lg bg-surface-container-low p-space-md flex flex-col justify-between shadow-md relative overflow-hidden group border border-outline-variant/40">
          <span className="font-label-sm text-label-sm uppercase tracking-widest text-outline mb-space-sm">INVESTIGATION PRIORITY</span>
          <span className="font-display text-[1.2rem] leading-tight text-primary font-semibold my-1 truncate">
            {hasRegion ? region.label : '—'}
          </span>
          <p className="font-label-sm text-label-sm text-on-surface-variant mt-space-xs truncate">
            {hasRegion ? 'Selected for inspection' : 'No region selected'}
          </p>
        </div>
      </div>

      {/* Main Content Layout: 9 Columns Canvas + 3 Columns Priority Panel */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-space-lg">
        
        {/* Left Column: Live Terrain Panel */}
        <div className="xl:col-span-9 rounded-lg bg-surface-container-lowest p-space-md flex flex-col shadow-xl relative overflow-hidden min-h-[580px] border border-outline-variant/40">
          <div className="flex flex-wrap items-center justify-between gap-space-sm mb-space-md z-10">
            <div className="flex items-center gap-space-sm">
              <div className="w-6 h-6 rounded-DEFAULT bg-surface-container-high flex items-center justify-center text-primary">
                <span className="material-symbols-outlined text-[16px]">layers</span>
              </div>
              <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">Active Terrain Reconstruction</span>
            </div>
            {hasRecon && (
              <button 
                onClick={() => onNavigate('/3d')}
                className="px-4 py-2 rounded-DEFAULT bg-secondary-container text-primary font-label-sm text-label-sm uppercase font-semibold hover:bg-secondary-container/80 transition-all flex items-center gap-2 cursor-pointer shadow-sm"
              >
                <span>VIEW 3D TERRAIN</span>
                <span className="material-symbols-outlined text-[16px]">view_in_ar</span>
              </button>
            )}
          </div>

          <div className="relative flex-1 w-full rounded-DEFAULT bg-surface-dim overflow-hidden flex flex-col items-center justify-center select-none min-h-[460px] border border-outline-variant/30">
            {hasRecon ? (
              <>
                <img 
                  src={reconImage} 
                  alt="Active terrain reconstruction" 
                  className="w-full h-full object-cover filter brightness-90 contrast-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-surface-container-lowest/80 via-transparent to-transparent pointer-events-none"></div>
                <div className="absolute bottom-4 left-4 bg-surface-container-lowest/90 backdrop-blur-sm p-3 rounded shadow border border-outline-variant/30 flex flex-col gap-1">
                  <span className="font-label-sm text-[10px] text-outline uppercase tracking-wider">Reconstruction Details</span>
                  <span className="font-label-sm text-label-sm text-primary font-semibold">Mode: RELATIVE</span>
                  <span className="font-label-sm text-label-sm text-on-surface-variant">{reconName}</span>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center text-center p-6 space-y-3 z-10">
                <span className="material-symbols-outlined text-outline text-[48px]">map</span>
                <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold tracking-wide uppercase">
                  NO ACTIVE TERRAIN RECONSTRUCTION
                </h3>
                <p className="font-body-sm text-body-sm text-on-surface-variant max-w-md">
                  Upload an observation in DepthWizard to generate relative terrain relief and a 3D surface.
                </p>
                <button 
                  onClick={() => onNavigate('/terrain')}
                  className="mt-2 px-5 py-2.5 rounded-DEFAULT bg-primary text-on-primary font-label-sm text-label-sm font-bold uppercase tracking-wider hover:bg-primary/90 transition-colors shadow-sm"
                >
                  OPEN DEPTHWIZARD
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Inspector Panel */}
        <div className="xl:col-span-3 flex flex-col gap-space-md">
          <div className="rounded-lg bg-surface-container-low p-space-md flex flex-col shadow-xl relative overflow-hidden border border-outline-variant/40 min-h-[580px]">
            <div className="flex items-center justify-between pb-space-sm border-b border-outline-variant/40 mb-space-md">
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-secondary text-[18px]">policy</span>
                <span className="font-label-sm text-label-sm uppercase tracking-widest text-outline">CURRENT PRIORITY</span>
              </div>
            </div>

            {hasRegion ? (
              <div className="flex flex-col gap-space-md h-full">
                <div>
                  <span className="font-label-sm text-label-sm text-outline uppercase">SELECTED REGION</span>
                  <h3 className="font-headline-md text-headline-md text-primary font-semibold">{region.label}</h3>
                  <span className="font-label-sm text-label-sm text-tertiary">{region.classification}</span>
                </div>

                <div className="grid grid-cols-2 gap-space-xs mt-2">
                  <div className="p-space-xs bg-surface-container rounded-DEFAULT flex flex-col">
                    <span className="font-label-sm text-[10px] text-outline uppercase">Rel. Change</span>
                    <span className="font-label-md text-label-md text-on-surface font-semibold">{region.relative_change != null ? region.relative_change : '—'}</span>
                  </div>
                  <div className="p-space-xs bg-surface-container rounded-DEFAULT flex flex-col">
                    <span className="font-label-sm text-[10px] text-outline uppercase">Area Fract.</span>
                    <span className="font-label-md text-label-md text-on-surface font-semibold">{region.area_fraction != null ? (region.area_fraction * 100).toFixed(2) + '%' : '—'}</span>
                  </div>
                </div>

                <div className="flex flex-col gap-1 mt-2">
                  <span className="font-label-sm text-label-sm text-outline uppercase">Interval</span>
                  <span className="font-body-sm text-body-sm text-on-surface bg-surface-container-high/60 p-2 rounded-DEFAULT">
                    {region.observation_interval || '—'}
                  </span>
                </div>

                {/* CTAs */}
                <div className="flex flex-col gap-2 pt-space-xs mt-auto">
                  <button onClick={() => onNavigate('/change')} className="w-full py-2 px-4 rounded-DEFAULT bg-surface-container-high text-secondary hover:bg-surface-container-highest font-label-sm text-label-sm font-semibold uppercase tracking-wider flex items-center justify-between border border-outline-variant/30 cursor-pointer">
                    <span>VIEW CHANGE ANALYSIS</span><span className="material-symbols-outlined text-[16px]">history_toggle_off</span>
                  </button>
                  <button onClick={() => onNavigate('/risk')} className="w-full py-2 px-4 rounded-DEFAULT bg-surface-container-high text-secondary hover:bg-surface-container-highest font-label-sm text-label-sm font-semibold uppercase tracking-wider flex items-center justify-between border border-outline-variant/30 cursor-pointer">
                    <span>VIEW RISK ANALYSIS</span><span className="material-symbols-outlined text-[16px]">warning</span>
                  </button>
                  <button onClick={() => onNavigate('/3d')} className="w-full py-2 px-4 rounded-DEFAULT bg-surface-container-high text-secondary hover:bg-surface-container-highest font-label-sm text-label-sm font-semibold uppercase tracking-wider flex items-center justify-between border border-outline-variant/30 cursor-pointer">
                    <span>VIEW 3D TERRAIN</span><span className="material-symbols-outlined text-[16px]">view_in_ar</span>
                  </button>
                  <button onClick={() => onNavigate('/simulation')} className="w-full py-2 px-4 rounded-DEFAULT bg-primary text-on-primary hover:bg-primary/90 font-label-sm text-label-sm font-bold uppercase tracking-wider flex items-center justify-between shadow cursor-pointer">
                    <span>OPEN SIMULATION</span><span className="material-symbols-outlined text-[16px]">cyclone</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-center h-full gap-4 text-outline">
                <span className="material-symbols-outlined text-[48px] text-outline-variant">select_all</span>
                <span className="font-label-md text-label-md uppercase font-medium">NO CANDIDATE REGION SELECTED</span>
                <button 
                  onClick={() => onNavigate('/change')}
                  className="mt-2 px-4 py-2 rounded-DEFAULT bg-surface-container-high text-secondary font-label-sm text-label-sm font-semibold uppercase tracking-wider hover:bg-surface-container-highest border border-outline-variant/30 cursor-pointer"
                >
                  OPEN CHANGE DETECTION
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Workflow Status */}
      <div className="rounded-lg bg-surface-container-low p-space-md flex flex-col shadow-md border border-outline-variant/40 mt-space-md">
        <div className="flex items-center gap-space-sm pb-space-sm mb-space-md border-b border-outline-variant/40">
          <span className="material-symbols-outlined text-primary text-[18px]">account_tree</span>
          <span className="font-label-md text-label-md font-semibold text-on-surface uppercase tracking-wider">LIVE WORKFLOW STATUS</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-space-md">
          {/* STEP 01 */}
          <div className="flex flex-col gap-1.5 p-3 rounded bg-surface-container border border-outline-variant/20">
            <span className="font-label-sm text-[10px] text-outline uppercase font-semibold">STEP 01 — TERRAIN RECONSTRUCTION</span>
            <span className={`font-label-sm text-label-sm font-bold ${stepReconstruct === 'COMPLETE' ? 'text-primary' : 'text-on-surface-variant'}`}>{stepReconstruct}</span>
          </div>
          {/* STEP 02 */}
          <div className="flex flex-col gap-1.5 p-3 rounded bg-surface-container border border-outline-variant/20">
            <span className="font-label-sm text-[10px] text-outline uppercase font-semibold">STEP 02 — TEMPORAL CHANGE ANALYSIS</span>
            <span className={`font-label-sm text-label-sm font-bold ${stepCompare === 'COMPLETE' ? 'text-primary' : stepCompare === 'READY' ? 'text-secondary' : 'text-on-surface-variant'}`}>{stepCompare}</span>
          </div>
          {/* STEP 03 */}
          <div className="flex flex-col gap-1.5 p-3 rounded bg-surface-container border border-outline-variant/20">
            <span className="font-label-sm text-[10px] text-outline uppercase font-semibold">STEP 03 — REGION SELECTION</span>
            <span className={`font-label-sm text-label-sm font-bold ${stepSelect === 'COMPLETE' ? 'text-primary' : stepSelect === 'READY' ? 'text-secondary' : 'text-on-surface-variant'}`}>{stepSelect}</span>
          </div>
          {/* STEP 04 */}
          <div className="flex flex-col gap-1.5 p-3 rounded bg-surface-container border border-outline-variant/20">
            <span className="font-label-sm text-[10px] text-outline uppercase font-semibold">STEP 04 — RISK INTELLIGENCE</span>
            <span className={`font-label-sm text-label-sm font-bold ${stepAssess === 'COMPLETE' ? 'text-primary' : stepAssess === 'READY' ? 'text-secondary' : 'text-on-surface-variant'}`}>{stepAssess}</span>
          </div>
          {/* STEP 05 */}
          <div className="flex flex-col gap-1.5 p-3 rounded bg-surface-container border border-outline-variant/20">
            <span className="font-label-sm text-[10px] text-outline uppercase font-semibold">STEP 05 — SIMULATION</span>
            <span className={`font-label-sm text-label-sm font-bold ${stepSimulate === 'READY' ? 'text-primary' : 'text-on-surface-variant'}`}>{stepSimulate}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
