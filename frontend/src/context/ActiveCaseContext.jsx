import React, { createContext, useContext, useState, useEffect } from 'react';

const ActiveCaseContext = createContext(null);

const STORAGE_KEY = 'slopesentinel_active_case';
const SELECTED_REGION_STORAGE_KEY = 'slopesentinel_selected_change_region';

const EMPTY_CASE = {
  active_case_id: null,
  source_type: null,
  reconstruction: null,
  change_outputs: null,
  risk_outputs: null,
  selected_region: null
};

function loadStoredCase() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);

    if (saved) {
      const parsed = JSON.parse(saved);

      if (parsed && typeof parsed === 'object') {
        const loaded = {
          ...EMPTY_CASE,
          ...parsed
        };

        // If selected_region is not in parsed, check if it was persisted individually
        if (!loaded.selected_region) {
          try {
            const savedRegion = localStorage.getItem(SELECTED_REGION_STORAGE_KEY);
            if (savedRegion) {
              const parsedReg = JSON.parse(savedRegion);
              if (parsedReg && parsedReg.region_id) {
                // If change outputs exist, restore the matching region object
                if (loaded.change_outputs?.changed_regions) {
                  const match = loaded.change_outputs.changed_regions.find(
                    (r) => r.id === parsedReg.region_id
                  );
                  if (match) {
                    loaded.selected_region = match;
                  }
                }
              }
            }
          } catch (regErr) {
            // Ignore parse errors on region fallback
          }
        }

        return loaded;
      }
    }
  } catch (e) {
    console.warn('Could not parse stored active case:', e);
  }

  return EMPTY_CASE;
}

function clearPersistedSelectedRegion() {
  try {
    localStorage.removeItem(SELECTED_REGION_STORAGE_KEY);
  } catch (e) {
    console.warn('Could not clear persisted selected region:', e);
  }
}

export function ActiveCaseProvider({ children }) {
  const [activeCase, setActiveCase] = useState(loadStoredCase);

  // Persist the complete active case so navigation/reloads retain the
  // current live reconstruction, change result, and selected region.
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(activeCase)
      );
    } catch (e) {
      console.warn('Could not persist active case:', e);
    }
  }, [activeCase]);

  // On first mount, recover the latest backend reconstruction if the
  // browser has no reconstruction saved locally.
  useEffect(() => {
    if (activeCase?.reconstruction) {
      return;
    }

    fetch('/api/terrain/active')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data || data.status !== 'success') {
          return;
        }

        const sourceType = data.source_type || 'LIVE';

        setActiveCase((prev) => ({
          ...prev,
          active_case_id:
            data.case_id ||
            prev.active_case_id,
          source_type: sourceType,
          reconstruction: data,

          // Backend recovery gives us a reconstruction only.
          // Never attach a stale change/risk result to a newly recovered
          // reconstruction.
          change_outputs: null,
          risk_outputs: null,
          selected_region: null
        }));

        clearPersistedSelectedRegion();
      })
      .catch((err) => {
        console.warn(
          'Could not fetch active reconstruction:',
          err
        );
      });
    // This is intentionally a mount-time recovery request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLiveReconstruction = (reconstructionData) => {
    if (!reconstructionData) {
      return;
    }

    const cid =
      reconstructionData.case_id ||
      `live_recon_${Date.now()}`;

    setActiveCase({
      active_case_id: cid,
      source_type: 'LIVE',
      reconstruction: reconstructionData,

      // A new reconstruction invalidates ALL downstream analysis.
      change_outputs: null,
      risk_outputs: null,
      selected_region: null
    });

    // Do not allow a zone from a previous observation to follow
    // a new live reconstruction.
    clearPersistedSelectedRegion();
  };

  const setChangeOutputs = (changeData) => {
    setActiveCase((prev) => ({
      ...prev,

      change_outputs: changeData || null,

      // Any newly-computed change result invalidates an older risk result.
      risk_outputs: null,

      // First detected region becomes the default active zone.
      // Clearing change data also clears the selected zone.
      selected_region:
        changeData?.changed_regions?.[0] ||
        null
    }));

    if (!changeData) {
      clearPersistedSelectedRegion();
    } else {
      const firstRegion =
        changeData?.changed_regions?.[0];

      if (firstRegion) {
        try {
          localStorage.setItem(
            SELECTED_REGION_STORAGE_KEY,
            JSON.stringify({
              case_id:
                changeData.case_id ||
                null,
              region_id:
                firstRegion.id,
              label:
                firstRegion.label,
              classification:
                firstRegion.classification,
              relative_change:
                firstRegion.relative_change,
              observation_interval:
                firstRegion.observation_interval,
              bbox_pct:
                firstRegion.bbox_pct
            })
          );
        } catch (e) {
          console.warn(
            'Could not persist selected change region:',
            e
          );
        }
      } else {
        clearPersistedSelectedRegion();
      }
    }
  };

  const setSelectedRegion = (region) => {
    setActiveCase((prev) => ({
      ...prev,
      selected_region: region || null
    }));

    if (!region) {
      clearPersistedSelectedRegion();
      return;
    }

    try {
      localStorage.setItem(
        SELECTED_REGION_STORAGE_KEY,
        JSON.stringify({
          case_id:
            region.case_id ||
            activeCase?.change_outputs?.case_id ||
            activeCase?.active_case_id ||
            null,
          region_id: region.id,
          label: region.label,
          classification: region.classification,
          relative_change: region.relative_change,
          observation_interval: region.observation_interval,
          bbox_pct: region.bbox_pct,
          area_fraction: region.area_fraction,
          affected_pixels: region.affected_pixels
        })
      );
    } catch (e) {
      console.warn(
        'Could not persist selected change region:',
        e
      );
    }
  };

  const setRiskOutputs = (riskData) => {
    setActiveCase((prev) => ({
      ...prev,
      risk_outputs: riskData || null
    }));
  };

  const clearActiveCase = () => {
    setActiveCase(EMPTY_CASE);
    clearPersistedSelectedRegion();
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(SELECTED_REGION_STORAGE_KEY);
    } catch (e) {
      console.warn('Could not clear storage:', e);
    }
  };

  return (
    <ActiveCaseContext.Provider
      value={{
        activeCase,
        setActiveCase,
        setLiveReconstruction,
        setChangeOutputs,
        setSelectedRegion,
        setRiskOutputs,
        clearActiveCase,
        resetActiveCase: clearActiveCase
      }}
    >
      {children}
    </ActiveCaseContext.Provider>
  );
}

export function useActiveCase() {
  const context = useContext(
    ActiveCaseContext
  );

  if (!context) {
    throw new Error(
      'useActiveCase must be used within an ActiveCaseProvider'
    );
  }

  return context;
}
