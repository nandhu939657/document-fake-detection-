# Model checkpoints

## Live model

`tamper_unet.pt` is the default checkpoint: an EfficientNet-b0 U-Net
(`segmentation_models_pytorch`, 1 input channel of output) trained on a
1,500-pair DocTamper FCD subset. Validation: IoU 0.627, Dice 0.696.

It is loaded by `scripts/infer_document.py`. If it is missing, inference falls
back to `tamper_unet_findit.pt` when present, then to the transparent visual
baseline.

## Receipt-domain model (experimental, not shipped)

`scripts/train_segmentation_findit.py` trains a receipt-domain U-Net from
`training_data/findit2` (93 forged / 484 genuine receipts, pixel annotations).
An earlier run produced an all-background model (val doc-F1 0.0), so its
checkpoint was removed. The script now exposes a `--pos-weight` calibration
knob, but the data is extremely imbalanced (tampered pixels are ~0.19% of each
page), so the model still needs real work before it is usable:

- at `--pos-weight 20` it collapses to "nothing is tampered";
- at `--pos-weight 250` it collapses to "everything is tampered" (no
  calibration even after several epochs).

A genuine fix likely needs focal loss (or hard example mining), higher
training resolution so the small annotated boxes survive, and many more
epochs. Until a run clears the `obvious_fakes_outscore_genuine` gate in
`scripts/eval_samples.py`, do not ship this checkpoint. The default
`tamper_unet.pt` above is the model that actually runs.

## DocTamper/DTD

The vendored DocTamper/DTD source has been removed. The trained U-Net above is
the only detection path that ships; only the DocTamper FCD *training data* was
used, not the DTD runtime.
