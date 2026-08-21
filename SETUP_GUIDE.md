# VerityLens Setup Guide

VerityLens is an institutional document-screening web application. The first release focuses on **tampered-text and document-region analysis** using the DocTamper/DTD research path. It accepts PNG, JPEG, and WEBP images up to 8 MB, stores analysis metadata for authenticated users, overlays suspicious regions on the source image, and generates a readable verification explanation.

> This project is a visual screening aid. It does not verify a certificate against an issuing authority and should not be treated as legal or institutional proof of authenticity.

## Requirements

Install Node.js 22 or later, pnpm 10, Python 3, and a Python Pillow installation. The project uses a React/Vite frontend, an Express/tRPC backend, MySQL-compatible persistence, S3-compatible storage, and Manus OAuth provided by the managed environment.

```bash
pnpm install
sudo pip3 install pillow
```

## Environment

The managed project supplies the database, authentication, storage, and built-in LLM environment variables. Do not commit a `.env` file or copy secret values into source code. For a local deployment, configure the equivalent variables expected by `server/_core/env.ts`, including `DATABASE_URL`, OAuth values, storage values, and the built-in LLM API values.

## Database and development server

Generate the Drizzle migration and apply it through the project management workflow. Then start the application:

```bash
pnpm check
pnpm test
pnpm dev
```

The browser application is available through the development URL printed by the server. Sign in before analysis because document creation and history are protected procedures.

## Free DocTamper/DTD checkpoint

The official DTD checkpoint is too large for the source repository, so it is intentionally excluded. Download the free research checkpoint from the authors' public Google Drive folder:

[Official DocTamper checkpoints](https://drive.google.com/drive/folders/11Ep8PJIrlIveudQaRulDOBENHGqw762a?usp=sharing)

Mount the following files under `models/weights/`:

| File | Purpose |
|---|---|
| `dtd_doctamper.pth` | Main DocTamper/DTD segmentation checkpoint |
| `vph_imagenet.pt` | Visual perception backbone weights |
| `swin_imagenet.pt` | Swin backbone weights |

The official model source is vendored under `models/dtd/`. The DTD implementation has a legacy PyTorch/MMCV dependency stack. When the required runtime and all three weights are available, `scripts/infer_document.py` attempts the real DTD branch. Otherwise, it reports the model status and uses the transparent baseline path.

DocTamper data and checkpoints are intended for research/non-commercial use according to the official repository. Review the [official repository](https://github.com/qcf-568/DocTamper) and its license/access conditions before redistribution or institutional deployment.

## Production build

```bash
pnpm run build
pnpm start
```

The root `Dockerfile` installs Python and Pillow and builds the Node application. A production image that activates DTD inference must additionally provide a compatible CPU PyTorch/MMCV environment and the externally mounted model weights. Because the managed runtime is memory constrained, validate model memory use before deployment.

## Application flow

Open **Analyze document**, choose or drop an image, and sign in. The server uploads the original file, invokes the Python subprocess, stores the generated overlay, asks the server-side LLM helper for a plain-language explanation, and persists the report. Open **Analysis history** to review prior authenticated analyses.

## Validation

```bash
pnpm check
pnpm test
pnpm run build
```

The current test suite covers authentication boundaries, authenticated history, report orchestration, and the Python subprocess output contract.
