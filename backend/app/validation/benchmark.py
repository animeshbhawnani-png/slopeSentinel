import os
import json
import time
import math
import logging
import uuid
import shutil
from typing import Dict, Any, List, Optional, Tuple

import numpy as np
from PIL import Image
import h5py

import httpx
import tempfile
from gradio_client import Client, handle_file

logger = logging.getLogger("slopesentinel.validation")
HF_SPACE = "Anii56/slopesentinel-depthwizard"

def _extract_artifact_url(r):
    if r is None:
        raise ValueError("HF DepthWizard did not return a valid depth artifact.")
    url = None
    if isinstance(r, dict):
        url = r.get("url") or r.get("path")
    elif isinstance(r, str):
        url = r
    else:
        url = getattr(r, "name", None)
    if not url:
        raise ValueError("HF DepthWizard did not return a valid depth artifact.")
    url = str(url)
    if url == "None" or not url.strip():
        raise ValueError("HF DepthWizard did not return a valid depth artifact.")
    return url

def _download_hf_artifact(url: str, dest_path: str, timeout: float = 120.0, max_retries: int = 3) -> bool:
    if not url.startswith("http://") and not url.startswith("https://"):
        shutil.copy2(url, dest_path)
        if os.path.exists(dest_path) and os.path.getsize(dest_path) > 0:
            return True
        return False

    for attempt in range(max_retries):
        try:
            tmp_path = dest_path + ".tmp"
            with httpx.stream("GET", url, timeout=timeout, follow_redirects=True) as response:
                response.raise_for_status()
                with open(tmp_path, "wb") as f:
                    for chunk in response.iter_bytes(chunk_size=8192):
                        f.write(chunk)
            if os.path.exists(tmp_path) and os.path.getsize(tmp_path) > 0:
                os.replace(tmp_path, dest_path)
                return True
            else:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)
        except Exception as e:
            logger.warning("Download attempt %d failed: %s", attempt + 1, e)
            if os.path.exists(dest_path + ".tmp"):
                try:
                    os.remove(dest_path + ".tmp")
                except:
                    pass
            if attempt == max_retries - 1:
                return False
            time.sleep(2)
    return False

def _infer_depth_hf_raw(image_bytes: bytes, filename: str) -> Tuple[np.ndarray, float]:
    if not image_bytes:
        raise ValueError("Input image is empty.")

    t0 = time.time()
    with tempfile.TemporaryDirectory() as tmpdir:
        safe_name = os.path.basename(filename) or "terrain.png"
        upload_path = os.path.join(tmpdir, safe_name)

        with open(upload_path, "wb") as f:
            f.write(image_bytes)

        hf_token = os.environ.get("HF_TOKEN")
        client = Client(
            HF_SPACE,
            token=hf_token,
            download_files=False,
        )

        hf_result = client.predict(
            image=handle_file(upload_path),
            api_name="/reconstruct",
        )

        if not isinstance(hf_result, (list, tuple)):
            raise ValueError("Invalid response format from HF Space.")

        if len(hf_result) < 6:
            raise ValueError(f"HF DepthWizard returned {len(hf_result)} outputs; 6 outputs are required.")

        # Output #5 is the raw numerical depth array (.npy)
        raw_depth_source = _extract_artifact_url(hf_result[5])
        depth_dest = os.path.join(tmpdir, "depth.npy")

        if not _download_hf_artifact(raw_depth_source, depth_dest, timeout=120.0):
            raise ValueError("Failed to download raw DepthWizard .npy artifact.")

        if not os.path.exists(depth_dest) or os.path.getsize(depth_dest) <= 0:
            raise ValueError("Raw DepthWizard .npy artifact is missing or empty.")

        try:
            depth_arr = np.load(depth_dest, allow_pickle=False).astype(np.float32)
        except Exception as exc:
            raise ValueError(f"Failed to load raw depth array: {exc}")

        if depth_arr.ndim != 2:
            raise ValueError(f"Raw depth array must be 2D; received {depth_arr.shape}.")

        if depth_arr.size == 0:
            raise ValueError("Raw depth array is empty.")

        if not np.any(np.isfinite(depth_arr)):
            raise ValueError("Raw depth array contains no finite values.")

        proc_time = round(time.time() - t0, 3)
        return depth_arr, proc_time
HF_SPACE = "Anii56/slopesentinel-depthwizard"

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(BASE_DIR, "static")
VALIDATION_DIR = os.path.join(STATIC_DIR, "validation")
GAMUS_DATA_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "..", "test_data", "gamus"))

