import React, { useState, useEffect } from 'react';
import { useActiveCase } from '../context/ActiveCaseContext';
import { apiUrl } from '../api';

export default function ChangeDetectionPage({ onNavigate }) {
  const {
    activeCase,
    setChangeOutputs,
    setSelectedRegion: setActiveSelectedRegion
  } = useActiveCase();

  const [splitPos, setSplitPos] = useState(50); // Split wipe percentage (0 - 100)
  
  // Observation A (Baseline) and Observation B (Repeat Pass)
  const [beforeObservation, setBeforeObservation] = useState(() => {
    if (activeCase?.reconstruction) {
      const recon = activeCase.reconstruction;
      const srcUrl = recon.source_image || recon.input_image;
      if (srcUrl) {
        return {
          name: recon.metadata?.original_filename || 'Active_DepthWizard_Observation.png',
          size: 'Live Model Input',
          url: srcUrl,
          isFromActiveCase: true,
          caseId: activeCase.active_case_id
        };
      }
    }
    return null;
  });

  const [afterObservation, setAfterObservation] = useState(null);

  // Pipeline execution state
  const [pipelineStage, setPipelineStage] = useState('IDLE');
  const [resultData, setResultData] = useState(activeCase?.change_outputs || null);
  const [errorMessage, setErrorMessage] = useState('');
  const [selectedRegion, setSelectedRegion] = useState(activeCase?.selected_region || null);

  const handleRegionSelect = (region) => {
    setSelectedRegion(region);
    if (setActiveSelectedRegion) {
      setActiveSelectedRegion(region);
    }
  };

  const clearLocalChangeResult = () => {
    setResultData(null);
    setSelectedRegion(null);
    if (setChangeOutputs) {
      setChangeOutputs(null);
    }
  };

  // Sync active live reconstruction if available
  useEffect(() => {
    if (activeCase?.reconstruction && !beforeObservation) {
      const recon = activeCase.reconstruction;
      const srcUrl = recon.source_image || recon.input_image;
      if (srcUrl) {
        setBeforeObservation({
          name: recon.metadata?.original_filename || 'Active_DepthWizard_Observation.png',
          size: 'Live Model Input',
          url: srcUrl,
          isFromActiveCase: true,
          caseId: activeCase.active_case_id
        });
      }
    }
  }, [activeCase]);

  // If activeCase already has valid change outputs, load them
  useEffect(() => {
    if (activeCase?.change_outputs) {
      setResultData(activeCase.change_outputs);
      setPipelineStage('COMPLETE');
      if (activeCase.selected_region) {
        setSelectedRegion(activeCase.selected_region);
      } else if (activeCase.change_outputs.changed_regions?.length > 0) {
        handleRegionSelect(activeCase.change_outputs.changed_regions[0]);
      }
    }
  }, [activeCase?.change_outputs]);

  const handleBeforeFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (beforeObservation?.url && !beforeObservation.isFromActiveCase) {
        URL.revokeObjectURL(beforeObservation.url);
      }
      clearLocalChangeResult();
      setBeforeObservation({
        file,
        name: file.name,
        size: (file.size / (1024 * 1024)).toFixed(1) + ' MB',
        url: URL.createObjectURL(file),
        isFromActiveCase: false
      });
    }
  };

  const handleAfterFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (afterObservation?.url) {
        URL.revokeObjectURL(afterObservation.url);
      }
      clearLocalChangeResult();
      setAfterObservation({
        file,
        name: file.name,
        size: (file.size / (1024 * 1024)).toFixed(1) + ' MB',
        url: URL.createObjectURL(file)
      });
    }
  };

  const handleClearBefore = () => {
    if (beforeObservation?.url && !beforeObservation.isFromActiveCase) {
      URL.revokeObjectURL(beforeObservation.url);
    }
    setBeforeObservation(null);
    clearLocalChangeResult();
  };

  const handleClearAfter = () => {
    if (afterObservation?.url) {
      URL.revokeObjectURL(afterObservation.url);
    }
    setAfterObservation(null);
    clearLocalChangeResult();
  };

  const runAnalysis = async () => {
    if (!beforeObservation || !afterObservation) {
      setErrorMessage('Both a Baseline (Observation A) and Repeat-Pass (Observation B) image are required to run change detection.');
      setPipelineStage('ERROR');
      return;
    }

    try {
      setErrorMessage('');
      setSelectedRegion(null);
      setPipelineStage('ALIGNING OBSERVATIONS');

      const t1 = setTimeout(() => {
        setPipelineStage(prev => (prev === 'ALIGNING OBSERVATIONS' ? 'RECONSTRUCTING / LOADING TERRAIN' : prev));
      }, 400);

      const t2 = setTimeout(() => {
        setPipelineStage(prev => (prev === 'RECONSTRUCTING / LOADING TERRAIN' ? 'COMPARING TERRAIN' : prev));
      }, 900);

      const t3 = setTimeout(() => {
        setPipelineStage(prev => (prev === 'COMPARING TERRAIN' ? 'GENERATING CHANGE MAP' : prev));
      }, 1400);

      const formData = new FormData();
      if (beforeObservation.file) {
        formData.append('before_file', beforeObservation.file);
      } else if (beforeObservation.isFromActiveCase || beforeObservation.caseId) {
        formData.append('before_case_id', beforeObservation.caseId || activeCase.active_case_id);
      }

      if (afterObservation.file) {
        formData.append('after_file', afterObservation.file);
      } else if (afterObservation.caseId) {
        formData.append('after_case_id', afterObservation.caseId);
      }

      const response = await fetch(apiUrl('/api/change/analyze'), {
        method: 'POST',
        body: formData
      });

      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({ detail: 'Comparison failed' }));
        throw new Error(errJson.detail || `Server error: ${response.status}`);
      }

      const data = await response.json();
      setPipelineStage('GENERATING CHANGE MAP');
      
      setTimeout(() => {
        setResultData(data);
        setPipelineStage('COMPLETE');
        if (data.changed_regions && data.changed_regions.length > 0) {
          handleRegionSelect(data.changed_regions[0]);
        } else {
          setSelectedRegion(null);
          if (setActiveSelectedRegion) {
            setActiveSelectedRegion(null);
          }
        }

        if (setChangeOutputs) {
          setChangeOutputs(data);
        }
      }, 350);

    } catch (err) {
      console.error('Change analysis failed:', err);
      setErrorMessage(err.message || 'Comparison failed');
      setPipelineStage('ERROR');
    }
  };

  const isBusy = pipelineStage !== 'IDLE' && pipelineStage !== 'COMPLETE' && pipelineStage !== 'ERROR';
  const canRun = Boolean(beforeObservation && afterObservation && !isBusy);


  // Candidate-zone display filter: only show meaningful extracted regions.
  // This affects visualization only; backend analysis values remain unchanged.
  const allChangedRegions = Array.isArray(resultData?.changed_regions)
    ? resultData.changed_regions
    : [];

  const MIN_DISPLAY_AREA_FRACTION = 0.005; // 0.5% of sector; lower this to show smaller candidate regions.

  const meaningfulRegions = allChangedRegions.filter((reg) => {
    const areaFraction = Number(reg?.area_fraction ?? 0);
    const bbox = reg?.bbox_pct;
    return (
      areaFraction >= MIN_DISPLAY_AREA_FRACTION &&
      bbox &&
      Number.isFinite(Number(bbox.top)) &&
      Number.isFinite(Number(bbox.left)) &&
      Number.isFinite(Number(bbox.width)) &&
      Number.isFinite(Number(bbox.height)) &&
      Number(bbox.width) > 0 &&
      Number(bbox.height) > 0
    );
  });

  // If all extracted regions are tiny/noisy, keep only the largest one
  // rather than cluttering the inspection canvas with insignificant zones.
  const displayRegions = meaningfulRegions.length > 0
    ? meaningfulRegions
    : allChangedRegions
        .filter((reg) => reg?.bbox_pct)
        .slice()
        .sort((a, b) => Number(b?.area_fraction ?? 0) - Number(a?.area_fraction ?? 0))
        .slice(0, 1);

  // Keep the current selection valid when a tiny/noisy region is filtered
  // out of the visible inspection set.
  useEffect(() => {
    if (!selectedRegion || displayRegions.length === 0) return;
    const stillVisible = displayRegions.some((reg) => reg.id === selectedRegion.id);
    if (!stillVisible) {
      handleRegionSelect(displayRegions[0]);
    }
  }, [resultData?.case_id, resultData?.changed_regions, selectedRegion?.id]);

  // Navigate to 3D surface viewer with selected region state
  const handleViewIn3D = (region) => {
    const regToSave =
      region ||
      selectedRegion ||
      (displayRegions.length > 0 ? displayRegions[0] : null);

    if (regToSave) {
      handleRegionSelect(regToSave);
      try {
        localStorage.setItem(
          'slopesentinel_selected_change_region',
          JSON.stringify({
            case_id: resultData?.case_id || 'custom_change',
            region_id: regToSave.id,
            label: regToSave.label,
            classification: regToSave.classification,
            relative_change: regToSave.relative_change,
            observation_interval: regToSave.observation_interval,
            bbox_pct: regToSave.bbox_pct
          })
        );
      } catch (e) {
        console.warn('Could not persist region to localStorage:', e);
      }
    }

    onNavigate('/3d');
  };

  // Navigate to Risk Intelligence with guaranteed selected region state
  const handleProceedToRisk = () => {
    const regToSave =
      selectedRegion ||
      activeCase?.selected_region ||
      (displayRegions.length > 0 ? displayRegions[0] : null);

    if (regToSave && setActiveSelectedRegion) {
      setActiveSelectedRegion(regToSave);
    }

    onNavigate('/risk');
  };

  return (
    <div className="flex flex-col w-full px-space-lg py-space-md space-y-space-lg">
      {/* Tactical Header Block */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-space-md bg-surface-container-low p-space-md rounded-DEFAULT shadow-md border border-outline-variant/40">
        <div className="space-y-space-xs">
          <div className="flex items-center gap-space-xs">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
            <span className="font-label-sm text-label-sm text-tertiary uppercase tracking-widest">
              MODULE 03 // DIFFERENTIAL ELEVATION ANALYTICS (Δz)
            </span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight font-semibold">
            Temporal Terrain Change Detection
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant">
            Upload multi-epoch terrain observations to compute differential relief (Δz) through DepthWizard and identify contiguous candidate change zones.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-space-sm bg-surface-container-lowest p-1.5 rounded-DEFAULT border border-outline-variant/30">
          <div className="flex items-center gap-2">
            <div className="px-3 py-1.5 rounded-DEFAULT bg-surface-container-high text-left">
              <span className="font-label-sm text-[10px] text-outline block leading-none mb-1">OBS A (BASE)</span>
              <span className="font-label-md text-label-md text-secondary font-semibold truncate max-w-[130px] block">
                {beforeObservation ? beforeObservation.name : 'NONE LOADED'}
              </span>
            </div>
            <div className="flex items-center text-outline-variant px-0.5">
              <span className="material-symbols-outlined text-[16px]">compare_arrows</span>
            </div>
            <div className="px-3 py-1.5 rounded-DEFAULT bg-surface-container-high text-left">
              <span className="font-label-sm text-[10px] text-error block leading-none mb-1">OBS B (REPEAT)</span>
              <span className="font-label-md text-label-md text-error font-semibold truncate max-w-[130px] block">
                {afterObservation ? afterObservation.name : 'NONE LOADED'}
              </span>
            </div>
          </div>

          {/* Run Change Analysis Button */}
          <button 
            onClick={runAnalysis}
            disabled={!canRun}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-DEFAULT font-label-md text-label-md tracking-wider font-semibold transition-all cursor-pointer ${
              canRun
                ? 'bg-primary text-on-primary shadow-[0_0_14px_rgba(126,246,237,0.3)] hover:bg-primary-container'
                : 'bg-surface-container-high text-outline cursor-not-allowed opacity-70'
            }`}
          >
            <span className={`material-symbols-outlined text-[18px] ${isBusy ? 'animate-spin' : ''}`}>
              {isBusy ? 'sync' : 'refresh'}
            </span>
            <span>
              {pipelineStage === 'ALIGNING OBSERVATIONS' && '1/4 ALIGNING...'}
              {pipelineStage === 'RECONSTRUCTING / LOADING TERRAIN' && '2/4 RECONSTRUCTING...'}
              {pipelineStage === 'COMPARING TERRAIN' && '3/4 COMPARING Δz...'}
              {pipelineStage === 'GENERATING CHANGE MAP' && '4/4 GENERATING MAP...'}
              {pipelineStage === 'COMPLETE' && 'RE-RUN CHANGE ANALYSIS'}
              {pipelineStage === 'IDLE' && (canRun ? 'RUN CHANGE ANALYSIS' : 'AWAITING 2 IMAGES')}
              {pipelineStage === 'ERROR' && 'RETRY ANALYSIS'}
            </span>
          </button>
        </div>
      </div>

      {/* Mandatory Scientific Disclaimer Banner */}
      <div className="bg-surface-container-lowest/80 border border-outline-variant/40 rounded-xl p-space-sm flex items-start gap-space-sm shadow-sm">
        <span className="material-symbols-outlined text-primary text-[20px] mt-0.5">verified_user</span>
        <div className="flex flex-col gap-0.5 text-on-surface">
          <span className="font-label-sm text-[11px] font-semibold text-primary uppercase tracking-wider">
            SCIENTIFIC CLASSIFICATION DISCLOSURE
          </span>
          <p className="font-body-sm text-body-sm text-on-surface-variant italic">
            "Relative terrain difference detected. Change extent and boundaries represent potential surface change and require field verification. Not a definitive landslide classification."
          </p>
        </div>
      </div>

      {/* Error Alert Box */}
      {pipelineStage === 'ERROR' && (
        <div className="p-4 rounded-xl bg-error-container/20 border border-error/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-md">
          <div className="flex items-start gap-2.5">
            <span className="material-symbols-outlined text-error text-[22px] mt-0.5">error</span>
            <div className="flex flex-col gap-0.5">
              <span className="font-label-md text-label-md text-error font-semibold uppercase">Temporal Analysis Failed</span>
              <span className="font-body-sm text-body-sm text-on-surface-variant">{errorMessage}</span>
            </div>
          </div>
        </div>
      )}

      {/* TOP SECTION: Two Split Technical Upload Panels (Before & After) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-space-md">
        {/* Panel 1: Observation A (Baseline) */}
        <div className="relative bg-surface-container-low rounded-DEFAULT p-space-md flex flex-col space-y-space-sm group shadow-sm border border-outline-variant/40">
          <div className="flex items-center justify-between pb-space-xs border-b border-outline-variant/30 flex-wrap gap-2">
            <div className="flex items-center gap-space-xs">
              <span className="material-symbols-outlined text-[18px] text-secondary">verified_user</span>
              <span className="font-label-md text-label-md text-on-surface uppercase tracking-wider font-semibold">
                Observation A (Baseline Image)
              </span>
            </div>
            <div className="flex items-center gap-2">
              <label className="cursor-pointer inline-flex items-center gap-1 font-label-sm text-[10px] text-primary bg-secondary-container/60 hover:bg-secondary-container px-2.5 py-1 rounded transition-colors font-medium">
                <span className="material-symbols-outlined text-[13px]">upload_file</span>
                <span>{beforeObservation ? 'Change File' : 'Upload Baseline'}</span>
                <input type="file" accept="image/*,.tif,.tiff" onChange={handleBeforeFileChange} className="hidden" />
              </label>
              {beforeObservation && (
                <button
                  onClick={handleClearBefore}
                  title="Clear baseline observation"
                  className="px-2 py-0.5 rounded bg-surface-container-high hover:bg-error/20 hover:text-error text-[10px] font-label-sm text-on-surface-variant transition-colors cursor-pointer"
                >
                  Clear
                </button>
              )}
              <span className="px-2 py-0.5 rounded-DEFAULT bg-secondary-container/60 text-secondary font-label-sm text-label-sm font-medium">
                {beforeObservation?.isFromActiveCase ? 'ACTIVE RECONSTRUCTION' : beforeObservation ? 'BASELINE LOADED' : 'AWAITING BASELINE'}
              </span>
            </div>
          </div>

          <div className="relative w-full h-64 overflow-hidden rounded-DEFAULT bg-surface-container-lowest flex items-center justify-center border border-outline-variant/30">
            {beforeObservation ? (
              <>
                <img 
                  className="w-full h-full object-cover filter contrast-105 brightness-90 group-hover:scale-[1.01] transition-transform duration-500" 
                  alt="Baseline terrain observation" 
                  src={beforeObservation.url}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-surface-container-lowest/80 via-transparent to-transparent pointer-events-none"></div>
                <div className="absolute top-2 left-2 px-2 py-1 bg-surface-container-lowest/90 backdrop-blur-sm rounded-DEFAULT font-label-sm text-label-sm text-tertiary font-mono">
                  FILE: {beforeObservation.name} ({beforeObservation.size})
                </div>
                <div className="absolute bottom-2 right-2 px-2 py-1 bg-surface-container-lowest/90 backdrop-blur-sm rounded-DEFAULT font-label-sm text-label-sm text-secondary font-medium">
                  {beforeObservation.isFromActiveCase ? 'FROM DEPTHWIZARD PIPELINE' : 'USER UPLOADED BASELINE'}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center p-6 text-center space-y-2">
                <span className="material-symbols-outlined text-outline text-[42px]">add_photo_alternate</span>
                <span className="font-label-md text-label-md text-on-surface font-semibold">
                  No Baseline Observation Loaded
                </span>
                <p className="font-body-sm text-body-sm text-on-surface-variant max-w-sm">
                  Upload an initial sector aerial or satellite orthophoto to serve as the baseline terrain reference.
                </p>
                <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-DEFAULT bg-secondary-container text-primary font-label-sm text-label-sm font-semibold shadow hover:bg-secondary-container/80 transition-all mt-1">
                  <span className="material-symbols-outlined text-[16px]">upload_file</span>
                  <span>Select Baseline Image</span>
                  <input type="file" accept="image/*,.tif,.tiff" onChange={handleBeforeFileChange} className="hidden" />
                </label>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-space-xs pt-1">
            <div className="bg-surface-container-high p-2 rounded-DEFAULT">
              <span className="font-label-sm text-[10px] text-outline block">OBSERVATION TYPE</span>
              <span className="font-label-sm text-label-sm text-on-surface font-semibold truncate block">
                {beforeObservation ? (beforeObservation.isFromActiveCase ? 'DepthWizard Active' : 'User Upload') : '—'}
              </span>
            </div>
            <div className="bg-surface-container-high p-2 rounded-DEFAULT">
              <span className="font-label-sm text-[10px] text-outline block">SURFACE CONDITIONS</span>
              <span className="font-label-sm text-label-sm text-secondary font-semibold truncate block">
                {beforeObservation ? 'Baseline Epoch' : '—'}
              </span>
            </div>
            <div className="bg-surface-container-high p-2 rounded-DEFAULT">
              <span className="font-label-sm text-[10px] text-outline block">DEPTHWIZARD STATUS</span>
              <span className="font-label-sm text-label-sm text-primary font-semibold truncate block">
                {beforeObservation ? 'Ready for DSM' : 'Awaiting Input'}
              </span>
            </div>
          </div>
        </div>

        {/* Panel 2: Observation B (Repeat Pass) */}
        <div className="relative bg-surface-container-low rounded-DEFAULT p-space-md flex flex-col space-y-space-sm group shadow-sm border border-outline-variant/40">
          <div className="flex items-center justify-between pb-space-xs border-b border-outline-variant/30 flex-wrap gap-2">
            <div className="flex items-center gap-space-xs">
              <span className={`material-symbols-outlined text-[18px] ${
                resultData?.overall_classification === 'SIGNIFICANT CHANGE' ? 'text-error' : 'text-tertiary'
              }`}>
                {resultData?.overall_classification === 'SIGNIFICANT CHANGE' ? 'warning' : 'history_toggle_off'}
              </span>
              <span className={`font-label-md text-label-md uppercase tracking-wider font-semibold ${
                resultData?.overall_classification === 'SIGNIFICANT CHANGE' ? 'text-error' : 'text-on-surface'
              }`}>
                Observation B (Repeat-Pass Image)
              </span>
            </div>
            <div className="flex items-center gap-2">
              <label className="cursor-pointer inline-flex items-center gap-1 font-label-sm text-[10px] text-error bg-error-container/60 hover:bg-error-container px-2.5 py-1 rounded transition-colors font-medium">
                <span className="material-symbols-outlined text-[13px]">upload_file</span>
                <span>{afterObservation ? 'Change File' : 'Upload Repeat Pass'}</span>
                <input type="file" accept="image/*,.tif,.tiff" onChange={handleAfterFileChange} className="hidden" />
              </label>
              {afterObservation && (
                <button
                  onClick={handleClearAfter}
                  title="Clear repeat observation"
                  className="px-2 py-0.5 rounded bg-surface-container-high hover:bg-error/20 hover:text-error text-[10px] font-label-sm text-on-surface-variant transition-colors cursor-pointer"
                >
                  Clear
                </button>
              )}
              <span className={`px-2 py-0.5 rounded-DEFAULT font-label-sm text-label-sm font-medium ${
                afterObservation ? 'bg-error-container text-on-error-container' : 'bg-surface-container-high text-outline'
              }`}>
                {afterObservation ? 'REPEAT PASS LOADED' : 'AWAITING REPEAT'}
              </span>
            </div>
          </div>

          <div className="relative w-full h-64 overflow-hidden rounded-DEFAULT bg-surface-container-lowest flex items-center justify-center border border-outline-variant/30">
            {afterObservation ? (
              <>
                <img 
                  className="w-full h-full object-cover filter contrast-110 group-hover:scale-[1.01] transition-transform duration-500" 
                  alt="Repeat terrain observation" 
                  src={afterObservation.url}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-surface-container-lowest/80 via-transparent to-transparent pointer-events-none"></div>
                <div className="absolute top-2 left-2 px-2 py-1 bg-surface-container-lowest/90 backdrop-blur-sm rounded-DEFAULT font-label-sm text-label-sm text-error font-mono">
                  FILE: {afterObservation.name} ({afterObservation.size})
                </div>
                <div className="absolute bottom-2 right-2 px-2 py-1 bg-surface-container-lowest/90 backdrop-blur-sm rounded-DEFAULT font-label-sm text-label-sm text-error font-semibold">
                  {resultData ? (resultData.overall_classification || 'SURFACE COMPARED') : 'READY FOR COMPARISON'}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center p-6 text-center space-y-2">
                <span className="material-symbols-outlined text-outline text-[42px]">add_photo_alternate</span>
                <span className="font-label-md text-label-md text-on-surface font-semibold">
                  No Repeat Observation Loaded
                </span>
                <p className="font-body-sm text-body-sm text-on-surface-variant max-w-sm">
                  Upload a second temporal image from the same sector to compute differential surface changes.
                </p>
                <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-DEFAULT bg-error-container text-on-error-container font-label-sm text-label-sm font-semibold shadow hover:bg-error-container/80 transition-all mt-1">
                  <span className="material-symbols-outlined text-[16px]">upload_file</span>
                  <span>Select Repeat Pass Image</span>
                  <input type="file" accept="image/*,.tif,.tiff" onChange={handleAfterFileChange} className="hidden" />
                </label>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-space-xs pt-1">
            <div className="bg-surface-container-high p-2 rounded-DEFAULT">
              <span className="font-label-sm text-[10px] text-outline block">SURFACE STATUS</span>
              <span className={`font-label-sm text-label-sm font-semibold truncate block ${
                resultData?.overall_classification === 'SIGNIFICANT CHANGE' ? 'text-error' : 'text-on-surface'
              }`}>
                {resultData ? resultData.overall_classification : afterObservation ? 'Ready to compare' : '—'}
              </span>
            </div>
            <div className="bg-surface-container-high p-2 rounded-DEFAULT">
              <span className="font-label-sm text-[10px] text-outline block">SURFACE CONDITIONS</span>
              <span className="font-label-sm text-label-sm text-tertiary font-semibold truncate block">
                {afterObservation ? 'Repeat Field Pass' : '—'}
              </span>
            </div>
            <div className="bg-surface-container-high p-2 rounded-DEFAULT">
              <span className="font-label-sm text-[10px] text-outline block">CONFIDENCE METRIC</span>
              <span className="font-label-sm text-label-sm text-tertiary font-semibold block" title="Confidence not quantified for this prototype">
                null (Prototype)
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* MIDDLE SECTION: Differential Elevation (Δz) Map with Split Wipe Slider */}
      <div className="bg-surface-container-low rounded-DEFAULT p-space-md space-y-space-md shadow-md border border-outline-variant/40">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-space-sm pb-space-xs border-b border-outline-variant/30">
          <div className="flex items-center gap-space-sm">
            <span className="material-symbols-outlined text-primary text-[22px]">difference</span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                  Differential Elevation Analysis (Δz Raster Canvas)
                </h2>
                <span className="px-2 py-0.5 rounded-DEFAULT bg-surface-container-high font-label-sm text-label-sm text-tertiary font-medium">
                  {resultData ? 'ANALYZED TEMPORAL PAIR' : 'AWAITING ANALYSIS'}
                </span>
              </div>
              <span className="font-label-sm text-label-sm text-outline">
                {resultData ? 'Drag the interactive comparison slider to inspect terrain shift between baseline and repeat-pass.' : 'Upload both observations and run analysis to render the differential elevation map.'}
              </span>
            </div>
          </div>

          {/* Color Legend */}
          <div className="flex items-center flex-wrap gap-4 bg-surface-container-high px-3 py-1.5 rounded-DEFAULT border border-outline-variant/30">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-DEFAULT bg-[#0e3830] border border-secondary/40"></span>
              <span className="font-label-sm text-label-sm text-on-surface-variant">Stable (&lt;0.08)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-DEFAULT bg-[#FF7652]"></span>
              <span className="font-label-sm text-label-sm text-on-surface-variant">Changed (0.08 - 0.20)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-DEFAULT bg-error animate-pulse"></span>
              <span className="font-label-sm text-label-sm text-on-surface font-semibold">
                Significant Change (&ge;0.20)
              </span>
            </div>
          </div>
        </div>

        {/* Raster Canvas Container */}
        <div className="relative w-full h-[460px] rounded-DEFAULT overflow-hidden select-none bg-surface-container-lowest border border-outline-variant/40 flex items-center justify-center">
          {!resultData ? (
            <div className="flex flex-col items-center justify-center p-8 text-center space-y-3 z-10">
              <div className="w-16 h-16 rounded-full bg-surface-container-high flex items-center justify-center text-primary shadow-inner mb-1">
                <span className="material-symbols-outlined text-[36px]">layers_clear</span>
              </div>
              <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold tracking-wide">
                NO OBSERVATION PAIR LOADED
              </h3>
              <p className="font-body-md text-body-md text-on-surface-variant max-w-lg">
                Upload a baseline and repeat-pass image from the same sector to perform temporal terrain comparison.
              </p>
              {(!beforeObservation || !afterObservation) && (
                <div className="flex items-center gap-2 pt-2">
                  <span className="font-label-sm text-label-sm text-outline">Prerequisites:</span>
                  <span className={`px-2 py-0.5 rounded text-[11px] font-label-sm font-semibold ${beforeObservation ? 'bg-secondary-container text-secondary' : 'bg-surface-container-high text-outline'}`}>
                    {beforeObservation ? '✓ Observation A Ready' : '✗ Observation A Required'}
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[11px] font-label-sm font-semibold ${afterObservation ? 'bg-error-container text-error' : 'bg-surface-container-high text-outline'}`}>
                    {afterObservation ? '✓ Observation B Ready' : '✗ Observation B Required'}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Base Layer: Baseline Observation (Before) */}
              <div className="absolute inset-0 w-full h-full">
                <img 
                  className="w-full h-full object-cover filter brightness-95" 
                  alt="Baseline terrain raster" 
                  src={resultData.before?.image || beforeObservation?.url}
                />
                <div className="absolute inset-0 bg-secondary-container/10 mix-blend-multiply"></div>
              </div>

              {/* Layer 2: Repeat Pass + Change Map Overlay (Clipped dynamically by slider position) */}
              <div 
                className="absolute inset-y-0 left-0 overflow-hidden" 
                style={{ width: `${splitPos}%` }}
              >
                <div className="w-[1200px] xl:w-[1500px] h-full relative">
                  {/* After image base */}
                  <img 
                    className="w-full h-full object-cover filter contrast-110" 
                    alt="Repeat observation with change raster" 
                    src={resultData.after?.image || afterObservation?.url}
                  />

                  {/* Change raster heatmap overlay */}
                  {resultData.change_map && (
                    <img
                      src={resultData.change_map}
                      alt="Differential Elevation Raster"
                      className="absolute inset-0 w-full h-full object-cover opacity-65 mix-blend-overlay pointer-events-none"
                    />
                  )}

                  {/* Contiguous Changed Region Markers */}
                  {displayRegions.map((reg, idx) => {
                    const isSelected = selectedRegion?.id === reg.id;
                    const centerY = reg.bbox_pct.top + (reg.bbox_pct.height / 2);
                    const centerX = reg.bbox_pct.left + (reg.bbox_pct.width / 2);
                    
                    // Simple offset logic based on index to prevent label overlap
                    const offset = [
                      { dx: 48, dy: -48, anchor: 'bottom-left' }, // Top-Right
                      { dx: -48, dy: -48, anchor: 'bottom-right' }, // Top-Left
                      { dx: 48, dy: 48, anchor: 'top-left' }, // Bottom-Right
                      { dx: -48, dy: 48, anchor: 'top-right' }, // Bottom-Left
                    ][idx % 4];

                    return (
                      <div 
                        key={reg.id}
                        style={{
                          top: `${centerY}%`,
                          left: `${centerX}%`,
                        }}
                        className={`absolute ${isSelected ? 'z-30' : 'z-20'} pointer-events-none flex items-center justify-center`}
                      >
                        {/* Anchor Dot */}
                        <div className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-primary ring-2 ring-primary/40' : 'bg-outline'}`}></div>

                        {/* Leader Line */}
                        <svg className="absolute overflow-visible pointer-events-none" style={{ top: 0, left: 0 }}>
                          <line 
                            x1="0" y1="0" 
                            x2={offset.dx} y2={offset.dy} 
                            stroke={isSelected ? '#7ef6ed' : '#737373'} 
                            strokeWidth={isSelected ? "1.5" : "1"} 
                            opacity={isSelected ? "0.9" : "0.5"} 
                          />
                        </svg>

                        {/* Interactive Label */}
                        <div 
                          onClick={() => handleRegionSelect(reg)}
                          style={{
                            top: `${offset.dy}px`,
                            left: `${offset.dx}px`,
                            transform: offset.anchor === 'bottom-left' ? 'translate(0, -100%)' :
                                       offset.anchor === 'bottom-right' ? 'translate(-100%, -100%)' :
                                       offset.anchor === 'top-left' ? 'translate(0, 0)' :
                                       'translate(-100%, 0)'
                          }}
                          className={`absolute px-2.5 py-1.5 rounded pointer-events-auto cursor-pointer whitespace-nowrap transition-all shadow-md backdrop-blur-sm border ${
                            isSelected 
                              ? 'bg-surface-container-lowest/95 border-primary ring-1 ring-primary/40 shadow-[0_0_12px_rgba(126,246,237,0.2)]'
                              : 'bg-surface-container-lowest/80 border-outline-variant/40 hover:bg-surface-container-lowest/95'
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className={`font-label-sm text-[10px] font-bold ${isSelected ? 'text-primary' : 'text-on-surface-variant'}`}>
                              {reg.label.toUpperCase()}
                            </span>
                            <span className="text-outline-variant text-[10px] font-bold">·</span>
                            <span className={`font-label-sm text-[10px] font-semibold ${
                              reg.classification === 'SIGNIFICANT CHANGE' 
                                ? (isSelected ? 'text-error' : 'text-error/80') 
                                : (isSelected ? 'text-on-surface' : 'text-on-surface-variant')
                            }`}>
                              {reg.classification}
                            </span>
                            <span className="text-outline-variant text-[10px] font-bold">·</span>
                            <span className={`font-label-sm text-[10px] font-mono ${isSelected ? 'text-primary' : 'text-outline'}`}>
                              Δz {reg.relative_change != null ? reg.relative_change : 'N/A'}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Wipe Divider Line & Handle */}
              <div 
                className="absolute top-0 bottom-0 w-0.5 bg-primary cursor-ew-resize flex items-center justify-center pointer-events-none z-20" 
                style={{ left: `${splitPos}%` }}
              >
                <div className="w-8 h-8 rounded-full bg-surface-container-lowest border-2 border-primary flex items-center justify-center shadow-[0_0_14px_rgba(126,246,237,0.5)]">
                  <span className="material-symbols-outlined text-primary text-[16px]">drag_indicator</span>
                </div>
              </div>

              {/* Spatial Coordinates Stamp */}
              <div className="absolute bottom-3 left-3 flex items-center gap-2 bg-surface-container-lowest/80 backdrop-blur-md px-2.5 py-1 rounded-DEFAULT font-label-sm text-label-sm text-outline border border-outline-variant/30">
                <span className="material-symbols-outlined text-[14px] text-primary">my_location</span>
                <span>SECTOR: {resultData.sector || 'CUSTOM UPLOAD'}</span>
                <span className="text-outline-variant">|</span>
                <span>INTERVAL: {resultData.observation_interval || 'TEMPORAL OBSERVATION'}</span>
              </div>

              {/* Live Split Badge */}
              <div className="absolute top-3 right-3 flex items-center gap-2 bg-surface-container-lowest/90 backdrop-blur-md px-3 py-1.5 rounded-DEFAULT border border-outline-variant/30">
                <span className="font-label-sm text-label-sm text-secondary font-medium">BEFORE ({splitPos}%)</span>
                <span className="font-label-sm text-label-sm text-outline">◂ WIPE SLIDER ▸</span>
                <span className="font-label-sm text-label-sm text-error font-semibold">AFTER / Δz ({100 - splitPos}%)</span>
              </div>
            </>
          )}
        </div>

        {/* Scrubber & Slider Controls */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-space-sm bg-surface-container-lowest p-space-sm rounded-DEFAULT border border-outline-variant/30">
          <div className="flex items-center gap-space-sm w-full sm:w-auto">
            <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider font-semibold">COMPARE SLIDER:</span>
            <div className="flex items-center gap-2 text-on-surface font-label-sm text-label-sm">
              <button 
                onClick={() => setSplitPos(0)}
                disabled={!resultData}
                className={`px-2.5 py-1 rounded-DEFAULT transition-colors cursor-pointer disabled:opacity-50 ${
                  splitPos === 0 ? 'bg-secondary-container text-primary font-semibold' : 'bg-surface-container-high hover:bg-surface-container'
                }`}
              >
                Baseline 100%
              </button>
              <button 
                onClick={() => setSplitPos(50)}
                disabled={!resultData}
                className={`px-2.5 py-1 rounded-DEFAULT transition-colors cursor-pointer disabled:opacity-50 ${
                  splitPos === 50 ? 'bg-secondary-container text-primary font-semibold' : 'bg-surface-container-high hover:bg-surface-container'
                }`}
              >
                Split 50/50
              </button>
              <button 
                onClick={() => setSplitPos(100)}
                disabled={!resultData}
                className={`px-2.5 py-1 rounded-DEFAULT transition-colors cursor-pointer disabled:opacity-50 ${
                  splitPos === 100 ? 'bg-secondary-container text-primary font-semibold' : 'bg-surface-container-high hover:bg-surface-container'
                }`}
              >
                Repeat Pass 100%
              </button>
            </div>
          </div>

          <div className="flex items-center gap-space-sm w-full sm:w-80">
            <span className="font-label-sm text-label-sm text-secondary whitespace-nowrap">Before</span>
            <input 
              type="range"
              min="0"
              max="100"
              value={splitPos}
              disabled={!resultData}
              onChange={(e) => setSplitPos(Number(e.target.value))}
              className="w-full accent-[#7ef6ed] bg-surface-container-high h-1.5 rounded-DEFAULT cursor-ew-resize appearance-none disabled:opacity-50" 
            />
            <span className="font-label-sm text-label-sm text-error whitespace-nowrap">After (Δz)</span>
          </div>
        </div>
      </div>

      {/* BOTTOM SECTION: Results Summary Card & Region Inspector Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-md">
        {/* Results Metric Card (8 Columns) */}
        <div className="lg:col-span-8 bg-surface-container-low rounded-DEFAULT p-space-md flex flex-col justify-between space-y-space-md shadow-sm border border-outline-variant/40">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-space-sm pb-space-xs border-b border-outline-variant/30 mb-space-md">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`px-2.5 py-1 rounded-DEFAULT font-label-md text-label-md font-bold tracking-wide flex items-center gap-1.5 shadow-sm ${
                  resultData?.overall_classification === 'SIGNIFICANT CHANGE'
                    ? 'bg-error-container text-on-error-container'
                    : resultData?.overall_classification === 'POTENTIAL TERRAIN CHANGE'
                    ? 'bg-tertiary-container/60 text-tertiary'
                    : 'bg-secondary-container/60 text-secondary'
                }`}>
                  <span className={`w-2 h-2 rounded-full ${
                    resultData?.overall_classification === 'SIGNIFICANT CHANGE' ? 'bg-error' : 'bg-secondary'
                  }`}></span>
                  POTENTIAL CHANGE: {resultData?.overall_classification || 'AWAITING OBSERVATIONS'}
                </span>
                <span className="px-2 py-1 rounded-DEFAULT bg-surface-container-high font-label-sm text-label-sm text-tertiary" title="Change confidence not quantified for this prototype">
                  CHANGE CONFIDENCE: NULL (NOT QUANTIFIED)
                </span>
              </div>
              <span className="font-label-sm text-[11px] text-outline font-mono">
                DIFFERENTIAL ID: {resultData?.case_id?.toUpperCase() || 'NONE'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-space-sm">
              <div className="bg-surface-container-lowest p-space-sm rounded-DEFAULT border border-outline-variant/30">
                <span className="font-label-sm text-label-sm text-outline block mb-1">PRIMARY CANDIDATE ZONE</span>
                <span className="font-label-lg text-label-lg text-on-surface font-semibold block">
                  {selectedRegion ? selectedRegion.label : resultData?.summary?.largest_change_region?.toUpperCase() || (resultData ? 'No Significant Cluster' : '—')}
                </span>
                <span className="font-label-sm text-[11px] text-tertiary-fixed-dim">
                  {resultData?.location || 'Awaiting Analysis'}
                </span>
              </div>

              <div className="bg-surface-container-lowest p-space-sm rounded-DEFAULT border border-outline-variant/30">
                <span className="font-label-sm text-label-sm text-outline block mb-1">MAX RELATIVE DIFFERENCE</span>
                <div className="flex items-baseline gap-1">
                  <span className="font-headline-sm text-headline-sm text-error font-bold">
                    {resultData?.summary?.max_relative_difference != null ? resultData.summary.max_relative_difference : '—'}
                  </span>
                  {resultData?.summary?.max_relative_difference != null && (
                    <span className="font-label-sm text-label-sm text-error">rel. units</span>
                  )}
                </div>
                <span className="font-label-sm text-[11px] text-error">
                  {resultData ? 'Relative terrain difference' : '—'}
                </span>
              </div>

              <div className="bg-surface-container-lowest p-space-sm rounded-DEFAULT border border-outline-variant/30">
                <span className="font-label-sm text-label-sm text-outline block mb-1">AFFECTED AREA FRACTION</span>
                <div className="flex items-baseline gap-1">
                  <span className="font-headline-sm text-headline-sm text-on-surface font-bold">
                    {resultData?.summary?.change_fraction != null ? `${(resultData.summary.change_fraction * 100).toFixed(1)}%` : '—'}
                  </span>
                </div>
                <span className="font-label-sm text-[11px] text-outline">
                  {resultData?.summary?.significant_fraction != null ? `Significant: ${(resultData.summary.significant_fraction * 100).toFixed(1)}%` : '—'}
                </span>
              </div>
            </div>

            <div className="mt-space-sm bg-surface-container-high/60 border border-outline-variant/40 rounded-DEFAULT p-space-sm flex flex-col md:flex-row md:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary text-[18px]">verified</span>
                <span className="font-label-sm text-label-sm text-on-surface font-semibold uppercase tracking-wide">
                  DepthWizard Evidence Quality:
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-space-md font-label-sm text-label-sm">
                <span className="text-on-surface-variant">
                  Image Quality: <strong className="text-primary">NOT QUANTIFIED</strong>
                </span>
                <span className="text-outline-variant">|</span>
                <span className="text-on-surface-variant">Reference Calibration: <strong className="text-tertiary">RELATIVE MODE</strong></span>
                <span className="text-outline-variant">|</span>
                <span className="text-on-surface-variant">Shadow Attenuation: <strong className="text-secondary">HEURISTIC</strong></span>
              </div>
            </div>
          </div>

          {/* Contiguous Changed Regions Pill List */}
          {displayRegions.length > 0 ? (
            <div className="bg-surface-container-lowest p-space-sm rounded-DEFAULT space-y-2 border border-outline-variant/30">
              <span className="font-label-sm text-label-sm text-outline tracking-wider font-semibold block">
                EXTRACTED CONTIGUOUS CANDIDATE REGIONS (CLICK TO INSPECT):
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {displayRegions.map((reg) => (
                  <button
                    key={reg.id}
                    onClick={() => handleRegionSelect(reg)}
                    className={`px-3 py-1.5 rounded-DEFAULT font-label-sm text-label-sm flex items-center gap-1.5 border transition-all cursor-pointer ${
                      selectedRegion?.id === reg.id
                        ? 'bg-error-container text-on-error-container border-error font-semibold shadow-sm'
                        : 'bg-surface-container-high text-on-surface-variant border-outline-variant/40 hover:text-on-surface'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-error"></span>
                    <span>{reg.label}: {reg.classification}</span>
                    <span className="text-outline text-[10px]">({(reg.area_fraction * 100).toFixed(1)}%)</span>
                  </button>
                ))}
              </div>
            </div>
          ) : resultData ? (
            <div className="bg-surface-container-lowest p-space-sm rounded-DEFAULT border border-outline-variant/30 text-on-surface-variant font-label-sm text-label-sm">
              No significant contiguous change clusters detected above threshold.
            </div>
          ) : null}
        </div>

        {/* Region Inspector & Dispatch Card (4 Columns) */}
        <div className="lg:col-span-4 bg-surface-container-low rounded-DEFAULT p-space-md flex flex-col justify-between space-y-space-md shadow-sm border border-outline-variant/40">
          <div className="space-y-space-sm">
            <div className="flex items-center gap-space-xs pb-space-xs border-b border-outline-variant/30">
              <span className="material-symbols-outlined text-tertiary text-[20px]">troubleshoot</span>
              <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                Candidate Region Inspector
              </span>
            </div>

            {selectedRegion ? (
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between p-2 bg-surface-container-high rounded-DEFAULT">
                  <span className="font-label-md text-label-md text-error font-bold">{selectedRegion.label}</span>
                  <span className="font-label-sm text-[10px] text-error bg-error-container/60 px-2 py-0.5 rounded font-semibold">
                    {selectedRegion.classification}
                  </span>
                </div>

                <div className="space-y-1 text-on-surface font-label-sm text-label-sm p-2 bg-surface-container-high rounded-DEFAULT">
                  <div className="flex justify-between">
                    <span className="text-outline">Relative Change:</span>
                    <span className="text-error font-semibold">{selectedRegion.relative_change} rel. units</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-outline">Observation Interval:</span>
                    <span className="text-on-surface font-mono">{selectedRegion.observation_interval}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-outline">Candidate Area:</span>
                    <span className="text-on-surface font-mono">{(selectedRegion.area_fraction * 100).toFixed(1)}% of sector</span>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-outline-variant/20">
                    <span className="text-outline">Actionable Next Step:</span>
                    <span className="text-primary font-semibold">{selectedRegion.next_step}</span>
                  </div>
                </div>

                <p className="font-body-sm text-[11px] text-on-surface-variant leading-relaxed italic">
                  Change boundaries are indicative candidate zones derived from differential depth raster analysis.
                </p>
              </div>
            ) : (
              <div className="p-4 text-center text-outline font-label-sm text-label-sm">
                {resultData ? 'Select a candidate change zone above to inspect its metrics.' : 'Run temporal change detection to extract and inspect candidate change zones.'}
              </div>
            )}
          </div>

          {/* Action CTAs */}
          <div className="pt-2 flex flex-col gap-2">
            <button 
              onClick={() => handleViewIn3D(selectedRegion)}
              disabled={!resultData}
              className="w-full py-2.5 px-3 bg-secondary-container text-primary border border-primary/40 rounded-DEFAULT font-label-md text-label-md font-semibold tracking-wider flex items-center justify-center gap-1.5 hover:bg-secondary-container/90 transition-all cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-[18px]">view_in_ar</span>
              <span>VIEW IN 3D SURFACE</span>
            </button>

            <button 
              onClick={handleProceedToRisk}
              disabled={!resultData}
              className="w-full py-2.5 px-3 bg-primary text-on-primary rounded-DEFAULT font-label-md text-label-md font-bold tracking-wider flex items-center justify-center gap-1.5 hover:bg-primary-container transition-all shadow-[0_0_16px_rgba(126,246,237,0.3)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span>PROCEED TO RISK INTELLIGENCE</span>
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </button>

            <div className="flex items-center justify-center gap-1.5 mt-1 font-label-sm text-[10px] text-outline text-center">
              <span className="material-symbols-outlined text-[12px] text-secondary">info</span>
              <span>Change confidence not quantified for this prototype.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
