import React, { useState, useEffect } from 'react';
import { apiUrl } from '../api';

export default function ValidationPage({ onNavigate }) {
  const [samples, setSamples] = useState([]);
  const [selectedSampleId, setSelectedSampleId] = useState('DC_03_26');
  const [comparisonMode, setComparisonMode] = useState('scale_aligned'); // 'scale_aligned' | 'normalized'
  const [validationData, setValidationData] = useState(null);
  const [summaryData, setSummaryData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [rgbFile, setRgbFile] = useState(null);
  const [refFile, setRefFile] = useState(null);

  // Load available GAMUS samples and aggregate summary on mount
  useEffect(() => {
    fetch(apiUrl('/api/validation/samples'))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setSamples(data || []);
        if (data && data.length > 0) {
          const firstReady = data.find((s) => s.has_reference);
          if (firstReady) {
            setSelectedSampleId(firstReady.sample_id);
          }
        }
      })
      .catch((err) => {
        console.warn('Could not fetch validation samples:', err);
      });

    fetch(apiUrl('/api/validation/summary'))
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setSummaryData(data);
      })
      .catch((err) => {
        console.warn('Could not fetch validation summary:', err);
      });
  }, []);

  // Fetch benchmark results whenever selected sample or comparison mode changes
  useEffect(() => {
    if (!selectedSampleId || selectedSampleId === 'CUSTOM_UPLOAD') return;

    setLoading(true);
    setError(null);

    fetch(apiUrl('/api/validation/run'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sample_id: selectedSampleId,
        comparison_mode: comparisonMode,
        force_rerun: false
      })
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Evaluation failed with status ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setValidationData(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Failed to load validation benchmark');
        setLoading(false);
      });
  }, [selectedSampleId, comparisonMode]);

  const handleExportDossier = () => {
    setExporting(true);
    setTimeout(() => {
      setExporting(false);
      setExported(true);

      // Trigger JSON download of the genuine evaluation record
      if (validationData) {
        const blob = new Blob([JSON.stringify(validationData, null, 2)], {
          type: 'application/json'
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `slopesentinel_gamus_validation_${selectedSampleId}_${comparisonMode}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      setTimeout(() => setExported(false), 3000);
    }, 1000);
  };

  const handleCustomUpload = async (e) => {
    e.preventDefault();
    if (!rgbFile) {
      setError("RGB file is required for custom validation.");
      return;
    }
    
    setLoading(true);
    setError(null);
    setValidationData(null);
    
    const formData = new FormData();
    formData.append('rgb_file', rgbFile);
    if (refFile) {
      formData.append('ref_file', refFile);
    }
    formData.append('comparison_mode', comparisonMode);
    
    try {
      const res = await fetch(apiUrl('/api/validation/custom'), {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Evaluation failed with status ${res.status}`);
      }
      const data = await res.json();
      setValidationData(data);
    } catch (err) {
      setError(err.message || 'Failed to process custom validation');
    } finally {
      setLoading(false);
    }
  };

  const handleRerun = () => {
    setLoading(true);
    fetch(apiUrl('/api/validation/run'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sample_id: selectedSampleId,
        comparison_mode: comparisonMode,
        force_rerun: true
      })
    })
      .then((res) => res.json())
      .then((data) => {
        setValidationData(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  };

  return (
    <div className="flex flex-col w-full">
      {/* Top Context Bar */}
      <div className="px-space-lg py-space-sm bg-surface-container-lowest flex flex-wrap items-center justify-between gap-space-sm border-b border-outline-variant/30">
        <div className="flex items-center gap-space-sm">
          <span className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse shadow-sm"></span>
          <span className="font-label-sm text-label-sm uppercase tracking-widest text-primary font-semibold">
            VALIDATION BENCHMARK // REAL GAMUS EVALUATION
          </span>
          <span className="font-label-sm text-label-sm text-outline tracking-wider">//</span>
          <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">
            DEPTHWIZARD MODEL VS. LIDAR AGL REFERENCE
          </span>
        </div>
        <div className="flex items-center gap-space-md">
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-DEFAULT bg-surface-container-high border border-outline-variant/30">
            <span className="material-symbols-outlined text-[14px] text-tertiary">science</span>
            <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">
              Methodology: Empirical Ground-Truth Target Correlation
            </span>
          </div>
          <span className="px-2 py-0.5 rounded-DEFAULT bg-secondary-container text-secondary font-label-sm text-label-sm font-medium tracking-wide uppercase">
            GAMUS VALIDATION SUITE v2.0
          </span>
        </div>
      </div>

      {/* Page Header */}
      <div className="px-space-lg py-space-md bg-surface-container-low flex flex-col md:flex-row md:items-end justify-between gap-space-sm border-b border-outline-variant/30">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-1.5 py-0.5 rounded-DEFAULT bg-surface-container-highest text-primary font-label-sm text-label-sm tracking-widest font-semibold">
              MODULE 07
            </span>
            <span className="text-outline font-label-sm text-label-sm tracking-widest uppercase">
              EMPIRICAL GROUND-TRUTH BENCHMARK
            </span>
          </div>
          <h1 className="font-headline-md text-headline-md text-on-surface tracking-tight font-semibold">
            Validation Benchmark
          </h1>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
            Empirical accuracy evaluation of DepthWizard (Depth Anything V2) monocular reconstruction against official GAMUS remote-sensing LiDAR reference targets.
          </p>
        </div>

        {/* Controls: Sample selector & Mode Switcher */}
        <div className="flex flex-wrap items-center gap-space-xs self-start md:self-auto">
          {/* Sample Selector */}
          <div className="flex items-center bg-surface-container px-2 py-1 rounded-DEFAULT border border-outline-variant/40">
            <label className="font-label-sm text-[10px] text-outline uppercase tracking-wider mr-2 font-semibold">
              GAMUS Sample:
            </label>
            <select
              value={selectedSampleId}
              onChange={(e) => setSelectedSampleId(e.target.value)}
              disabled={loading}
              className="bg-surface-container-high border border-outline-variant/40 rounded px-2 py-1 text-on-surface font-label-sm text-label-sm font-semibold focus:outline-none focus:border-primary cursor-pointer disabled:opacity-60"
            >
              <optgroup label="BUILT-IN GAMUS">
                {samples.map((s) => (
                  <option key={s.sample_id} value={s.sample_id} disabled={!s.has_reference}>
                    {s.sample_id} {s.has_reference ? '(Ready)' : '(No Ref)'}
                  </option>
                ))}
              </optgroup>
              <optgroup label="CUSTOM VALIDATION">
                <option value="CUSTOM_UPLOAD">CUSTOM UPLOAD</option>
              </optgroup>
            </select>
          </div>

          {/* Mode Switcher */}
          <div className="flex items-center bg-surface-container p-1 rounded-DEFAULT border border-outline-variant/40">
            <button
              onClick={() => setComparisonMode('scale_aligned')}
              className={`px-2.5 py-1 rounded font-label-sm text-label-sm transition-all cursor-pointer ${
                comparisonMode === 'scale_aligned'
                  ? 'bg-secondary-container text-primary font-semibold'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
              title="Least-squares affine scale & shift alignment against ground-truth metric AGL elevation (m)"
            >
              SCALE-ALIGNED METRIC (m)
            </button>
            <button
              onClick={() => setComparisonMode('normalized')}
              className={`px-2.5 py-1 rounded font-label-sm text-label-sm transition-all cursor-pointer ${
                comparisonMode === 'normalized'
                  ? 'bg-secondary-container text-primary font-semibold'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
              title="Normalized dimensionless [0, 1] relative surface comparison"
            >
              NORMALIZED RELATIVE
            </button>
          </div>

          <button
            onClick={handleRerun}
            disabled={loading}
            className="px-3 py-1.5 rounded-DEFAULT bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-label-sm text-label-sm border border-outline-variant/40 flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60"
            title="Re-run DepthWizard pipeline on this GAMUS sample"
          >
            <span className={`material-symbols-outlined text-[16px] ${loading ? 'animate-spin' : ''}`}>
              refresh
            </span>
            <span>Re-run</span>
          </button>

          <button
            onClick={handleExportDossier}
            disabled={exporting || loading}
            className="px-3 py-1.5 rounded-DEFAULT bg-primary text-on-primary font-label-sm text-label-sm font-medium flex items-center gap-1.5 shadow-sm transition-transform active:scale-95 disabled:opacity-80 cursor-pointer"
          >
            <span className={`material-symbols-outlined text-[16px] ${exporting ? 'animate-spin' : ''}`}>
              {exporting ? 'sync' : exported ? 'check_circle' : 'download'}
            </span>
            <span>{exporting ? 'GENERATING...' : exported ? 'DOSSIER DOWNLOADED' : 'EXPORT AUDIT DOSSIER'}</span>
          </button>
        </div>
      </div>

      {/* Mandatory Scientific Disclaimer Banner (Requirement 17) */}
      <div className="mx-space-lg mt-space-md bg-surface-container-lowest/90 border border-outline-variant/40 rounded-xl p-space-sm flex items-start gap-space-sm shadow-sm">
        <span className="material-symbols-outlined text-primary text-[20px] mt-0.5">verified_user</span>
        <div className="flex flex-col gap-0.5 text-on-surface">
          <span className="font-label-sm text-[11px] font-semibold text-primary uppercase tracking-wider">
            SCIENTIFIC GROUNDING &amp; PROTOTYPE BENCHMARK DISCLOSURE
          </span>
          <p className="font-body-sm text-body-sm text-on-surface-variant italic leading-relaxed">
            "Metrics are reported for the selected validation sample and depend on reference quality, alignment, masking, and calibration. They do not represent guaranteed performance across all Himalayan terrain. Monocular depth provides relative terrain structure; metric elevation requires suitable reference/calibration information where available."
          </p>
        </div>
      </div>

      {/* Main Workflow Container */}
      <div className="p-space-lg space-y-space-lg">
        {selectedSampleId === 'CUSTOM_UPLOAD' && !validationData && !loading && (
          <div className="bg-surface-container border border-outline-variant/40 rounded-xl p-space-lg shadow-sm max-w-3xl">
            <h2 className="text-title-md font-semibold text-on-surface mb-2">Custom Sample Evaluation</h2>
            <p className="text-body-sm text-on-surface-variant mb-6">
              Upload an RGB image for monocular depth reconstruction. Optionally, upload a compatible HDF5 reference array to enable metric benchmarking. If the reference is omitted, the system runs in "Prediction Only" mode.
            </p>
            <form onSubmit={handleCustomUpload} className="flex flex-col gap-6">
              <div>
                <label className="block text-label-sm font-semibold text-on-surface mb-1">RGB Image (Required)</label>
                <input 
                  type="file" 
                  accept="image/*" 
                  onChange={(e) => setRgbFile(e.target.files[0])} 
                  className="block w-full text-body-sm text-on-surface-variant file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-label-sm file:font-semibold file:bg-primary-container file:text-primary hover:file:bg-primary-container/80 cursor-pointer"
                />
              </div>
              <div>
                <label className="block text-label-sm font-semibold text-on-surface mb-1">HDF5 Reference Array (Optional)</label>
                <input 
                  type="file" 
                  accept=".h5,.hdf5" 
                  onChange={(e) => setRefFile(e.target.files[0])} 
                  className="block w-full text-body-sm text-on-surface-variant file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-label-sm file:font-semibold file:bg-surface-container-high file:text-on-surface-variant hover:file:bg-surface-container-highest cursor-pointer"
                />
                <p className="text-[11px] text-outline italic mt-2">Metrics calculation requires a corresponding ground-truth HDF5 surface array.</p>
              </div>
              <button 
                type="submit" 
                disabled={!rgbFile} 
                className="mt-2 px-6 py-2.5 bg-primary text-on-primary rounded font-label-md font-semibold w-fit disabled:opacity-50 cursor-pointer shadow-sm transition-transform active:scale-95"
              >
                Run Custom Validation
              </button>
            </form>
          </div>
        )}


        {loading ? (
          <div className="flex flex-col items-center justify-center p-16 bg-surface-container-low rounded-DEFAULT border border-outline-variant/40 space-y-3">
            <span className="material-symbols-outlined text-primary text-[48px] animate-spin">
              hourglass_top
            </span>
            <div className="font-headline-sm text-headline-sm text-on-surface font-semibold">
              Evaluating GAMUS Sample {selectedSampleId}...
            </div>
            <p className="font-body-sm text-body-sm text-on-surface-variant max-w-md text-center">
              Running DepthWizard Depth Anything V2 monocular inference, dimension alignment, invalid pixel masking, and Pearson correlation against ground truth.
            </p>
          </div>
        ) : error ? (
          <div className="p-space-lg bg-error-container/30 border border-error/50 rounded-DEFAULT text-error flex items-start gap-space-sm">
            <span className="material-symbols-outlined text-[24px]">error</span>
            <div>
              <div className="font-label-md text-label-md font-bold uppercase">Validation Benchmark Failed</div>
              <p className="font-body-sm text-body-sm mt-1">{error}</p>
            </div>
          </div>
        ) : validationData ? (
          validationData.is_prediction_only ? (
            <div className="flex flex-col gap-space-lg">
              <div className="bg-surface-container-low border border-outline-variant/30 rounded-2xl p-space-lg flex flex-col items-center justify-center min-h-[120px] text-center gap-2">
                <span className="material-symbols-outlined text-[32px] text-outline">visibility</span>
                <span className="text-on-surface-variant font-label-md tracking-widest uppercase font-semibold">PREDICTION ONLY — METRICS UNAVAILABLE</span>
                <p className="text-body-sm text-outline max-w-lg">No ground truth reference was provided. Only the reconstructed depth map is available. Metric evaluation requires a corresponding HDF5 reference array.</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md">
                <div className="flex flex-col bg-surface-container-low rounded-DEFAULT overflow-hidden shadow-md border border-outline-variant/40">
                  <div className="p-space-md bg-surface-container"><span className="font-label-sm text-label-sm font-semibold uppercase tracking-wider text-primary">RGB INPUT</span></div>
                  <img src={validationData.images.rgb} className="w-full h-80 object-cover" alt="RGB Input" />
                </div>
                <div className="flex flex-col bg-surface-container-low rounded-DEFAULT overflow-hidden shadow-md border border-outline-variant/40">
                  <div className="p-space-md bg-surface-container"><span className="font-label-sm text-label-sm font-semibold uppercase tracking-wider text-secondary">PREDICTED DEPTH SURFACE</span></div>
                  <img src={validationData.images.prediction} className="w-full h-80 object-cover" alt="Predicted Depth" />
                </div>
              </div>
            </div>
          ) : (
          <>
            {/* Three-Panel Evaluation Workflow (Requirement 15 & 16) */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-space-md">
              {/* PANEL 1: REFERENCE TARGET */}
              <div className="flex flex-col bg-surface-container-low rounded-DEFAULT overflow-hidden shadow-md border border-outline-variant/40">
                <div className="p-space-md bg-surface-container flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-label-sm text-label-sm font-semibold uppercase tracking-wider text-primary">
                        01 // REFERENCE TARGET
                      </span>
                    </div>
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-DEFAULT bg-surface-container-highest font-label-sm text-label-sm text-tertiary">
                      <span className="w-1.5 h-1.5 rounded-full bg-tertiary"></span>
                      GAMUS Earthflow LiDAR AGL Surface
                    </span>
                  </div>
                  <span className="material-symbols-outlined text-outline-variant text-[20px]">
                    history_edu
                  </span>
                </div>

                <div className="px-space-md py-space-xs bg-surface-container-lowest flex items-center justify-between text-on-surface-variant font-label-sm text-label-sm border-y border-outline-variant/30">
                  <span>SAMPLE: <strong className="text-on-surface font-mono">{validationData.sample_id}</strong></span>
                  <span className="text-tertiary-fixed-dim font-medium">LiDAR Ground Truth (1024×1024)</span>
                </div>

                <div className="relative w-full h-72 bg-surface-container-lowest overflow-hidden flex items-center justify-center group">
                  <img
                    className="w-full h-full object-cover"
                    alt="Official GAMUS reference elevation surface"
                    src={validationData.images.reference}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-surface-container-low/80 via-transparent to-transparent pointer-events-none"></div>

                  <div className="absolute top-2 left-2 px-2 py-0.5 rounded-DEFAULT bg-surface-container-lowest/90 backdrop-blur-sm font-label-sm text-label-sm text-outline border border-outline-variant/30">
                    TARGET: LiDAR AGL (m)
                  </div>
                  <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between text-[11px] font-label-sm text-tertiary-fixed-dim bg-surface-container-low/95 px-2 py-1 rounded-DEFAULT border border-outline-variant/30">
                    <span>SPAN: {validationData.reference_statistics.min_m}m → {validationData.reference_statistics.max_m}m</span>
                    <span className="text-on-surface-variant font-normal">Mean: {validationData.reference_statistics.mean_m}m</span>
                  </div>
                </div>

                <div className="p-space-md space-y-space-xs bg-surface-container-low flex-1 flex flex-col justify-between">
                  <p className="font-body-sm text-body-sm text-on-surface-variant">
                    Official GAMUS (Earthflow) top-down remote-sensing benchmark target providing pixel-level LiDAR above-ground-level elevation.
                  </p>
                  <div className="pt-space-xs flex flex-wrap items-center gap-1.5">
                    <span className="px-2 py-0.5 rounded-DEFAULT bg-surface-container-high font-label-sm text-label-sm text-outline">
                      COVERAGE: {validationData.valid_pixel_percentage}%
                    </span>
                    <span className="px-2 py-0.5 rounded-DEFAULT bg-surface-container-high font-label-sm text-label-sm text-outline">
                      FORMAT: HDF5 (.h5)
                    </span>
                  </div>
                </div>
              </div>

              {/* PANEL 2: DEPTHWIZARD MODEL */}
              <div className="flex flex-col bg-surface-container-low rounded-DEFAULT overflow-hidden shadow-md border border-outline-variant/40">
                <div className="p-space-md bg-surface-container flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-label-sm text-label-sm font-semibold uppercase tracking-wider text-primary">
                        02 // DEPTHWIZARD MODEL
                      </span>
                    </div>
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-DEFAULT bg-secondary-container font-label-sm text-label-sm text-primary">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary animate-ping"></span>
                      Depth Anything V2 Monocular Pipeline
                    </span>
                  </div>
                  <span className="material-symbols-outlined text-primary text-[20px]">
                    view_in_ar
                  </span>
                </div>

                <div className="px-space-md py-space-xs bg-surface-container-lowest flex items-center justify-between text-on-surface-variant font-label-sm text-label-sm border-y border-outline-variant/30">
                  <span>PIPELINE: <strong className="text-secondary">Monocular MVS Relief</strong></span>
                  <span className="text-primary font-medium">{validationData.comparison_mode}</span>
                </div>

                <div className="relative w-full h-72 bg-surface-container-lowest overflow-hidden flex items-center justify-center">
                  <img
                    className="w-full h-full object-cover"
                    alt="DepthWizard predicted terrain surface"
                    src={validationData.images.prediction}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-surface-container-low/80 via-transparent to-transparent pointer-events-none"></div>

                  <div className="absolute top-2 left-2 px-2 py-0.5 rounded-DEFAULT bg-surface-container-lowest/90 backdrop-blur-sm font-label-sm text-label-sm text-secondary border border-outline-variant/30">
                    PREDICTION: Depth Anything V2
                  </div>
                  <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between text-[11px] font-label-sm text-tertiary-fixed-dim bg-surface-container-low/95 px-2 py-1 rounded-DEFAULT border border-outline-variant/30">
                    <span>INFER TIME: {validationData.processing_time_s}s</span>
                    <span className="text-on-surface-variant font-mono">
                      {validationData.is_cached ? 'LOADED FROM CACHE' : 'FRESH INFERENCE'}
                    </span>
                  </div>
                </div>

                <div className="p-space-md space-y-space-xs bg-surface-container-low flex-1 flex flex-col justify-between">
                  <p className="font-body-sm text-body-sm text-on-surface-variant">
                    Unsupervised monocular terrain reconstruction from the sample RGB image ({validationData.sample_id}_RGB.png), aligned via bilinear interpolation without spatial warping.
                  </p>
                  <div className="pt-space-xs flex flex-wrap items-center justify-between">
                    <span className="px-2 py-0.5 rounded-DEFAULT bg-surface-container-high font-label-sm text-label-sm text-secondary">
                      {validationData.model_name}
                    </span>
                  </div>
                </div>
              </div>

              {/* PANEL 3: SPATIAL ERROR RESIDUAL */}
              <div className="flex flex-col bg-surface-container-low rounded-DEFAULT overflow-hidden shadow-md border border-outline-variant/40">
                <div className="p-space-md bg-surface-container flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-label-sm text-label-sm font-semibold uppercase tracking-wider text-primary">
                        03 // SPATIAL ERROR RESIDUAL
                      </span>
                    </div>
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-DEFAULT bg-surface-container-highest font-label-sm text-label-sm text-secondary">
                      <span className="w-1.5 h-1.5 rounded-full bg-secondary"></span>
                      Pixel Residual Heatmap |Prediction - Reference|
                    </span>
                  </div>
                  <span className="material-symbols-outlined text-secondary text-[20px]">
                    join_inner
                  </span>
                </div>

                <div className="px-space-md py-space-xs bg-surface-container-lowest flex items-center justify-between text-on-surface-variant font-label-sm text-label-sm border-y border-outline-variant/30">
                  <span>RESIDUAL METRIC: <strong className="text-tertiary">Absolute Deviation</strong></span>
                  <span className="text-outline font-medium">MAE: {validationData.mae} {validationData.units === 'meters' ? 'm' : ''}</span>
                </div>

                <div className="relative w-full h-72 bg-surface-container-lowest overflow-hidden flex items-center justify-center">
                  <img
                    className="w-full h-full object-cover"
                    alt="Spatial error residual heatmap"
                    src={validationData.images.error_heatmap}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-surface-container-low/80 via-transparent to-transparent pointer-events-none"></div>

                  <div className="absolute bottom-2 left-2 right-2 p-2 bg-surface-container-low/95 rounded-DEFAULT flex flex-col gap-1 text-[10px] font-label-sm border border-outline-variant/30">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-2 bg-[#1e4a42] rounded-DEFAULT inline-block"></span>
                      <span className="text-primary font-medium">Cool Slate: Minimal Deviation (&lt;10%)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-2 bg-[#ff7652] rounded-DEFAULT inline-block"></span>
                      <span className="text-tertiary-fixed-dim font-medium">Amber / Scarlet: High Residual Deviation</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-2 bg-[#121717] rounded-DEFAULT inline-block"></span>
                      <span className="text-outline font-medium">Dark Slate: Masked Unmeasured LiDAR Void</span>
                    </div>
                  </div>
                </div>

                <div className="p-space-md space-y-space-xs bg-surface-container-low flex-1 flex flex-col justify-between">
                  <p className="font-body-sm text-body-sm text-on-surface-variant">
                    Spatial concordance analysis identifies areas of high fidelity and highlights regions affected by building occlusions, vegetation, or steep shadowing.
                  </p>
                  <div className="pt-space-xs flex items-center justify-between">
                    <span className="font-label-sm text-label-sm text-outline">PEARSON r:</span>
                    <span className="px-2 py-0.5 rounded-DEFAULT bg-surface-container-high font-label-sm text-label-sm text-secondary font-mono font-semibold">
                      {validationData.correlation > 0 ? '+' : ''}{validationData.correlation.toFixed(4)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* 4 Genuine Benchmark Metric Cards (Requirement 10, 11, 16) */}
            <div className="space-y-space-md">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-[18px]">
                    query_stats
                  </span>
                  <h2 className="font-headline-sm text-headline-sm uppercase tracking-wide text-on-surface font-semibold">
                    Genuine Validation Metrics (GAMUS // Sample {validationData.sample_id})
                  </h2>
                </div>
                <span className="font-label-sm text-label-sm text-outline uppercase tracking-widest font-semibold">
                  MODE: {validationData.comparison_mode}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-md">
                {/* Metric 1: RMSE */}
                <div className="p-space-md bg-surface-container-low rounded-DEFAULT flex flex-col justify-between shadow-sm border border-outline-variant/40">
                  <div className="flex items-start justify-between mb-space-sm">
                    <span className="font-label-sm text-label-sm uppercase tracking-widest text-outline font-semibold">
                      ROOT MEAN SQUARE ERROR
                    </span>
                    <span className="px-1.5 py-0.5 rounded-DEFAULT bg-surface-container-high font-label-sm text-label-sm text-primary font-mono font-bold">
                      RMSE
                    </span>
                  </div>
                  <div className="my-space-xs">
                    <div className="font-headline-lg text-headline-lg font-bold text-primary font-mono">
                      {validationData.rmse}
                      <span className="text-headline-sm font-normal text-on-surface-variant ml-1">
                        {validationData.units === 'meters' ? 'm' : 'rel'}
                      </span>
                    </div>
                    <p className="font-body-sm text-body-sm text-on-surface-variant mt-1 leading-snug">
                      Quadratic mean of differences between prediction and ground truth.
                    </p>
                  </div>
                  <div className="pt-space-sm mt-space-sm bg-surface-container-lowest/40 -mx-space-md -mb-space-md p-space-sm flex items-center gap-2 border-t border-outline-variant/30">
                    <span className="material-symbols-outlined text-primary text-[14px]">check_circle</span>
                    <span className="font-label-sm text-[10px] text-primary uppercase tracking-wider font-semibold">
                      GENUINE EMPIRICAL VALUE
                    </span>
                  </div>
                </div>

                {/* Metric 2: MAE */}
                <div className="p-space-md bg-surface-container-low rounded-DEFAULT flex flex-col justify-between shadow-sm border border-outline-variant/40">
                  <div className="flex items-start justify-between mb-space-sm">
                    <span className="font-label-sm text-label-sm uppercase tracking-widest text-outline font-semibold">
                      MEAN ABSOLUTE ERROR
                    </span>
                    <span className="px-1.5 py-0.5 rounded-DEFAULT bg-surface-container-high font-label-sm text-label-sm text-secondary font-mono font-bold">
                      MAE
                    </span>
                  </div>
                  <div className="my-space-xs">
                    <div className="font-headline-lg text-headline-lg font-bold text-secondary font-mono">
                      {validationData.mae}
                      <span className="text-headline-sm font-normal text-on-surface-variant ml-1">
                        {validationData.units === 'meters' ? 'm' : 'rel'}
                      </span>
                    </div>
                    <p className="font-body-sm text-body-sm text-on-surface-variant mt-1 leading-snug">
                      Average magnitude of pixel-level elevation residual.
                    </p>
                  </div>
                  <div className="pt-space-sm mt-space-sm bg-surface-container-lowest/40 -mx-space-md -mb-space-md p-space-sm flex items-center gap-2 border-t border-outline-variant/30">
                    <span className="material-symbols-outlined text-secondary text-[14px]">straighten</span>
                    <span className="font-label-sm text-[10px] text-secondary uppercase tracking-wider font-semibold">
                      GENUINE EMPIRICAL VALUE
                    </span>
                  </div>
                </div>

                {/* Metric 3: Pearson Correlation */}
                <div className="p-space-md bg-surface-container-low rounded-DEFAULT flex flex-col justify-between shadow-sm border border-outline-variant/40">
                  <div className="flex items-start justify-between mb-space-sm">
                    <span className="font-label-sm text-label-sm uppercase tracking-widest text-outline font-semibold">
                      PEARSON CORRELATION
                    </span>
                    <span className="px-1.5 py-0.5 rounded-DEFAULT bg-surface-container-high font-label-sm text-label-sm text-tertiary font-mono font-bold">
                      PEARSON r
                    </span>
                  </div>
                  <div className="my-space-xs">
                    <div className={`font-headline-lg text-headline-lg font-bold font-mono ${
                      validationData.correlation >= 0.15 ? 'text-primary' : validationData.correlation >= 0 ? 'text-tertiary' : 'text-error'
                    }`}>
                      {validationData.correlation > 0 ? '+' : ''}{validationData.correlation.toFixed(4)}
                    </div>
                    <p className="font-body-sm text-body-sm text-on-surface-variant mt-1 leading-snug">
                      Topographic slope shape correlation (invariant to positive scale/shift).
                    </p>
                  </div>
                  <div className="pt-space-sm mt-space-sm bg-surface-container-lowest/40 -mx-space-md -mb-space-md p-space-sm flex items-center gap-2 border-t border-outline-variant/30">
                    <span className="material-symbols-outlined text-tertiary text-[14px]">join_inner</span>
                    <span className="font-label-sm text-[10px] text-tertiary uppercase tracking-wider font-semibold">
                      SCALE-INVARIANT INDEX
                    </span>
                  </div>
                </div>

                {/* Metric 4: Valid Pixel Coverage */}
                <div className="p-space-md bg-surface-container-low rounded-DEFAULT flex flex-col justify-between shadow-sm border border-outline-variant/40">
                  <div className="flex items-start justify-between mb-space-sm">
                    <span className="font-label-sm text-label-sm uppercase tracking-widest text-outline font-semibold">
                      VALID PIXEL COVERAGE
                    </span>
                    <span className="px-1.5 py-0.5 rounded-DEFAULT bg-secondary-container font-label-sm text-label-sm text-primary font-mono font-bold">
                      MASK
                    </span>
                  </div>
                  <div className="my-space-xs">
                    <div className="font-headline-lg text-headline-lg font-bold text-on-surface font-mono">
                      {validationData.valid_pixel_percentage}%
                    </div>
                    <p className="font-body-sm text-body-sm text-on-surface-variant mt-1 leading-snug">
                      {validationData.valid_pixels.toLocaleString()} / {validationData.total_pixels.toLocaleString()} pixels ({validationData.invalid_pixels.toLocaleString()} voids excluded).
                    </p>
                  </div>
                  <div className="pt-space-sm mt-space-sm bg-surface-container-lowest/40 -mx-space-md -mb-space-md p-space-sm flex items-center gap-2 border-t border-outline-variant/30">
                    <span className="material-symbols-outlined text-primary text-[14px]">filter_alt</span>
                    <span className="font-label-sm text-[10px] text-primary uppercase tracking-wider font-semibold">
                      STRICT VOID/NODATA MASKING
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Calibration & Scaling Documentation Box (Requirement 11 & 12) */}
            <div className="p-space-md bg-surface-container-low rounded-DEFAULT border border-outline-variant/40 space-y-2">
              <div className="flex items-center gap-2 text-primary font-label-sm text-label-sm uppercase font-semibold">
                <span className="material-symbols-outlined text-[18px]">tune</span>
                <span>Transparent Calibration &amp; Scale Handling Documentation</span>
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant leading-relaxed">
                {validationData.calibration_method}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1 text-[11px] font-mono text-outline">
                <div className="p-2 bg-surface-container rounded border border-outline-variant/20">
                  <strong>Reference Stats:</strong> Min: {validationData.reference_statistics.min_m}m | Max: {validationData.reference_statistics.max_m}m | Mean: {validationData.reference_statistics.mean_m}m | Std: {validationData.reference_statistics.std_m}m
                </div>
                <div className="p-2 bg-surface-container rounded border border-outline-variant/20">
                  <strong>Prediction Stats:</strong> Min: {validationData.prediction_statistics.min} | Max: {validationData.prediction_statistics.max} | Mean: {validationData.prediction_statistics.mean} | Std: {validationData.prediction_statistics.std}
                </div>
              </div>
            </div>

            {/* Multi-Sample Aggregate Benchmark Table (Requirement 19 & 20) */}
            {summaryData && summaryData.samples && summaryData.samples.length > 0 && (
              <div className="bg-surface-container-low rounded-DEFAULT p-space-md border border-outline-variant/40 space-y-space-sm shadow-sm">
                <div className="flex items-center justify-between pb-space-xs border-b border-outline-variant/30">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-[20px]">
                      table_chart
                    </span>
                    <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface">
                      GAMUS Benchmark Multi-Sample Evaluation Table
                    </h3>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-surface-container-high font-label-sm text-label-sm text-tertiary font-medium">
                    {summaryData.evaluation_scope} ({summaryData.sample_count} Samples)
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left font-label-sm text-label-sm">
                    <thead>
                      <tr className="border-b border-outline-variant/40 text-outline">
                        <th className="py-2.5 px-3 font-semibold uppercase">Sample ID</th>
                        <th className="py-2.5 px-3 font-semibold uppercase">Dataset</th>
                        <th className="py-2.5 px-3 font-semibold uppercase">Valid Coverage</th>
                        <th className="py-2.5 px-3 font-semibold uppercase">Pearson Correlation (r)</th>
                        <th className="py-2.5 px-3 font-semibold uppercase">Scale-Aligned RMSE</th>
                        <th className="py-2.5 px-3 font-semibold uppercase">Scale-Aligned MAE</th>
                        <th className="py-2.5 px-3 font-semibold uppercase">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant/20 font-mono">
                      {summaryData.samples.map((s) => {
                        const isSelected = s.sample_id === selectedSampleId;
                        return (
                          <tr
                            key={s.sample_id}
                            className={`transition-colors ${
                              isSelected ? 'bg-secondary-container/30 text-on-surface font-semibold' : 'hover:bg-surface-container'
                            }`}
                          >
                            <td className="py-2.5 px-3 flex items-center gap-2">
                              {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>}
                              <span>{s.sample_id}</span>
                            </td>
                            <td className="py-2.5 px-3 text-on-surface-variant font-sans">GAMUS Earthflow</td>
                            <td className="py-2.5 px-3">{s.valid_pixel_percentage}%</td>
                            <td className={`py-2.5 px-3 ${s.correlation >= 0 ? 'text-primary' : 'text-error'}`}>
                              {s.correlation > 0 ? '+' : ''}{s.correlation.toFixed(4)}
                            </td>
                            <td className="py-2.5 px-3 text-on-surface font-bold">{s.rmse} m</td>
                            <td className="py-2.5 px-3 text-secondary font-bold">{s.mae} m</td>
                            <td className="py-2.5 px-3">
                              {isSelected ? (
                                <span className="px-2 py-0.5 rounded bg-primary/20 text-primary font-sans text-[11px] font-semibold">
                                  INSPECTING
                                </span>
                              ) : (
                                <button
                                  onClick={() => setSelectedSampleId(s.sample_id)}
                                  className="px-2 py-0.5 rounded bg-surface-container-high hover:bg-surface-container-highest text-secondary font-sans text-[11px] cursor-pointer transition-colors border border-outline-variant/30"
                                >
                                  Inspect
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-primary/40 bg-surface-container font-mono font-bold text-on-surface">
                        <td className="py-2.5 px-3 font-sans uppercase">MEAN AGGREGATE</td>
                        <td className="py-2.5 px-3 font-sans text-outline text-[11px]">3 Samples</td>
                        <td className="py-2.5 px-3">{summaryData.mean_metrics.mean_valid_coverage_pct}%</td>
                        <td className="py-2.5 px-3 text-primary">
                          +{summaryData.mean_metrics.mean_correlation.toFixed(4)}
                        </td>
                        <td className="py-2.5 px-3 text-primary">{summaryData.mean_metrics.mean_rmse_m} m</td>
                        <td className="py-2.5 px-3 text-secondary">{summaryData.mean_metrics.mean_mae_m} m</td>
                        <td className="py-2.5 px-3 font-sans text-[10px] text-tertiary">BENCHMARK SUMMARY</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </>
          )
        ) : null}
      </div>
    </div>
  );
}