os.makedirs(VALIDATION_DIR, exist_ok=True)


def _apply_elevation_colormap(arr: np.ndarray, vmin: float = None, vmax: float = None) -> Image.Image:
    valid = np.isfinite(arr)
    if not np.any(valid):
        return Image.fromarray(np.zeros((*arr.shape, 3), dtype=np.uint8))
    
    if vmin is None:
        vmin = float(np.percentile(arr[valid], 1.0))
    if vmax is None:
        vmax = float(np.percentile(arr[valid], 99.0))
    
    if vmax <= vmin:
        norm = np.zeros_like(arr, dtype=np.float32)
    else:
        norm = np.clip((arr - vmin) / (vmax - vmin), 0.0, 1.0)
        
    x = norm
    r = np.clip(np.where(x < 0.5, 2.0 * x * 0.4, 0.4 + 2.0 * (x - 0.5) * 0.6), 0.0, 1.0)
    g = np.clip(np.where(x < 0.5, 0.4 + x * 1.2, 1.0 - (x - 0.5) * 1.6), 0.0, 1.0)
    b = np.clip(np.where(x < 0.35, 0.8 - x * 1.2, 0.38 - (x - 0.35) * 0.58), 0.0, 1.0)

    r[~valid] = 0.08
    g[~valid] = 0.12
    b[~valid] = 0.12

    rgb = np.stack([r * 255.0, g * 255.0, b * 255.0], axis=-1).astype(np.uint8)
    return Image.fromarray(rgb, mode="RGB")


def _apply_error_colormap(err_arr: np.ndarray, mask: np.ndarray, vmax: float = None) -> Image.Image:
    valid = mask & np.isfinite(err_arr)
    if not np.any(valid):
        return Image.fromarray(np.zeros((*err_arr.shape, 3), dtype=np.uint8))

    if vmax is None:
        vmax = float(np.percentile(err_arr[valid], 95.0))
    if vmax <= 0:
        vmax = 1.0

    norm = np.clip(err_arr / vmax, 0.0, 1.0)

    x = norm
    r = np.clip(0.12 + x * 0.88, 0.0, 1.0)
    g = np.clip(0.40 * (1.0 - x) + 0.50 * np.sin(x * np.pi), 0.0, 1.0)
    b = np.clip(0.35 * (1.0 - x), 0.0, 1.0)

    r[~valid] = 0.07
    g[~valid] = 0.09
    b[~valid] = 0.09

    rgb = np.stack([r * 255.0, g * 255.0, b * 255.0], axis=-1).astype(np.uint8)
    return Image.fromarray(rgb, mode="RGB")


def list_gamus_samples() -> List[Dict[str, Any]]:
    samples = []
    if not os.path.exists(GAMUS_DATA_DIR):
        logger.warning("GAMUS data directory not found: %s", GAMUS_DATA_DIR)
        return samples

    for fname in sorted(os.listdir(GAMUS_DATA_DIR)):
        if fname.endswith("_RGB.png"):
            sample_id = fname[:-8]
            rgb_path = os.path.join(GAMUS_DATA_DIR, fname)
            ref_path = os.path.join(GAMUS_DATA_DIR, f"{sample_id}_AGL.h5")
            cls_path = os.path.join(GAMUS_DATA_DIR, f"{sample_id}_CLS.h5")

            has_ref = os.path.exists(ref_path)
            ref_valid = False
            ref_info = {}

            if has_ref:
                try:
                    with h5py.File(ref_path, "r") as hf:
                        if "image" in hf:
                            ref_shape = list(hf["image"].shape)
                            ref_dtype = str(hf["image"].dtype)
                            ref_valid = True
                            ref_info = {
                                "format": "HDF5 (.h5)",
                                "shape": ref_shape,
                                "dtype": ref_dtype,
                                "representation": "Above Ground Level (AGL) Elevation Target (m)"
                            }
                        else:
                            ref_info = {"note": "Missing 'image' dataset key in HDF5 file."}
                except Exception as e:
                    ref_info = {"note": f"Could not read reference HDF5: {str(e)}"}

            status_label = "READY" if (has_ref and ref_valid) else "SKIPPED - REFERENCE MISSING"
            
            samples.append({
                "sample_id": sample_id,
                "dataset": "GAMUS (Earthflow)",
                "rgb_file": fname,
                "rgb_path": rgb_path,
                "ref_file": f"{sample_id}_AGL.h5" if has_ref else None,
                "has_reference": has_ref and ref_valid,
                "status": status_label,
                "reference_info": ref_info,
                "has_semantic_classes": os.path.exists(cls_path)
            })

    return samples

