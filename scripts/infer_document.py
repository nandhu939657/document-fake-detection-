#!/usr/bin/env python3
"""Server-side document forgery analysis adapter.

The production contract is JSON-in/JSON-out so the Node server can invoke the
analyzer as a short-lived subprocess. A trained segmentation checkpoint
(models/weights/tamper_unet.pt or tamper_unet_findit.pt) is preferred; a
deterministic visual baseline keeps the application usable when the Python
runtime or the checkpoint is unavailable.

Scoring is confidence-based: what matters is how strongly the model believes
any region was edited, not how much of the page happens to be highlighted. A
small tampered line on an otherwise clean page is still a real forgery, so the
score combines the peak probability with the mean of the flagged pixels, and
page area acts as a gate that only scales the result down for tiny regions.
The score is scaled to 0-99 and split into genuine / review / forged bands.
"""
import base64
import io
import json
import sys
from pathlib import Path
import importlib.util

import numpy as np
from PIL import Image, ImageFilter, ImageEnhance, ImageDraw

MODEL_SIZE = 256
PIXEL_THRESHOLD = 0.5
MIN_AREA = 0.03  # a confidently-edited region covering >=3% of the page is conclusive
REVIEW_MIN = 35
FORGED_MIN = 70
GRID = 16  # coarse grid for connected-region extraction
HOT_CELL = 0.05  # a grid cell is "hot" when 5% of its pixels are above threshold
MAX_REGIONS = 5
REGION_MIN_CONF = 0.30  # boxes below this mean confidence are treated as noise

_MODEL_CACHE: dict[str, object] = {}


def decision_for_score(score: int) -> str:
    if score >= FORGED_MIN:
        return "forged"
    if score >= REVIEW_MIN:
        return "review"
    return "genuine"


def classify_region(image: Image.Image, px0: int, py0: int, px1: int, py1: int) -> tuple[str, str]:
    """Classify region as text, signature, or logo/seal based on aspect ratio, placement, and color."""
    img_w, img_h = image.size
    w = max(1, px1 - px0)
    h = max(1, py1 - py0)
    aspect = w / h
    cy = (py0 + py1) / (2 * img_h)

    # Check color saturation (stamps, seals, and logos frequently use colored ink)
    has_color = False
    try:
        crop = image.crop((max(0, px0), max(0, py0), min(img_w, px1), min(img_h, py1)))
        hsv = crop.convert("HSV")
        sat_mean = float(np.array(hsv)[:, :, 1].mean())
        has_color = sat_mean > 25
    except Exception:
        pass

    # Signature: usually placed in lower section (cy > 0.50), cursive width-to-height ratio
    if cy > 0.50 and 1.2 <= aspect <= 4.5 and h < img_h * 0.30:
        return "signature", "copied signature"

    # Logo / Seal: compact / square / circular aspect ratio, or colored stamp
    if 0.65 <= aspect <= 1.55 and (has_color or cy < 0.32 or (w < img_w * 0.25 and h < img_h * 0.25)):
        return "logo" if cy < 0.32 else "seal", "modified seal / logo"

    # Default: Altered text (words, sentences, numbers, dates)
    return "text", "altered text"


def is_border_noise(px0: int, py0: int, px1: int, py1: int, img_w: int, img_h: int) -> bool:
    """Filter out scanner margins and page boundary shadows."""
    w = px1 - px0
    h = py1 - py0
    edge_x = px0 < int(0.02 * img_w) or px1 > int(0.98 * img_w)
    edge_y = py0 < int(0.02 * img_h) or py1 > int(0.98 * img_h)
    if (edge_x or edge_y) and (w < int(0.025 * img_w) or h < int(0.025 * img_h)):
        return True
    if (h < int(0.007 * img_h) and w > int(0.12 * img_w)) or (w < int(0.007 * img_w) and h > int(0.12 * img_h)):
        return True
    return False


def score_mask(mask: np.ndarray, regions: list[dict] | None = None) -> tuple[int, float, float]:
    """Score document authenticity based on cluster confidence and coherent evidence."""
    above = mask > PIXEL_THRESHOLD
    coverage = float(above.mean())
    peak = float(mask.max())

    if not regions or coverage < 0.005:
        score = int(round(coverage * 2000))
        return max(0, min(24, score)), coverage, peak

    top_conf = max(r["confidence"] for r in regions)
    top_hot = max(r.get("hotPixels", 0) for r in regions)

    if top_conf >= 0.80 and top_hot >= 300:
        score = int(round(72 + 26 * min(1.0, (top_conf - 0.80) / 0.15)))
    elif top_conf >= 0.72 and top_hot >= 150:
        score = int(round(40 + 28 * min(1.0, (top_conf - 0.72) / 0.10)))
    elif top_conf >= 0.71:
        score = int(round(35 + 6 * (top_conf - 0.71) / 0.02))
    elif top_conf >= 0.60:
        score = int(round(12 + 18 * min(1.0, (top_conf - 0.60) / 0.11)))
    else:
        score = int(round(5 + 10 * min(1.0, top_conf / 0.60)))

    score = max(0, min(99, score))
    return score, coverage, peak


