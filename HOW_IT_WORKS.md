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
                    +--> DTD branch if checkpoint + runtime are mounted
                    |       - aspect-ratio preprocessing
                    |       - RGB and JPEG-frequency inputs
                    |       - segmentation mask prediction
                    |       - mask remapped to original dimensions
                    |
                    +--> transparent baseline otherwise
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

The subprocess uses a JSON-compatible contract. It reads a base64 image from standard input and writes one JSON result to standard output. The DTD branch checks for the official checkpoint, backbone weights, quantization table, and compatible PyTorch runtime. If all are present, it loads the official model, produces a segmentation mask, resizes the mask back to the original image dimensions, extracts a normalized suspicious region, and composites the red evidence overlay directly onto the source image.

If the legacy DTD runtime is absent, the subprocess does not pretend that a deep model ran. It returns an explicit status such as `dtd-checkpoint-missing` or `dtd-checkpoint-mounted-runtime-unavailable` and uses the transparent baseline path so the application can still be exercised. This distinction is important for academic reporting and institutional trust.

## Explainability layer

The approved DTD path provides a segmentation-style localization mask rather than a Grad-CAM classification heatmap. The report therefore calls the visual output a **DTD localization overlay**. Normalized coordinates allow the browser to draw region markers on the overlay without knowing the model's internal tensor size.

The LLM receives structured findings such as prediction, score, tampering type, and flagged coordinates. It is instructed to write a cautious explanation for non-technical reviewers and not to claim official verification or legal certainty. The LLM call is server-side so credentials are not exposed in the browser.

## Persistence and privacy

Image bytes are kept in object storage. The database stores references, prediction data, region JSON, explanation text, model version, and timestamps. Analysis history is filtered by the authenticated user ID. The repository does not contain environment secrets or the large DTD weights.

## What the system does not do

The current approved release does not query issuing authorities, validate QR codes against external records, identify a certificate as legally fraudulent, or reliably classify copied signatures, seals, stamps, and logos. Those capabilities require separate data, model branches, and evaluation. The present scope is visual screening for tampered text and suspicious document regions.
