# How VerityLens Works

VerityLens is a full-stack document-screening workflow. The browser provides the reviewer interface, the Node server coordinates the request, the Python subprocess performs image analysis, object storage keeps image artifacts, the database stores report metadata, and the server-side LLM writes a readable explanation.

## End-to-end request flow

```text
Reviewer uploads image
        |
        v
React dashboard validates type and size
        |
        v
Protected tRPC procedure receives image data
        |
        +--> Original image uploaded to object storage
        |
        +--> Python subprocess receives base64 image bytes
                    |
                    +--> U-Net checkpoint (tamper_unet.pt, or
                    |    tamper_unet_findit.pt when present)
                    |       - 256x256 RGB preprocessing
                    |       - segmentation mask prediction
                    |       - mask remapped to original dimensions
                    |
                    +--> transparent visual baseline otherwise
        |
        v
Overlay image and normalized regions uploaded to object storage
        |
        v
Server-side LLM turns structured findings into plain-language explanation
        |
        v
Database stores report metadata for the authenticated user
        |
        v
Dashboard renders prediction, score, overlay, indicators, and explanation
```

## Browser layer

The React page supports drag-and-drop and file-picker uploads. It checks the MIME type and an 8 MB limit before calling the server. The upload action is protected by authentication. The history tab remains unavailable to anonymous users and requests only records belonging to the signed-in user.

## Server layer

The backend uses tRPC procedures rather than exposing ad hoc public REST endpoints. The `analysis.create` procedure validates the image, stores the original, invokes `python3 scripts/infer_document.py`, stores the generated overlay, calls the built-in LLM helper on the server, and persists the report. The user ID is taken from the authenticated session rather than from client input.

## Python inference layer

The subprocess uses a JSON-compatible contract. It reads a base64 image from standard input and writes one JSON result to standard output. It loads `models/weights/tamper_unet.pt` (or `tamper_unet_findit.pt` when present), produces a segmentation mask, resizes it back to the original image dimensions, and composites the red evidence overlay onto the source image.

The document score is not the average mask probability, because a small edit would be diluted by the rest of the page. Instead it combines the saturated coverage (fraction of pixels above 0.5, capped at 8% of the page) with the peak pixel probability. The result is split into `genuine` (0–34), `review` (35–64), and `forged` (65–99) so an uncertain document is not forced into a binary answer.

If the checkpoint or Python runtime is absent, the subprocess does not pretend that a deep model ran. It returns `baseline-visual-fallback` (or `unet-checkpoint-mounted-runtime-unavailable`) and uses the transparent heuristic path so the application can still be exercised.

## Explainability layer

The U-Net provides a segmentation-style localization mask rather than a Grad-CAM classification heatmap. The report therefore calls the visual output a **tamper localization overlay**. Normalized coordinates allow the browser to draw region markers on the overlay without knowing the model's internal tensor size. Regions are connected components of hot cells on a coarse grid and are only shown once the score leaves the genuine band.

The LLM receives structured findings such as decision, score, tampering type, and flagged coordinates. It is instructed to write a cautious explanation for non-technical reviewers, to state that a human must decide when the band is `review`, and not to claim official verification or legal certainty. The LLM call is server-side so credentials are not exposed in the browser.

## Persistence and privacy

Image bytes are kept in a private object-storage bucket. The database stores references, prediction data, region JSON, explanation text, model version, and timestamps. Stored URLs point at `/manus-storage/<key>`, which redirects to a five-minute signed URL, so documents are not publicly readable. Analysis history is filtered by the authenticated user ID. The repository does not contain environment secrets or large model weights.

Local email sign-in is development-only; production requires OAuth or Supabase Auth, and `auth.devLogin` is disabled unless `ALLOW_DEV_LOGIN=true` is set deliberately.

## What the system does not do

The current approved release does not query issuing authorities, validate QR codes against external records, identify a certificate as legally fraudulent, or reliably classify copied signatures, seals, stamps, and logos. Those capabilities require separate data, model branches, and evaluation. The present scope is visual screening for tampered text and suspicious document regions.
