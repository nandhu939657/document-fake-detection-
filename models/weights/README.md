# DTD checkpoint mount

The official free DocTamper/DTD checkpoint is intentionally not committed to this repository because the 257 MB file exceeds project synchronization limits.

Download the authors' public checkpoint from the official Google Drive folder:

https://drive.google.com/drive/folders/11Ep8PJIrlIveudQaRulDOBENHGqw762a?usp=sharing

Required file: `dtd_doctamper.pth`

Place it at:

`models/weights/dtd_doctamper.pth`

The official source code is vendored under `models/dtd/`. The current managed runtime does not include the legacy PyTorch/MMCV dependencies required by the DTD checkpoint, so the application reports the model status explicitly and uses its transparent baseline until a compatible CPU runtime or converted ONNX artifact is mounted.
