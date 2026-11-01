# VerityLens

VerityLens is a document-tampering screening prototype. Upload an image (PNG,
JPEG, or WEBP), and a locally-run U-Net produces a pixel-level tamper mask,
an evidence overlay, normalized flagged regions, and a plain-language
explanation from a local LLM. Nothing is sent to a third-party AI API.

This is a first-pass screening tool, not a certified fraud detector. It does
not check signatures, seals, or stamps against an issuing authority.

## How the decision is made

The model returns a per-pixel probability map. Averaging that map over the
whole page hides small edits, so the score combines two signals:

```text
coverage = fraction of pixels above 0.5
peak     = strongest single-pixel probability
score    = 100 * min(1, coverage / 0.08) * peak
```

`0.08` means "a tamper covering about 8% of the page is already conclusive".
The score is reported in three bands:

| Score | Decision | Meaning |
|---|---|---|
| 0–34 | `genuine` | No strong tamper signal |
| 35–64 | `review` | Possible tampering; a human must decide |
| 65–99 | `forged` | Strong localized tamper signal |

Regions are connected components of hot cells on a 16×16 grid, with the mean
probability of each box as its confidence. Regions are only surfaced once the
score leaves the genuine band.

## Model

`models/weights/tamper_unet.pt` is the default checkpoint: an
EfficientNet-b0 U-Net trained on a 1,500-pair DocTamper FCD subset
(validation IoU 0.627, Dice 0.696). If
`models/weights/tamper_unet_findit.pt` exists it is used as a second option;
that checkpoint is trained on receipt-domain pixel annotations. If neither
artifact or the Python runtime is available, the app falls back to a clearly
labelled visual heuristic instead of pretending a model ran.

The vendored DocTamper/DTD source under `models/dtd/` is not wired into
inference. It needs legacy dependencies and checkpoints that are not shipped,
so the app no longer advertises a DTD path.

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
