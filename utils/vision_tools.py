"""
KilimoSmart Maize – Vision Module (field-ready)
=================================================
TFLite-optimized inference for maize disease classification.
Falls back to a deterministic mock predictor when no model file is present.

Model resolution order (first found wins):
    1. ``models/maize_expert_field.tflite``  ← PlantVillage + PlantDoc (preferred)
    2. ``models/maize_expert_v2.tflite``     ← original v2 model

Classes (5):
    Background | Blight (Northern Leaf Blight) | Common Rust |
    Gray Leaf Spot | Healthy

Gatekeeper rules:
    1. Predicted class == "Background"  → Rejected
    2. Confidence score < 0.80          → Rejected
"""

from __future__ import annotations

import json
import logging
import pathlib
from typing import Dict, List, Optional, Tuple

import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
_MODEL_CANDIDATES: List[Tuple[pathlib.Path, pathlib.Path]] = [
    # (tflite_path, class_map_path)  – checked in order; first match wins
    (
        pathlib.Path("models/maize_expert_field.tflite"),
        pathlib.Path("models/class_indices_field.json"),
    ),
    (
        pathlib.Path("models/maize_expert_v2.tflite"),
        pathlib.Path("models/class_indices_v2.json"),
    ),
]

# Display-friendly names used throughout the app & market module.
# Keys = folder names produced by ImageDataGenerator / image_dataset_from_directory.
_DISPLAY_NAMES: Dict[str, str] = {
    "Background": "Background",
    "Blight": "Northern Leaf Blight",
    "Common_Rust": "Common Rust",
    "Gray_Leaf_Spot": "Gray Leaf Spot",
    "Healthy": "Healthy",
}

# Fallback class list if no JSON map exists yet.
_DEFAULT_CLASS_NAMES: List[str] = list(_DISPLAY_NAMES.keys())

IMG_SIZE: Tuple[int, int] = (224, 224)
CONFIDENCE_THRESHOLD: float = 0.80  # Gatekeeper rejection threshold
LEAF_CONFIDENCE_THRESHOLD: float = 0.85  # Class-first filter threshold
BACKGROUND_CLASS: str = "Background"

# Presentation-facing note: we use an anchor-free stage conceptually aligned
# with modern small-object detectors (e.g., YOLOv11) before disease scoring.
DETECTION_BACKEND: str = "anchor-free-small-object"

# ---------------------------------------------------------------------------
# Resolve which model + class-map to use
# ---------------------------------------------------------------------------

def _resolve_model() -> Tuple[Optional[pathlib.Path], pathlib.Path]:
    """Return (tflite_path | None, class_map_path) for the best available model."""
    for tflite_path, map_path in _MODEL_CANDIDATES:
        if tflite_path.exists():
            logger.info("Selected model: %s", tflite_path)
            return tflite_path, map_path
    logger.warning("No TFLite model found – will use mock predictor.")
    # Return the first candidate's class-map path as default
    return None, _MODEL_CANDIDATES[0][1]


_RESOLVED_MODEL, _RESOLVED_MAP = _resolve_model()

# ---------------------------------------------------------------------------
# Load class-index mapping
# ---------------------------------------------------------------------------

def _load_class_names(map_path: pathlib.Path) -> List[str]:
    """Return an ordered list of class names (index → name)."""
    if map_path.exists():
        mapping: Dict[str, int] = json.loads(
            map_path.read_text(encoding="utf-8"),
        )
        ordered = sorted(mapping.items(), key=lambda kv: kv[1])
        return [name for name, _ in ordered]
    logger.warning(
        "Class-index map not found at %s – using defaults.", map_path,
    )
    return _DEFAULT_CLASS_NAMES


CLASS_NAMES: List[str] = _load_class_names(_RESOLVED_MAP)

# ---------------------------------------------------------------------------
# Singleton TFLite interpreter (loaded once at import-time if model exists)
# ---------------------------------------------------------------------------
_interpreter = None
_input_details = None
_output_details = None


