# Public model and dataset findings

## DocTamper / DTD

The official CVPR 2023 project describes DocTamper as a large-scale document image dataset containing approximately 170,000 document images and pixel-level tampered-text evidence. Its DTD approach is designed specifically for visually consistent tampered text in photographed document images and reports cross-domain F-measure improvements on DocTamper and related test sets.

Official paper page: https://cvpr.thecvf.com/virtual/2023/poster/21237
Official repository: https://github.com/qcf-568/DocTamper

The repository states that the dataset is available through Baidu Drive and Kaggle, but access is restricted to non-commercial use. It also states that applicants should use an education email and that the training code requires contacting the authors. The official repository provides inference models/code and data synthesis code, but does not provide a plug-and-play detector for signatures, seals, or stamps. Therefore, DocTamper is a strong primary source for tampered-text localization, but the application needs additional targeted data or a multi-task extension for signatures, seals, logos, and stamp regions.

## Engineering decision

The upgraded application should use a two-stage research path: a document-tampering localization model based on the official DTD/DocTamper work for text and splicing-like anomalies, plus specialized signature/seal/stamp detectors or a project-specific multi-label fine-tuning stage. The deployed Python subprocess should support variable-size images by preserving aspect ratio, resizing the long edge to a bounded inference size, and mapping output masks back to original coordinates.

The current sandbox does not contain PyTorch, TorchVision, or a public model artifact. The current checkpoint therefore keeps a clearly labelled baseline adapter. A real DocTamper/DTD or EfficientNet/TorchScript artifact must be supplied or downloaded under an approved license before claiming trained-model accuracy or true Grad-CAM results.

## Complementary public sources

The Columbia Image Splicing Detection Evaluation Dataset provides 1,845 fixed-size 128×128 image blocks with roughly balanced authentic and spliced examples, organized by smooth/textured content and boundary type. It is research-only and requires a download request, so it is useful for splicing pretraining or evaluation but is not a certificate-specific end-to-end dataset.

Source: https://www.ee.columbia.edu/ln/dvmm/downloads/AuthSplicedDataSet/AuthSplicedDataSet.htm

A recent public signature-forgery study evaluates cross-dataset generalization on CEDAR, ICDAR, and GPDS Synthetic. These benchmarks are cropped signature verification datasets, not full certificate images. They are therefore appropriate for a specialist signature crop classifier, while a document-level system still needs a detector or region proposal stage to find signatures inside certificates.

Source: https://arxiv.org/abs/2510.17724

## Revised accuracy strategy

For the requested broad target taxonomy, a single generic EfficientNet classifier is not sufficient for reliable localization of every object type. The practical high-accuracy design is a multi-stage pipeline: document-level tampering localization trained or fine-tuned on DocTamper/DTD for text regions; a signature specialist trained on CEDAR/ICDAR/GPDS-style crops; a stamp/seal/logo detector fine-tuned on institution-specific annotated crops; and a splicing/localization branch evaluated with a public splicing dataset. All branches should expose coordinates that are remapped to the original image and merged into one evidence overlay.