def mask_regions(mask: np.ndarray, decision: str, image: Image.Image | None = None) -> list[dict]:
    """Connected hot cells on a coarse grid, returned as categorized anomaly regions."""
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
    img_w = image.size[0] if image is not None else mask.shape[1]
    img_h = image.size[1] if image is not None else mask.shape[0]

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
            gy0, gy1 = min(ys), max(ys) + 1
            gx0, gx1 = min(xs), max(xs) + 1

            cy0, cy1 = int(gy0 * cell), int(gy1 * cell)
            cx0, cx1 = int(gx0 * cell), int(gx1 * cell)
            patch = mask[cy0:cy1, cx0:cx1] > PIXEL_THRESHOLD
            if not patch.any():
                continue
            rows = np.where(patch.any(axis=1))[0]
            cols = np.where(patch.any(axis=0))[0]
            py0, py1 = cy0 + int(rows[0]), cy0 + int(rows[-1]) + 1
            px0, px1 = cx0 + int(cols[0]), cx0 + int(cols[-1]) + 1
            confidence = float(mask[py0:py1, px0:px1].mean())
            hot_pixels = int(patch.sum())

            if confidence < REGION_MIN_CONF:
                continue

            if is_border_noise(px0, py0, px1, py1, img_w, img_h):
                continue

            category, label = ("text", "tampered text")
            if image is not None:
                category, label = classify_region(image, px0, py0, px1, py1)
            elif decision != "forged":
                label = "region requiring review"

            regions.append({
                "type": category,
                "label": label if decision == "forged" else ("region requiring review" if decision == "review" else label),
                "confidence": round(min(0.99, max(0.0, confidence)), 3),
                "x": round(px0 / mask.shape[1], 3),
                "y": round(py0 / mask.shape[0], 3),
                "width": round((px1 - px0) / mask.shape[1], 3),
                "height": round((py1 - py0) / mask.shape[0], 3),
                "hotPixels": hot_pixels,
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
    all_regions = mask_regions(mask, "review", image)
    score, coverage, peak = score_mask(mask, all_regions)
    decision = decision_for_score(score)
    regions = all_regions if decision != "genuine" else []

    overlay = image.copy()
    output = io.BytesIO()

    # Draw precise markers only: text underlined with red, signature/logo circled
    if decision != "genuine" and regions:
        draw = ImageDraw.Draw(overlay)
        img_w, img_h = image.size
        line_w = max(3, int(img_h * 0.004))
        for r in regions:
            px0 = int(r["x"] * img_w)
            py0 = int(r["y"] * img_h)
            px1 = int((r["x"] + r["width"]) * img_w)
            py1 = int((r["y"] + r["height"]) * img_h)
            cat = r.get("type", "text")
            stroke_color = (225, 29, 72) if decision == "forged" else (217, 119, 6)

            if cat in ("signature", "logo", "seal"):
                pad = max(4, int(img_h * 0.006))
                draw.ellipse([px0 - pad, py0 - pad, px1 + pad, py1 + pad], outline=stroke_color, width=line_w)
            else:
                under_y = min(img_h - 2, py1 + 2)
                draw.line([(px0, under_y), (px1, under_y)], fill=stroke_color, width=line_w)
                tick_h = max(3, int(line_w * 1.5))
                draw.line([(px0, under_y - tick_h), (px0, under_y + 1)], fill=stroke_color, width=line_w)
                draw.line([(px1, under_y - tick_h), (px1, under_y + 1)], fill=stroke_color, width=line_w)

    overlay.save(output, format="JPEG", quality=90, optimize=True)

    if decision == "forged":
        types = list(dict.fromkeys(r["label"] for r in regions))
        tampering_types = types if types else ["tampered text"]
    elif decision == "review":
        types = list(dict.fromkeys(r["label"] for r in regions))
        tampering_types = types if types else ["possible tampering - manual review"]
    else:
        tampering_types = ["no high-confidence text anomaly"]

    return {
        "prediction": "genuine" if decision == "genuine" else "forged",
        "decision": decision,
        "modelStatus": meta["modelStatus"],
        "forgeryScore": score,
        "scoreDetails": {"coverage": round(coverage, 4), "peak": round(peak, 4), "min_area": MIN_AREA},
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
    # ponytail: rough heuristic scale with no held-out calibration; the trained
    # U-Net path is preferred. No artificial floor so clean pages score low.
    anomaly = sum(item[0] for item in hot) / max(1, len(hot))
    score = min(99, max(0, int(round(anomaly * 1.2))))
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
        "scoreDetails": {"coverage": None, "peak": None, "min_area": MIN_AREA},
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