def compute_validation_metrics(
    pred_dsm: np.ndarray,
    ref_arr: np.ndarray,
    sample_id: str,
    comparison_mode: str,
    proc_time: float,
    rgb_path: str,
    is_custom: bool = False
) -> Dict[str, Any]:
    mode_slug = "metric" if comparison_mode == "scale_aligned" else "norm"
    
    orig_ref_h, orig_ref_w = ref_arr.shape
    pred_pil = Image.fromarray(pred_dsm)
    pred_resized = np.array(
        pred_pil.resize((orig_ref_w, orig_ref_h), Image.Resampling.BILINEAR)
    )

    valid_mask = (ref_arr >= 0.0) & np.isfinite(ref_arr) & np.isfinite(pred_resized)
    total_pixels = int(ref_arr.size)
    valid_pixels = int(np.sum(valid_mask))
    invalid_pixels = total_pixels - valid_pixels
    valid_fraction = float(valid_pixels / total_pixels)

    if valid_pixels < 100:
        raise ValueError(f"Sample {sample_id} contains insufficient valid reference pixels ({valid_pixels})")

    p = pred_resized[valid_mask]
    y = ref_arr[valid_mask]

    p_mean = float(np.mean(p))
    y_mean = float(np.mean(y))
    cov = float(np.mean((p - p_mean) * (y - y_mean)))
    p_std = float(np.std(p))
    y_std = float(np.std(y))

    if p_std > 1e-8 and y_std > 1e-8:
        correlation = float(cov / (p_std * y_std))
    else:
        correlation = 0.0

    if comparison_mode == "scale_aligned":
        p_var = float(np.var(p))
        if p_var > 1e-8:
            s_scale = float(cov / p_var)
            t_shift = float(y_mean - s_scale * p_mean)
        else:
            s_scale = 1.0
            t_shift = float(y_mean - p_mean)

        p_eval = s_scale * p + t_shift
        p_surface_eval = s_scale * pred_resized + t_shift
        
        diff = p_eval - y
        rmse = float(np.sqrt(np.mean(diff ** 2)))
        mae = float(np.mean(np.abs(diff)))
        units = "meters"
        mode_label = "SCALE-ALIGNED METRIC"
        calib_note = (
            f"Least-squares affine scale alignment: s={s_scale:.4f}, shift={t_shift:.3f}m. "
            f"Transforms relative Depth Anything V2 monocular relief to match reference AGL elevation span."
        )
    else:
        p_min, p_max = float(np.min(p)), float(np.max(p))
        y_min, y_max = float(np.min(y)), float(np.max(y))

        p_norm = (p - p_min) / (p_max - p_min + 1e-8)
        y_norm = (y - y_min) / (y_max - y_min + 1e-8)
        
        p_eval = p_norm
        p_surface_eval = (pred_resized - p_min) / (p_max - p_min + 1e-8)
        
        diff = p_norm - y_norm
        rmse = float(np.sqrt(np.mean(diff ** 2)))
        mae = float(np.mean(np.abs(diff)))
        units = "relative_units"
        mode_label = "NORMALIZED RELATIVE"
        calib_note = "Normalized relative comparison [0.0, 1.0]. Evaluates spatial topographic fidelity without metric scale assumptions."

    rgb_img_filename = f"{sample_id.lower()}_rgb.png"
    rgb_img_path = os.path.join(VALIDATION_DIR, rgb_img_filename)
    if not os.path.exists(rgb_img_path) or rgb_path != rgb_img_path:
        Image.open(rgb_path).convert("RGB").save(rgb_img_path)

    pred_img_filename = f"{sample_id.lower()}_pred_{mode_slug}.png"
    pred_img_path = os.path.join(VALIDATION_DIR, pred_img_filename)
    pred_vis = _apply_elevation_colormap(p_surface_eval)
    pred_vis.save(pred_img_path)

    ref_img_filename = f"{sample_id.lower()}_ref.png"
    ref_img_path = os.path.join(VALIDATION_DIR, ref_img_filename)
    ref_vis = _apply_elevation_colormap(ref_arr)
    ref_vis.save(ref_img_path)

    full_diff = np.abs(p_surface_eval - ref_arr) if comparison_mode == "scale_aligned" else np.abs(p_surface_eval - ((ref_arr - np.min(y)) / (np.max(y) - np.min(y) + 1e-8)))
    err_img_filename = f"{sample_id.lower()}_error_{mode_slug}.png"
    err_img_path = os.path.join(VALIDATION_DIR, err_img_filename)
    err_vis = _apply_error_colormap(full_diff, valid_mask)
    err_vis.save(err_img_path)

    out = {
        "sample_id": sample_id,
        "source_dataset": "Custom Upload" if is_custom else "GAMUS (Earthflow Monocular Depth Benchmark)",
        "reference_target": "Uploaded Reference HDF5 Target" if is_custom else "LiDAR Above-Ground-Level (AGL) Surface in Meters",
        "model_name": "DepthWizard Engine (Depth Anything V2 Small-hf)",
        "comparison_mode": mode_label,
        "calibration_method": calib_note,
        "units": units,
        "rmse": round(rmse, 4),
        "mae": round(mae, 4),
        "correlation": round(correlation, 4),
        "valid_pixel_fraction": round(valid_fraction, 4),
        "valid_pixel_percentage": round(valid_fraction * 100.0, 2),
        "total_pixels": total_pixels,
        "valid_pixels": valid_pixels,
        "invalid_pixels": invalid_pixels,
        "reference_statistics": {
            "min_m": round(float(np.min(y)), 2),
            "max_m": round(float(np.max(y)), 2),
            "mean_m": round(float(np.mean(y)), 2),
            "std_m": round(float(np.std(y)), 2)
        },
        "prediction_statistics": {
            "min": round(float(np.min(p)), 2),
            "max": round(float(np.max(p)), 2),
            "mean": round(float(np.mean(p)), 2),
            "std": round(float(np.std(p)), 2)
        },
        "images": {
            "rgb": f"/static/validation/{rgb_img_filename}",
            "prediction": f"/static/validation/{pred_img_filename}",
            "reference": f"/static/validation/{ref_img_filename}",
            "error_heatmap": f"/static/validation/{err_img_filename}"
        },
        "processing_time_s": proc_time,
        "scientific_disclaimer": (
            "Custom empirical benchmark — results are valid only when a compatible ground-truth reference is supplied." if is_custom else 
            "Metrics are reported for the selected validation sample and depend on reference quality, alignment, masking, and calibration. They do not represent guaranteed performance across all Himalayan terrain."
        ),
        "is_cached": False,
        "is_prediction_only": False
    }
    return out


