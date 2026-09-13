import React, { useState } from 'react';
import ThreeTerrainViewer from '../components/ThreeTerrainViewer';
import { useActiveCase } from '../context/ActiveCaseContext';
import { apiUrl } from '../api';

export default function ThreeDTerrainPage({ onNavigate }) {
  const { activeCase } = useActiveCase();
  const recon = activeCase?.reconstruction;

  // Active mesh URL: live reconstruction mesh from DepthWizard
  const meshUrl = recon?.mesh_output || recon?.mesh || null;
  const textureUrl = recon?.source_image || recon?.input_image || null;
  const dsmUrl = recon?.dsm_output || recon?.dsm || null;
  const isLive = Boolean(recon);
  const caseId = activeCase?.active_case_id || (recon?.case_id ? recon.case_id : 'LIVE-MESH');
  const vertexCount = recon?.metadata?.mesh?.vertex_count || 0;
  const faceCount = recon?.metadata?.mesh?.face_count || 0;
  const originalFilename = recon?.metadata?.original_filename || (isLive ? 'Live DepthWizard Input' : 'No Mesh Loaded');

  const selectedRegion = activeCase?.selected_region || null;

  return (
    <div className="flex flex-col w-full">
      {/* Context Ribbon */}
      <div className="px-margin-desktop py-space-md flex flex-wrap items-center justify-between gap-space-md bg-surface-container-lowest border-b border-outline-variant/30">
        <div className="flex flex-col">
          <div className="flex items-center gap-space-xs">
            <span className="font-label-sm text-label-sm text-primary uppercase tracking-widest">
              Digital Elevation Model // Three.js WebGL 3D Mesh
            </span>
            <span className="text-outline-variant text-[10px]">/</span>
            <span className="font-label-sm text-label-sm text-tertiary-fixed-dim tracking-tight">
              {caseId} ({isLive ? 'LIVE DEPTHWIZARD RECONSTRUCTION' : 'NO ACTIVE RECONSTRUCTION'})
            </span>
          </div>
          <div className="flex items-baseline gap-space-sm mt-0.5">
            <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight font-semibold">
              3D Terrain Surface Viewer
            </h1>
            <p className="font-body-md text-body-md text-on-surface-variant font-normal">
              High-fidelity interactive elevation mesh derived from Depth Anything V2 monocular depth reconstruction.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-space-sm flex-wrap">
          <div className="px-space-md py-space-xs bg-surface-container-low rounded-DEFAULT flex items-center gap-space-md border border-outline-variant/30">
            <div className="flex flex-col">
              <span className="font-label-sm text-[10px] text-outline uppercase tracking-wider">Mesh Vertices</span>
              <span className="font-label-md text-label-md text-on-surface font-semibold tracking-wide">
                {vertexCount.toLocaleString()} PTS
              </span>
            </div>
            <div className="w-px h-6 bg-surface-container-highest"></div>
            <div className="flex flex-col">
              <span className="font-label-sm text-[10px] text-outline uppercase tracking-wider">TIN Faces</span>
              <span className="font-label-md text-label-md text-primary font-semibold">
                {faceCount.toLocaleString()}
              </span>
            </div>
            <div className="w-px h-6 bg-surface-container-highest"></div>
            <div className="flex items-center gap-1.5 pl-1">
              <span className={`w-2 h-2 rounded-full ${isLive ? 'bg-primary animate-pulse' : 'bg-tertiary'}`}></span>
              <span className={`font-label-sm text-label-sm tracking-widest font-semibold ${isLive ? 'text-primary' : 'text-secondary'}`}>
                {isLive ? 'LIVE UPLOAD MESH' : 'NO MESH LOADED'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Mandatory Scientific Disclaimer Banner */}
      <div className="mx-margin-desktop mt-4 bg-surface-container-lowest/80 border border-outline-variant/40 rounded-xl p-space-sm flex items-start gap-space-sm shadow-sm">
        <span className="material-symbols-outlined text-primary text-[20px] mt-0.5">verified_user</span>
        <div className="flex flex-col gap-0.5 text-on-surface">
          <span className="font-label-sm text-[11px] font-semibold text-primary uppercase tracking-wider">
            SCIENTIFIC GROUNDING &amp; DISCLOSURE
          </span>
          <p className="font-body-sm text-body-sm text-on-surface-variant italic">
            "Monocular depth provides relative terrain structure; metric elevation requires suitable reference/calibration information where available."
          </p>
        </div>
      </div>

      {/* Main Flagship Workspace: 3D Viewport (9 Cols) + Telemetry Inspector Rail (3 Cols) */}
      <div className="px-margin-desktop py-space-md grid grid-cols-1 xl:grid-cols-12 gap-space-md items-start">
        {/* 3D TERRAIN VIEWPORT (9 Columns) */}
        <div className="xl:col-span-9 flex flex-col gap-space-sm">
          <div className="relative w-full h-[720px] bg-surface-container-lowest rounded-DEFAULT overflow-hidden select-none border border-outline-variant/40 shadow-2xl">
            <ThreeTerrainViewer
              meshUrl={meshUrl}
              textureUrl={textureUrl}
              dsmUrl={dsmUrl}
              title={isLive ? `DepthWizard Reconstruction: ${originalFilename}` : '3D Terrain Elevation Mesh'}
              className="w-full h-full"
              autoRotate={false}
              showControls={true}
            />
          </div>
        </div>

        {/* 25% TELEMETRY INSPECTION PANEL (3 Columns) */}
        <div className="xl:col-span-3 flex flex-col gap-space-md">
          {/* Active Observation Context Card */}
          <div className="bg-surface-container-low rounded-DEFAULT p-space-md shadow-md border border-outline-variant/40 flex flex-col gap-space-xs">
            <div className="flex items-center justify-between pb-space-xs border-b border-outline-variant/30">
              <span className="font-label-sm text-[11px] text-primary uppercase font-semibold flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[15px]">dataset</span>
                Active Observation
              </span>
              <span className={`px-2 py-0.5 rounded text-[9px] font-label-sm font-semibold uppercase ${
                isLive ? 'bg-primary-container text-primary' : 'bg-surface-container-high text-outline'
              }`}>
                {isLive ? 'LIVE MESH' : 'NONE LOADED'}
              </span>
            </div>

            <div className="flex flex-col gap-1.5 pt-1 text-on-surface">
              <span className="font-label-md text-label-md font-semibold truncate" title={originalFilename}>
                {originalFilename}
              </span>
              <span className="font-label-sm text-[11px] text-tertiary font-mono">
                Case ID: {caseId}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-outline-variant/20 font-label-sm text-[11px]">
              <div className="bg-surface-container p-2 rounded">
                <span className="text-outline text-[10px] block">RECON MODE</span>
                <span className="font-semibold text-on-surface uppercase">
                  {recon?.mode || 'RELATIVE'}
                </span>
              </div>
              <div className="bg-surface-container p-2 rounded">
                <span className="text-outline text-[10px] block">ASPECT RATIO</span>
                <span className="font-semibold text-on-surface font-mono">
                  {recon?.metadata?.mesh?.aspect_ratio ? `${recon.metadata.mesh.aspect_ratio}:1` : '1.0:1'}
                </span>
              </div>
            </div>

            {meshUrl && (
              <div className="pt-2 flex flex-col gap-2">
                <button
                  onClick={async () => {
                    if (!caseId) { alert('OBJ mesh not available. Run terrain reconstruction first.'); return; }
                    try {
                      const res = await fetch(apiUrl(`/api/terrain/reconstruct/${caseId}/mesh`));
                      if (!res.ok) {
                         const err = await res.json().catch(() => ({}));
                         throw new Error(err.detail || `Download failed with status ${res.status}`);
                      }
                      const blob = await res.blob();
                      if (blob.size === 0) throw new Error("Downloaded file is empty (0 bytes).");
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${caseId}_mesh.obj`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                    } catch (e) {
                      console.error(e);
                      alert('OBJ mesh not available. Run terrain reconstruction first.\n' + e.message);
                    }
                  }}
                  className="w-full py-2 px-3 bg-secondary-container hover:bg-secondary-container/90 text-primary font-label-md text-label-md font-semibold rounded flex items-center justify-center gap-1.5 transition-colors border border-primary/30 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px]">download</span>
                  <span>Download .OBJ Mesh</span>
                </button>
              </div>
            )}
          </div>

          {/* Target Inspector Card */}
          <div className="bg-surface-container-low rounded-DEFAULT p-space-md shadow-md border-l-2 border-error border border-outline-variant/40">
            <div className="flex items-center justify-between pb-space-sm border-b border-outline-variant/30 mb-space-sm">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-error animate-ping"></span>
                <span className="font-label-sm text-label-sm text-error font-semibold tracking-wider uppercase">Hazard Inspection</span>
              </div>
              <span className="px-2 py-0.5 rounded-DEFAULT bg-error-container text-error font-label-sm text-[10px] font-bold tracking-widest">
                {selectedRegion ? (selectedRegion.classification || 'POTENTIAL CHANGE') : 'NO REGION'}
              </span>
            </div>

            <div className="mb-space-md">
              <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold uppercase">
                {selectedRegion ? selectedRegion.label : 'NO REGION SELECTED'}
              </h2>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
                {selectedRegion 
                  ? 'Steep planar shear gradient identified by monocular photogrammetric relief differential.' 
                  : 'Select a candidate change zone in Change Detection to inspect terrain deformation in 3D.'}
              </p>
            </div>

            <div className="flex flex-col gap-2.5 mb-space-md">
              <div className="p-2.5 bg-surface-container rounded-DEFAULT flex items-center justify-between border border-outline-variant/30">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-error text-[18px]">crisis_alert</span>
                  <span className="font-label-sm text-label-sm text-on-surface-variant">Classification</span>
                </div>
                <span className="font-label-md text-label-md text-error font-bold px-2 py-0.5 bg-error-container/60 rounded-DEFAULT">
                  {selectedRegion ? (selectedRegion.classification || 'POTENTIAL CHANGE') : '—'}
                </span>
              </div>

              <div className="p-2.5 bg-surface-container rounded-DEFAULT flex flex-col gap-1 border border-outline-variant/30">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-tertiary text-[18px]">trending_down</span>
                    <span className="font-label-sm text-label-sm text-on-surface-variant">Relative Change (Δz)</span>
                  </div>
                  <span className="font-label-md text-label-md text-error font-bold font-mono">
                    {selectedRegion?.relative_change != null ? `+${(selectedRegion.relative_change * 100).toFixed(1)}%` : '—'}
                  </span>
                </div>
              </div>

              <div className="p-2.5 bg-surface-container rounded-DEFAULT flex items-center justify-between border border-outline-variant/30">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-tertiary text-[18px]">verified_user</span>
                  <span className="font-label-sm text-label-sm text-on-surface-variant">Confidence Metric</span>
                </div>
                <span className="font-label-md text-label-md text-tertiary font-semibold" title="Confidence not quantified for this prototype">
                  null (Prototype)
                </span>
              </div>
            </div>

            {/* Action Button */}
            <button 
              onClick={() => onNavigate('/simulation')}
              className="w-full py-3 px-4 bg-primary text-on-primary hover:bg-primary-container font-label-lg text-label-lg font-semibold rounded-DEFAULT flex items-center justify-center gap-2 transition-all shadow-[0_0_16px_rgba(95,217,209,0.3)] active:scale-[0.98] cursor-pointer"
            >
              <span>FORWARD TO SIMULATION</span>
              <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
            </button>
          </div>

          {/* Infrastructure Impact Card */}
          <div className="bg-surface-container-low rounded-DEFAULT p-space-md shadow-sm border border-outline-variant/40 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-tertiary text-[18px]">traffic</span>
              <span className="font-label-sm text-label-sm text-on-surface font-medium tracking-wide">CORRIDOR VULNERABILITY</span>
            </div>
            <p className="font-body-sm text-body-sm text-on-surface-variant leading-relaxed">
              Surface trajectory inspection indicates downslope corridor proximity. Run physical scenario modeling to prioritize on-site geotechnical dispatch.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
