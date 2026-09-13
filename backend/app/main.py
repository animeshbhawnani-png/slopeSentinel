import os
import json
import uuid
import glob
import logging
import threading
from typing import Optional, Dict

from fastapi import FastAPI, File, UploadFile, Form, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse

from pydantic import BaseModel

from app.depthwizard.pipeline import get_depthwizard_pipeline
from app.change_detection.engine import get_change_engine
from app.validation.benchmark import list_gamus_samples, evaluate_gamus_sample, get_aggregate_benchmark_summary, evaluate_custom_sample

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("slopesentinel.api")

app = FastAPI(
    title="SlopeSentinel DepthWizard Terrain Reconstruction API",
    description="FastAPI backend for SlopeSentinel monocular depth estimation (Depth Anything V2), DSM generation, and 3D terrain synthesis",
    version="2.0.0",
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "https://slopesentinel-8p2j.onrender.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Setup static directories for input uploads and outputs
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
UPLOADS_DIR = os.path.join(STATIC_DIR, "uploads")
OUTPUTS_DIR = os.path.join(STATIC_DIR, "outputs")

for d in [UPLOADS_DIR, OUTPUTS_DIR]:
    os.makedirs(d, exist_ok=True)

# Mount static files to serve images and mesh artifacts
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# In-memory and disk registry for persistent reconstructions
ACTIVE_RECONSTRUCTIONS: Dict[str, dict] = {}
LATEST_RECONSTRUCTION_ID: Optional[str] = None
RECONSTRUCTION_LOCK = threading.Lock()

# Preload existing saved reconstructions from disk on startup
try:
    for json_file in glob.glob(os.path.join(OUTPUTS_DIR, "live_recon_*.json")):
        with open(json_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            cid = data.get("case_id")
            if cid:
                ACTIVE_RECONSTRUCTIONS[cid] = data
                LATEST_RECONSTRUCTION_ID = cid
    logger.info("Loaded %d previously cached reconstructions from disk.", len(ACTIVE_RECONSTRUCTIONS))
except Exception as e:
    logger.warning("Could not reload past reconstructions from disk: %s", e)

# Create the singleton pipeline wrapper without loading model weights.
logger.info("Initializing DepthWizard pipeline singleton...")
pipeline = get_depthwizard_pipeline()

@app.get("/")
def read_root():
    return {
        "status": "online",
        "system": "SlopeSentinel DepthWizard Engine",
        "model": pipeline.model_name,
        "device": pipeline.device,
        "version": "2.0.0",
        "endpoints": {
            "reconstruct": "POST /api/terrain/reconstruct",
            "health": "GET /api/v1/health"
        }
    }


@app.get("/api/v1/health")
def health_check():
    return {
        "status": "healthy",
        "model": pipeline.model_name,
        "device": pipeline.device,
        "pipeline_version": "DepthWizard Engine v2.0",
        "static_dir_ready": os.path.exists(STATIC_DIR),
    }


@app.post("/api/terrain/reconstruct")
async def reconstruct_terrain(
    file: Optional[UploadFile] = File(None),
    reference_elevation: Optional[float] = Form(None),
    calibration_mode: Optional[str] = Form("relative")
):
    """
    DepthWizard Monocular Terrain Reconstruction Endpoint.
    Receives terrain imagery, runs Depth Anything V2 monocular depth estimation,
    applies optional reference calibration, and generates heightmap, DSM, and 3D terrain mesh (.obj).
    """
    logger.info(
        "Received terrain reconstruction request: file=%s, ref_elev=%s, calib_mode=%s",
        getattr(file, "filename", None), reference_elevation, calibration_mode
    )

    if file is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A terrain image upload is required."
        )

    # Validate file format
    allowed_extensions = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp"}
    filename = file.filename or "upload.jpg"
    _, ext = os.path.splitext(filename.lower())
    if ext not in allowed_extensions:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file format '{ext}'. Allowed formats: JPG, JPEG, PNG, TIFF, WEBP."
        )

    # Read uploaded bytes safely
    try:
        image_bytes = await file.read()
        if len(image_bytes) == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded file is empty (0 bytes)."
            )
        if len(image_bytes) > 50 * 1024 * 1024:  # 50 MB limit
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Uploaded file exceeds 50MB limit."
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to read upload payload: %s", e)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to read upload stream: {str(e)}"
        )

    # Save original image in static/uploads
    req_uuid = str(uuid.uuid4())[:8]
    safe_name = f"{req_uuid}_{os.path.basename(filename)}"
    upload_save_path = os.path.join(UPLOADS_DIR, safe_name)
    try:
        with open(upload_save_path, "wb") as f:
            f.write(image_bytes)
    except Exception as e:
        logger.warning("Could not persist original upload to disk: %s", e)

    # Execute DepthWizard Pipeline with graceful failure handling
    if not RECONSTRUCTION_LOCK.acquire(blocking=False):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Another terrain reconstruction is already in progress. Please retry shortly.",
        )

    try:
        try:
            result = pipeline.run(
                image_bytes=image_bytes,
                static_dir=STATIC_DIR,
                reference_elevation=reference_elevation,
                calibration_mode=calibration_mode or "relative",
                filename_prefix=f"recon_{req_uuid}"
            )
        finally:
            RECONSTRUCTION_LOCK.release()

        result["source_image"] = f"/static/uploads/{safe_name}"
        result["input_image"] = f"/static/uploads/{safe_name}"
        result["metadata"]["original_filename"] = filename

        # Store in active registry and persist to disk
        cid = result.get("case_id", f"live_recon_{req_uuid}")
        result["case_id"] = cid
        ACTIVE_RECONSTRUCTIONS[cid] = result
        global LATEST_RECONSTRUCTION_ID
        LATEST_RECONSTRUCTION_ID = cid

        try:
            json_path = os.path.join(OUTPUTS_DIR, f"{cid}.json")
            with open(json_path, "w", encoding="utf-8") as f:
                json.dump(result, f, indent=2)
        except Exception as err:
            logger.warning("Could not persist reconstruction JSON to disk: %s", err)

        logger.info(
            "Completed DepthWizard synthesis for %s (Case ID: %s, Infer: %.2fs, Mesh: %.2fs)",
            filename, cid,
            result["metadata"]["inference_time_s"],
            result["metadata"]["mesh_generation_time_s"]
        )
        return result

    except ValueError as ve:
        # Invalid image content (corrupted, unparseable)
        logger.error("Image validation error during DepthWizard processing: %s", ve)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Image decoding failed: {str(ve)}"
        )
    except Exception as e:
        # Unexpected processing exception - log error, do not crash server
        logger.exception("Unexpected error in DepthWizard pipeline: %s", e)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "status": "error",
                "message": f"DepthWizard reconstruction failed: {str(e)}"
            }
        )


