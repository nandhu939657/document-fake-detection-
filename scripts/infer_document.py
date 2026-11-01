#!/usr/bin/env python3
"""Server-side document forgery analysis adapter.

The production contract is JSON-in/JSON-out so the Node server can invoke the
analyzer as a short-lived subprocess. A trained segmentation checkpoint
(models/weights/tamper_unet.pt or tamper_unet_findit.pt) is preferred; a
deterministic visual baseline keeps the application usable when the Python
runtime or the checkpoint is unavailable.

Scoring is evidence-based rather than "average mask probability": a tampered
region is usually a small fraction of the page, so averaging the whole mask
dilutes a real forgery to a near-zero score. Instead we combine
  - coverage: fraction of pixels above the decision threshold, saturated at
    SATURATION (a forgery covering ~8% of the page is already conclusive), and
  - peak: the strongest single-pixel probability, which guards against a model
    that is confident but noisy.
The product is scaled to 0-99 and split into genuine / review / forged bands.
"""
import base64
import io
import json
import sys
from pathlib import Path
import importlib.util

import numpy as np
from PIL import Image, ImageFilter, ImageEnhance

MODEL_SIZE = 256
PIXEL_THRESHOLD = 0.5
SATURATION = 0.08  # 8% of the page at >0.5 saturates the area term
REVIEW_MIN = 35
FORGED_MIN = 65
GRID = 16  # coarse grid for connected-region extraction
HOT_CELL = 0.05  # a grid cell is "hot" when 5% of its pixels are above threshold
MAX_REGIONS = 5

_MODEL_CACHE: dict[str, object] = {}


def decision_for_score(score: int) -> str:
    if score >= FORGED_MIN:
        return "forged"
    if score >= REVIEW_MIN:
        return "review"
    return "genuine"


def score_mask(mask: np.ndarray) -> tuple[int, float, float]:
    coverage = float((mask > PIXEL_THRESHOLD).mean())
    peak = float(mask.max())
    score = int(round(100 * min(1.0, coverage / SATURATION) * peak))
    return max(0, min(99, score)), coverage, peak


