#!/usr/bin/env python3
"""Train a tamper-localization U-Net on domain-matched, region-annotated data.

The whole-document genuine/forged classifier (train_classifier_findit.py)
failed twice on this same dataset: tampered regions are tiny (10-20px boxes)
relative to the full receipt image, and global average pooling smooths that
signal away before a single yes/no decision can be made. Segmentation avoids
this -- it predicts a per-pixel probability map instead of collapsing the
whole image into one pooled vector, the same approach scripts/train.py
already uses for tamper_unet.pt (but that one is trained on DocTamper, a
mismatched domain; this one uses the "Find it again!" SROIE-derived data,
which is domain-matched with a genuine class).

Data: training_data/findit2/{train,val,test}/*.png with pixel regions parsed
from training_data/findit2/{train,val,test}.txt's "forgery annotations"
column (a Python-literal-encoded VIA export). Only regions marked
'Original area': 'no' (i.e. actually modified) become positive mask pixels;
regions marked 'yes' are untouched reference boxes and are excluded.

Exports a state-dict artifact to models/weights/tamper_unet_findit.pt.

Run with the project venv:
    python scripts/train_segmentation_findit.py
"""
import argparse
import ast
import csv
import os
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader, Dataset
import torchvision.transforms as T
import segmentation_models_pytorch as smp
import torch.optim as optim

SIZE = 256


def parse_modified_rects(annotation_str: str):
    if not annotation_str or annotation_str == "0":
        return []
    try:
        data = ast.literal_eval(annotation_str)
    except (ValueError, SyntaxError):
        return []
    rects = []
    for region in data.get("regions", []):
        attrs = region.get("region_attributes", {})
        if attrs.get("Original area") != "no":
            continue  # untouched reference box, not a tamper site
        shape = region.get("shape_attributes", {})
        if shape.get("name") == "rect":
            rects.append((shape["x"], shape["y"], shape["width"], shape["height"]))
    return rects