@app.get("/api/terrain/active")
def get_active_reconstruction():
    """
    Returns the currently active live reconstruction.
    """
    if LATEST_RECONSTRUCTION_ID and LATEST_RECONSTRUCTION_ID in ACTIVE_RECONSTRUCTIONS:
        return ACTIVE_RECONSTRUCTIONS[LATEST_RECONSTRUCTION_ID]
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Reconstruction case not found."
    )


@app.get("/api/terrain/reconstruct/{case_id}")
def get_reconstruction_by_id(case_id: str):
    """
    Returns reconstruction state, references, and metadata for a specific case_id.
    """
    if case_id in ACTIVE_RECONSTRUCTIONS:
        return ACTIVE_RECONSTRUCTIONS[case_id]

    # Check disk cache
    json_path = os.path.join(OUTPUTS_DIR, f"{case_id}.json")
    if os.path.exists(json_path):
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                ACTIVE_RECONSTRUCTIONS[case_id] = data
                return data
        except Exception as e:
            logger.warning("Error reading %s: %s", json_path, e)

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Reconstruction case not found."
    )


@app.get("/api/terrain/reconstruct/{case_id}/mesh")
def get_reconstruction_mesh(case_id: str):
    """
    Directly serves the 3D Wavefront .OBJ mesh file for the requested case_id.
    """
    recon = ACTIVE_RECONSTRUCTIONS.get(case_id)
    if not recon:
        json_path = os.path.join(OUTPUTS_DIR, f"{case_id}.json")
        if os.path.exists(json_path):
            with open(json_path, "r", encoding="utf-8") as f:
                recon = json.load(f)
        # Removed demo fallback to ensure genuine file downloads

    if not recon:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Reconstruction case '{case_id}' not found."
        )

    mesh_rel = recon.get("mesh_output") or recon.get("mesh")
    if not mesh_rel:
        raise HTTPException(status_code=404, detail="Mesh artifact path not found in reconstruction.")

    mesh_disk_path = os.path.join(STATIC_DIR, mesh_rel.replace("/static/", "").replace("/", os.sep))
    if not os.path.exists(mesh_disk_path):
        raise HTTPException(status_code=404, detail=f"Mesh file does not exist on disk: {mesh_rel}")

    return FileResponse(
        path=mesh_disk_path,
        media_type="text/plain",
        filename=f"{case_id}_mesh.obj"
    )


