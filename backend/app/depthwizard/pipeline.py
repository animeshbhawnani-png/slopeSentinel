import io
import os
import time
import math
import uuid
import logging
from typing import Dict, Any, Optional, Tuple

import numpy as np
from PIL import Image, ImageOps
import scipy.ndimage as ndimage
import torch
from transformers import pipeline as hf_pipeline


logger = logging.getLogger("depthwizard")
logger.setLevel(logging.INFO)


# ---------------------------------------------------------------------------
# Global singleton cache for Depth Anything V2
# ---------------------------------------------------------------------------

_DEPTH_ANYTHING_PIPELINE = None
_MODEL_NAME = "depth-anything/Depth-Anything-V2-Small-hf"
_DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
_MODEL_LOAD_TIME_S = 0.0


def load_depth_anything_model():
    """
    Initializes and caches the Depth Anything V2 pipeline singleton.
    """
    global _DEPTH_ANYTHING_PIPELINE, _MODEL_LOAD_TIME_S

    if _DEPTH_ANYTHING_PIPELINE is None:
        logger.info(
            "Loading Depth Anything V2 model (%s) on device: %s...",
            _MODEL_NAME,
            _DEVICE,
        )

        t0 = time.time()

        try:
            _DEPTH_ANYTHING_PIPELINE = hf_pipeline(
                task="depth-estimation",
                model=_MODEL_NAME,
                device=_DEVICE,
            )

            _MODEL_LOAD_TIME_S = round(time.time() - t0, 3)

            logger.info(
                "Depth Anything V2 loaded successfully in %.3fs on %s",
                _MODEL_LOAD_TIME_S,
                _DEVICE,
            )

        except Exception as e:
            logger.error("Failed to load Depth Anything V2: %s", e)
            raise

    return _DEPTH_ANYTHING_PIPELINE