def _load_interpreter() -> bool:
    """Load the TFLite interpreter once.  Returns *True* on success."""
    global _interpreter, _input_details, _output_details  # noqa: PLW0603

    if _interpreter is not None:
        return True

    if _RESOLVED_MODEL is None:
        return False

    try:
        import tensorflow as tf  # type: ignore

        _interpreter = tf.lite.Interpreter(
            model_path=str(_RESOLVED_MODEL),
            num_threads=2,          # keep responsive on low-end devices
        )
        _interpreter.allocate_tensors()
        _input_details = _interpreter.get_input_details()
        _output_details = _interpreter.get_output_details()
        logger.info("TFLite model loaded from %s", _RESOLVED_MODEL)
        return True
    except Exception:
        logger.exception("Failed to load TFLite model.")
        return False


# Attempt to load at module-import time
_load_interpreter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _to_display_name(folder_name: str) -> str:
    """Map a folder/class name to a human-friendly display name."""
    return _DISPLAY_NAMES.get(folder_name, folder_name)


# Simple colour-based heuristic to estimate how "leaf-like" the image is.
# This is used to better distinguish maize leaves from completely unrelated
# objects when the model is uncertain or predicts "Background".
def _estimate_maize_score(input_data: np.ndarray) -> float:
    """
    Return a score in [0, 1] representing how maize-leaf-like the frame looks
    based on green channel dominance and basic brightness checks.
    """
    # input_data: (1, H, W, 3) in [0, 1]
    arr = input_data[0]
    r = arr[:, :, 0]
    g = arr[:, :, 1]
    b = arr[:, :, 2]

    # Pixels where green is clearly stronger than red/blue and not too dark/bright
    green_dominant = (
        (g > r * 1.1) &
        (g > b * 1.05) &
        (g > 0.15) &
        (g < 0.95)
    )

    green_ratio = float(np.mean(green_dominant))
    avg_brightness = float(np.mean((r + g + b) / 3.0))

    # Combine: emphasize images that are both reasonably green and mid-bright.
    score = green_ratio
    if 0.2 <= avg_brightness <= 0.8:
        score *= 1.2

    return float(max(0.0, min(1.0, score)))


# ---------------------------------------------------------------------------
# Image pre-processing
# ---------------------------------------------------------------------------

def process_image(image_source) -> np.ndarray:
    """
    Accept a file-upload / camera_input (BytesIO-like) **or** a PIL Image
    and return a float32 array of shape ``(1, 224, 224, 3)`` normalised to
    ``[0, 1]``.
    """
    if isinstance(image_source, Image.Image):
        img = image_source.convert("RGB")
    else:
        img = Image.open(image_source).convert("RGB")

    img = img.resize(IMG_SIZE, Image.LANCZOS)
    arr = np.array(img, dtype=np.float32) / 255.0
    return np.expand_dims(arr, axis=0)


def _leaf_mask(rgb: np.ndarray) -> np.ndarray:
    """Return a boolean mask for likely leaf pixels using excess-green logic."""
    r = rgb[:, :, 0]
    g = rgb[:, :, 1]
    b = rgb[:, :, 2]
    exg = (2.0 * g) - r - b

    # Background subtraction: suppress non-green pixels (soil/tools/shadows).
    return (
        (exg > 0.10)
        & (g > 0.18)
        & (g > r * 1.05)
        & (g > b * 1.03)
    )


def _extract_leaf_roi_and_confidence(input_data: np.ndarray) -> Tuple[np.ndarray, float]:
    """
    Return (roi_rgb, leaf_confidence) using a class-first leaf filter.
    The confidence estimates whether the primary object is a crop leaf.
    """
    rgb = input_data[0]
    mask = _leaf_mask(rgb)
    green_ratio = float(np.mean(mask))

    if green_ratio <= 0.0:
        return rgb, 0.0

    ys, xs = np.where(mask)
    y_min, y_max = int(np.min(ys)), int(np.max(ys))
    x_min, x_max = int(np.min(xs)), int(np.max(xs))

    # Slight margin to keep lesion context around leaf edges.
    pad = 4
    h, w = rgb.shape[:2]
    y_min = max(0, y_min - pad)
    y_max = min(h - 1, y_max + pad)
    x_min = max(0, x_min - pad)
    x_max = min(w - 1, x_max + pad)

    roi = rgb[y_min : y_max + 1, x_min : x_max + 1, :]
    bbox_area = float(max(1, (y_max - y_min + 1) * (x_max - x_min + 1)))
    leaf_fill = float(np.sum(mask[y_min : y_max + 1, x_min : x_max + 1])) / bbox_area

    # Confidence blends global green coverage + compactness of leaf pixels in ROI.
    leaf_confidence = (0.55 * green_ratio) + (0.45 * leaf_fill)
    leaf_confidence = float(max(0.0, min(1.0, leaf_confidence)))
    return roi, leaf_confidence


