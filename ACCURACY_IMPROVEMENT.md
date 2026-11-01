# Improving Detection Accuracy

VerityLens should improve accuracy through **domain-specific localization**, not by treating every forgery type as one generic image-classification problem. The shipped model is a U-Net trained on pixel-level document tampering annotations, which provides a segmentation-style evidence output and a document score derived from localized evidence.

## Current model strategy

The application accepts arbitrary image dimensions, resizes to 256×256 for inference, and remaps predicted regions to the original image coordinates. The Python subprocess loads `models/weights/tamper_unet.pt` (trained on a 1,500-pair DocTamper FCD subset) and uses `tamper_unet_findit.pt` when present. The score combines saturated coverage with peak probability and reports `genuine` / `review` / `forged` bands. A clearly labelled visual fallback is used when the checkpoint or runtime is unavailable.

The labeled sample regression check lives in `scripts/eval_samples.py`; run it after any scoring or model change. It fails if known fakes stop outscoring known genuine documents, if no fake reaches the forged band, or if a genuine document is called forged.

The first release should make a narrow, defensible claim: **the system screens document images for visual evidence associated with tampered text and suspicious document regions**. It should not claim reliable identification of copied signatures, seals, stamps, logos, or institutional authenticity until those categories have their own labeled data and validation.

## Free research resources

| Target | Recommended resource | Role | Limitation |
|---|---|---|---|
| Tampered text | [DocTamper/DTD](https://github.com/qcf-568/DocTamper) | Pixel/region localization in document images | Research/non-commercial access conditions; requires compatible model runtime |
| Signature crops | CEDAR, ICDAR, or GPDS-style research benchmarks | Train a specialist signature forgery classifier | Mostly cropped signatures, not full certificates |
| Image splicing | [Columbia splicing dataset](https://www.ee.columbia.edu/ln/dvmm/downloads/AuthSplicedDataSet/AuthSplicedDataSet.htm) or another approved research set | Evaluate copy-paste/splicing evidence | Research-only access and domain mismatch with certificates |
| Seals, stamps, logos | Permission-cleared institutional samples | Fine-tune detectors for the target institution/domain | Public generic data is usually insufficient for certificate-specific accuracy |

## Recommended improvement sequence

First, benchmark the shipped U-Net on a held-out certificate set. Do not use the same images for training and evaluation. Record precision, recall, F1, IoU or Dice for localization, false-positive rate, false-negative rate, inference latency, and memory use.

Second, create a certificate-specific validation set with genuine and manipulated examples. Manipulations should include edited text, copy-pasted text, changed font rendering, recompressed regions, and realistic scan or camera artifacts. Every manipulated example should have a pixel mask or bounding box. The dataset must be permission-cleared and separated into training, validation, and test partitions by source document.

Third, improve generalization with realistic augmentation: JPEG recompression, blur, illumination changes, perspective distortion, resizing, noise, screenshots, and camera capture. Augmentation must not erase the manipulation evidence or leak the source document between splits.

Fourth, add separate specialists only when their data is available. A signature branch can detect and crop signature regions before applying a Siamese or metric-learning verifier. A seal/stamp/logo branch can use an object detector or segmentation model trained on annotated institutional examples. Their outputs should be merged into a common evidence schema rather than forced into the DTD text model.

## Accuracy and reporting rules

Never report an accuracy percentage from a different dataset as the application's certificate accuracy. Every visible performance number should identify the dataset, split, task, and metric. Reports should distinguish document-level forgery likelihood from region-level localization confidence. Low-confidence or out-of-distribution documents should be marked for manual review rather than forced into a binary decision.

## Practical free path

For a free academic prototype, keep the U-Net tampered-text localizer, evaluate it on a small permission-cleared certificate set, and add more categories only after collecting labeled samples. This path gives the strongest defensible accuracy improvement without paying for proprietary APIs or claiming unsupported detection capabilities.