def evaluate_gamus_sample(
    sample_id: str,
    comparison_mode: str = "scale_aligned",
    force_rerun: bool = False
) -> Dict[str, Any]:
    mode_slug = "metric" if comparison_mode == "scale_aligned" else "norm"
    cache_file = os.path.join(VALIDATION_DIR, f"cache_{sample_id.lower()}_{mode_slug}.json")

    if not force_rerun and os.path.exists(cache_file):
        try:
            with open(cache_file, "r", encoding="utf-8") as f:
                cached_data = json.load(f)
                cached_data["is_cached"] = True
                return cached_data
        except Exception as err:
            logger.warning("Could not read cached validation data: %s", err)

    rgb_path = os.path.join(GAMUS_DATA_DIR, f"{sample_id}_RGB.png")
    ref_path = os.path.join(GAMUS_DATA_DIR, f"{sample_id}_AGL.h5")

    if not os.path.exists(rgb_path):
        raise FileNotFoundError(f"RGB image for GAMUS sample {sample_id} not found at {rgb_path}")
    if not os.path.exists(ref_path):
        raise FileNotFoundError(f"Reference AGL target for GAMUS sample {sample_id} not found at {ref_path}")

    with open(rgb_path, "rb") as f:
        rgb_bytes = f.read()

    pred_dsm, proc_time = _infer_depth_hf_raw(rgb_bytes, f"gamus_eval_{sample_id.lower()}.png")

    with h5py.File(ref_path, "r") as hf:
        if "image" not in hf:
            raise ValueError(f"Reference file {ref_path} does not contain 'image' dataset")
        ref_arr = hf["image"][:].astype(np.float32)

    out = compute_validation_metrics(pred_dsm, ref_arr, sample_id, comparison_mode, proc_time, rgb_path, is_custom=False)
    
    try:
        with open(cache_file, "w", encoding="utf-8") as f:
            json.dump(out, f, indent=2)
    except Exception as err:
        logger.warning("Could not persist validation cache: %s", err)

    return out