def load_split(data_dir: Path, split: str):
    items = []
    with open(data_dir / f"{split}.txt", newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        next(reader)  # header
        for row in reader:
            if not row:
                continue
            fname, label, annotation = row[0], row[3], row[4]
            path = data_dir / split / fname
            if not path.exists():
                continue
            rects = parse_modified_rects(annotation) if label == "1" else []
            items.append((path, rects))
    return items


class MaskDataset(Dataset):
    def __init__(self, items, size=SIZE, train=True):
        self.items = items
        self.size = size
        self.train = train
        self.normalize = T.Normalize((0.485, 0.456, 0.406), (0.229, 0.224, 0.225))

    def __len__(self):
        return len(self.items)

    def __getitem__(self, i):
        path, rects = self.items[i]
        img = Image.open(path).convert("RGB")
        w0, h0 = img.size
        mask_img = Image.new("L", (w0, h0), 0)
        if rects:
            draw = ImageDraw.Draw(mask_img)
            for (x, y, w, h) in rects:
                draw.rectangle([x, y, x + w, y + h], fill=255)

        img = img.resize((self.size, self.size), Image.BILINEAR)
        mask_img = mask_img.resize((self.size, self.size), Image.NEAREST)

        if self.train and random.random() < 0.5:
            img = img.transpose(Image.FLIP_LEFT_RIGHT)
            mask_img = mask_img.transpose(Image.FLIP_LEFT_RIGHT)

        x = self.normalize(T.ToTensor()(img))
        y = torch.from_numpy(np.asarray(mask_img, dtype=np.float32) / 255.0).unsqueeze(0)
        return x, y


def make_model(pretrained: bool):
    weights = "imagenet" if pretrained else None
    return smp.Unet("efficientnet-b0", encoder_weights=weights, in_channels=3, classes=1)


def dice_loss(pred, target, eps=1e-6):
    pred = torch.sigmoid(pred)
    inter = (pred * target).sum()
    union = pred.sum() + target.sum()
    return 1.0 - (2.0 * inter + eps) / (union + eps)


def train_one_epoch(model, loader, opt, device):
    model.train()
    total = 0.0
    for x, y in loader:
        x, y = x.to(device), y.to(device)
        opt.zero_grad()
        logits = model(x)
        loss = dice_loss(logits, y) + F.binary_cross_entropy_with_logits(logits, y)
        loss.backward()
        opt.step()
        total += loss.item()
    return total / len(loader)


@torch.no_grad()
def evaluate(model, loader, device, doc_threshold=0.5, pixel_threshold=0.5):
    model.eval()
    ious, dices = [], []
    tp = fp = tn = fn = 0
    for x, y in loader:
        x, y = x.to(device), y.to(device)
        prob = torch.sigmoid(model(x))
        pred_mask = (prob > pixel_threshold).float()
        inter = (pred_mask * y).sum(dim=(1, 2, 3))
        union = (pred_mask + y).clamp(0, 1).sum(dim=(1, 2, 3))
        dice = (2.0 * inter) / (pred_mask.sum(dim=(1, 2, 3)) + y.sum(dim=(1, 2, 3)) + 1e-6)
        for i in range(x.size(0)):
            ious.append((inter[i] / (union[i] + 1e-6)).item())
            dices.append(dice[i].item())

        # Document-level decision from the mask: take the peak pixel probability
        # rather than the mean -- averaging over the whole image is exactly the
        # dilution problem that sank the plain classifier on this same data.
        doc_pred = (prob.view(prob.size(0), -1).amax(dim=1) > doc_threshold).float()
        doc_true = (y.view(y.size(0), -1).sum(dim=1) > 0).float()
        tp += int(((doc_pred == 1) & (doc_true == 1)).sum())
        fp += int(((doc_pred == 1) & (doc_true == 0)).sum())
        tn += int(((doc_pred == 0) & (doc_true == 0)).sum())
        fn += int(((doc_pred == 0) & (doc_true == 1)).sum())

    total = tp + fp + tn + fn
    doc_acc = (tp + tn) / max(1, total)
    doc_prec = tp / max(1, tp + fp)
    doc_recall = tp / max(1, tp + fn)
    doc_f1 = 2 * doc_prec * doc_recall / max(1e-6, doc_prec + doc_recall)
    return {
        "iou": float(np.mean(ious)), "dice": float(np.mean(dices)),
        "doc_acc": doc_acc, "doc_prec": doc_prec, "doc_recall": doc_recall, "doc_f1": doc_f1,
        "tp": tp, "fp": fp, "tn": tn, "fn": fn,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="training_data/findit2")
    ap.add_argument("--out", default="models/weights/tamper_unet_findit.pt")
    ap.add_argument("--epochs", type=int, default=12)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    torch.set_num_threads(os.cpu_count() or 4)
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)

    data_dir = Path(args.data)
    train_items = load_split(data_dir, "train")
    val_items = load_split(data_dir, "val")
    test_items = load_split(data_dir, "test")

    def counts(items):
        forged = sum(1 for _, rects in items if rects)
        return len(items) - forged, forged

    tg, tf = counts(train_items)
    vg, vf = counts(val_items)
    xg, xf = counts(test_items)
    print(f"train: genuine={tg} forged={tf} total={len(train_items)}")
    print(f"val:   genuine={vg} forged={vf} total={len(val_items)}")
    print(f"test:  genuine={xg} forged={xf} total={len(test_items)} (held out, not used for model selection)")

    device = torch.device("cpu")
    model = make_model(pretrained=True).to(device)
    opt = optim.Adam(model.parameters(), lr=args.lr)
    train_loader = DataLoader(MaskDataset(train_items, train=True), batch_size=args.batch, shuffle=True, num_workers=0)
    val_loader = DataLoader(MaskDataset(val_items, train=False), batch_size=args.batch, num_workers=0)
    test_loader = DataLoader(MaskDataset(test_items, train=False), batch_size=args.batch, num_workers=0)

    print("params(M):", round(sum(p.numel() for p in model.parameters()) / 1e6, 2))
    best_f1 = -1.0
    for epoch in range(1, args.epochs + 1):
        loss = train_one_epoch(model, train_loader, opt, device)
        metrics = evaluate(model, val_loader, device)
        print(f"epoch {epoch:02d} loss={loss:.4f} iou={metrics['iou']:.4f} dice={metrics['dice']:.4f} "
              f"doc_acc={metrics['doc_acc']:.4f} doc_prec={metrics['doc_prec']:.4f} "
              f"doc_recall={metrics['doc_recall']:.4f} doc_f1={metrics['doc_f1']:.4f} "
              f"tp={metrics['tp']} fp={metrics['fp']} tn={metrics['tn']} fn={metrics['fn']}")
        if metrics["doc_f1"] > best_f1:
            best_f1 = metrics["doc_f1"]
            torch.save(model.state_dict(), str(Path(args.out)))
            print(f"  -> saved new best (val doc_f1={best_f1:.4f})")

    print(f"done. best val_doc_f1={best_f1:.4f} artifact={args.out}")

    model.load_state_dict(torch.load(str(Path(args.out)), map_location=device))
    test_metrics = evaluate(model, test_loader, device)
    print(f"HELD-OUT TEST: iou={test_metrics['iou']:.4f} dice={test_metrics['dice']:.4f} "
          f"doc_acc={test_metrics['doc_acc']:.4f} doc_prec={test_metrics['doc_prec']:.4f} "
          f"doc_recall={test_metrics['doc_recall']:.4f} doc_f1={test_metrics['doc_f1']:.4f} "
          f"tp={test_metrics['tp']} fp={test_metrics['fp']} tn={test_metrics['tn']} fn={test_metrics['fn']}")


if __name__ == "__main__":
    main()