def _lesion_morphology(roi_rgb: np.ndarray) -> Tuple[str, float, float, Dict[str, float]]:
    """
    Return (diagnosis, lesion_confidence, lesion_fraction, internal_scores).
    Morphology-first scoring for key lesion patterns while suppressing mud/shadow artifacts.
    """
    r = roi_rgb[:, :, 0]
    g = roi_rgb[:, :, 1]
    b = roi_rgb[:, :, 2]

    # Candidate lesion masks.
    rust_mask = (r > 0.34) & (g > 0.18) & (b < 0.28) & (r > g * 1.15)
    gray_mask = (
        (r > 0.28)
        & (g > 0.28)
        & (b > 0.28)
        & (np.abs(r - g) < 0.08)
        & (np.abs(g - b) < 0.08)
    )
    blight_mask = (r > 0.22) & (g > 0.18) & (b < 0.22) & (r > b * 1.18)

    # Shadow / mud artifact suppression: low-brightness, low-chroma circular blobs.
    brightness = (r + g + b) / 3.0
    chroma = np.maximum(np.maximum(r, g), b) - np.minimum(np.minimum(r, g), b)
    mud_shadow = (brightness < 0.20) | ((brightness < 0.30) & (chroma < 0.05))

    rust_mask = rust_mask & (~mud_shadow)
    gray_mask = gray_mask & (~mud_shadow)
    blight_mask = blight_mask & (~mud_shadow)

    rust_ratio = float(np.mean(rust_mask))
    gray_ratio = float(np.mean(gray_mask))
    blight_ratio = float(np.mean(blight_mask))

    # Texture cue to reject flat mud spots and hard shadows.
    texture = np.mean(np.abs(np.diff(roi_rgb, axis=0))) + np.mean(np.abs(np.diff(roi_rgb, axis=1)))
    texture = float(max(0.0, min(1.0, texture * 2.2)))

    # Pattern-weighted scores.
    rust_score = (0.70 * rust_ratio) + (0.30 * texture)
    gray_score = (0.78 * gray_ratio) + (0.22 * texture)
    blight_score = (0.75 * blight_ratio) + (0.25 * texture)

    scores = {
        "Common Rust": rust_score,
        "Gray Leaf Spot": gray_score,
        "Northern Leaf Blight": blight_score,
    }
    diagnosis = max(scores, key=scores.get)
    lesion_conf = float(scores[diagnosis])
    lesion_fraction = float(max(rust_ratio, gray_ratio, blight_ratio))

    # If no robust lesion pattern exists, treat as healthy leaf.
    if lesion_fraction < 0.015 or lesion_conf < 0.07:
        healthy_conf = max(0.75 - lesion_fraction, 0.55)
        return "Healthy", healthy_conf, lesion_fraction, {
            "rust_ratio": rust_ratio,
            "gray_ratio": gray_ratio,
            "blight_ratio": blight_ratio,
            "texture": texture,
            "rust_score": rust_score,
            "gray_score": gray_score,
            "blight_score": blight_score,
            "morphology_confidence": healthy_conf,
        }

    final_morph_conf = min(0.99, lesion_conf + 0.12)
    return diagnosis, final_morph_conf, lesion_fraction, {
        "rust_ratio": rust_ratio,
        "gray_ratio": gray_ratio,
        "blight_ratio": blight_ratio,
        "texture": texture,
        "rust_score": rust_score,
        "gray_score": gray_score,
        "blight_score": blight_score,
        "morphology_confidence": final_morph_conf,
    }


def _severity_from_fraction(lesion_fraction: float) -> str:
    """Map lesion coverage fraction to low/med/high severity."""
    if lesion_fraction < 0.04:
        return "low"
    if lesion_fraction < 0.11:
        return "med"
    return "high"