class DepthWizardPipeline:
    """
    DepthWizard MVP Terrain Reconstruction Pipeline.

    Architecture:

        INPUT IMAGE
            ↓
        PREPROCESSING
            ↓
        MONOCULAR DEPTH ESTIMATION
            ↓
        ROBUST DEPTH NORMALIZATION
            ↓
        TERRAIN-ORIENTED SURFACE FILTER
            ↓
        OPTIONAL CALIBRATION
            ↓
        DSM / HEIGHTMAP
            ↓
        3D TERRAIN MESH
    """

    def __init__(self):
        self.model_name = "Depth Anything V2 (Small-hf)"
        self.device = _DEVICE

        # Ensure model is initialized.
        load_depth_anything_model()

    # -----------------------------------------------------------------------
    # Stage 1: Input validation
    # -----------------------------------------------------------------------

    def validate_and_decode_input(self, image_bytes: bytes) -> Image.Image:
        """
        Accepts JPG/JPEG/PNG/TIFF/WebP/GeoTIFF-compatible image streams.
        Returns an RGB PIL image.
        """

        if not image_bytes or len(image_bytes) == 0:
            raise ValueError("Uploaded image payload is empty (0 bytes).")

        if len(image_bytes) > 50 * 1024 * 1024:
            raise ValueError(
                "Uploaded image exceeds maximum allowed size of 50MB."
            )

        try:
            img = Image.open(io.BytesIO(image_bytes))
            img.verify()

        except Exception as e:
            raise ValueError(
                f"Corrupt or unsupported image stream: {str(e)}"
            )

        img = Image.open(io.BytesIO(image_bytes))

        try:
            img = ImageOps.exif_transpose(img)
        except Exception:
            pass

        return img.convert("RGB")

    # -----------------------------------------------------------------------
    # Stage 2: Preprocessing
    # -----------------------------------------------------------------------

    def preprocess(
        self,
        image: Image.Image,
        max_dim: int = 1024,
    ) -> Tuple[Image.Image, Dict[str, Any]]:
        """
        Preserves aspect ratio while constraining processing resolution.
        """

        orig_w, orig_h = image.size

        scale = min(
            1.0,
            max_dim / max(orig_w, orig_h),
        )

        new_w = max(64, int(orig_w * scale))
        new_h = max(64, int(orig_h * scale))

        # Align dimensions to ViT-friendly 14-pixel patch multiples.
        new_w = max(14, (new_w // 14) * 14)
        new_h = max(14, (new_h // 14) * 14)

        processed_img = image.resize(
            (new_w, new_h),
            Image.Resampling.BICUBIC,
        )

        img_np = np.array(processed_img, dtype=np.float32) / 255.0

        luminance = (
            0.2989 * img_np[:, :, 0]
            + 0.5870 * img_np[:, :, 1]
            + 0.1140 * img_np[:, :, 2]
        )

        # These remain diagnostic heuristics only.
        shadow_mask = luminance < 0.10
        shadow_ratio = float(np.mean(shadow_mask))

        lum_grad = ndimage.generic_gradient_magnitude(
            luminance,
            ndimage.sobel,
        )

        low_texture_mask = lum_grad < 0.02
        low_texture_ratio = float(np.mean(low_texture_mask))

        metadata = {
            "original_resolution": [orig_w, orig_h],
            "inference_resolution": [new_w, new_h],
            "aspect_ratio_preserved": True,
            "mean_luminance": float(np.mean(luminance)),
            "contrast_std": float(np.std(luminance)),
            "heuristic_indicators": {
                "shadow_mask_ratio": round(shadow_ratio, 4),
                "low_texture_ratio": round(low_texture_ratio, 4),
                "note": (
                    "Heuristic detection only; not empirical confidence."
                ),
            },
        }

        return processed_img, metadata

    # -----------------------------------------------------------------------
    # Stage 3: Depth Anything V2
    # -----------------------------------------------------------------------

    def estimate_depth(
        self,
        pil_image: Image.Image,
    ) -> Tuple[np.ndarray, float, Dict[str, Any]]:
        """
        Runs Depth Anything V2 and converts the result into robust
        normalized relative depth.

        IMPORTANT:
        This remains relative monocular depth. It is not metric elevation.
        """

        pipe = load_depth_anything_model()

        t0 = time.time()

        with torch.no_grad():
            result = pipe(pil_image)

        t_infer = time.time() - t0

        # Extract model prediction.
        if "predicted_depth" in result:
            raw_depth = result["predicted_depth"]

            if isinstance(raw_depth, torch.Tensor):
                depth_arr = (
                    raw_depth
                    .squeeze()
                    .detach()
                    .cpu()
                    .numpy()
                    .astype(np.float32)
                )
            else:
                depth_arr = np.asarray(
                    raw_depth,
                    dtype=np.float32,
                )

        elif "depth" in result:
            depth_arr = np.asarray(
                result["depth"],
                dtype=np.float32,
            )

        else:
            raise RuntimeError(
                "Unexpected output structure from Depth Anything V2 pipeline."
            )

        depth_arr = np.squeeze(depth_arr)

        if depth_arr.ndim != 2:
            raise RuntimeError(
                f"Unexpected depth shape: {depth_arr.shape}"
            )

        # -------------------------------------------------------------------
        # Clean non-finite values first.
        # -------------------------------------------------------------------

        finite_mask = np.isfinite(depth_arr)

        if not np.any(finite_mask):
            raise RuntimeError(
                "Depth Anything V2 returned no finite depth values."
            )

        finite_values = depth_arr[finite_mask]

        raw_min = float(np.min(finite_values))
        raw_max = float(np.max(finite_values))
        raw_mean = float(np.mean(finite_values))
        raw_median = float(np.median(finite_values))

        p01 = float(np.percentile(finite_values, 1.0))
        p05 = float(np.percentile(finite_values, 5.0))
        p50 = float(np.percentile(finite_values, 50.0))
        p95 = float(np.percentile(finite_values, 95.0))
        p99 = float(np.percentile(finite_values, 99.0))

        cleaned_depth = np.nan_to_num(
            depth_arr,
            nan=raw_median,
            posinf=p99,
            neginf=p01,
        )

        # -------------------------------------------------------------------
        # Robust normalization.
        #
        # Previously:
        #   (depth - min) / (max - min)
        #
        # That makes isolated prediction extremes control the full surface.
        #
        # Now:
        #   0.5 percentile → 0
        #   99.5 percentile → 1
        #
        # Values outside that range are clipped.
        # -------------------------------------------------------------------

        low = float(np.percentile(cleaned_depth, 0.5))
        high = float(np.percentile(cleaned_depth, 99.5))

        if high > low:
            normalized_depth = np.clip(
                (cleaned_depth - low) / (high - low),
                0.0,
                1.0,
            )
        else:
            normalized_depth = np.full_like(
                cleaned_depth,
                0.5,
                dtype=np.float32,
            )

        depth_stats = {
            "raw_min": raw_min,
            "raw_max": raw_max,
            "raw_mean": raw_mean,
            "raw_median": raw_median,
            "raw_p01": p01,
            "raw_p05": p05,
            "raw_p50": p50,
            "raw_p95": p95,
            "raw_p99": p99,
            "finite_fraction": float(np.mean(finite_mask)),
            "normalization_low": low,
            "normalization_high": high,
        }

        return (
            normalized_depth.astype(np.float32),
            round(t_infer, 3),
            depth_stats,
        )

    # -----------------------------------------------------------------------
    # Stage 4: Terrain surface filtering
    # -----------------------------------------------------------------------
    def filter_terrain_surface(
        self,
        normalized_depth: np.ndarray,
        median_size: int = 9,
        gaussian_sigma: float = 4.0,
        outlier_sigma: float = 2.0,
        absolute_threshold: float = 0.035,
    ) -> Tuple[np.ndarray, Dict[str, Any]]:
        # """
        # Convert raw monocular depth into a smoother
        # terrain-oriented relative surface.

        # IMPORTANT:
        # This is a prototype terrain-surface heuristic.
        # It is NOT a semantic ground/building/vegetation
        # segmentation model and is NOT a geotechnical DSM.

        # The design goal is to preserve broad terrain relief
        # while strongly suppressing narrow object-level peaks
        # caused by buildings, trees, roofs and other visible
        # structures.
        # """

        source = np.asarray(
            normalized_depth,
            dtype=np.float32,
        )

        source = np.nan_to_num(
            source,
            nan=0.5,
            posinf=1.0,
            neginf=0.0,
        )

        source = np.clip(
            source,
            0.0,
            1.0,
        )

        # ------------------------------------------------------------
        # 1. Robust local surface
        # ------------------------------------------------------------

        if median_size < 3:
            median_size = 3

        if median_size % 2 == 0:
            median_size += 1

        median_surface = ndimage.median_filter(
            source,
            size=median_size,
            mode="nearest",
        )

        # ------------------------------------------------------------
        # 2. Multi-scale low-frequency terrain estimates
        # ------------------------------------------------------------

        small_scale = ndimage.gaussian_filter(
            source,
            sigma=max(1.5, gaussian_sigma * 0.5),
            mode="nearest",
        )

        medium_scale = ndimage.gaussian_filter(
            source,
            sigma=max(2.5, gaussian_sigma),
            mode="nearest",
        )

        broad_scale = ndimage.gaussian_filter(
            source,
            sigma=max(4.0, gaussian_sigma * 2.0),
            mode="nearest",
        )

        # Broad terrain gets the strongest influence.
        terrain_base = (
            0.20 * median_surface
            + 0.25 * small_scale
            + 0.25 * medium_scale
            + 0.30 * broad_scale
        )

        # ------------------------------------------------------------
        # 3. Detect narrow object-scale deviations
        # ------------------------------------------------------------

        residual = (
            source - terrain_base
        )

        abs_residual = np.abs(
            residual
        )

        residual_median = float(
            np.median(abs_residual)
        )

        residual_mad = float(
            np.median(
                np.abs(
                    abs_residual
                    - residual_median
                )
            )
        )

        robust_sigma = max(
            1.4826 * residual_mad,
            1e-4,
        )

        threshold = max(
            outlier_sigma * robust_sigma,
            absolute_threshold,
        )

        strong_outlier_mask = (
            abs_residual > threshold
        )

        # ------------------------------------------------------------
        # 4. Replace strong deviations with terrain base
        # ------------------------------------------------------------

        filtered = source.copy()

        filtered[
            strong_outlier_mask
        ] = terrain_base[
            strong_outlier_mask
        ]

        # ------------------------------------------------------------
        # 5. Morphological opening/closing
        #
        # Removes narrow peaks and fills tiny holes while retaining
        # larger terrain forms.
        # ------------------------------------------------------------

        filtered = ndimage.grey_opening(
            filtered,
            size=(5, 5),
        )

        filtered = ndimage.grey_closing(
            filtered,
            size=(5, 5),
        )

        # ------------------------------------------------------------
        # 6. Strong continuous smoothing
        # ------------------------------------------------------------

        filtered = ndimage.gaussian_filter(
            filtered,
            sigma=gaussian_sigma,
            mode="nearest",
        )

        # ------------------------------------------------------------
        # 7. Blend toward the broad terrain surface
        #
        # This prevents small object structure from coming back.
        # ------------------------------------------------------------

        filtered = (
            0.80 * filtered
            + 0.20 * broad_scale
        )

        # ------------------------------------------------------------
        # 8. Limit extreme local slopes
        #
        # This is important for preventing single-cell / small-area
        # vertical spikes in the final mesh.
        # ------------------------------------------------------------

        local_min = ndimage.minimum_filter(
            filtered,
            size=7,
            mode="nearest",
        )

        local_max = ndimage.maximum_filter(
            filtered,
            size=7,
            mode="nearest",
        )

        # Maximum allowed deviation from local terrain neighborhood.
        max_local_deviation = 0.12

        filtered = np.maximum(
            filtered,
            local_min - max_local_deviation,
        )

        filtered = np.minimum(
            filtered,
            local_max + max_local_deviation,
        )

        # ------------------------------------------------------------
        # 9. Final low-pass pass
        # ------------------------------------------------------------

        filtered = ndimage.gaussian_filter(
            filtered,
            sigma=2.0,
            mode="nearest",
        )

        # ------------------------------------------------------------
        # 10. Robust final normalization
        # ------------------------------------------------------------

        p01 = float(
            np.percentile(
                filtered,
                1.0,
            )
        )

        p99 = float(
            np.percentile(
                filtered,
                99.0,
            )
        )

        if p99 > p01:
            filtered = np.clip(
                (
                    filtered - p01
                )
                / (
                    p99 - p01
                ),
                0.0,
                1.0,
            )

        else:
            filtered = np.clip(
                filtered,
                0.0,
                1.0,
            )

        filtered = filtered.astype(
            np.float32
        )

        filter_metadata = {
            "method": (
                "Multi-scale terrain extraction with "
                "median filtering, low-frequency Gaussian "
                "surfaces, morphological cleanup, robust "
                "outlier suppression, local slope limiting, "
                "and final smoothing"
            ),
            "median_size": median_size,
            "gaussian_sigma": gaussian_sigma,
            "outlier_sigma": outlier_sigma,
            "absolute_threshold": absolute_threshold,
            "robust_sigma": round(
                float(robust_sigma),
                6,
            ),
            "outlier_threshold": round(
                float(threshold),
                6,
            ),
            "outlier_fraction": round(
                float(
                    np.mean(
                        strong_outlier_mask
                    )
                ),
                6,
            ),
            "outlier_pixels_replaced": int(
                np.count_nonzero(
                    strong_outlier_mask
                )
            ),
            "surface_range": [
                round(
                    float(np.min(filtered)),
                    4,
                ),
                round(
                    float(np.max(filtered)),
                    4,
                ),
            ],
            "note": (
                "Prototype terrain-surface heuristic. "
                "It does not perform semantic ground "
                "segmentation and should not be interpreted "
                "as a geotechnically validated bare-earth DSM."
            ),
        }

        return (
            filtered,
            filter_metadata,
        )

    def calibrate(
        self,
        relative_depth: np.ndarray,
        reference_elevation: Optional[float] = None,
        calibration_mode: str = "relative",
        elevation_span: float = 380.0,
    ) -> Tuple[np.ndarray, Dict[str, Any]]:
        """
        MODE A:
            Relative terrain relief.

        MODE B:
            Reference-calibrated elevation, only when a real reference
            elevation is explicitly supplied.
        """

        if (
            calibration_mode == "calibrated"
            and reference_elevation is not None
            and reference_elevation > 0
        ):
            ref_alt = float(reference_elevation)

            base_elevation = (
                ref_alt
                - (elevation_span * 0.45)
            )

            elevation_grid = (
                base_elevation
                + (relative_depth * elevation_span)
            )

            mode_label = "calibrated"

            desc = (
                "Calibrated to supplied reference elevation anchor: "
                f"{ref_alt:.1f}m ALT "
                f"(Span: {elevation_span:.1f}m)"
            )

            is_anchored = True

        else:
            # IMPORTANT:
            # No metric elevation is claimed in image-only mode.
            mode_label = "relative"
            ref_alt = None

            elevation_grid = (
                relative_depth * 100.0
            )

            desc = (
                "Relative Terrain Relief "
                "(Uncalibrated; 0 - 100 relative units)"
            )

            is_anchored = False

        min_e = float(np.min(elevation_grid))
        max_e = float(np.max(elevation_grid))
        mean_e = float(np.mean(elevation_grid))

        calibration_metadata = {
            "mode": mode_label,
            "is_reference_anchored": is_anchored,
            "reference_elevation_m": ref_alt,
            "calibration_description": desc,
            "min_elevation": round(min_e, 2),
            "max_elevation": round(max_e, 2),
            "mean_elevation": round(mean_e, 2),
            "elevation_range": round(
                max_e - min_e,
                2,
            ),
            "units": (
                "meters"
                if is_anchored
                else "relative_relief_units"
            ),
        }

        return (
            elevation_grid.astype(np.float32),
            calibration_metadata,
        )

    # -----------------------------------------------------------------------
    # Stage 6: DSM + heightmap
    # -----------------------------------------------------------------------

    def generate_dsm_and_heightmap(
        self,
        elevation_grid: np.ndarray,
        is_calibrated: bool = False,
    ) -> Tuple[Image.Image, Image.Image]:
        """
        Generates:
            1. heightmap.png
            2. dsm.png
        """

        del is_calibrated  # Kept for API compatibility.

        H, W = elevation_grid.shape

        min_e = float(np.min(elevation_grid))
        max_e = float(np.max(elevation_grid))

        if max_e > min_e:
            norm = (
                elevation_grid - min_e
            ) / (max_e - min_e)
        else:
            norm = np.full_like(
                elevation_grid,
                0.5,
                dtype=np.float32,
            )

        # Grayscale heightmap.
        heightmap_8bit = (
            np.clip(norm, 0.0, 1.0) * 255.0
        ).astype(np.uint8)

        heightmap_img = Image.fromarray(
            heightmap_8bit,
            mode="L",
        )

        # Analytical hillshade.
        azimuth = math.radians(315.0)
        altitude = math.radians(45.0)

        dy, dx = np.gradient(
            norm * 50.0
        )

        slope = (
            np.pi / 2.0
            - np.arctan(
                np.sqrt(dx ** 2 + dy ** 2)
            )
        )

        aspect = np.arctan2(
            -dx,
            dy,
        )

        shaded = (
            np.sin(altitude) * np.sin(slope)
            + np.cos(altitude)
            * np.cos(slope)
            * np.cos(azimuth - aspect)
        )

        shaded = np.clip(
            shaded,
            0.0,
            1.0,
        )

        # Existing visualization style retained.
        r = np.clip(
            (norm * 1.5 - 0.2)
            * 255.0
            * shaded
            + 22.0,
            0,
            255,
        ).astype(np.uint8)

        g = np.clip(
            (norm * 0.95 + 0.1)
            * 225.0
            * shaded
            + 28.0,
            0,
            255,
        ).astype(np.uint8)

        b = np.clip(
            (1.0 - norm * 0.65)
            * 205.0
            * shaded
            + 35.0,
            0,
            255,
        ).astype(np.uint8)

        dsm_rgb = np.stack(
            [r, g, b],
            axis=-1,
        )

        dsm_img = Image.fromarray(
            dsm_rgb,
            mode="RGB",
        )

        return (
            heightmap_img,
            dsm_img,
        )

    # -----------------------------------------------------------------------
    # Depth visualization
    # -----------------------------------------------------------------------

    def render_depth_colormap(
        self,
        normalized_depth: np.ndarray,
    ) -> Image.Image:
        """
        Renders relative depth into the existing high-visibility
        visualization.
        """

        d = np.clip(
            normalized_depth,
            0.0,
            1.0,
        )

        r = np.clip(
            np.where(
                d < 0.5,
                11
                + d * 2.0 * (37 - 11),
                37
                + (d - 0.5)
                * 2.0
                * (255 - 37),
            ),
            0,
            255,
        ).astype(np.uint8)

        g = np.clip(
            np.where(
                d < 0.5,
                21
                + d * 2.0 * (81 - 21),
                81
                + (d - 0.5)
                * 2.0
                * (217 - 81),
            ),
            0,
            255,
        ).astype(np.uint8)

        b = np.clip(
            np.where(
                d < 0.5,
                19
                + d * 2.0 * (69 - 19),
                69
                + (d - 0.5)
                * 2.0
                * (209 - 69),
            ),
            0,
            255,
        ).astype(np.uint8)

        rgb = np.stack(
            [r, g, b],
            axis=-1,
        )

        return Image.fromarray(
            rgb,
            mode="RGB",
        )

    # -----------------------------------------------------------------------
    # Stage 7: Mesh generation
    # -----------------------------------------------------------------------

    def generate_mesh_obj(
        self,
        elevation_grid: np.ndarray,
        output_filepath: str,
        grid_target: int = 100,
    ) -> Tuple[Dict[str, Any], float]:
        """
        Generates a browser-friendly terrain mesh.

        The mesh is created from the FILTERED terrain-oriented surface.

        Exports:
            v
            vt
            vn
            f
        """

        t0 = time.time()

        H, W = elevation_grid.shape

        if H < 2 or W < 2:
            raise ValueError(
                "Elevation grid is too small to generate a mesh."
            )

        # Preserve true spatial aspect ratio.
        aspect = (
            float(W) / float(H)
            if H > 0
            else 1.0
        )

        if aspect >= 1.0:
            extent_x = 100.0
            extent_z = round(
                100.0 / aspect,
                2,
            )
        else:
            extent_x = round(
                100.0 * aspect,
                2,
            )
            extent_z = 100.0

        # Downsample using linspace rather than simple stride so the
        # complete image extent is always represented.
        target_w = min(
            max(2, grid_target),
            W,
        )

        target_h = min(
            max(2, grid_target),
            H,
        )

        x_idx = np.linspace(
            0,
            W - 1,
            target_w,
        ).astype(np.int32)

        y_idx = np.linspace(
            0,
            H - 1,
            target_h,
        ).astype(np.int32)

        clean_elev = elevation_grid[
            np.ix_(y_idx, x_idx)
        ].astype(np.float32)

        clean_elev = np.nan_to_num(
            clean_elev,
            nan=0.0,
            posinf=0.0,
            neginf=0.0,
        )

        min_e = float(
            np.min(clean_elev)
        )

        max_e = float(
            np.max(clean_elev)
        )

        # Another conservative percentile stretch at mesh stage.
        if max_e > min_e:
            p05 = float(
                np.percentile(
                    clean_elev,
                    0.5,
                )
            )

            p995 = float(
                np.percentile(
                    clean_elev,
                    99.5,
                )
            )

            if p995 > p05:
                norm_e = np.clip(
                    (
                        clean_elev - p05
                    )
                    / (p995 - p05),
                    0.0,
                    1.0,
                )
            else:
                norm_e = (
                    clean_elev - min_e
                ) / (max_e - min_e)

        else:
            norm_e = np.zeros_like(
                clean_elev,
                dtype=np.float32,
            )

        # Conservative relative vertical relief.
        relief_scale = 10.0

        y_grid = (
            norm_e * relief_scale
        ).astype(np.float32)

        sub_h, sub_w = y_grid.shape

        # -------------------------------------------------------------------
        # Surface normals.
        # -------------------------------------------------------------------

        dx_step = extent_x / max(
            1,
            sub_w - 1,
        )

        dz_step = extent_z / max(
            1,
            sub_h - 1,
        )

        dydx = np.zeros_like(
            y_grid,
            dtype=np.float32,
        )

        dydx[:, 1:-1] = (
            y_grid[:, 2:]
            - y_grid[:, :-2]
        ) / (
            2.0 * dx_step
        )

        dydx[:, 0] = (
            y_grid[:, 1]
            - y_grid[:, 0]
        ) / dx_step

        dydx[:, -1] = (
            y_grid[:, -1]
            - y_grid[:, -2]
        ) / dx_step

        dydz = np.zeros_like(
            y_grid,
            dtype=np.float32,
        )

        dydz[1:-1, :] = (
            y_grid[2:, :]
            - y_grid[:-2, :]
        ) / (
            2.0 * dz_step
        )

        dydz[0, :] = (
            y_grid[1, :]
            - y_grid[0, :]
        ) / dz_step

        dydz[-1, :] = (
            y_grid[-1, :]
            - y_grid[-2, :]
        ) / dz_step

        nx = -dydx
        ny = np.ones_like(
            y_grid,
            dtype=np.float32,
        )
        nz = -dydz

        n_len = np.sqrt(
            nx ** 2
            + ny ** 2
            + nz ** 2
        )

        n_len = np.where(
            n_len == 0,
            1.0,
            n_len,
        )

        nx /= n_len
        ny /= n_len
        nz /= n_len

        # -------------------------------------------------------------------
        # Validate normals.
        # -------------------------------------------------------------------

        nx = np.nan_to_num(
            nx,
            nan=0.0,
            posinf=0.0,
            neginf=0.0,
        )

        ny = np.nan_to_num(
            ny,
            nan=1.0,
            posinf=1.0,
            neginf=1.0,
        )

        nz = np.nan_to_num(
            nz,
            nan=0.0,
            posinf=0.0,
            neginf=0.0,
        )

        vertices = []
        texcoords = []
        normals = []

        # -------------------------------------------------------------------
        # Vertex generation.
        # -------------------------------------------------------------------

        for i in range(sub_h):

            v_ratio = (
                float(i)
                / max(1, sub_h - 1)
            )

            z_pos = (
                v_ratio - 0.5
            ) * extent_z

            v_uv = 1.0 - v_ratio

            for j in range(sub_w):

                u_ratio = (
                    float(j)
                    / max(1, sub_w - 1)
                )

                x_pos = (
                    u_ratio - 0.5
                ) * extent_x

                u_uv = u_ratio

                y_pos = float(
                    y_grid[i, j]
                )

                vertices.append(
                    (
                        round(x_pos, 4),
                        round(y_pos, 4),
                        round(z_pos, 4),
                    )
                )

                texcoords.append(
                    (
                        round(u_uv, 5),
                        round(v_uv, 5),
                    )
                )

                normals.append(
                    (
                        round(
                            float(nx[i, j]),
                            5,
                        ),
                        round(
                            float(ny[i, j]),
                            5,
                        ),
                        round(
                            float(nz[i, j]),
                            5,
                        ),
                    )
                )

        # -------------------------------------------------------------------
        # Grid triangulation.
        # -------------------------------------------------------------------

        faces = []

        for i in range(sub_h - 1):

            for j in range(sub_w - 1):

                top_left = (
                    i * sub_w
                    + j
                    + 1
                )

                top_right = (
                    top_left + 1
                )

                bottom_left = (
                    (i + 1)
                    * sub_w
                    + j
                    + 1
                )

                bottom_right = (
                    bottom_left + 1
                )

                faces.append(
                    (
                        top_left,
                        bottom_left,
                        top_right,
                    )
                )

                faces.append(
                    (
                        top_right,
                        bottom_left,
                        bottom_right,
                    )
                )

        # -------------------------------------------------------------------
        # OBJ validation before writing.
        # -------------------------------------------------------------------

        vertex_count = len(vertices)
        face_count = len(faces)

        if vertex_count == 0:
            raise RuntimeError(
                "Mesh contains zero vertices."
            )

        if face_count == 0:
            raise RuntimeError(
                "Mesh contains zero faces."
            )

        max_face_index = max(
            max(face)
            for face in faces
        )

        if max_face_index > vertex_count:
            raise RuntimeError(
                "Mesh face references an invalid vertex index."
            )

        for v in vertices:
            if not np.all(
                np.isfinite(
                    np.asarray(v)
                )
            ):
                raise RuntimeError(
                    "Mesh contains non-finite vertex coordinates."
                )

        for n in normals:
            if not np.all(
                np.isfinite(
                    np.asarray(n)
                )
            ):
                raise RuntimeError(
                    "Mesh contains non-finite normals."
                )

        os.makedirs(
            os.path.dirname(
                output_filepath
            ),
            exist_ok=True,
        )

        # -------------------------------------------------------------------
        # Write Wavefront OBJ.
        # -------------------------------------------------------------------

        with open(
            output_filepath,
            "w",
            encoding="utf-8",
        ) as f:

            f.write(
                "# SlopeSentinel DepthWizard "
                "3D Terrain Mesh\n"
            )

            f.write(
                "# Model: Depth Anything V2\n"
            )

            f.write(
                f"# Vertices: {vertex_count}\n"
            )

            f.write(
                f"# Normals: {len(normals)}\n"
            )

            f.write(
                f"# Faces: {face_count}\n"
            )

            f.write(
                f"# Aspect Ratio: {aspect:.3f}\n"
            )

            f.write(
                f"# Extent X: {extent_x}\n"
            )

            f.write(
                f"# Extent Z: {extent_z}\n"
            )

            for v in vertices:
                f.write(
                    f"v {v[0]} {v[1]} {v[2]}\n"
                )

            for vt in texcoords:
                f.write(
                    f"vt {vt[0]} {vt[1]}\n"
                )

            for vn in normals:
                f.write(
                    f"vn {vn[0]} {vn[1]} {vn[2]}\n"
                )

            for face in faces:
                f.write(
                    "f "
                    f"{face[0]}/{face[0]}/{face[0]} "
                    f"{face[1]}/{face[1]}/{face[1]} "
                    f"{face[2]}/{face[2]}/{face[2]}\n"
                )

        file_size_kb = round(
            os.path.getsize(
                output_filepath
            )
            / 1024.0,
            1,
        )

        if file_size_kb <= 0:
            raise RuntimeError(
                "OBJ file was created but is empty."
            )

        mesh_stats = {
            "vertex_count": vertex_count,
            "face_count": face_count,
            "file_size_kb": file_size_kb,
            "format": "Wavefront OBJ (.obj)",
            "obj_valid": True,
            "bounding_box": {
                "x_extent": [
                    -round(extent_x / 2.0, 1),
                    round(extent_x / 2.0, 1),
                ],
                "z_extent": [
                    -round(extent_z / 2.0, 1),
                    round(extent_z / 2.0, 1),
                ],
                "y_vertical_relief": [
                    0.0,
                    relief_scale,
                ],
            },
            "aspect_ratio": round(
                aspect,
                3,
            ),
            "grid_resolution": [
                sub_w,
                sub_h,
            ],
            "has_vertex_normals": True,
        }

        t_mesh = time.time() - t0

        return (
            mesh_stats,
            round(t_mesh, 3),
        )

    # -----------------------------------------------------------------------
    # Full pipeline
    # -----------------------------------------------------------------------

    def run(
        self,
        image_bytes: bytes,
        static_dir: str,
        reference_elevation: Optional[float] = None,
        calibration_mode: str = "relative",
        filename_prefix: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Executes the full DepthWizard reconstruction pipeline.
        """

        t_total_start = time.time()

        req_id = str(
            uuid.uuid4()
        )[:8]

        if not filename_prefix:
            filename_prefix = (
                f"recon_{req_id}"
            )

        outputs_dir = os.path.join(
            static_dir,
            "outputs",
        )

        os.makedirs(
            outputs_dir,
            exist_ok=True,
        )

        # -------------------------------------------------------------------
        # 1. Decode
        # -------------------------------------------------------------------

        decoded_image = (
            self.validate_and_decode_input(
                image_bytes
            )
        )

        # -------------------------------------------------------------------
        # 2. Preprocess
        # -------------------------------------------------------------------

        (
            preprocessed_image,
            prep_meta,
        ) = self.preprocess(
            decoded_image
        )

        # -------------------------------------------------------------------
        # 3. Depth estimation
        # -------------------------------------------------------------------

        (
            raw_normalized_depth,
            t_infer,
            depth_stats,
        ) = self.estimate_depth(
            preprocessed_image
        )

        # -------------------------------------------------------------------
        # 4. Save raw depth visualization.
        #
        # Keep this output as model depth.
        # Terrain DSM will use the filtered surface below.
        # -------------------------------------------------------------------

        depth_png_filename = (
            f"{filename_prefix}_depth.png"
        )

        depth_npy_filename = (
            f"{filename_prefix}_depth.npy"
        )

        depth_png_path = os.path.join(
            outputs_dir,
            depth_png_filename,
        )

        depth_npy_path = os.path.join(
            outputs_dir,
            depth_npy_filename,
        )

        colormap_img = (
            self.render_depth_colormap(
                raw_normalized_depth
            )
        )

        colormap_img.save(
            depth_png_path,
            format="PNG",
        )

        np.save(
            depth_npy_path,
            raw_normalized_depth,
        )

        # -------------------------------------------------------------------
        # 5. Terrain-oriented filtering.
        # -------------------------------------------------------------------

        (
            filtered_terrain,
            filter_meta,
        ) = self.filter_terrain_surface(
            raw_normalized_depth
        )

        filtered_depth_png_filename = (
            f"{filename_prefix}_terrain_surface.png"
        )

        filtered_depth_png_path = os.path.join(
            outputs_dir,
            filtered_depth_png_filename,
        )

        self.render_depth_colormap(
            filtered_terrain
        ).save(
            filtered_depth_png_path,
            format="PNG",
        )

        filtered_depth_npy_filename = (
            f"{filename_prefix}_terrain_surface.npy"
        )

        filtered_depth_npy_path = os.path.join(
            outputs_dir,
            filtered_depth_npy_filename,
        )

        np.save(
            filtered_depth_npy_path,
            filtered_terrain,
        )

        # -------------------------------------------------------------------
        # 6. Optional calibration.
        #
        # IMPORTANT:
        # Use FILTERED terrain surface, not raw depth.
        # -------------------------------------------------------------------

        (
            elevation_grid,
            calib_meta,
        ) = self.calibrate(
            relative_depth=filtered_terrain,
            reference_elevation=reference_elevation,
            calibration_mode=calibration_mode,
        )

        # -------------------------------------------------------------------
        # 6.5 Calculate Terrain Steepness (Prototype Indicator)
        # -------------------------------------------------------------------
        
        dy, dx = np.gradient(elevation_grid)
        slope_mag = np.sqrt(dx**2 + dy**2)
        slope_angle_deg = np.degrees(np.arctan(slope_mag))
        valid_slopes = slope_angle_deg[np.isfinite(slope_angle_deg)]
        
        slope_score = None
        if valid_slopes.size > 0:
            representative_slope_angle = float(np.percentile(valid_slopes, 75))
            slope_score = min(100, max(0, int((representative_slope_angle / 45.0) * 100)))

        # -------------------------------------------------------------------
        # 7. DSM / heightmap
        # -------------------------------------------------------------------

        (
            heightmap_img,
            dsm_img,
        ) = self.generate_dsm_and_heightmap(
            elevation_grid,
            is_calibrated=(
                calib_meta[
                    "is_reference_anchored"
                ]
            ),
        )

        heightmap_filename = (
            f"{filename_prefix}_heightmap.png"
        )

        dsm_filename = (
            f"{filename_prefix}_dsm.png"
        )

        dsm_npy_filename = (
            f"{filename_prefix}_dsm.npy"
        )

        heightmap_path = os.path.join(
            outputs_dir,
            heightmap_filename,
        )

        dsm_path = os.path.join(
            outputs_dir,
            dsm_filename,
        )

        dsm_npy_path = os.path.join(
            outputs_dir,
            dsm_npy_filename,
        )

        heightmap_img.save(
            heightmap_path,
            format="PNG",
        )

        dsm_img.save(
            dsm_path,
            format="PNG",
        )

        np.save(
            dsm_npy_path,
            elevation_grid,
        )

        # -------------------------------------------------------------------
        # 8. Mesh
        # -------------------------------------------------------------------

        mesh_filename = (
            f"{filename_prefix}_mesh.obj"
        )

        mesh_path = os.path.join(
            outputs_dir,
            mesh_filename,
        )

        (
            mesh_stats,
            t_mesh,
        ) = self.generate_mesh_obj(
            elevation_grid,
            mesh_path,
            grid_target=100,
        )

        # -------------------------------------------------------------------
        # 9. Final metadata
        # -------------------------------------------------------------------

        t_total = (
            time.time()
            - t_total_start
        )

        case_id = (
            f"live_recon_{req_id}"
        )

        return {
            "status": "success",
            "case_id": case_id,
            "source_type": "LIVE",
            "model": self.model_name,
            "device": self.device,
            "mode": calib_meta["mode"],

            # Raw model depth.
            "depth_map": (
                f"/static/outputs/{depth_png_filename}"
            ),
            "depth_output": (
                f"/static/outputs/{depth_png_filename}"
            ),
            "depth_array": (
                f"/static/outputs/{depth_npy_filename}"
            ),

            # Terrain-oriented surface.
            "terrain_surface": (
                f"/static/outputs/"
                f"{filtered_depth_png_filename}"
            ),
            "terrain_surface_array": (
                f"/static/outputs/"
                f"{filtered_depth_npy_filename}"
            ),

            # DSM / heightmap.
            "heightmap": (
                f"/static/outputs/{heightmap_filename}"
            ),
            "heightmap_output": (
                f"/static/outputs/{heightmap_filename}"
            ),
            "dsm": (
                f"/static/outputs/{dsm_filename}"
            ),
            "dsm_output": (
                f"/static/outputs/{dsm_filename}"
            ),
            "dsm_array": (
                f"/static/outputs/{dsm_npy_filename}"
            ),

            # Mesh.
            "mesh": (
                f"/static/outputs/{mesh_filename}"
            ),
            "mesh_output": (
                f"/static/outputs/{mesh_filename}"
            ),

            "confidence": None,
            "confidence_message": (
                "Confidence not quantified "
                "for this prototype."
            ),

            "heuristic_indicators": (
                prep_meta[
                    "heuristic_indicators"
                ]
            ),

            "metadata": {
                "pipeline": (
                    "DepthWizard Engine v2.1 "
                    "(Depth Anything V2 + "
                    "terrain surface filtering)"
                ),
                "case_id": case_id,
                "request_id": req_id,
                "model_load_time_s": (
                    _MODEL_LOAD_TIME_S
                ),
                "inference_time_s": t_infer,
                "mesh_generation_time_s": t_mesh,
                "total_processing_time_s": round(
                    t_total,
                    3,
                ),
                
                "slope_score": slope_score,

                "preprocessing": prep_meta,

                "depth_statistics": depth_stats,

                "terrain_filter": filter_meta,

                "calibration": calib_meta,

                "mesh": mesh_stats,

                "scientific_notes": [
                    (
                        "Monocular depth provides "
                        "relative terrain structure."
                    ),
                    (
                        "Surface objects such as buildings "
                        "and vegetation may affect monocular "
                        "depth estimation."
                    ),
                    (
                        "Metric elevation requires suitable "
                        "reference/calibration information "
                        "where available."
                    ),
                    (
                        "Terrain filtering is a prototype "
                        "heuristic and is not a semantic "
                        "ground/building/vegetation classifier."
                    ),
                ],

                "uncertainty_note": (
                    "Confidence not quantified for "
                    "this prototype. Monocular depth "
                    "provides relative terrain structure; "
                    "metric elevation requires suitable "
                    "reference/calibration information "
                    "where available."
                ),
            },
        }


# ---------------------------------------------------------------------------
# Singleton accessor
# ---------------------------------------------------------------------------

_INSTANCE = None


def get_depthwizard_pipeline() -> DepthWizardPipeline:
    global _INSTANCE

    if _INSTANCE is None:
        _INSTANCE = DepthWizardPipeline()

    return _INSTANCE