@app.get("/api/terrain/reconstruct/{case_id}/dsm")
def get_reconstruction_dsm(case_id: str):
    """
    Directly serves the DSM hillshade raster for the requested case_id.
    """
    recon = ACTIVE_RECONSTRUCTIONS.get(case_id)
    if not recon:
        json_path = os.path.join(OUTPUTS_DIR, f"{case_id}.json")
        if os.path.exists(json_path):
            with open(json_path, "r", encoding="utf-8") as f:
                recon = json.load(f)
        # Removed demo fallback to ensure genuine file downloads

    if not recon:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Reconstruction case '{case_id}' not found."
        )

    dsm_rel = recon.get("dsm_output") or recon.get("dsm")
    if not dsm_rel:
        raise HTTPException(status_code=404, detail="DSM artifact path not found in reconstruction.")

    dsm_disk_path = os.path.join(STATIC_DIR, dsm_rel.replace("/static/", "").replace("/", os.sep))
    if not os.path.exists(dsm_disk_path):
        raise HTTPException(status_code=404, detail=f"DSM file does not exist on disk: {dsm_rel}")

    return FileResponse(
        path=dsm_disk_path,
        media_type="image/png",
        filename=f"{case_id}_dsm.png"
    )


class ChangeAnalysisRequest(BaseModel):
    before_terrain_id: Optional[str] = None
    after_terrain_id: Optional[str] = None


@app.get("/api/change/cases")
def get_change_cases():
    """
    Returns available change observation cases in upload-first production mode.
    """
    return []