def mask_regions(mask: np.ndarray, decision: str) -> list[dict]:
    """Connected hot cells on a coarse grid, returned as normalized boxes."""
    hot = np.zeros((GRID, GRID), dtype=bool)
    cell = mask.shape[0] / GRID
    for gy in range(GRID):
        for gx in range(GRID):
            y0, y1 = int(gy * cell), int((gy + 1) * cell)
            x0, x1 = int(gx * cell), int((gx + 1) * cell)
            patch = mask[y0:y1, x0:x1]
            hot[gy, gx] = patch.size > 0 and float((patch > PIXEL_THRESHOLD).mean()) >= HOT_CELL

    seen = np.zeros_like(hot)
    regions = []
    for gy in range(GRID):
        for gx in range(GRID):
            if not hot[gy, gx] or seen[gy, gx]:
                continue
            stack = [(gy, gx)]
            seen[gy, gx] = True
            cells = []
            while stack:
                y, x = stack.pop()
                cells.append((y, x))
                for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                    if 0 <= ny < GRID and 0 <= nx < GRID and hot[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
            ys = [c[0] for c in cells]
            xs = [c[1] for c in cells]
            y0, y1 = min(ys), max(ys) + 1
            x0, x1 = min(xs), max(xs) + 1
            confidence = float(mask[int(y0 * cell):int(y1 * cell), int(x0 * cell):int(x1 * cell)].mean())
            regions.append({
                "label": "tampered text" if decision == "forged" else "region requiring review",
                "confidence": round(min(0.99, max(0.0, confidence)), 3),
                "x": round(x0 / GRID, 3),
                "y": round(y0 / GRID, 3),
                "width": round((x1 - x0) / GRID, 3),
                "height": round((y1 - y0) / GRID, 3),
            })
    regions.sort(key=lambda region: region["confidence"], reverse=True)
    return regions[:MAX_REGIONS]


def _load_unet(weights: Path):
    import torch
    import segmentation_models_pytorch as smp

    key = str(weights.resolve())
    model = _MODEL_CACHE.get(key)
    if model is None:
        model = smp.Unet("efficientnet-b0", encoder_weights=None, in_channels=3, classes=1)
        model.load_state_dict(torch.load(str(weights), map_location="cpu"))
        model.eval()
        _MODEL_CACHE[key] = model
    return model


def try_unet(raw: bytes, weights: Path):
    if not weights.exists() or importlib.util.find_spec("torch") is None or importlib.util.find_spec("segmentation_models_pytorch") is None:
        return None
    try:
        import torch
        import torch.nn.functional as F
        import torchvision.transforms as transforms

        image = Image.open(io.BytesIO(raw)).convert("RGB")
        original_size = image.size
        resized = image.resize((MODEL_SIZE, MODEL_SIZE), Image.Resampling.BILINEAR)
        x = transforms.Compose([transforms.ToTensor(), transforms.Normalize((0.485, 0.456, 0.406), (0.229, 0.224, 0.225))])(resized).unsqueeze(0)

        model = _load_unet(weights)
        with torch.no_grad():
            logits = model(x)
            mask = torch.sigmoid(logits)
            mask = F.interpolate(mask, size=(original_size[1], original_size[0]), mode="bilinear", align_corners=False)[0, 0].numpy()

        is_findit = weights.name == "tamper_unet_findit.pt"
        return {
            "mask": mask,
            "modelStatus": "unet-runtime-active",
            "modelVersion": (
                "Project-trained U-Net (EfficientNet-b0, receipt tamper annotations)"
                if is_findit
                else "Project-trained U-Net (EfficientNet-b0, DocTamper FCD subset)"
            ),
            "modelNote": (
                "Segmentation mask generated by the receipt-domain U-Net trained on the Find-it-again SROIE annotations."
                if is_findit
                else "Segmentation mask generated by the project-trained U-Net trained on a 1,500-pair DocTamper FCD subset."
            ),
        }
    except Exception as exc:
        return {"error": f"U-Net runtime unavailable: {exc}"}


def build_result(image: Image.Image, mask: np.ndarray, meta: dict) -> dict:
    score, coverage, peak = score_mask(mask)
    decision = decision_for_score(score)
    # Low-confidence hot cells are noise on a clean document; only surface
    # regions once the score has crossed into review/forged.
    regions = mask_regions(mask, decision) if decision != "genuine" else []

    mask_image = Image.fromarray(np.uint8(np.clip(mask * 255, 0, 255)), mode="L")
    overlay = image.convert("RGBA")
    red = Image.new("RGBA", image.size, (220, 38, 38, 0))
    red.putalpha(mask_image.point(lambda p: min(180, int(p * 0.75))))
    overlay = Image.alpha_composite(overlay, red)
    output = io.BytesIO()
    overlay.convert("RGB").save(output, format="JPEG", quality=88, optimize=True)

    if decision == "forged":
        tampering_types = ["tampered text"]
    elif decision == "review":
        tampering_types = ["possible tampering - manual review"]
    else:
        tampering_types = ["no high-confidence text anomaly"]

    return {
        "prediction": "genuine" if decision == "genuine" else "forged",
        "decision": decision,
        "modelStatus": meta["modelStatus"],
        "forgeryScore": score,
        "scoreDetails": {"coverage": round(coverage, 4), "peak": round(peak, 4), "saturation": SATURATION},
        "tamperingTypes": tampering_types,
        "flaggedRegions": regions,
        "overlayBase64": base64.b64encode(output.getvalue()).decode("ascii"),
        "modelVersion": meta["modelVersion"],
        "modelNote": meta["modelNote"],
    }


def baseline(image: Image.Image) -> dict:
    """Transparent visual fallback: no trained artifact, so stay conservative."""
    image = image.copy()
    image.thumbnail((1400, 1400))
    width, height = image.size
    gray = image.convert("L")
    residual = ImageEnhance.Contrast(Image.eval(gray, lambda p: abs(p - 128))).enhance(1.8)

    tiles = []
    tile_w = max(1, width // 8)
    tile_h = max(1, height // 8)
    for y in range(0, height, tile_h):
        for x in range(0, width, tile_w):
            box = (x, y, min(width, x + tile_w), min(height, y + tile_h))
            crop = gray.crop(box)
            crop_data = crop.get_flattened_data() if hasattr(crop, "get_flattened_data") else crop.getdata()
            mean = sum(crop_data) / max(1, crop.width * crop.height)
            edge = ImageEnhance.Contrast(crop).enhance(2.2)
            edge_data = edge.get_flattened_data() if hasattr(edge, "get_flattened_data") else edge.getdata()
            edge_mean = sum(edge_data) / max(1, edge.width * edge.height)
            tiles.append((abs(edge_mean - mean), x, y, box[2], box[3]))
    tiles.sort(reverse=True)
    hot = tiles[: max(1, min(4, len(tiles)))]
    score = min(99, max(0, int(35 + sum(item[0] for item in hot) / max(1, len(hot)))))
    decision = decision_for_score(score)

    regions = []
    for _, x1, y1, x2, y2 in hot:
        regions.append({
            "label": "region requiring review" if decision != "genuine" else "no high-confidence text anomaly",
            "confidence": round(min(0.98, max(0.0, score / 100)), 3),
            "x": round(x1 / width, 3),
            "y": round(y1 / height, 3),
            "width": round((x2 - x1) / width, 3),
            "height": round((y2 - y1) / height, 3),
        })

    overlay = image.convert("RGBA")
    mask = residual.resize(image.size).convert("L").filter(ImageFilter.GaussianBlur(radius=10))
    red = Image.new("RGBA", image.size, (220, 38, 38, 0))
    red.putalpha(mask.point(lambda p: min(170, int(p * 0.9))))
    overlay = Image.alpha_composite(overlay, red)
    output = io.BytesIO()
    overlay.convert("RGB").save(output, format="JPEG", quality=88, optimize=True)

    has_torch = importlib.util.find_spec("torch") is not None
    has_smp = importlib.util.find_spec("segmentation_models_pytorch") is not None
    if (Path("models/weights/tamper_unet_findit.pt").exists() or Path("models/weights/tamper_unet.pt").exists()) and not (has_torch and has_smp):
        model_status = "unet-checkpoint-mounted-runtime-unavailable"
    else:
        model_status = "baseline-visual-fallback"

    return {
        "prediction": "genuine" if decision == "genuine" else "forged",
        "decision": decision,
        "modelStatus": model_status,
        "forgeryScore": score,
        "scoreDetails": {"coverage": None, "peak": None, "saturation": SATURATION},
        "tamperingTypes": ["possible tampering - manual review"] if decision != "genuine" else ["no high-confidence text anomaly"],
        "flaggedRegions": regions if decision != "genuine" else [],
        "overlayBase64": base64.b64encode(output.getvalue()).decode("ascii"),
        "modelVersion": "Visual baseline (no trained model artifact)",
        "modelNote": "No trained checkpoint/runtime was available, so this is a transparent visual heuristic and should not be treated as model evidence.",
    }


def analyze(raw: bytes) -> dict:
    image = Image.open(io.BytesIO(raw)).convert("RGB")

    candidates = [
        Path("models/weights/tamper_unet.pt"),
        Path("models/weights/tamper_unet_findit.pt"),
    ]
    for weights in candidates:
        result = try_unet(raw, weights)
        if result and "mask" in result:
            return build_result(image, result["mask"], result)

    return baseline(image)


if __name__ == "__main__":
    try:
        encoded = sys.stdin.read().strip()
        if not encoded:
            raise ValueError("No image payload received")
        print(json.dumps(analyze(base64.b64decode(encoded))))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        sys.exit(1)