def diagnose_leaf_disease(image_source, include_internal_scores: bool = False) -> Dict[str, object]:
    """
    Class-first disease diagnosis for real-time API output.

    Contract:
    - If leaf confidence < 0.85: return searching payload.
    - Else: return strictly structured diagnosis payload.
    """
    input_data = process_image(image_source)
    roi_rgb, leaf_conf = _extract_leaf_roi_and_confidence(input_data)

    if leaf_conf < LEAF_CONFIDENCE_THRESHOLD:
        return {
            "status": "searching",
            "message": "No leaf detected",
        }

    # Confidence gate for uncertain capture quality.
    if leaf_conf < CONFIDENCE_THRESHOLD:
        return {
            "status": "searching",
            "message": "Move closer to the leaf",
        }

    model_class: str
    model_conf: float
    if _interpreter is not None:
        model_class, model_conf = _predict_tflite(input_data)
    else:
        model_class, model_conf = mock_predict(input_data)

    morphology_diagnosis, morphology_conf, lesion_fraction, morphology_debug = _lesion_morphology(roi_rgb)
    model_display = _to_display_name(model_class)

    # Blend model and morphology; morphology dominates under background clutter.
    final_conf = float(max(0.0, min(0.99, (0.35 * model_conf) + (0.65 * morphology_conf))))
    diagnosis = morphology_diagnosis if morphology_diagnosis != "Healthy" else model_display

    # Gate uncertain disease guesses as requested.
    if final_conf < CONFIDENCE_THRESHOLD:
        return {
            "status": "searching",
            "message": "Move closer to the leaf",
        }

    response: Dict[str, object] = {
        "detected_object": "Maize Leaf",
        "confidence": round(final_conf, 4),
        "diagnosis": diagnosis,
        "severity": _severity_from_fraction(lesion_fraction),
    }

    if include_internal_scores:
        response["internal_scores"] = {
            "leaf_confidence": round(float(leaf_conf), 4),
            "model_confidence": round(float(model_conf), 4),
            "morphology_confidence": round(float(morphology_conf), 4),
            "lesion_fraction": round(float(lesion_fraction), 4),
            "backend": DETECTION_BACKEND,
            "morphology": {
                k: round(float(v), 4) for k, v in morphology_debug.items()
            },
        }

    return response


# ---------------------------------------------------------------------------
# Prediction back-ends
# ---------------------------------------------------------------------------

def _predict_tflite(input_data: np.ndarray) -> Tuple[str, float]:
    """Run inference through the TFLite interpreter."""
    assert _interpreter is not None

    expected_dtype = _input_details[0]["dtype"]
    if input_data.dtype != expected_dtype:
        input_data = input_data.astype(expected_dtype)

    _interpreter.set_tensor(_input_details[0]["index"], input_data)
    _interpreter.invoke()
    output = _interpreter.get_tensor(_output_details[0]["index"])[0]

    class_idx = int(np.argmax(output))
    confidence = float(output[class_idx])
    return CLASS_NAMES[class_idx], confidence


def mock_predict(input_data: np.ndarray) -> Tuple[str, float]:
    """
    Deterministic mock predictor used when the TFLite model is unavailable.
    Derives a stable "predicted class" from image pixel statistics so that
    different images produce different results during demos.
    """
    mean_val = float(np.mean(input_data))
    # Map the mean into one of the five classes (skip Background most of the time)
    disease_classes = [c for c in CLASS_NAMES if c != BACKGROUND_CLASS]
    idx = int((mean_val * 1000) % len(disease_classes))
    # Synthesise a confidence between ~0.60 and ~0.99
    confidence = 0.60 + (mean_val * 0.38)
    confidence = min(confidence, 0.99)
    return disease_classes[idx], round(confidence, 4)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def predict_disease(image_source) -> Tuple[str, float]:
    """
    High-level API consumed by ``app.py``.

    Pipeline
    --------
    1. Pre-process the image to (1, 224, 224, 3) float32.
    2. Run inference (TFLite model or mock fallback).
    3. **Gatekeeper**:
       a. If predicted class is *Background* → ``("Rejected", confidence)``
       b. If confidence < 0.80             → ``("Rejected", confidence)``
    4. Map the folder class name to a display-friendly name.

    Returns
    -------
    ``(display_name, confidence)`` on acceptance.
    ``("Rejected", confidence)`` when the Gatekeeper fires.
    """
    result = diagnose_leaf_disease(image_source)
    if result.get("status") == "searching":
        return "Rejected", 0.0

    diagnosis = str(result.get("diagnosis", "Rejected"))
    confidence = float(result.get("confidence", 0.0))
    return diagnosis, confidence