@app.post("/api/change/analyze")
async def analyze_temporal_change(
    req: Optional[ChangeAnalysisRequest] = None,
    before_case_id: Optional[str] = Form(None),
    before_file: Optional[UploadFile] = File(None),
    after_file: Optional[UploadFile] = File(None)
):
    """
    Temporal Terrain Change Detection Endpoint (Upload-First).
    Compares two multi-epoch observations using DepthWizard surface reconstruction,
    spatial alignment, differential elevation (Δz) mapping, and contiguous changed region extraction.
    Requires genuine Before (Baseline) and After (Repeat Pass) observations.
    """
    engine = get_change_engine()

    # Check if before_case_id is provided from an active live reconstruction
    active_recon_id = before_case_id or (req.before_terrain_id if req else None)
    if before_file is None and active_recon_id and after_file is not None:
        recon = ACTIVE_RECONSTRUCTIONS.get(active_recon_id)
        if not recon:
            json_path = os.path.join(OUTPUTS_DIR, f"{active_recon_id}.json")
            if os.path.exists(json_path):
                try:
                    with open(json_path, "r", encoding="utf-8") as f:
                        recon = json.load(f)
                except Exception as e:
                    logger.warning("Error reading cached case %s: %s", json_path, e)
        if recon:
            src_rel = recon.get("source_image") or recon.get("input_image")
            if src_rel:
                disk_path = os.path.join(STATIC_DIR, src_rel.replace("/static/", "").replace("/", os.sep))
                if os.path.exists(disk_path):
                    with open(disk_path, "rb") as f:
                        before_bytes = f.read()
                    after_bytes = await after_file.read()
                    return engine.analyze_custom_pair(
                        before_bytes=before_bytes,
                        after_bytes=after_bytes,
                        static_dir=STATIC_DIR,
                        before_label=recon.get("metadata", {}).get("original_filename", "Live Baseline"),
                        after_label=after_file.filename or "Repeat Pass"
                    )

    # If custom files are uploaded, process custom pair
    if before_file is not None and after_file is not None:
        try:
            logger.info(
                "Processing genuine temporal change detection pair: before=%s, after=%s",
                before_file.filename, after_file.filename
            )
            before_bytes = await before_file.read()
            after_bytes = await after_file.read()
            if len(before_bytes) == 0 or len(after_bytes) == 0:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty (0 bytes).")
            
            result = engine.analyze_custom_pair(
                before_bytes=before_bytes,
                after_bytes=after_bytes,
                static_dir=STATIC_DIR,
                before_label=before_file.filename or "Baseline Observation",
                after_label=after_file.filename or "Repeat Pass Observation"
            )
            return result
        except HTTPException:
            raise
        except Exception as e:
            logger.exception("Temporal change analysis failed: %s", e)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Change analysis failed: {str(e)}"
            )

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Temporal change detection requires both a baseline (Observation A) and repeat-pass (Observation B) image."
    )


class ValidationRunRequest(BaseModel):
    sample_id: Optional[str] = "DC_03_26"
    comparison_mode: Optional[str] = "scale_aligned"
    force_rerun: Optional[bool] = False


@app.get("/api/validation/samples")
def get_validation_samples():
    """
    Returns discovered GAMUS test samples and indicates reference availability.
    """
    return list_gamus_samples()


@app.post("/api/validation/run")
def run_validation(
    req: Optional[ValidationRunRequest] = None,
    sample_id: Optional[str] = None,
    comparison_mode: Optional[str] = None,
    force_rerun: Optional[bool] = False
):
    """
    Runs or returns cached validation benchmark for a GAMUS sample.
    """
    sid = sample_id or (req.sample_id if req else None) or "DC_03_26"
    mode = comparison_mode or (req.comparison_mode if req else None) or "scale_aligned"
    rerun = force_rerun or (req.force_rerun if req else False)
    try:
        return evaluate_gamus_sample(sid, comparison_mode=mode, force_rerun=rerun)
    except FileNotFoundError as fnf:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(fnf))
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except Exception as e:
        logger.exception("Validation benchmark error: %s", e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Validation benchmark failed: {str(e)}")


@app.post("/api/validation/custom")
async def run_custom_validation(
    rgb_file: UploadFile = File(...),
    ref_file: Optional[UploadFile] = File(None),
    comparison_mode: Optional[str] = Form("scale_aligned")
):
    try:
        rgb_bytes = await rgb_file.read()
        ref_bytes = await ref_file.read() if ref_file else None
        
        if len(rgb_bytes) == 0:
            raise HTTPException(status_code=400, detail="RGB file is empty.")
            
        return evaluate_custom_sample(
            rgb_bytes=rgb_bytes,
            ref_bytes=ref_bytes,
            comparison_mode=comparison_mode
        )
    except Exception as e:
        logger.exception("Custom Validation error: %s", e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Custom validation failed: {str(e)}")


@app.get("/api/validation/summary")
def get_validation_summary():
    """
    Returns aggregate multi-sample GAMUS benchmark statistics.
    """
    try:
        return get_aggregate_benchmark_summary()
    except Exception as e:
        logger.exception("Validation summary error: %s", e)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Validation summary failed: {str(e)}")



