import React, { useState, useEffect } from 'react';
import { useActiveCase } from '../context/ActiveCaseContext';

export default function RiskAnalysisPage({ onNavigate }) {
  const { activeCase, setRiskOutputs } = useActiveCase();

  const maxRelativeChange = Number(
    activeCase?.change_outputs?.summary?.max_relative_difference ?? 0
  );

  const changeFraction = Number(
    activeCase?.change_outputs?.summary?.change_fraction ?? 0
  );

  const significantFraction = Number(
    activeCase?.change_outputs?.summary?.significant_fraction ?? 0
  );

  const hasTerrain = !!activeCase?.change_outputs;
  const terrainChangeScore = hasTerrain ? Math.min(100, Math.max(0, Math.round(maxRelativeChange * 100))) : null;

  // Prefer an actually supplied slope score when one exists.
  const suppliedSlopeScore = [
    activeCase?.change_outputs?.slope_score,
    activeCase?.reconstruction?.metadata?.slope_score,
    activeCase?.selected_region?.slope
  ].find(
    (value) => Number.isFinite(Number(value))
  );

  const slopeBaseline = suppliedSlopeScore != null ? Number(suppliedSlopeScore) : null;

  // User-supplied environmental input (persists via activeCase.risk_outputs across mounts if already set)
  const initialEnv = activeCase?.risk_outputs?.environmental_trigger_score;
  const [userEnvironmentalInput, setUserEnvironmentalInput] = useState(
    initialEnv != null ? Number(initialEnv) : null
  );

  const environmentBaseline = userEnvironmentalInput;

  const [scenarioMode, setScenarioMode] = useState(false);

  // Scenario sliders default to 50 ONLY if there's no baseline and we are actively engaging scenario mode
  const [scenarioSlope, setScenarioSlope] = useState(slopeBaseline != null ? slopeBaseline : 50);
  const [scenarioEnvironment, setScenarioEnvironment] = useState(environmentBaseline != null ? environmentBaseline : 50);

  useEffect(() => {
    setScenarioSlope(slopeBaseline != null ? slopeBaseline : 50);
    setScenarioEnvironment(environmentBaseline != null ? environmentBaseline : 50);
    setScenarioMode(false);
    // DO NOT reset userEnvironmentalInput here, we want it to persist for the current case.
  }, [
    activeCase?.active_case_id,
    slopeBaseline,
    // Note: intentionally excluding environmentBaseline here so changing it doesn't constantly reset scenario mode
  ]);

  const slopeScore = scenarioMode ? scenarioSlope : slopeBaseline;
  const environmentScore = scenarioMode ? scenarioEnvironment : environmentBaseline;

  let computedScore = null;
  let riskLevel = 'INSUFFICIENT EVIDENCE';
  let indicatorLabel = 'INSUFFICIENT EVIDENCE';
  let isPartialEvidence = false;

  const hasSlope = slopeScore != null;
  const hasEnv = environmentScore != null;

  if (hasTerrain && hasSlope) {
    if (hasEnv) {
      computedScore = Math.round(
        (terrainChangeScore * 0.40) +
        (slopeScore * 0.30) +
        (environmentScore * 0.30)
      );
      indicatorLabel = '3-FACTOR PROTOTYPE INDICATOR';
    } else {
      computedScore = Math.round(
        (terrainChangeScore * (40 / 70)) +
        (slopeScore * (30 / 70))
      );
      indicatorLabel = '2-FACTOR PROTOTYPE INDICATOR';
      isPartialEvidence = true;
    }
  }

  if (computedScore != null) {
    riskLevel =
      computedScore <= 30
        ? 'LOW'
        : computedScore <= 55
          ? 'WATCH'
          : computedScore <= 75
            ? 'ELEVATED'
            : 'HIGH';
  }

  const getEnvQualitativeLabel = (val) => {
    if (val == null) return '';
    if (val <= 20) return 'LOW';
    if (val <= 40) return 'MODERATE';
    if (val <= 60) return 'ELEVATED';
    if (val <= 80) return 'HIGH';
    return 'VERY HIGH';
  };

  const envLabel = getEnvQualitativeLabel(environmentScore);

  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);

  const handleExport = () => {
    setExporting(true);
    try {
      const report = {
        type: "FeatureCollection",
        metadata: {
          case_id: activeCase?.active_case_id || 'UNKNOWN_CASE',
          risk_level: riskLevel,
          computed_score: computedScore,
          scenario_mode: scenarioMode,
          factors: {
            terrain_change_score: terrainChangeScore,
            slope_score: slopeScore,
            environment_score: environmentScore
          },
          scientific_disclaimer: "Prototype Risk Brief. Computed score relies on multi-factor heuristics rather than exact physical solvers. Not for life-safety use."
        },
        features: activeCase?.selected_region?.bbox_pct ? [{
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [[
              [activeCase.selected_region.bbox_pct.left, activeCase.selected_region.bbox_pct.top],
              [activeCase.selected_region.bbox_pct.left + (activeCase.selected_region.bbox_pct.width || 0), activeCase.selected_region.bbox_pct.top],
              [activeCase.selected_region.bbox_pct.left + (activeCase.selected_region.bbox_pct.width || 0), activeCase.selected_region.bbox_pct.top + (activeCase.selected_region.bbox_pct.height || 0)],
              [activeCase.selected_region.bbox_pct.left, activeCase.selected_region.bbox_pct.top + (activeCase.selected_region.bbox_pct.height || 0)],
              [activeCase.selected_region.bbox_pct.left, activeCase.selected_region.bbox_pct.top]
            ]]
          },
          properties: {
            id: activeCase.selected_region.id,
            classification: activeCase.selected_region.classification
          }
        }] : []
      };

      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `slopesentinel_risk_brief_${activeCase?.active_case_id || 'export'}.geojson`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      setExported(true);
      setTimeout(() => setExported(false), 3000);
    } catch (e) {
      console.error(e);
      alert('Failed to generate Advisory Package');
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    if (!setRiskOutputs) return;

    if (computedScore != null) {
      setRiskOutputs({
        case_id: activeCase?.active_case_id || null,
        mode: scenarioMode ? 'SCENARIO' : 'BASELINE',
        score: computedScore,
        level: riskLevel,
        terrain_change_score: terrainChangeScore,
        slope_score: slopeScore,
        environmental_trigger_score: environmentScore,
        environmental_source: hasEnv ? 'user_supplied' : null,
        is_partial_evidence: isPartialEvidence,
        max_relative_change: maxRelativeChange,
        change_fraction: changeFraction,
        significant_fraction: significantFraction,
        is_probability: false
      });
    } else {
      setRiskOutputs(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeCase?.active_case_id,
    scenarioMode,
    computedScore,
    riskLevel,
    terrainChangeScore,
    slopeScore,
    environmentScore,
    hasEnv,
    isPartialEvidence,
    maxRelativeChange,
    changeFraction,
    significantFraction
  ]);

  return (
    <div className="p-space-lg xl:p-space-xl flex flex-col gap-space-lg max-w-[1720px] mx-auto w-full">
      {/* Top Command Strip */}
      <section className="flex flex-col md:flex-row md:items-end justify-between gap-space-md pb-space-sm border-b border-outline-variant/30">
        <div className="flex flex-col gap-space-xs">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-error animate-pulse"></span>
            <span className="font-label-sm text-label-sm uppercase tracking-widest text-tertiary">Mission Module // 04</span>
            <span className="text-outline-variant text-label-sm">/</span>
            <span className="font-label-sm text-label-sm text-primary uppercase">
              {activeCase?.source_type === 'LIVE' ? `Active Live Case: ${activeCase.active_case_id}` : 'Sector Analysis'}
            </span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight font-semibold">
            Risk Intelligence
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant max-w-2xl">
            An explainable prototype risk indicator based on terrain and environmental signals.
          </p>
        </div>

        {/* Risk Diagnostics */}
        <div className="flex items-center gap-space-xs flex-wrap">
          <div className="bg-surface-container-low px-3 py-1.5 rounded-lg flex items-center gap-2 shadow-sm border border-outline-variant/40">
            <span className="material-symbols-outlined text-[16px] text-tertiary">radar</span>
            <span className="font-label-sm text-label-sm text-outline uppercase">Sensor Array:</span>
            <span className="font-label-sm text-label-sm text-on-surface font-semibold">
              Depth Anything V2 Monocular
            </span>
          </div>
          <div className="bg-surface-container-low px-3 py-1.5 rounded-lg flex items-center gap-2 shadow-sm border border-outline-variant/40">
            <span className="material-symbols-outlined text-[16px] text-primary">satellite_alt</span>
            <span className="font-label-sm text-label-sm text-outline uppercase">Pass:</span>
            <span className="font-label-sm text-label-sm text-primary font-semibold">
              Live User Epoch
            </span>
          </div>
          <div className="bg-surface-container-high px-3 py-1.5 rounded-lg flex items-center gap-2 shadow-sm border border-outline-variant/40">
            <span className="font-label-sm text-label-sm text-tertiary-fixed-dim uppercase">Risk Engine:</span>
            <span className="font-label-sm text-label-sm text-secondary font-medium">Heuristic Prototype</span>
          </div>
        </div>
      </section>

      {/* Main Grid: Left Column 7 Cols + Right Column 5 Cols */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-space-lg items-start">
        {/* LEFT COLUMN (7 Cols) */}
        <div className="xl:col-span-7 flex flex-col gap-space-lg">
          {/* Main Risk Hero Card */}
          <article className="bg-surface-container-low rounded-xl p-space-lg relative overflow-hidden shadow-xl flex flex-col gap-space-md border border-outline-variant/40">
            <div className="absolute -right-24 -top-24 w-80 h-80 rounded-full bg-error/10 blur-3xl pointer-events-none"></div>
            <div className="absolute -left-20 -bottom-20 w-64 h-64 rounded-full bg-primary/5 blur-3xl pointer-events-none"></div>

            <div className="flex flex-wrap items-center justify-between gap-space-sm relative z-10">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">shield_with_heart</span>
                <span className="font-label-sm text-label-sm tracking-widest text-outline uppercase">Computed Risk Indicator</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-label-sm text-label-sm px-2 py-0.5 rounded-DEFAULT bg-surface-container-high border border-outline-variant/40 text-tertiary font-medium uppercase">
                  {indicatorLabel}
                </span>
                {computedScore != null && (
                  <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-DEFAULT text-on-error-container shadow-[0_0_12px_rgba(147,0,10,0.35)] ${isPartialEvidence ? 'bg-secondary-container/80 text-secondary' : 'bg-error-container/80 text-on-error-container'}`}>
                    <span className="relative flex h-2 w-2">
                      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isPartialEvidence ? 'bg-secondary' : 'bg-error'}`}></span>
                      <span className={`relative inline-flex rounded-full h-2 w-2 ${isPartialEvidence ? 'bg-secondary' : 'bg-error'}`}></span>
                    </span>
                    <span className="font-label-sm text-label-sm tracking-wider font-semibold uppercase">
                      {isPartialEvidence ? `PARTIAL EVIDENCE / ${riskLevel}` : `${riskLevel} [${computedScore}/100]`}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Score Readout Display */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-space-md items-center py-space-sm relative z-10">
              <div className="md:col-span-5 flex flex-col">
                <span className="font-label-sm text-label-sm text-tertiary-fixed-dim uppercase tracking-widest mb-1">
                  PROTOTYPE RISK INDICATOR
                </span>
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-display text-on-surface font-semibold tracking-tighter leading-none">
                    {computedScore != null ? computedScore : '—'}
                  </span>
                  <span className="font-headline-sm text-headline-sm text-outline-variant font-medium">/ 100</span>
                </div>
                <div className="mt-2 flex items-center gap-1.5 text-error">
                  <span className="material-symbols-outlined text-[16px]">trending_up</span>
                  <span className="font-label-sm text-label-sm font-semibold tracking-wide">{scenarioMode ? 'Scenario modifier mode' : 'Based on active change-detection result'}</span>
                </div>
              </div>

              {/* Sparkline Graph */}
              <div className="md:col-span-7 flex flex-col justify-center">
                <div className="relative w-full h-20 bg-surface-container rounded-lg p-3 flex flex-col justify-between overflow-hidden border border-outline-variant/30">
                  <div className="flex items-center justify-between text-label-sm font-label-sm">
                    <span className="text-outline uppercase">Risk Indicator Scale</span>
                    <span className="text-tertiary font-semibold">0–100</span>
                  </div>
                  <svg className="w-full h-8 overflow-visible" fill="none" preserveAspectRatio="none" viewBox="0 0 340 32">
                    <defs>
                      <linearGradient id="hazardGradient" x1="0%" x2="0%" y1="0%" y2="100%">
                        <stop offset="0%" stopColor="#ffb4ab" stopOpacity="0.35"></stop>
                        <stop offset="100%" stopColor="#ffb4ab" stopOpacity="0.0"></stop>
                      </linearGradient>
                    </defs>
                    <path d="M0 24 Q 25 22, 50 25 T 100 20 T 150 21 T 200 13 T 250 15 T 300 7 T 340 4" fill="none" stroke="#ffb4ab" strokeLinecap="round" strokeWidth="2.5"></path>
                    <path d="M0 24 Q 25 22, 50 25 T 100 20 T 150 21 T 200 13 T 250 15 T 300 7 T 340 4 L 340 32 L 0 32 Z" fill="url(#hazardGradient)"></path>
                    <circle className="animate-pulse" cx={computedScore != null ? (computedScore / 100) * 340 : 0} cy={computedScore != null ? 24 - (computedScore/100)*20 : 24} fill="#ffb4ab" r={computedScore != null ? 3.5 : 0}></circle>
                  </svg>
                  <div className="flex items-center justify-between font-label-sm text-[10px] text-outline">
                    <span>LOW ≤ 30</span>
                    <span>WATCH 31–55</span>
                    <span className="text-error font-medium">HIGH 76–100</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-surface-container rounded-lg p-space-md flex flex-col gap-space-xs relative z-10 border border-outline-variant/30">
              <div className="flex items-center gap-2 text-tertiary">
                <span className="material-symbols-outlined text-[16px]">info</span>
                <span className="font-label-sm text-label-sm uppercase tracking-wider font-semibold">
                  Prototype risk indicator • Illustrative heuristic score
                </span>
              </div>
              <p className="font-body-md text-body-md text-on-surface-variant leading-relaxed">
                Prototype decision-support indicator combining observed terrain change, slope susceptibility, and an environmental trigger. This score is not a landslide probability and requires field verification.
              </p>
            </div>
          </article>

          {/* Factor Breakdown Matrix (Interactive Scenario Sliders) */}
          <article className="bg-surface-container-low rounded-xl p-space-lg flex flex-col gap-space-md shadow-lg border border-outline-variant/40">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[18px]">account_tree</span>
                <h2 className="font-headline-sm text-headline-sm font-semibold text-on-surface">Underlying Factor Analysis</h2>
              </div>
              <span className="font-label-sm text-label-sm text-outline uppercase font-semibold">Weighted Sub-Models</span>
            </div>

            <div className="flex items-center justify-between bg-surface-container-high/50 border border-outline-variant/30 rounded-lg p-2.5">
              <div className="flex flex-col gap-0.5">
                <span className="font-label-sm text-label-sm text-on-surface font-semibold uppercase tracking-wide flex items-center gap-2">
                  {scenarioMode ? (
                    <><span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span> SCENARIO / WHAT-IF INPUT</>
                  ) : (
                    'Baseline Data Mode'
                  )}
                </span>
                <span className="font-label-sm text-[10px] text-outline">
                  {scenarioMode
                    ? 'Sliders are active for illustrative what-if analysis.'
                    : 'Observed terrain change is data-driven; other factors use available case inputs.'}
                </span>
              </div>
              <div className="inline-flex items-center gap-1 bg-surface-container-low rounded-md p-1 border border-outline-variant/30">
                <button
                  type="button"
                  onClick={() => setScenarioMode(false)}
                  className={`px-3 py-1.5 rounded-md font-label-sm text-[11px] font-semibold transition-colors ${!scenarioMode
                    ? 'bg-secondary-container text-primary'
                    : 'text-outline hover:text-on-surface'
                    }`}
                >
                  BASELINE
                </button>
                <button
                  type="button"
                  onClick={() => setScenarioMode(true)}
                  className={`px-3 py-1.5 rounded-md font-label-sm text-[11px] font-semibold transition-colors ${scenarioMode
                    ? 'bg-primary text-on-primary'
                    : 'text-outline hover:text-on-surface'
                    }`}
                >
                  SCENARIO
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-space-md pt-2">
              {/* Factor 1 */}
              <div className="bg-surface-container p-space-md rounded-lg flex flex-col gap-space-xs transition hover:bg-surface-container-high border border-outline-variant/30">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                    <span className="font-label-md text-label-md font-semibold text-on-surface uppercase tracking-wide">
                      Terrain Change (Observed • Weight {isPartialEvidence ? '40/70' : '40%'})
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="font-label-lg text-label-lg font-bold text-primary">
                      {terrainChangeScore != null ? terrainChangeScore : '—'}
                    </span>
                    <span className="font-label-sm text-label-sm text-outline">/ 100</span>
                  </div>
                </div>

                <div className="w-full">
                  <div className="h-1.5 rounded bg-surface-container-highest overflow-hidden">
                    <div
                      className="h-full bg-primary rounded"
                      style={{ width: `${terrainChangeScore || 0}%` }}
                    ></div>
                  </div>
                </div>

                <div className="flex items-center justify-between mt-1 text-on-surface-variant font-body-sm text-body-sm gap-3">
                  <span>Observed relative surface change</span>
                  <span className="font-label-sm text-[11px] text-tertiary-fixed-dim whitespace-nowrap">
                    Max Δz: {maxRelativeChange.toFixed(3)} rel. units
                  </span>
                </div>
              </div>

              {/* Factor 2 */}
              <div className="bg-surface-container p-space-md rounded-lg flex flex-col gap-space-xs transition hover:bg-surface-container-high border border-outline-variant/30">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-secondary"></span>
                    <span className="font-label-md text-label-md font-semibold text-on-surface uppercase tracking-wide">
                      Derived Terrain Steepness Indicator (Weight {isPartialEvidence ? '30/70' : '30%'})
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="font-label-lg text-label-lg font-bold text-secondary">{slopeScore != null ? slopeScore : '—'}</span>
                    <span className="font-label-sm text-label-sm text-outline">/ 100</span>
                  </div>
                </div>

                {scenarioMode ? (
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={scenarioSlope}
                    onChange={(e) => setScenarioSlope(Number(e.target.value))}
                    className="w-full accent-[#a2d0c1] bg-surface-container-highest h-1.5 rounded cursor-pointer"
                  />
                ) : (
                  <div className="h-1.5 rounded bg-surface-container-highest overflow-hidden">
                    <div
                      className="h-full bg-secondary rounded"
                      style={{ width: `${slopeScore || 0}%` }}
                    ></div>
                  </div>
                )}

                <div className="flex items-center justify-between mt-1 text-on-surface-variant font-body-sm text-body-sm gap-3">
                  <span>
                    {scenarioMode
                      ? 'Illustrative scenario modifier'
                      : 'Derived terrain steepness · prototype'}
                  </span>
                  <span className="font-label-sm text-label-sm text-tertiary-fixed-dim whitespace-nowrap">
                    {slopeScore != null ? 'Source: active case terrain data' : 'No terrain steepness available'}
                  </span>
                </div>
              </div>

              {/* Factor 3 */}
              <div className="bg-surface-container p-space-md rounded-lg flex flex-col gap-space-xs transition hover:bg-surface-container-high border border-outline-variant/30">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-error"></span>
                    <span className="font-label-md text-label-md font-semibold text-on-surface uppercase tracking-wide">
                      Environmental Trigger (Weight 30%)
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="font-label-lg text-label-lg font-bold text-error">{environmentScore != null ? environmentScore : '—'}</span>
                    <span className="font-label-sm text-label-sm text-outline">/ 100</span>
                    {hasEnv && (
                      <span className="ml-2 font-label-sm text-label-sm font-semibold px-2 py-0.5 rounded-DEFAULT bg-surface-container-highest text-error">
                        {envLabel}
                      </span>
                    )}
                  </div>
                </div>

                {scenarioMode ? (
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={scenarioEnvironment}
                    onChange={(e) => setScenarioEnvironment(Number(e.target.value))}
                    className="w-full accent-[#ffb4ab] bg-surface-container-highest h-1.5 rounded cursor-pointer"
                  />
                ) : (
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={userEnvironmentalInput ?? 50}
                    onChange={(e) => setUserEnvironmentalInput(Number(e.target.value))}
                    className="w-full accent-[#ffb4ab] bg-surface-container-highest h-1.5 rounded cursor-pointer"
                    style={{ opacity: userEnvironmentalInput == null ? 0.3 : 1 }}
                  />
                )}

                <div className="flex items-center justify-between mt-1 text-on-surface-variant font-body-sm text-body-sm gap-3">
                  <span>
                    {scenarioMode
                      ? 'Illustrative scenario modifier'
                      : environmentScore != null ? 'Recent rainfall / environmental condition' : 'No environmental observation supplied'}
                  </span>
                  <span className="font-label-sm text-label-sm text-tertiary-fixed-dim whitespace-nowrap">
                    {scenarioMode
                      ? 'Environmental scenario input'
                      : environmentScore != null ? 'User-supplied environmental observation' : 'User input required'}
                  </span>
                </div>
              </div>
            </div>
          </article>

          {/* Aerial Snapshot Reference */}
          <article className="bg-surface-container-low rounded-xl p-space-md flex flex-col md:flex-row gap-space-md items-center justify-between shadow-sm border border-outline-variant/40">
            <div className="relative w-full md:w-44 h-28 rounded-lg overflow-hidden flex-shrink-0 bg-surface-container flex items-center justify-center">
              {(activeCase?.reconstruction?.source_image || activeCase?.change_outputs?.before?.image || activeCase?.change_outputs?.after?.image) ? (
                <>
                  <img
                    className="w-full h-full object-cover"
                    alt="Technical observation mapping"
                    src={
                      activeCase?.reconstruction?.source_image ||
                      activeCase?.change_outputs?.before?.image ||
                      activeCase?.change_outputs?.after?.image
                    }
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-surface-container-lowest/90 via-transparent to-transparent"></div>
                  <div className="absolute bottom-2 left-2 flex items-center gap-1 font-label-sm text-[10px] text-primary">
                    <span className="material-symbols-outlined text-[12px]">filter_center_focus</span>
                    <span>{activeCase?.selected_region?.label || activeCase?.change_outputs?.changed_regions?.[0]?.label || 'ACTIVE SECTOR'}</span>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center text-outline gap-1">
                  <span className="material-symbols-outlined text-[24px]">satellite_alt</span>
                  <span className="text-[10px] font-label-sm">No Image Loaded</span>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1 w-full">
              <div className="flex items-center gap-2">
                <span className="font-label-sm text-label-sm text-tertiary uppercase">Spatial Displacement Anchor</span>
                <span className="text-outline text-label-sm">•</span>
                <span className="font-label-sm text-label-sm text-outline-variant">
                  {activeCase?.active_case_id ? `Case: ${activeCase.active_case_id}` : 'Pending Observation'}
                </span>
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                {activeCase?.change_outputs
                  ? `Relative displacement differential: ${maxRelativeChange.toFixed(3)} in ${activeCase.selected_region?.label || 'Candidate Zone'}.`
                  : 'Perform temporal change detection or reconstruct terrain in DepthWizard to populate risk metrics.'}
              </p>
            </div>
            <button
              onClick={() => onNavigate('/3d')}
              className="w-full md:w-auto px-4 py-2 rounded-DEFAULT bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-label-sm text-label-sm transition-colors flex items-center justify-center gap-2 shrink-0 border border-outline-variant/30 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">zoom_in</span>
              <span>INSPECT IN 3D</span>
            </button>
          </article>
        </div>

        {/* RIGHT COLUMN (5 Cols) */}
        <div className="xl:col-span-5 flex flex-col gap-space-lg">
          {/* Model Confidence Matrix */}
          <article className="bg-surface-container-low rounded-xl p-space-lg shadow-xl relative overflow-hidden flex flex-col gap-space-md border border-outline-variant/40">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[18px]">verified_user</span>
                <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider font-semibold">MODEL CONFIDENCE</span>
              </div>
              <span className="font-label-sm text-label-sm px-2 py-0.5 rounded-DEFAULT bg-secondary-container text-primary font-medium">
                PROTOTYPE EVALUATION
              </span>
            </div>

            <div className="flex items-center gap-space-lg pt-1">
              <div className="flex flex-col">
                <div className="flex items-baseline">
                  <span className="font-display text-[1.6rem] font-semibold text-primary tracking-tight" title="Confidence not quantified for this prototype">NOT QUANTIFIED</span>
                </div>
                <span className="font-label-sm text-label-sm text-tertiary-fixed-dim uppercase tracking-wider mt-1">Unquantified Prototype</span>
              </div>
              <div className="flex-1 flex flex-col gap-1.5 justify-center border-l border-outline-variant/40 pl-space-md">
                <div className="flex items-center justify-between font-label-sm text-[11px]">
                  <span className="text-outline">Signal Alignment:</span>
                  <span className="text-on-surface font-semibold">Depth Anything V2 Monocular</span>
                </div>
                <div className="flex items-center justify-between font-label-sm text-[11px]">
                  <span className="text-outline">Change Evidence:</span>
                  <span className="text-on-surface font-semibold">Relative Elevation Profile</span>
                </div>
                <div className="flex items-center justify-between font-label-sm text-[11px]">
                  <span className="text-outline">Verification Status:</span>
                  <span className="text-secondary font-semibold">Field Check Advised</span>
                </div>
              </div>
            </div>

            <div className="bg-surface-container rounded-lg p-space-sm flex items-start gap-2 border border-outline-variant/30">
              <span className="material-symbols-outlined text-primary text-[18px] shrink-0 mt-0.5">info</span>
              <p className="font-body-sm text-body-sm text-on-surface-variant leading-snug">
                Confidence is not empirically quantified for this prototype. The risk indicator is heuristic and is not an empirical failure probability.
              </p>
            </div>
          </article>

          {/* Explainability Log ("WHY FLAGGED") */}
          <article className="bg-surface-container-low rounded-xl p-space-lg shadow-xl flex flex-col gap-space-md border border-outline-variant/40">
            <div className="flex items-center justify-between pb-space-xs border-b border-outline-variant/30">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-tertiary text-[20px]">help_center</span>
                <h2 className="font-headline-sm text-headline-sm font-semibold text-on-surface">Explainability Log // Indicator Logic</h2>
              </div>
              <span className="font-label-sm text-label-sm text-outline uppercase font-mono">TRIG_COND: {computedScore != null ? 'EVIDENCE MET' : 'MISSING INPUTS'}</span>
            </div>

            <div className="flex flex-col gap-space-sm pt-space-xs">
              <div className="p-space-md rounded-lg bg-surface-container flex items-start gap-space-sm hover:bg-surface-container-high transition border border-outline-variant/30">
                <div className="w-6 h-6 rounded-DEFAULT bg-primary-container text-on-primary-container flex items-center justify-center shrink-0 mt-0.5">
                  <span className="material-symbols-outlined text-[16px] font-bold">{terrainChangeScore != null ? 'check' : 'warning'}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="font-label-md text-label-md font-semibold text-on-surface tracking-wide">Observed terrain change signal</span>
                  <span className="font-body-sm text-body-sm text-on-surface-variant">{terrainChangeScore != null ? `Max relative terrain difference: ${maxRelativeChange.toFixed(3)} relative units.` : 'No change detection result available.'}</span>
                </div>
              </div>

              <div className="p-space-md rounded-lg bg-surface-container flex items-start gap-space-sm hover:bg-surface-container-high transition border border-outline-variant/30">
                <div className="w-6 h-6 rounded-DEFAULT bg-secondary-container text-secondary flex items-center justify-center shrink-0 mt-0.5">
                  <span className="material-symbols-outlined text-[16px] font-bold">{slopeScore != null ? 'check' : 'warning'}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="font-label-md text-label-md font-semibold text-on-surface tracking-wide">Derived terrain steepness indicator</span>
                  <span className="font-body-sm text-body-sm text-on-surface-variant">{slopeScore != null ? `Calculated from reconstructed terrain gradient: ${slopeScore}/100.` : 'Insufficient terrain surface steepness data.'}</span>
                </div>
              </div>

              <div className="p-space-md rounded-lg bg-surface-container flex items-start gap-space-sm hover:bg-surface-container-high transition border border-outline-variant/30">
                <div className="w-6 h-6 rounded-DEFAULT bg-error-container text-on-error-container flex items-center justify-center shrink-0 mt-0.5">
                  <span className="material-symbols-outlined text-[16px] font-bold">{environmentScore != null ? 'check' : 'info'}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="font-label-md text-label-md font-semibold text-on-surface tracking-wide">{environmentScore != null ? 'Environmental trigger' : 'Environmental trigger unavailable'}</span>
                  <span className="font-body-sm text-body-sm text-on-surface-variant">{environmentScore != null ? `User-supplied environmental observation: ${environmentScore}/100 (${envLabel})` : 'No environmental observation supplied.'}</span>
                </div>
              </div>
            </div>

            <div className="bg-surface-container-lowest p-2.5 rounded-DEFAULT border border-outline-variant/40 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-tertiary text-[18px]">verified</span>
                <span className="font-label-sm text-label-sm text-tertiary font-semibold uppercase">Recommended Next Step:</span>
              </div>
              <span className="font-label-sm text-label-sm text-on-surface">Field verification recommended</span>
            </div>
          </article>

          {/* Primary CTA & Export Rail */}
          <article className="bg-surface-container-low rounded-xl p-space-lg shadow-xl flex flex-col gap-space-md border border-outline-variant/40">
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="font-label-sm text-label-sm text-tertiary-fixed-dim uppercase tracking-wider font-semibold">Tactical Action &amp; Modeling</span>
                <span className="font-label-sm text-[10px] text-tertiary px-2 py-0.5 rounded-DEFAULT bg-surface-container-high border border-outline-variant/40">PROTOTYPE RECON</span>
              </div>
              <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface">Spatial Exploration</h3>
              <p className="font-body-sm text-body-sm text-on-surface-variant">Field verification recommended before operational action.</p>
            </div>

            <div className="flex flex-col gap-space-sm">
              <button
                onClick={() => onNavigate('/simulation')}
                className="w-full h-12 bg-primary hover:bg-primary-fixed-dim text-on-primary font-label-lg text-label-lg font-bold rounded-DEFAULT flex items-center justify-center gap-3 transition-all transform active:scale-[0.99] shadow-[0_0_20px_rgba(126,246,237,0.25)] cursor-pointer"
              >
                <span>PROCEED TO SIMULATION SCENARIO</span>
                <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
              </button>

              <button
                onClick={() => onNavigate('/3d')}
                className="w-full h-11 bg-surface-container-high hover:bg-surface-container-highest text-secondary border border-outline-variant/40 font-label-md text-label-md font-semibold rounded-DEFAULT flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">view_in_ar</span>
                <span>VIEW IN 3D TERRAIN</span>
              </button>

              <button
                onClick={handleExport}
                disabled={exporting}
                className="w-full h-11 bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-label-md rounded-DEFAULT flex items-center justify-center gap-2 transition-colors border border-outline-variant/40 disabled:opacity-80 cursor-pointer"
              >
                {exporting ? (
                  <>
                    <span className="material-symbols-outlined text-[18px] text-primary animate-spin">sync</span>
                    <span className="text-primary font-semibold">Generating GeoJSON Bundle...</span>
                  </>
                ) : exported ? (
                  <>
                    <span className="material-symbols-outlined text-[18px] text-primary">check_circle</span>
                    <span className="text-primary font-semibold">Advisory Package Downloaded</span>
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[18px] text-tertiary">download</span>
                    <span>Export Prototype Brief (GeoJSON / PDF)</span>
                  </>
                )}
              </button>
            </div>

            <div className="flex items-center justify-between pt-space-xs text-outline font-label-sm text-[11px]">
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">verified</span>Status: Field Verification Advised
              </span>
              <span className="flex items-center gap-1 text-tertiary-fixed-dim">
                <span className="material-symbols-outlined text-[14px]">description</span>Prototype Risk Indicator v1
              </span>
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}
