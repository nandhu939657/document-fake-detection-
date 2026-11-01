# Model checkpoints

## Live model

`tamper_unet.pt` is the default checkpoint: an EfficientNet-b0 U-Net
(`segmentation_models_pytorch`, 1 input channel of output) trained on a
1,500-pair DocTamper FCD subset. Validation: IoU 0.627, Dice 0.696.

It is loaded by `scripts/infer_document.py`. If it is missing, inference falls
back to `tamper_unet_findit.pt` when present, then to the transparent visual
baseline.

## Optional receipt-domain model

`tamper_unet_findit.pt` is produced by
`scripts/train_segmentation_findit.py` from `training_data/findit2`
(receipt tamper annotations). It is optional and only used as a second choice
behind `tamper_unet.pt`.

## DocTamper/DTD

The vendored source under `models/dtd/` is reference material only. It is not
called by the app and its official 257 MB checkpoint is not committed. The
legacy PyTorch/MMCV/`jpegio` runtime required by that checkpoint is not part
of `scripts/requirements.txt`, so do not expect the DTD path to run without
separate setup.