def evaluate_custom_sample(
    rgb_bytes: bytes,
    ref_bytes: Optional[bytes],
    comparison_mode: str = "scale_aligned"
) -> Dict[str, Any]:
    sample_id = f"custom_{str(uuid.uuid4())[:8]}"
    mode_slug = "metric" if comparison_mode == "scale_aligned" else "norm"

    rgb_path = os.path.join(VALIDATION_DIR, f"{sample_id}_upload_RGB.png")
    with open(rgb_path, "wb") as f:
        f.write(rgb_bytes)

    pred_dsm, proc_time = _infer_depth_hf_raw(rgb_bytes, f"custom_eval_{sample_id.lower()}.png")

    if ref_bytes:
        ref_path = os.path.join(VALIDATION_DIR, f"{sample_id}_upload_ref.h5")
        with open(ref_path, "wb") as f:
            f.write(ref_bytes)
        
        with h5py.File(ref_path, "r") as hf:
            if "image" not in hf:
                raise ValueError("Uploaded HDF5 reference file does not contain 'image' dataset key.")
            ref_arr = hf["image"][:].astype(np.float32)

        out = compute_validation_metrics(pred_dsm, ref_arr, sample_id, comparison_mode, proc_time, rgb_path, is_custom=True)
        return out
    else:
        # Prediction only
        rgb_img_filename = f"{sample_id.lower()}_rgb.png"
        rgb_img_path = os.path.join(VALIDATION_DIR, rgb_img_filename)
        Image.open(rgb_path).convert("RGB").save(rgb_img_path)

        pred_img_filename = f"{sample_id.lower()}_pred_only.png"
        pred_img_path = os.path.join(VALIDATION_DIR, pred_img_filename)
        pred_vis = _apply_elevation_colormap(pred_dsm)
        pred_vis.save(pred_img_path)

        return {
            "sample_id": sample_id,
            "source_dataset": "Custom Upload (PREDICTION ONLY)",
            "model_name": "DepthWizard Engine (Depth Anything V2 Small-hf)",
            "is_prediction_only": True,
            "processing_time_s": proc_time,
            "images": {
                "rgb": f"/static/validation/{rgb_img_filename}",
                "prediction": f"/static/validation/{pred_img_filename}"
            },
            "scientific_disclaimer": "PREDICTION ONLY — NO GROUND TRUTH REFERENCE. Metrics unavailable — reference target required."
        }


def get_aggregate_benchmark_summary() -> Dict[str, Any]:
    samples = list_gamus_samples()
    ready_samples = [s["sample_id"] for s in samples if s["has_reference"]]
    skipped_samples = [s for s in samples if not s["has_reference"]]

    results = []
    for sid in ready_samples:
        cache_file = os.path.join(VALIDATION_DIR, f"cache_{sid.lower()}_metric.json")
        if os.path.exists(cache_file):
            try:
                with open(cache_file, "r", encoding="utf-8") as f:
                    cached_data = json.load(f)
                    cached_data["is_cached"] = True
                    results.append(cached_data)
            except Exception as e:
                logger.error("Error reading cached benchmark sample %s: %s", sid, e)
        else:
            # If there is no cached result, DO NOT trigger HF inference.
            logger.info("Skipping sample %s in summary due to missing cache.", sid)
            skipped_samples.append({
                "sample_id": sid,
                "has_reference": True,
                "status": "SKIPPED - NOT CACHED"
            })

    if not results:
        return {
            "dataset": "GAMUS (Earthflow)",
            "sample_count": 0,
            "samples": [],
            "skipped": skipped_samples,
            "mean_rmse": None,
            "mean_mae": None,
            "mean_correlation": None
        }

    mean_rmse = round(float(np.mean([r["rmse"] for r in results])), 3)
    mean_mae = round(float(np.mean([r["mae"] for r in results])), 3)
    mean_corr = round(float(np.mean([r["correlation"] for r in results])), 4)
    mean_coverage = round(float(np.mean([r["valid_pixel_percentage"] for r in results])), 2)

    return {
        "dataset": "GAMUS (Earthflow Remote Sensing Monocular Depth)",
        "sample_count": len(results),
        "evaluation_scope": "Single-sample benchmark" if len(results) == 1 else "Multi-sample subset benchmark",
        "mean_metrics": {
            "mean_rmse_m": mean_rmse,
            "mean_mae_m": mean_mae,
            "mean_correlation": mean_corr,
            "mean_valid_coverage_pct": mean_coverage
        },
        "samples": results,
        "skipped_samples": [
            {
                "sample_id": s["sample_id"],
                "reason": s["status"]
            } for s in skipped_samples
        ]
    }
