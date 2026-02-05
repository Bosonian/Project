"""
Pupil & Iris Segmentation Cloud Service

FastAPI service for Cloud Run that accepts eye images and returns
pupil/iris circle detection results using a trained U-Net model.

Endpoints:
    POST /detect       - Detect pupil and iris from uploaded image
    POST /detect/base64 - Detect from base64-encoded image (PWA)
    GET  /health       - Health check
"""

import io
import os
import time
import logging
from contextlib import asynccontextmanager

import cv2
import numpy as np
import tensorflow as tf
from fastapi import FastAPI, File, UploadFile, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# Configuration
MODEL_PATH = os.environ.get("MODEL_PATH", "./model/pupil_segnet")
IMG_SIZE = 256
NUM_CLASSES = 3
PORT = int(os.environ.get("PORT", 8080))

# CORS: restrict to GitHub Pages and local dev
ALLOWED_ORIGINS = os.environ.get(
    "ALLOWED_ORIGINS",
    "https://bosonian.github.io,http://localhost:8000,http://127.0.0.1:8000"
).split(",")

# Global model reference
model = None

# Request counter for logging (no PII stored)
request_count = 0


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load model on startup."""
    global model
    logger.info(f"Loading model from {MODEL_PATH}")
    try:
        model = tf.saved_model.load(MODEL_PATH)
        logger.info("Model loaded successfully")
        # Warm up with a dummy inference
        dummy = tf.constant(np.zeros((1, IMG_SIZE, IMG_SIZE, 3), dtype=np.float32))
        _ = model.signatures["serving_default"](dummy)
        logger.info("Model warmup complete")
    except Exception as e:
        logger.error(f"Failed to load model: {e}")
        raise
    yield
    logger.info("Shutting down")


app = FastAPI(
    title="Pupil Detection API",
    description="Detects pupil and iris circles from eye images",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS - restricted to allowed origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log request metrics (no PII)."""
    global request_count
    request_count += 1
    start = time.time()
    response = await call_next(request)
    elapsed = round((time.time() - start) * 1000, 1)
    logger.info(
        "req=%d method=%s path=%s status=%d ms=%.1f",
        request_count,
        request.method,
        request.url.path,
        response.status_code,
        elapsed,
    )
    return response


# Response models
class CircleResult(BaseModel):
    x: float
    y: float
    radius: float


class ConfidenceResult(BaseModel):
    pupil: float
    iris: float


class DetectionResponse(BaseModel):
    pupil: Optional[CircleResult] = None
    iris: Optional[CircleResult] = None
    confidence: ConfidenceResult
    ratio: Optional[float] = None
    inference_ms: float
    model_version: str = "1.0.0"


def fit_circle_from_mask(mask: np.ndarray, class_id: int) -> Optional[dict]:
    """
    Fit a circle to a segmentation mask region using contour analysis.

    Args:
        mask: 2D predicted class array
        class_id: class to fit (1=iris, 2=pupil)

    Returns:
        Dict with x, y, radius or None
    """
    binary = (mask == class_id).astype(np.uint8)
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if not contours:
        return None

    largest = max(contours, key=cv2.contourArea)
    if len(largest) < 5:
        return None

    # Centroid from moments
    M = cv2.moments(largest)
    if M["m00"] > 0:
        cx = M["m10"] / M["m00"]
        cy = M["m01"] / M["m00"]
    else:
        (cx, cy), _ = cv2.minEnclosingCircle(largest)

    # Effective radius from area
    area = cv2.contourArea(largest)
    radius = float(np.sqrt(area / np.pi))

    return {"x": float(cx), "y": float(cy), "radius": radius}


