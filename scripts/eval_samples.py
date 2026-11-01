#!/usr/bin/env python3
"""Regression check for the document forgery decision.

Runs the real inference path on a small labeled sample set and asserts that
the evidence-based score separates known fakes from known genuine documents.
Run from anywhere with the project venv:

    python scripts/eval_samples.py
"""
import argparse
import io
import json
import os
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
os.chdir(ROOT)
sys.path.insert(0, str(ROOT / "scripts"))

import infer_document as infer  # noqa: E402

# Known labels for the bundled samples. Kept small and explicit so a failure
# points at a concrete image instead of a vague aggregate.
CASES = [
    ("samples/sample-2-fake-obvious.jpg", "fake"),
    ("samples/sample-6-fake-moderate.jpg", "fake"),
    ("samples/sample-12-web-fake-obvious.png", "fake"),
    ("samples/sample-15-web-fake-invoice-obvious.png", "fake"),
    ("samples/sample-1-genuine-letter.png", "genuine"),
    ("samples/sample-4-genuine-invoice.png", "genuine"),
    ("samples/sample-5-genuine-form.png", "genuine"),
    ("samples/sample-14-web-genuine-invoice.png", "genuine"),
]


def evaluate(relative_path: str, weights: Path | None):
    path = ROOT / relative_path
    raw = path.read_bytes()
    image = Image.open(io.BytesIO(raw)).convert("RGB")

    candidates = [weights] if weights else [Path("models/weights/tamper_unet.pt"), Path("models/weights/tamper_unet_findit.pt")]
    result = None
    for candidate in candidates:
        result = infer.try_unet(raw, candidate)
        if result and "mask" in result:
            break
    if not result or "mask" not in result:
        return {"score": None, "decision": "no-model", "regions": 0, "version": "none"}

    out = infer.build_result(image, result["mask"], result)
    return {
        "score": out["forgeryScore"],
        "decision": out["decision"],
        "regions": len(out["flaggedRegions"]),
        "version": out["modelVersion"],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--weights", help="Optional checkpoint path to evaluate instead of the default order")
    parser.add_argument("--json", action="store_true", help="Print a machine-readable summary only")
    args = parser.parse_args()
    weights = Path(args.weights) if args.weights else None

    rows = []
    for relative_path, label in CASES:
        result = evaluate(relative_path, weights)
        rows.append({"file": relative_path, "label": label, **result})

    fake_scores = [row["score"] for row in rows if row["label"] == "fake" and row["score"] is not None]
    genuine_scores = [row["score"] for row in rows if row["label"] == "genuine" and row["score"] is not None]
    genuine_forged = [row["file"] for row in rows if row["label"] == "genuine" and row["decision"] == "forged"]
    fake_forged = [row["file"] for row in rows if row["label"] == "fake" and row["decision"] == "forged"]

    checks = {
        "model_loaded": len(fake_scores) == len([r for r in rows if r["label"] == "fake"]) and len(genuine_scores) == len([r for r in rows if r["label"] == "genuine"]),
        "fakes_outscore_genuine": bool(fake_scores and genuine_scores) and (sum(fake_scores) / len(fake_scores)) > (sum(genuine_scores) / len(genuine_scores)),
        "at_least_one_fake_forged": len(fake_forged) >= 1,
        "no_genuine_forged": len(genuine_forged) == 0,
    }
    passed = all(checks.values())

    if args.json:
        print(json.dumps({"passed": passed, "checks": checks, "rows": rows}, indent=2))
    else:
        print(f"{'file':<52} {'label':<8} {'score':>5} {'decision':<8} regions")
        print("-" * 90)
        for row in rows:
            print(f"{row['file']:<52} {row['label']:<8} {str(row['score']):>5} {row['decision']:<8} {row['regions']}")
        print("-" * 90)
        for name, ok in checks.items():
            print(f"{'PASS' if ok else 'FAIL'}  {name}")
        print("PASS" if passed else "FAIL")

    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
