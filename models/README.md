# VerityLens model pack

The Python subprocess accepts arbitrary PNG, JPEG, or WEBP document dimensions and normalizes the long edge internally while preserving aspect ratio. A production model pack should provide a TorchScript or ONNX artifact at this directory together with its preprocessing and output metadata.

The expected output contract is JSON with a document prediction, forgery likelihood, model status, tampering classes, and normalized regions. Each region should include `label`, `x`, `y`, `width`, `height`, and `confidence`, where coordinates are relative to the original image. Supported classes are `altered text`, `copied signature`, `modified seal`, `inconsistent font`, `image splicing`, and `modified logo`.

Recommended research training path:

| Branch | Public starting data | Output |
|---|---|---|
| Text tampering | DocTamper / official DTD implementation | Pixel mask and text-tampering confidence |
| Signature | CEDAR, ICDAR, GPDS-style cropped benchmarks | Signature crop forgery confidence |
| Splicing | Columbia splicing dataset or an approved modern localization set | Spliced-region mask |
| Seal/logo | Institution-specific annotated crops | Seal/logo region class and confidence |

The model pack must include the dataset license/provenance and evaluation metrics. Do not claim production accuracy until the artifact is supplied, evaluated on a held-out certificate set, and mounted in the container.