def run_inference(image_bytes: bytes) -> DetectionResponse:
    """
    Full inference pipeline: decode image -> segment -> fit circles.

    Args:
        image_bytes: Raw image bytes (JPEG/PNG)

    Returns:
        DetectionResponse with detection results
    """
    start = time.time()

    # Decode image
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="Could not decode image")

    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    orig_h, orig_w = img_rgb.shape[:2]

    # Preprocess
    resized = cv2.resize(img_rgb, (IMG_SIZE, IMG_SIZE))
    normalized = resized.astype(np.float32) / 255.0
    batch = tf.constant(normalized[np.newaxis, ...])

    # Run model
    infer = model.signatures["serving_default"]
    output = infer(batch)
    output_key = list(output.keys())[0]
    pred = output[output_key].numpy()[0]  # (256, 256, 3)

    # Get class predictions
    pred_mask = np.argmax(pred, axis=-1).astype(np.uint8)

    # Fit circles in model space
    pupil_circle = fit_circle_from_mask(pred_mask, 2)
    iris_circle = fit_circle_from_mask(pred_mask, 1)

    # Scale to original image coordinates
    scale_x = orig_w / IMG_SIZE
    scale_y = orig_h / IMG_SIZE
    avg_scale = (scale_x + scale_y) / 2

    if pupil_circle:
        pupil_circle["x"] *= scale_x
        pupil_circle["y"] *= scale_y
        pupil_circle["radius"] *= avg_scale

    if iris_circle:
        iris_circle["x"] *= scale_x
        iris_circle["y"] *= scale_y
        iris_circle["radius"] *= avg_scale

    # Confidence from softmax probabilities
    pupil_conf = float(np.mean(pred[..., 2][pred_mask == 2])) if np.any(pred_mask == 2) else 0.0
    iris_conf = float(np.mean(pred[..., 1][pred_mask == 1])) if np.any(pred_mask == 1) else 0.0

    # Pupil-to-iris ratio
    ratio = None
    if pupil_circle and iris_circle and iris_circle["radius"] > 0:
        ratio = round(pupil_circle["radius"] / iris_circle["radius"], 4)

    elapsed_ms = round((time.time() - start) * 1000, 1)

    return DetectionResponse(
        pupil=CircleResult(**pupil_circle) if pupil_circle else None,
        iris=CircleResult(**iris_circle) if iris_circle else None,
        confidence=ConfidenceResult(
            pupil=round(pupil_conf, 3),
            iris=round(iris_conf, 3),
        ),
        ratio=ratio,
        inference_ms=elapsed_ms,
    )


@app.post("/detect", response_model=DetectionResponse)
async def detect_pupil(image: UploadFile = File(...)):
    """
    Detect pupil and iris from an uploaded eye image.

    Accepts JPEG or PNG images. Returns circle parameters for
    both pupil and iris, confidence scores, and the pupil/iris ratio.
    """
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image (JPEG/PNG)")

    contents = await image.read()
    if len(contents) > 10 * 1024 * 1024:  # 10MB limit
        raise HTTPException(status_code=400, detail="Image too large (max 10MB)")

    return run_inference(contents)


@app.post("/detect/base64", response_model=DetectionResponse)
async def detect_pupil_base64(data: dict):
    """
    Detect pupil and iris from a base64-encoded image.

    Accepts JSON body: {"image": "<base64-encoded-image>"}
    This endpoint is useful for PWA integration where the image
    is captured from canvas as a data URL.
    """
    import base64

    image_b64 = data.get("image", "")
    if not image_b64:
        raise HTTPException(status_code=400, detail="Missing 'image' field")

    # Strip data URL prefix if present
    if "," in image_b64:
        image_b64 = image_b64.split(",", 1)[1]

    try:
        image_bytes = base64.b64decode(image_b64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 encoding")

    if len(image_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large (max 10MB)")

    return run_inference(image_bytes)


@app.get("/health")
async def health_check():
    """Health check endpoint for Cloud Run."""
    return {
        "status": "healthy",
        "model_loaded": model is not None,
        "model_path": MODEL_PATH,
        "requests_served": request_count,
        "version": "2.0.0",
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
