# VerityLens

VerityLens is a document-tampering screening prototype. Upload an image (PNG,
JPEG, or WEBP), and a locally-run U-Net produces a pixel-level tamper mask,
an evidence overlay, normalized flagged regions, and a plain-language
explanation from a local LLM. Nothing is sent to a third-party AI API.

This is a first-pass screening tool, not a certified fraud detector. It does
not check signatures, seals, or stamps against an issuing authority.

## How the decision is made

The model returns a per-pixel probability map. Averaging that map over the
whole page hides small edits, so the score combines confidence with edited
area:

```text
confidence = 0.5 * peak + 0.5 * mean(probabilities above 0.5)
area       = min(1, coverage / 0.03)      # cover >=3% of the page => conclusive
score      = 100 * confidence * area
```

`0.03` means "a confident tamper covering about 3% of the page is already
conclusive". The score is reported in three bands:

| Score | Decision | Meaning |
|---|---|---|
| 0–34 | `genuine` | No strong tamper signal |
| 35–69 | `review` | Possible tampering; a human must decide |
| 70–99 | `forged` | Strong localized tamper signal |

Regions are connected components of hot cells on a 16×16 grid, then each box is
tightened to the flagged pixels it contains. Box confidence is the mean
probability inside the box; boxes below 0.30 are treated as noise. Regions are
only surfaced once the score leaves the genuine band.

## Model

`models/weights/tamper_unet.pt` is the shipped checkpoint: an
EfficientNet-b0 U-Net trained on a 1,500-pair DocTamper FCD subset
(validation IoU 0.627, Dice 0.696). If
`models/weights/tamper_unet_findit.pt` exists it is used as a second option;
that receipt-domain checkpoint is still experimental and is not shipped (see
`models/weights/README.md`). If neither artifact or the Python runtime is
available, the app falls back to a clearly labelled visual heuristic instead
of pretending a model ran.

The trained U-Net is the only detection path that ships. The app no longer
advertises a DocTamper/DTD runtime; the vendored source has been removed.

## Quick start

See [SETUP_GUIDE.md](SETUP_GUIDE.md) for the full walkthrough. Short version:

```bash
pnpm install
python -m venv models/ml/.venv
models/ml/.venv/Scripts/python.exe -m pip install -r scripts/requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu
ollama pull llama3.2:3b
# create .env (see SETUP_GUIDE.md), then:
pnpm db:push
pnpm dev
```

## Tests

```bash
pnpm check
pnpm test
python scripts/eval_samples.py
```

`pnpm test` includes a real inference call and a labeled-sample regression
test (`scripts/eval_samples.py`) that fails if known fakes stop outscoring
known genuine documents.

## Privacy and auth

- Uploaded documents are stored in a private Supabase bucket. The app returns
  `/manus-storage/<key>` paths that redirect to short-lived signed URLs.
- Local email sign-in (`auth.devLogin`) is development-only. In production it
  is disabled unless `ALLOW_DEV_LOGIN=true` is explicitly set. Real
  deployments should configure OAuth or Supabase Auth.
- `JWT_SECRET` is required in production.

## Repository notes

- Runtime secrets and `.env` files are excluded.
- Large checkpoints are not committed; see `models/weights/README.md`.
- This repository documents a research-oriented screening tool, not official
  document verification.
