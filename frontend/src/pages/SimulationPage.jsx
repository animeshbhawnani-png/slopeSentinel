import React, { useState } from 'react';
import { useActiveCase } from '../context/ActiveCaseContext';

export default function SimulationPage({ onNavigate }) {
  const { activeCase } = useActiveCase();
  const [running, setRunning] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState('nh109'); // 'nh109', 'pylons', 'culvert', 'dwellings'
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  // Requirement 2: MUST read the currently selected region from ActiveCaseContext.
  const activeRegion = activeCase?.selected_region;

  const handleRerun = () => {
    setRunning(true);
    setTimeout(() => {
      setRunning(false);
    }, 1200);
  };

  const handleDownload = () => {
    if (!activeRegion) return;
    setDownloading(true);
    
    try {
      const report = {
        active_case_id: activeCase?.active_case_id || 'UNKNOWN_CASE',
        investigation_priority: isSignificant ? 'HIGH' : 'ROUTINE',
        simulation_status: 'ILLUSTRATIVE - NOT A PHYSICAL SOLVER',
        scientific_disclaimer: 'This is an illustrative geometric proxy. It does not represent exact runout, physical landslide mechanics, velocity, or true geotechnical probability. Do not use for life-safety decisions.',
        region: {
          id: activeRegion.id,
          label: activeRegion.label || 'CANDIDATE ZONE',
          classification: activeRegion.classification || 'POTENTIAL TERRAIN CHANGE',
          relative_change: activeRegion.relative_change != null ? activeRegion.relative_change : activeRegion.peak_relative_change,
          area_fraction: activeRegion.area_fraction,
          observation_interval: activeRegion.observation_interval || activeCase?.change_outputs?.observation_interval,
          bbox_pct: activeRegion.bbox_pct
        }
      };

      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `slopesentinel_geotechnical_brief_${activeRegion.id || 'export'}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      setDownloaded(true);
      setTimeout(() => setDownloaded(false), 3000);
    } catch (e) {
      console.error('Failed to generate geotechnical brief', e);
      alert('Failed to generate Geotechnical Brief');
    } finally {
      setDownloading(false);
    }
  };

  // Requirement 9: If no selected region exists, show a clear
  // "Select a candidate change zone first" state. Do not silently invent Zone A.
  if (!activeRegion) {
    const caseId = activeCase?.active_case_id || 'NO ACTIVE CASE';
    const isLive = activeCase?.source_type === 'LIVE';

    return (
      <div className="px-gutter-desktop py-space-lg max-w-[1680px] w-full mx-auto space-y-space-lg">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-space-md pb-space-sm border-b border-outline-variant/30">
          <div className="space-y-space-xs">
            <div className="flex items-center gap-space-xs">
              <span className="px-2 py-0.5 rounded-DEFAULT bg-surface-container-high text-tertiary font-label-sm text-label-sm uppercase tracking-wider font-semibold">
                {isLive ? `CASE // ${caseId}` : `CASE // ${caseId.toUpperCase()}`}
              </span>
              <span className="text-outline font-label-sm text-label-sm">/</span>
              <span className="font-label-sm text-label-sm text-tertiary">ILLUSTRATIVE IMPACT SCENARIO</span>
            </div>
            <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight font-semibold">
              Impact Simulation
            </h1>
            <p className="font-body-md text-body-md text-on-surface-variant max-w-2xl">
              Explore a simplified spatial corridor scenario anchored to an identified candidate change zone.
            </p>
          </div>

          <div className="flex items-center gap-space-sm bg-surface-container-low p-1.5 rounded-DEFAULT border border-outline-variant/30">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-DEFAULT bg-surface-container-high">
              <span className="font-label-sm text-label-sm text-outline">STATUS:</span>
              <span className="font-label-sm text-label-sm text-error font-medium">AWAITING CANDIDATE ZONE</span>
            </div>
          </div>
        </div>

        {/* Empty State Banner Card */}
        <div className="p-space-xl rounded-xl bg-surface-container-low border border-outline-variant/40 shadow-xl flex flex-col items-center justify-center text-center max-w-3xl mx-auto space-y-space-md my-space-lg">
          <div className="w-16 h-16 rounded-full bg-error-container/40 text-error flex items-center justify-center shadow-inner">
            <span className="material-symbols-outlined text-[36px]">crisis_alert</span>
          </div>

          <div className="space-y-2">
            <span className="px-3 py-1 rounded-DEFAULT bg-error-container text-on-error-container font-label-sm text-label-sm uppercase tracking-wider font-bold">
              Action Required
            </span>
            <h2 className="font-headline-md text-headline-md text-on-surface font-semibold tracking-tight">
              Select a Candidate Change Zone First
            </h2>
            <p className="font-body-md text-body-md text-on-surface-variant max-w-xl mx-auto leading-relaxed">
              The impact simulation scenario must be anchored to an identified candidate change region from Temporal Change Detection.
              No candidate zone is currently selected for Case <span className="text-primary font-mono font-semibold">{caseId}</span>.
            </p>
          </div>

          <div className="p-space-md rounded-lg bg-surface-container w-full max-w-xl text-left border border-outline-variant/30 space-y-2">
            <div className="flex items-center gap-2 text-tertiary font-label-sm text-label-sm font-semibold uppercase tracking-wider">
              <span className="material-symbols-outlined text-[16px]">info</span>
              <span>Workflow Requirement</span>
            </div>
            <p className="font-body-sm text-body-sm text-on-surface-variant leading-relaxed">
              Simulation corridors are calculated dynamically from detected differential terrain change (Δz clusters), relative displacement, and observation intervals.
              Please go to Temporal Change Detection to inspect candidate zones and forward your selection.
            </p>
          </div>

          {/* Action CTAs */}
          <div className="flex flex-col sm:flex-row items-center gap-3 pt-space-xs w-full sm:w-auto">
            <button
              onClick={() => onNavigate('/change')}
              className="w-full sm:w-auto px-6 py-3 rounded-DEFAULT bg-primary text-on-primary font-label-md text-label-md font-bold uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-primary/90 transition-all shadow-[0_0_16px_rgba(95,217,209,0.25)] cursor-pointer"
            >
              <span>Go to Change Detection</span>
              <span className="material-symbols-outlined text-[18px]">history_toggle_off</span>
            </button>

            <button
              onClick={() => onNavigate('/3d')}
              className="w-full sm:w-auto px-5 py-3 rounded-DEFAULT bg-surface-container-high text-secondary hover:bg-surface-container-highest font-label-md text-label-md font-semibold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors border border-outline-variant/30 cursor-pointer"
            >
              <span>View 3D Terrain</span>
              <span className="material-symbols-outlined text-[18px]">view_in_ar</span>
            </button>
          </div>
        </div>

        {/* Mandatory Scientific Disclaimer Banner */}
        <div className="bg-surface-container-lowest/80 border border-outline-variant/40 rounded-xl p-space-sm flex items-start gap-space-sm shadow-sm max-w-3xl mx-auto">
          <span className="material-symbols-outlined text-primary text-[20px] mt-0.5">verified_user</span>
          <div className="flex flex-col gap-0.5 text-on-surface">
            <span className="font-label-sm text-[11px] font-semibold text-primary uppercase tracking-wider">
              SCIENTIFIC INTEGRITY &amp; PROTOTYPE DISCLOSURE
            </span>
            <p className="font-body-sm text-body-sm text-on-surface-variant italic">
              "Impact scenarios are illustrative geometric approximations intended for prototype decision-support exploration. They do not represent exact geotechnical prediction, physical dynamics, or empirical failure probability."
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Active Region Metadata Extraction
  // Anchored dynamically to the selected region
  const caseId = activeCase?.active_case_id || 'ANALYZED-CASE';
  const isLive = activeCase?.source_type === 'LIVE';
  const regionLabel = activeRegion.label || (activeRegion.id ? activeRegion.id.toUpperCase() : 'CANDIDATE ZONE');
  const classification = activeRegion.classification || 'POTENTIAL TERRAIN CHANGE';
  const rawRelativeChange = activeRegion.relative_change != null ? activeRegion.relative_change : activeRegion.peak_relative_change;
  const relativeChangeFormatted =
    rawRelativeChange != null
      ? (typeof rawRelativeChange === 'number' ? rawRelativeChange.toFixed(3) : String(rawRelativeChange))
      : '—';
  const observationInterval = activeRegion.observation_interval || activeCase?.change_outputs?.observation_interval || 'Observed Temporal Interval';
  
  const candidateArea = activeRegion.area_fraction != null 
    ? `${(activeRegion.area_fraction * 100).toFixed(1)}% of sector` 
    : (activeRegion.affected_pixels ? `${activeRegion.affected_pixels} pixels` : 'Indicative Cluster');

  const locationName = activeCase?.change_outputs?.location || 'Analyzed Sector Flank';
  const sectorCode = activeCase?.change_outputs?.sector || 'TEMPORAL-CHANGE-CORRIDOR';

  // Bounding-box geometry must be initialized BEFORE any derived SVG values use it.
  const hasBbox =
    activeRegion?.bbox_pct &&
    Number.isFinite(Number(activeRegion.bbox_pct.left)) &&
    Number.isFinite(Number(activeRegion.bbox_pct.top)) &&
    Number.isFinite(Number(activeRegion.bbox_pct.width)) &&
    Number.isFinite(Number(activeRegion.bbox_pct.height));

  const pctLeft = hasBbox ? Number(activeRegion.bbox_pct.left) : 50;
  const pctTop = hasBbox ? Number(activeRegion.bbox_pct.top) : 50;
  const pctWidth = hasBbox ? Number(activeRegion.bbox_pct.width) : 0;
  const pctHeight = hasBbox ? Number(activeRegion.bbox_pct.height) : 0;

  const centerX_pct = pctLeft + (pctWidth / 2);
  const centerY_pct = pctTop + (pctHeight / 2);

  // Map normalized 0-100% region position to SVG coordinates.
  const svgCrestX = hasBbox
    ? 200 + (centerX_pct / 100) * 500
    : 460;
  const svgCrestY = hasBbox
    ? 120 + (centerY_pct / 100) * 100
    : 270;

  // Detachment / Coordinate Anchor
  const detachmentElevText = hasBbox
    ? `Prototype normalized image-space anchor: X ${Math.round(centerX_pct)}%, Y ${Math.round(centerY_pct)}%`
    : 'REGION ANCHOR UNAVAILABLE (PROTOTYPE)';

  const detachmentCoordDesc = hasBbox
    ? `Prototype normalized image-space anchor: X ${Math.round(centerX_pct)}%, Y ${Math.round(centerY_pct)}% • ${locationName}`
    : `${locationName} • Region geometry did not include a bbox anchor`;

  // Severity & Investigation Priority
  const isSignificant = classification === 'SIGNIFICANT CHANGE' || (Number(rawRelativeChange) >= 0.20);
  const isModerate = classification === 'POTENTIAL TERRAIN CHANGE' || (Number(rawRelativeChange) >= 0.08);
  const priorityLevel = isSignificant ? 'HIGH' : isModerate ? 'MODERATE' : 'MONITORING';
  const priorityBadgeClass = isSignificant 
    ? 'bg-error text-on-error' 
    : isModerate 
      ? 'bg-tertiary-container text-tertiary' 
      : 'bg-secondary-container text-secondary';

  const recommendation = isSignificant
    ? 'Field engineering verification recommended: Deploy geotechnical inspection team for on-site fissure inspection, piezometer water table assessment, and high-density repeat LiDAR/UAV scanning before taking operational decisions.'
    : isModerate
      ? 'Field reconnaissance recommended: Conduct ground-truth check of candidate surface alteration and monitor repeat satellite/drone passes for acceleration.'
      : 'Routine baseline monitoring: Surface differential remains within nominal threshold. Continue periodic temporal surveillance.';

  // Envelope calculation based on area_fraction (0 to 1) or relative_change
  const envelopeSpread = 40 + ((activeRegion.area_fraction || 0) * 1000) + ((Number(rawRelativeChange) || 0) * 150);
  const clampedSpread = Math.min(250, Math.max(80, envelopeSpread));

  // Downslope orientation (X shift)
  const flowDirectionX = centerX_pct < 50 ? 1 : -1;
  const endX = svgCrestX + (flowDirectionX * 150) - (centerX_pct - 50);
  const endY = 480;

  const corridorSpan = rawRelativeChange != null
    ? Math.round(250 + Number(rawRelativeChange) * 800)
    : null;
  const assets = [
    {
      id: 'transport_corridor',
      title: 'Primary Downslope Transport Corridor',
      subtitle: `Illustrative ~${corridorSpan}m corridor intersect`,
      type: 'TRANSPORT CORRIDOR',
      icon: 'warning',
      iconColor: 'text-error',
      metric: `~${corridorSpan}m corridor (Illustrative)`,
      detail: `Primary downslope transit axis in direct alignment with ${regionLabel} illustrative geometric corridor.`,
      svgLabel: `ACCESS CORRIDOR (~${corridorSpan}m)`,
      stroke: '#93000a'
    },
    {
      id: 'drainage_culvert',
      title: 'Downslope Drainage Channel / Inflow Axis',
      subtitle: 'Natural catchment drainage channel intercept',
      type: 'HYDROLOGIC INFRASTRUCTURE',
      icon: 'water_damage',
      iconColor: 'text-primary',
      metric: 'Drainage Conduit',
      detail: 'Downslope natural stream or drainage chute at risk of blockage or debris diversion under failure scenario.',
      svgLabel: 'DRAINAGE CHANNEL / INFLOW',
      stroke: '#7ef6ed'
    },
    {
      id: 'retaining_pylons',
      title: 'Structural Retaining Slope Features',
      subtitle: 'Slope retaining infrastructure in sector boundary',
      type: 'STRUCTURAL RETENTION',
      icon: 'account_tree',
      iconColor: 'text-tertiary',
      metric: 'Retention Elements',
      detail: 'Engineering stabilization features along the slope corridor requiring inspection under severe rainfall conditions.',
      svgLabel: 'RETAINING STRUCTURES',
      stroke: '#f3e1bb'
    },
    {
      id: 'perimeter_dwellings',
      title: 'Peripheral Built Footprints (Illustrative)',
      subtitle: 'Structures adjacent to downstream sector boundary',
      type: 'PERIMETER STRUCTURES',
      icon: 'home',
      iconColor: 'text-error',
      metric: 'Sector Footprints',
      detail: 'Built structures situated in proximate downstream trajectory in this illustrative proxy scenario.',
      svgLabel: 'PERIMETER FOOTPRINTS',
      stroke: '#ffb4ab'
    }
  ];


  return (
    <div className="px-gutter-desktop py-space-lg max-w-[1680px] w-full mx-auto space-y-space-lg">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-space-md pb-space-sm border-b border-outline-variant/30">
        <div className="space-y-space-xs">
          <div className="flex items-center gap-space-xs">
            <span className="px-2 py-0.5 rounded-DEFAULT bg-error-container text-on-error-container font-label-sm text-label-sm uppercase tracking-wider font-semibold">
              {isLive ? `LIVE CASE // ${caseId}` : `CASE // ${caseId.toUpperCase()}`}
            </span>
            <span className="text-outline font-label-sm text-label-sm">/</span>
            <span className="font-label-sm text-label-sm text-tertiary">ILLUSTRATIVE IMPACT SCENARIO (PROTOTYPE)</span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight font-semibold">
            Impact Simulation Scenario
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant max-w-2xl">
            Explore an illustrative geometric corridor proxy anchored to candidate change zone <strong className="text-primary font-semibold">{regionLabel}</strong>.
          </p>
        </div>

        <div className="flex items-center gap-space-sm bg-surface-container-low p-1.5 rounded-DEFAULT border border-outline-variant/30">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-DEFAULT bg-surface-container-high">
            <span className="font-label-sm text-label-sm text-outline">METHODOLOGY:</span>
            <span className="font-label-sm text-label-sm text-secondary font-medium">Illustrative Spatial Corridor</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-DEFAULT bg-secondary-container/30">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
            <span className="font-label-sm text-label-sm text-primary font-medium uppercase">PROTOTYPE DECISION SUPPORT</span>
          </div>
        </div>
      </div>

      {/* Mandatory Scientific Disclaimer Banner (Requirement 6 & 8) */}
      <div className="bg-surface-container-lowest/90 border border-outline-variant/40 rounded-xl p-space-sm flex items-start gap-space-sm shadow-sm">
        <span className="material-symbols-outlined text-primary text-[20px] mt-0.5">verified_user</span>
        <div className="flex flex-col gap-0.5 text-on-surface">
          <span className="font-label-sm text-[11px] font-semibold text-primary uppercase tracking-wider">
            SCIENTIFIC STATUS: ILLUSTRATIVE PROTOTYPE SCENARIO ONLY
          </span>
          <p className="font-body-sm text-body-sm text-on-surface-variant italic leading-relaxed">
            "This simulation generates an illustrative geometric proxy corridor for emergency planning and prioritization. It does not model physical landslide dynamics, soil mechanics, exact runout distance, velocity, or geotechnical failure probability. Ground-truth field verification is required before operational decisions."
          </p>
        </div>
      </div>

      {/* Main Grid: 8 Columns Viewport Canvas + 4 Columns Scenario Summary */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-gutter-desktop items-start">
        {/* Left 8 Columns */}
        <div className="xl:col-span-8 flex flex-col space-y-space-md">
          <div className="relative w-full rounded-xl bg-surface-container-lowest overflow-hidden shadow-2xl min-h-[640px] flex flex-col justify-between border border-outline-variant/40">
            <div className="absolute inset-0 z-0 pointer-events-none opacity-40 bg-[radial-gradient(#5fd9d1_1px,transparent_1px)] [background-size:24px_24px]"></div>

            {/* Viewport Top Control Bar */}
            <div className="relative z-20 p-space-md flex flex-wrap items-center justify-between gap-space-sm bg-surface-container-lowest/80 backdrop-blur-md border-b border-outline-variant/30">
              <div className="flex items-center gap-space-sm">
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-DEFAULT bg-surface-container border border-outline-variant/30">
                  <span className="material-symbols-outlined text-[16px] text-error">crisis_alert</span>
                  <span className="font-label-sm text-label-sm text-on-surface uppercase font-semibold">
                    Anchored Source: {regionLabel}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-DEFAULT bg-surface-container-low border border-outline-variant/30">
                  <span className="font-label-sm text-label-sm text-outline">APPROACH:</span>
                  <span className="font-label-sm text-label-sm text-tertiary font-medium">Geometric Proxy (Illustrative)</span>
                </div>
              </div>

              <div className="flex items-center gap-space-xs">
                <button 
                  onClick={handleRerun}
                  disabled={running}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-DEFAULT bg-secondary-container text-primary font-label-sm text-label-sm uppercase hover:bg-secondary-container/80 transition-all active:scale-95 shadow-[0_0_12px_rgba(95,217,209,0.15)] disabled:opacity-80 font-semibold cursor-pointer"
                >
                  <span className={`material-symbols-outlined text-[16px] ${running ? 'animate-spin' : ''}`}>sync</span>
                  <span>{running ? 'CALCULATING...' : 'RE-RUN SCENARIO'}</span>
                </button>
                <div className="px-2.5 py-1.5 rounded-DEFAULT bg-surface-container text-on-surface-variant font-label-sm text-label-sm border border-outline-variant/30 font-mono">
                  {detachmentElevText}
                </div>
              </div>
            </div>

            {/* SVG Simulation Canvas */}
            <div className="relative z-10 w-full flex-1 flex items-center justify-center p-4">
              <svg className="w-full h-full max-h-[560px]" fill="none" viewBox="0 0 920 540" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="terrainGrade" x1="0" x2="1" y1="0" y2="1">
                    <stop offset="0%" stopColor="#131d1b"></stop>
                    <stop offset="50%" stopColor="#17221f"></stop>
                    <stop offset="100%" stopColor="#0b1513"></stop>
                  </linearGradient>
                  <linearGradient id="runoutGlow" x1="0.3" x2="0.7" y1="0.1" y2="0.9">
                    <stop offset="0%" stopColor="#ffb4ab" stopOpacity="0.9"></stop>
                    <stop offset="35%" stopColor="#f3e1bc" stopOpacity="0.65"></stop>
                    <stop offset="100%" stopColor="#d6c5a1" stopOpacity="0.2"></stop>
                  </linearGradient>
                  <radialGradient cx="50%" cy="50%" id="sourceDetachment" r="50%">
                    <stop offset="0%" stopColor="#93000a"></stop>
                    <stop offset="70%" stopColor="#ffb4ab" stopOpacity="0.8"></stop>
                    <stop offset="100%" stopColor="#ffb4ab" stopOpacity="0"></stop>
                  </radialGradient>
                </defs>

                <polygon fill="url(#terrainGrade)" opacity="0.95" points="120,490 380,180 840,320 620,530"></polygon>

                {/* Perspective Grid */}
                <g opacity="0.6" stroke="#3d4948" strokeDasharray="3 4" strokeWidth="1">
                  <line x1="160" x2="410" y1="460" y2="200"></line>
                  <line x1="220" x2="470" y1="480" y2="220"></line>
                  <line x1="280" x2="530" y1="500" y2="240"></line>
                  <line x1="340" x2="590" y1="520" y2="260"></line>
                  <line x1="210" x2="680" y1="390" y2="440"></line>
                  <line x1="270" x2="740" y1="310" y2="360"></line>
                  <line x1="330" x2="800" y1="230" y2="280"></line>
                </g>

                {/* Simulated Runout Corridor Envelope Path */}
                <path 
                  d={`M ${svgCrestX - clampedSpread * 0.15},${svgCrestY + 5} C ${svgCrestX - clampedSpread * 0.15 - 20},${svgCrestY + 50} ${endX - clampedSpread * 0.8 + 40},${endY - 100} ${endX - clampedSpread * 0.8},${endY} L ${endX + clampedSpread * 0.2},${endY + 30} C ${endX + clampedSpread * 0.2 + 70},${endY - 70} ${svgCrestX + clampedSpread * 0.35 + 25},${svgCrestY + 100} ${svgCrestX + clampedSpread * 0.35},${svgCrestY + 15} Z`}
                  fill="url(#runoutGlow)" 
                  style={{ opacity: running ? 0.3 : 1, transition: 'all 0.6s ease' }}
                />

                <g opacity="0.7" stroke="#f3e1bc" strokeDasharray="6 4" strokeWidth="1.5">
                  <path d={`M ${svgCrestX + 10},${svgCrestY + 10} C ${svgCrestX - 20},${svgCrestY + 80} ${endX - 30},${endY - 120} ${endX - 60},${endY + 10}`}></path>
                  <path d={`M ${svgCrestX + 25},${svgCrestY + 15} C ${svgCrestX + 5},${svgCrestY + 90} ${endX + 10},${endY - 100} ${endX + 5},${endY + 30}`}></path>
                </g>

                {/* Detachment Crest Anchored to Region */}
                <g id="detachment-crest">
                  <path d={`M ${svgCrestX - 40},${svgCrestY + 5} Q ${svgCrestX},${svgCrestY - 10} ${svgCrestX + 40},${svgCrestY + 15} Q ${svgCrestX},${svgCrestY + 30} ${svgCrestX - 40},${svgCrestY + 5} Z`} fill="url(#sourceDetachment)" style={{ transition: 'all 0.6s ease' }}></path>
                  <path d={`M ${svgCrestX - 45},${svgCrestY + 3} Q ${svgCrestX},${svgCrestY - 15} ${svgCrestX + 45},${svgCrestY + 13}`} stroke="#ffb4ab" strokeLinecap="round" strokeWidth="3" style={{ transition: 'all 0.6s ease' }}></path>
                  <circle cx={svgCrestX} cy={svgCrestY} fill="#ffb4ab" r="4" style={{ transition: 'all 0.6s ease' }}></circle>
                  <rect fill="#131d1b" height="26" rx="2" stroke="#93000a" strokeWidth="1" width="168" x={svgCrestX - 69} y={svgCrestY - 45} style={{ transition: 'all 0.6s ease' }}></rect>
                  <text fill="#ffdad6" fontFamily="JetBrains Mono" fontSize="10" fontWeight="600" x={svgCrestX - 59} y={svgCrestY - 28} style={{ transition: 'all 0.6s ease' }}>
                    {regionLabel} CREST (PROTOTYPE)
                  </text>
                </g>

                {/* Asset 1: Transport Corridor Breach */}
                <g 
                  id="nh109-corridor" 
                  onClick={() => setSelectedAsset('nh109')}
                  className="cursor-pointer"
                >
                  <path d="M 160,370 C 260,380 430,410 740,435" fill="none" stroke="#3d4948" strokeLinecap="round" strokeWidth="7"></path>
                  <path d="M 160,370 C 260,380 430,410 740,435" fill="none" stroke="#222c2a" strokeWidth="5"></path>
                  <path d={`M ${endX - 80},${endY - 98} C ${endX},${endY - 87} ${endX + 75},${endY - 76} ${endX + 125},${endY - 69}`} fill="none" stroke="#ffb4ab" strokeLinecap="round" strokeWidth="7" style={{ transition: 'all 0.6s ease' }}></path>
                  <path d={`M ${endX - 80},${endY - 98} C ${endX},${endY - 87} ${endX + 75},${endY - 76} ${endX + 125},${endY - 69}`} fill="none" stroke="#93000a" strokeDasharray="4 3" strokeWidth="3" style={{ transition: 'all 0.6s ease' }}></path>
                  <rect 
                    fill="#93000a" 
                    height="24" 
                    rx="2" 
                    width="210" 
                    x={endX - 95} 
                    y={endY - 145} 
                    stroke={selectedAsset === 'nh109' ? '#7ef6ed' : 'none'} 
                    strokeWidth="1.5"
                    style={{ transition: 'all 0.6s ease' }}
                  ></rect>
                  <text fill="#ffdad6" fontFamily="JetBrains Mono" fontSize="10" fontWeight="700" x={endX - 87} y={endY - 129} style={{ transition: 'all 0.6s ease' }}>
                    {assets[0].svgLabel}
                  </text>
                </g>

                {/* Asset 2: Drainage Inflow Culvert */}
                <g 
                  id="asset-culvert" 
                  transform={`translate(${endX - 105}, ${endY - 50})`}
                  onClick={() => setSelectedAsset('culvert')}
                  className="cursor-pointer"
                  style={{ transition: 'all 0.6s ease' }}
                >
                  <circle cx="0" cy="0" fill="#131d1b" r="14" stroke={selectedAsset === 'culvert' ? '#7ef6ed' : '#7ef6ed'} strokeWidth={selectedAsset === 'culvert' ? '3' : '1.5'}></circle>
                  <circle cx="0" cy="0" fill="#7ef6ed" r="4"></circle>
                  <rect fill="#17221f" height="22" rx="2" width="180" x="14" y="-12" stroke={selectedAsset === 'culvert' ? '#7ef6ed' : 'none'}></rect>
                  <text fill="#dae5e1" fontFamily="JetBrains Mono" fontSize="9" x="22" y="3">
                    {assets[1].svgLabel}
                  </text>
                </g>

                {/* Asset 3: Pylon Cluster / Infrastructure */}
                <g 
                  id="asset-pylons" 
                  transform={`translate(${svgCrestX + 5}, ${svgCrestY + 165})`}
                  onClick={() => setSelectedAsset('pylons')}
                  className="cursor-pointer"
                  style={{ transition: 'all 0.6s ease' }}
                >
                  <circle cx="0" cy="0" fill="#131d1b" r="12" stroke={selectedAsset === 'pylons' ? '#7ef6ed' : '#f3e1bb'} strokeWidth={selectedAsset === 'pylons' ? '3' : '1.5'}></circle>
                  <polygon fill="#f3e1bb" points="0,-5 5,5 -5,5"></polygon>
                  <rect fill="#17221f" height="22" rx="2" width="170" x="16" y="-11" stroke={selectedAsset === 'pylons' ? '#7ef6ed' : 'none'}></rect>
                  <text fill="#f3e1bb" fontFamily="JetBrains Mono" fontSize="9" x="24" y="4">
                    {assets[2].svgLabel}
                  </text>
                </g>

                {/* Asset 4: Lower Dwellings / Perimeter */}
                <g 
                  id="settlement-alpha" 
                  transform={`translate(${endX - 170}, ${endY + 5})`}
                  onClick={() => setSelectedAsset('dwellings')}
                  className="cursor-pointer"
                  style={{ transition: 'all 0.6s ease' }}
                >
                  <rect fill="#2d3734" height="16" stroke={selectedAsset === 'dwellings' ? '#7ef6ed' : '#ffb4ab'} strokeWidth="1.5" width="16" x="-8" y="-8"></rect>
                  <rect fill="#131d1b" height="22" rx="2" width="160" x="14" y="-12" stroke={selectedAsset === 'dwellings' ? '#7ef6ed' : 'none'}></rect>
                  <text fill="#ffb4ab" fontFamily="JetBrains Mono" fontSize="9" x="20" y="3">
                    {assets[3].svgLabel}
                  </text>
                </g>

                <text fill="#869392" fontFamily="JetBrains Mono" fontSize="9" x="635" y="260">
                  SLOPE ASPECT: DYNAMIC NORMAL (ILLUSTRATIVE)
                </text>
              </svg>
            </div>

            {/* Bottom Legend HUD */}
            <div className="relative z-20 p-space-md bg-surface-container-lowest/90 backdrop-blur-md flex flex-wrap items-center justify-between gap-space-md border-t border-outline-variant/30">
              <div className="flex items-center gap-space-lg flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-error"></span>
                  <span className="font-label-sm text-label-sm text-on-surface">Detachment Source ({regionLabel})</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-DEFAULT bg-tertiary"></span>
                  <span className="font-label-sm text-label-sm text-on-surface">Illustrative Runout Cone</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-1.5 rounded-DEFAULT bg-error"></span>
                  <span className="font-label-sm text-label-sm text-on-surface">Corridor Intersect</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-primary ring-2 ring-primary/30"></span>
                  <span className="font-label-sm text-label-sm text-on-surface">Drainage / Assets</span>
                </div>
              </div>

              <div className="font-label-sm text-label-sm text-outline">
                HEURISTIC PROXY RESOLUTION: <span className="text-on-surface font-semibold">10m DTM (Prototype)</span>
              </div>
            </div>
          </div>

          {/* Quick Metrics Bar (Requirement 4: active case ID, region label, classification, relative change, interval, candidate area) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-space-md">
            {/* Metric 1: Source Zone & Case ID */}
            <div className="p-space-md rounded-xl bg-surface-container-low flex flex-col justify-between border border-outline-variant/40 shadow-sm">
              <div className="flex items-center justify-between text-outline">
                <span className="font-label-sm text-label-sm uppercase font-semibold">Active Source Zone</span>
                <span className="material-symbols-outlined text-[16px]">crisis_alert</span>
              </div>
              <div className="mt-space-sm">
                <span className="font-display text-[1.8rem] leading-none text-on-surface font-semibold">
                  {regionLabel}
                </span>
                <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
                  Case ID: <span className="font-mono text-primary font-semibold">{caseId}</span> • {locationName}
                </p>
              </div>
            </div>

            {/* Metric 2: Classification & Relative Change */}
            <div className="p-space-md rounded-xl bg-surface-container-low flex flex-col justify-between border border-outline-variant/40 shadow-sm">
              <div className="flex items-center justify-between text-outline">
                <span className="font-label-sm text-label-sm uppercase font-semibold">Region Classification</span>
                <span className="material-symbols-outlined text-[16px]">trending_down</span>
              </div>
              <div className="mt-space-sm">
                <span className={`font-display text-[1.5rem] leading-none font-semibold ${isSignificant ? 'text-error' : 'text-tertiary'}`}>
                  {classification}
                </span>
                <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
                  Relative Shift (Δz): <strong className="text-error font-mono">{relativeChangeFormatted}</strong> rel. units
                </p>
              </div>
            </div>

            {/* Metric 3: Observation Interval & Candidate Area */}
            <div className="p-space-md rounded-xl bg-surface-container-low flex flex-col justify-between border border-outline-variant/40 shadow-sm sm:col-span-2 md:col-span-1">
              <div className="flex items-center justify-between text-outline">
                <span className="font-label-sm text-label-sm uppercase font-semibold">Observation &amp; Area</span>
                <span className="material-symbols-outlined text-[16px]">date_range</span>
              </div>
              <div className="mt-space-sm">
                <span className="font-label-lg text-label-lg leading-tight text-on-surface font-mono font-semibold block">
                  {observationInterval}
                </span>
                <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
                  Candidate Area: <strong className="text-primary font-mono">{candidateArea}</strong>
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right 4 Columns Sidebar */}
        <div className="xl:col-span-4 flex flex-col space-y-space-md">
          <div className="p-space-lg rounded-xl bg-surface-container-low shadow-xl flex flex-col space-y-space-lg border border-outline-variant/40">
            <div className="flex items-center justify-between pb-space-sm border-b border-outline-variant/40">
              <div className="flex items-center gap-space-xs">
                <span className="material-symbols-outlined text-primary text-[20px]">analytics</span>
                <span className="font-headline-sm text-headline-sm uppercase tracking-wide text-on-surface font-semibold">
                  SCENARIO SUMMARY
                </span>
              </div>
              <span className={`px-2.5 py-1 rounded-DEFAULT ${priorityBadgeClass} font-label-md text-label-md font-bold uppercase tracking-wider`}>
                {priorityLevel} EXPOSURE
              </span>
            </div>

            {/* Failure Source Envelope (Requirement 5) */}
            <div className="p-space-md rounded-DEFAULT bg-surface-container space-y-1.5 border border-outline-variant/30">
              <span className="font-label-sm text-label-sm uppercase text-outline font-semibold">
                FAILURE SOURCE ENVELOPE (SCENARIO)
              </span>
              <div className="font-body-lg text-body-lg text-on-surface font-medium flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-error"></span>
                <span>{regionLabel}</span>
                <span className="text-outline text-label-sm">/</span>
                <span className="text-tertiary text-label-sm font-mono">{caseId}</span>
              </div>
              <p className="font-label-sm text-label-sm text-on-surface-variant font-mono">
                {detachmentCoordDesc}
              </p>
              <div className="flex items-center justify-between pt-1 border-t border-outline-variant/20 font-label-sm text-[11px]">
                <span className="text-outline">Classification:</span>
                <span className="text-error font-semibold">{classification}</span>
              </div>
              <div className="flex items-center justify-between font-label-sm text-[11px]">
                <span className="text-outline">Relative Change (Δz):</span>
                <span className="text-primary font-mono font-semibold">{relativeChangeFormatted} rel. units</span>
              </div>
            </div>

            {/* Directly Affected Infrastructure Assets (Requirement 7) */}
            <div className="space-y-space-sm">
              <div className="flex items-center justify-between">
                <span className="font-label-sm text-label-sm uppercase text-outline tracking-wider font-semibold">
                  Illustrative Exposed Assets
                </span>
                <span className="font-label-sm text-[10px] text-tertiary">
                  Click to inspect
                </span>
              </div>

              <div className="space-y-2">
                {assets.map((asset) => {
                  const isSelected = selectedAsset === asset.id;
                  return (
                    <div 
                      key={asset.id}
                      onClick={() => setSelectedAsset(asset.id)}
                      className={`p-space-sm rounded-DEFAULT cursor-pointer flex items-start gap-space-sm transition-all border ${
                        isSelected 
                          ? 'bg-surface-container-high border-primary ring-1 ring-primary/40 shadow-sm' 
                          : 'bg-surface-container border-outline-variant/30 hover:bg-surface-container-high'
                      }`}
                    >
                      <span className={`material-symbols-outlined ${asset.iconColor} text-[18px] mt-0.5`}>
                        {asset.icon}
                      </span>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className="font-body-md text-body-md text-on-surface font-medium block">
                            {asset.title}
                          </span>
                          <span className="font-label-sm text-[10px] text-tertiary font-mono">
                            {asset.metric}
                          </span>
                        </div>
                        <span className="font-label-sm text-label-sm text-on-surface-variant font-normal">
                          {asset.subtitle}
                        </span>
                        {isSelected && (
                          <p className="font-body-sm text-[11px] text-on-surface-variant mt-1.5 pt-1 border-t border-outline-variant/30 italic">
                            {asset.detail}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Investigation Priority & Recommendation (Requirement 7) */}
            <div className="p-space-md rounded-DEFAULT bg-secondary-container/40 space-y-space-xs border border-secondary/30">
              <div className="flex items-center gap-2 text-primary">
                <span className="material-symbols-outlined text-[18px]">verified_user</span>
                <span className="font-label-md text-label-md uppercase font-semibold">
                  Investigation Priority: {priorityLevel}
                </span>
              </div>
              <p className="font-body-sm text-body-sm text-on-surface leading-relaxed">
                {recommendation}
              </p>
            </div>

            {/* CTAs */}
            <div className="flex flex-col gap-space-xs pt-space-xs">
              <button 
                onClick={handleDownload}
                disabled={downloading}
                className="w-full py-3 px-4 rounded-DEFAULT bg-primary text-on-primary font-label-md text-label-md font-semibold uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-primary/90 transition-all shadow-[0_0_16px_rgba(95,217,209,0.2)] active:scale-[0.98] disabled:opacity-80 cursor-pointer"
              >
                <span className={`material-symbols-outlined text-[18px] ${downloading ? 'animate-spin' : ''}`}>
                  {downloading ? 'sync' : downloaded ? 'check_circle' : 'download'}
                </span>
                <span>
                  {downloading 
                    ? 'Preparing Geotechnical Brief...' 
                    : downloaded 
                      ? 'Brief Downloaded (GeoJSON)' 
                      : 'Download Geotechnical Brief'}
                </span>
              </button>

              <button 
                onClick={() => onNavigate('/3d')}
                className="w-full py-2.5 px-4 rounded-DEFAULT bg-surface-container-high text-secondary hover:bg-surface-container-highest font-label-md text-label-md font-medium uppercase tracking-wider flex items-center justify-center gap-2 transition-colors border border-outline-variant/30 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">view_in_ar</span>
                <span>View In 3D Surface</span>
              </button>

              <button 
                onClick={() => onNavigate('/validation')}
                className="w-full py-2 px-4 rounded-DEFAULT bg-transparent text-on-surface-variant hover:text-on-surface font-label-sm text-label-sm uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <span>View Historical Validation</span>
                <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
