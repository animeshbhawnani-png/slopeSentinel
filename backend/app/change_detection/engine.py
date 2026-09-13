import os
import json
import time
import math
import uuid
import logging
from typing import Dict, Any, List, Optional, Tuple

import numpy as np
from PIL import Image
import scipy.ndimage as ndimage

from app.depthwizard.pipeline import get_depthwizard_pipeline

logger = logging.getLogger("change_detection")
logger.setLevel(logging.INFO)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class TemporalChangeEngine:
    """
    Temporal Terrain Change Detection Engine.
    
    Reuses the DepthWizard pipeline to reconstruct Before and After observations,
    aligns spatial rasters, computes differential elevation (Δz), filters numerical noise,
    generates a visual change map, and extracts contiguous candidate changed regions.
    """

    def __init__(self):
        self.pipeline = get_depthwizard_pipeline()

    def align_rasters(self, before_arr: np.ndarray, after_arr: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        """
        Step 3: Spatial Alignment.
        Ensures compatible raster dimensions and normalizes resolution via bicubic resampling.
        """
        if before_arr.shape == after_arr.shape:
            return before_arr, after_arr

        # Target dimensions = before_arr shape
        target_h, target_w = before_arr.shape[:2]
        h, w = after_arr.shape[:2]

        zoom_factors = (target_h / h, target_w / w)
        if after_arr.ndim == 3:
            zoom_factors = (target_h / h, target_w / w, 1)

        aligned_after = ndimage.zoom(after_arr, zoom_factors, order=2)
        return before_arr, aligned_after[:target_h, :target_w]

    def compute_terrain_difference(
        self,
        before_depth: np.ndarray,
        after_depth: np.ndarray,
        noise_sigma: float = 1.2,
        stable_thresh: float = 0.08,
        sig_thresh: float = 0.22
    ) -> Tuple[np.ndarray, np.ndarray, Dict[str, Any]]:
        """
        Step 4: Terrain Difference Calculation.
        difference = after_terrain - before_terrain
        1. Normalizes difference
        2. Removes numerical noise via Gaussian smoothing
        3. Segments into STABLE, CHANGED, and SIGNIFICANT CHANGE
        """
        # Ensure identical raster bounds
        b_depth, a_depth = self.align_rasters(before_depth, after_depth)

        # Raw differential elevation
        raw_diff = a_depth - b_depth

        # Noise reduction via Gaussian filter
        filtered_diff = ndimage.gaussian_filter(raw_diff, sigma=noise_sigma)

        # Absolute change magnitude
        abs_diff = np.abs(filtered_diff)

        # Remove negligible numerical sensor flutter
        abs_diff[abs_diff < 0.04] = 0.0

        # Classification categorical raster:
        # 0 = Stable (< stable_thresh)
        # 1 = Changed (stable_thresh <= diff < sig_thresh)
        # 2 = Significant Change (>= sig_thresh)
        classes = np.zeros_like(abs_diff, dtype=np.uint8)
        classes[abs_diff >= stable_thresh] = 1
        classes[abs_diff >= sig_thresh] = 2

        total_pixels = abs_diff.size
        stable_count = int(np.sum(classes == 0))
        changed_count = int(np.sum(classes == 1))
        sig_count = int(np.sum(classes == 2))

        stats = {
            "total_pixels": total_pixels,
            "stable_fraction": round(stable_count / total_pixels, 4),
            "changed_fraction": round(changed_count / total_pixels, 4),
            "significant_change_fraction": round(sig_count / total_pixels, 4),
            "max_relative_difference": round(float(np.max(abs_diff)), 4),
            "mean_relative_difference": round(float(np.mean(abs_diff)), 4),
            "change_thresholds": {
                "stable": f"< {stable_thresh}",
                "changed": f"{stable_thresh} - {sig_thresh}",
                "significant": f">= {sig_thresh}"
            }
        }

        return filtered_diff, classes, stats

    def generate_change_map(
        self,
        diff_arr: np.ndarray,
        classes: np.ndarray,
        output_png_path: str,
        output_npy_path: Optional[str] = None
    ) -> str:
        """
        Generates visual change map raster using SlopeSentinel color scheme:
        - Stable: Deep alpine teal (#0e3830)
        - Changed: Warm amber / sand (#FF7652)
        - Significant Change: High-visibility orange / red (#e94b4b)
        """
        H, W = classes.shape

        # Base RGB canvas
        r = np.full((H, W), 14, dtype=np.uint8)   # #0e
        g = np.full((H, W), 56, dtype=np.uint8)   # #38
        b = np.full((H, W), 48, dtype=np.uint8)   # #30

        # Changed (Class 1) -> Sand / Coral (#FF7652)
        c1 = classes == 1
        r[c1] = 255
        g[c1] = 118
        b[c1] = 82

        # Significant (Class 2) -> High-alert Crimson (#e94b4b)
        c2 = classes == 2
        r[c2] = 233
        g[c2] = 75
        b[c2] = 75

        # Blend with subtle hillshade intensity for realistic relief representation
        dy, dx = np.gradient(diff_arr)
        slope = np.clip(np.sqrt(dx**2 + dy**2) * 5.0, 0.0, 0.4)
        r = np.clip(r * (1.0 + slope), 0, 255).astype(np.uint8)
        g = np.clip(g * (1.0 + slope), 0, 255).astype(np.uint8)
        b = np.clip(b * (1.0 + slope), 0, 255).astype(np.uint8)

        change_rgb = np.stack([r, g, b], axis=-1)
        change_img = Image.fromarray(change_rgb, mode="RGB")

        os.makedirs(os.path.dirname(output_png_path), exist_ok=True)
        change_img.save(output_png_path, format="PNG")

        if output_npy_path:
            os.makedirs(os.path.dirname(output_npy_path), exist_ok=True)
            np.save(output_npy_path, diff_arr.astype(np.float32))

        return output_png_path

    def extract_changed_regions(
        self,
        classes: np.ndarray,
        diff_arr: np.ndarray,
        observation_interval: str,
        min_cluster_pixels: int = 50
    ) -> List[Dict[str, Any]]:
        """
        Step 5: Contiguous Changed Region Extraction.
        Applies connected components labeling to identify contiguous candidate change zones.
        Computes bounding box, relative magnitude, area fraction, and classification.
        """
        # Binary mask of significant change (or moderate if no significant)
        sig_mask = classes == 2
        if np.sum(sig_mask) < min_cluster_pixels:
            sig_mask = classes >= 1

        labeled_array, num_features = ndimage.label(sig_mask)
        if num_features == 0:
            return []

        H, W = classes.shape
        total_pixels = H * W
        regions = []

        zone_letters = ["A", "B", "C", "D", "E"]
        slices = ndimage.find_objects(labeled_array)

        # Sort clusters by pixel area descending
        cluster_sizes = [(i + 1, np.sum(labeled_array == (i + 1))) for i in range(num_features)]
        cluster_sizes.sort(key=lambda x: x[1], reverse=True)

        for rank, (label_idx, p_count) in enumerate(cluster_sizes[:3]):
            if p_count < min_cluster_pixels:
                continue

            sl = slices[label_idx - 1]
            min_y, max_y = sl[0].start, sl[0].stop
            min_x, max_x = sl[1].start, sl[1].stop

            cluster_diff = diff_arr[labeled_array == label_idx]
            mean_rel_change = float(np.mean(np.abs(cluster_diff)))
            max_rel_change = float(np.max(np.abs(cluster_diff)))

            # Relative classification
            if mean_rel_change >= 0.20:
                classification = "SIGNIFICANT CHANGE"
            else:
                classification = "POTENTIAL TERRAIN CHANGE"

            letter = zone_letters[rank] if rank < len(zone_letters) else f"Z{rank+1}"
            zone_id = f"zone_{letter.lower()}"

            region_dict = {
                "id": zone_id,
                "label": f"ZONE {letter}",
                "classification": classification,
                "relative_change": round(mean_rel_change, 3),
                "peak_relative_change": round(max_rel_change, 3),
                "confidence": None,  # Strictly null as required
                "affected_pixels": int(p_count),
                "area_fraction": round(p_count / total_pixels, 4),
                "observation_interval": observation_interval,
                "next_step": "FIELD VERIFICATION RECOMMENDED",
                "bbox": [int(min_y), int(min_x), int(max_y), int(max_x)],
                "bbox_pct": {
                    "top": round((min_y / H) * 100, 1),
                    "left": round((min_x / W) * 100, 1),
                    "width": round(((max_x - min_x) / W) * 100, 1),
                    "height": round(((max_y - min_y) / H) * 100, 1)
                }
            }
            regions.append(region_dict)

        return regions

    def analyze_custom_pair(
        self,
        before_bytes: bytes,
        after_bytes: bytes,
        static_dir: str,
        before_label: str = "Custom Baseline Observation",
        after_label: str = "Custom Repeat Observation"
    ) -> Dict[str, Any]:
        """
        Executes change detection between two custom user-uploaded images.
        """
        t0 = time.time()
        req_id = str(uuid.uuid4())[:8]

        # 1. Reconstruct Before
        before_result = self.pipeline.run(
            image_bytes=before_bytes,
            static_dir=static_dir,
            calibration_mode="relative",
            filename_prefix=f"custom_{req_id}_before"
        )

        # 2. Reconstruct After
        after_result = self.pipeline.run(
            image_bytes=after_bytes,
            static_dir=static_dir,
            calibration_mode="relative",
            filename_prefix=f"custom_{req_id}_after"
        )

        # 3. Load depth tensors
        before_depth_path = os.path.join(static_dir, before_result["depth_array"].replace("/static/", ""))
        after_depth_path = os.path.join(static_dir, after_result["depth_array"].replace("/static/", ""))

        before_depth = np.load(before_depth_path)
        after_depth = np.load(after_depth_path)

        # 4. Difference & Segmentation
        diff_arr, classes, stats = self.compute_terrain_difference(before_depth, after_depth)

        # Save change map
        change_map_rel = f"/static/outputs/custom_{req_id}_change_map.png"
        change_npy_rel = f"/static/outputs/custom_{req_id}_change.npy"

        output_png_path = os.path.join(static_dir, "outputs", f"custom_{req_id}_change_map.png")
        output_npy_path = os.path.join(static_dir, "outputs", f"custom_{req_id}_change.npy")

        self.generate_change_map(diff_arr, classes, output_png_path, output_npy_path)

        # Save uploaded images to web path
        static_uploads = os.path.join(static_dir, "uploads")
        os.makedirs(static_uploads, exist_ok=True)
        web_before_path = os.path.join(static_uploads, f"custom_{req_id}_before.png")
        web_after_path = os.path.join(static_uploads, f"custom_{req_id}_after.png")

        with open(web_before_path, "wb") as f:
            f.write(before_bytes)
        with open(web_after_path, "wb") as f:
            f.write(after_bytes)

        # 5. Extract changed regions
        obs_interval = "Custom Upload Interval"
        changed_regions = self.extract_changed_regions(classes, diff_arr, obs_interval)

        t_total = time.time() - t0
        primary_region = changed_regions[0] if changed_regions else None
        total_change_fraction = stats["changed_fraction"] + stats["significant_change_fraction"]
        overall_classification = (
            "SIGNIFICANT CHANGE" if stats["significant_change_fraction"] >= 0.04
            else "POTENTIAL TERRAIN CHANGE" if total_change_fraction >= 0.05
            else "STABLE / NOMINAL"
        )

        return {
            "status": "success",
            "case_id": f"custom_{req_id}",
            "title": f"Custom Pair Analysis ({req_id})",
            "sector": "User Uploaded Region",
            "location": "Custom Field Survey Coordinates",
            "observation_interval": obs_interval,
            "overall_classification": overall_classification,
            "comparison_mode": "Relative Terrain Difference",
            "confidence": None,
            "confidence_message": "Change confidence not quantified for this prototype.",
            "before": {
                "image": f"/static/uploads/custom_{req_id}_before.png",
                "date": "User Upload Baseline",
                "conditions": "Optical Survey",
                "sensor": before_label,
                "depth_map": before_result["depth_map"],
                "dsm": before_result["dsm"],
                "mesh": before_result["mesh"],
                "heuristic_indicators": before_result["heuristic_indicators"]
            },
            "after": {
                "image": f"/static/uploads/custom_{req_id}_after.png",
                "date": "User Upload Repeat",
                "conditions": "Optical Re-Survey",
                "sensor": after_label,
                "depth_map": after_result["depth_map"],
                "dsm": after_result["dsm"],
                "mesh": after_result["mesh"],
                "heuristic_indicators": after_result["heuristic_indicators"]
            },
            "change_map": change_map_rel,
            "change_array": change_npy_rel,
            "changed_regions": changed_regions,
            "summary": {
                "largest_change_region": primary_region["id"] if primary_region else None,
                "change_fraction": total_change_fraction,
                "significant_fraction": stats["significant_change_fraction"],
                "max_relative_difference": stats["max_relative_difference"],
                "mean_relative_difference": stats["mean_relative_difference"],
                "confidence": None
            },
            "stats": stats,
            "metadata": {
                "processing_time_s": round(t_total, 3),
                "disclaimer": (
                    "Relative terrain difference detected. Change extent and boundaries are indicative "
                    "and require field verification. Not a definitive landslide classification."
                )
            }
        }



# Singleton engine accessor
_CHANGE_ENGINE = None

def get_change_engine() -> TemporalChangeEngine:
    global _CHANGE_ENGINE
    if _CHANGE_ENGINE is None:
        _CHANGE_ENGINE = TemporalChangeEngine()
    return _CHANGE_ENGINE



