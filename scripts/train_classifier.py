#!/usr/bin/env python3
"""Train a binary genuine/forged document classifier.

Positive (forged) examples come from training_data/docTamperFCD_subset/images
(document photos with edited text regions). Negative (genuine) examples come
from training_data/rvl-cdip-small-200 (real scanned documents across 16
categories: invoices, letters, memos, forms, resumes, etc.).

Exports a TorchScript-free state-dict artifact to
models/weights/genuine_forged_classifier.pt for use in infer_document.py.

Run with the project venv:
    python scripts/train_classifier.py

Self-check (no data needed, ensures model/loss contract holds):
    python scripts/train_classifier.py --self-test
"""
import argparse
import os
import random
from pathlib import Path

import numpy as np
from PIL import Image

import torch
import torch.nn as nn
from torch.utils.data import DataLoader, Dataset
import torchvision.transforms as T
import segmentation_models_pytorch as smp
import torch.optim as optim

SIZE = 160


def list_forged(data_dir: Path):
    return sorted(data_dir.glob("docTamperFCD_subset/images/*.jpg"))


def list_genuine(data_dir: Path):
    return sorted(data_dir.glob("rvl-cdip-small-200/*/*/*"))


def stratified_split(items, val_fraction, seed):
    rng = random.Random(seed)
    shuffled = items[:]
    rng.shuffle(shuffled)
    n_val = max(1, int(len(shuffled) * val_fraction))
    return shuffled[n_val:], shuffled[:n_val]


class DocDataset(Dataset):
    def __init__(self, items, size=SIZE, train=True):
        self.items = items
        self.size = size
        self.train = train
        self.normalize = T.Normalize((0.485, 0.456, 0.406), (0.229, 0.224, 0.225))

    def __len__(self):
        return len(self.items)

    def __getitem__(self, i):
        path, label = self.items[i]
        # Force grayscale for both classes: the source datasets differ in color
        # mode (DocTamper = color photos, RVL-CDIP = grayscale scans), which is
        # a trivial dataset-identity shortcut with nothing to do with forgery.
        # Converting both to L (then replicating to 3 channels) removes it.
        img = Image.open(path).convert("L").convert("RGB").resize((self.size, self.size))
        if self.train and random.random() < 0.5:
            img = img.transpose(Image.FLIP_LEFT_RIGHT)
        x = T.ToTensor()(img)
        x = self.normalize(x)
        y = torch.tensor([float(label)])
        return x, y


class ForgeryClassifier(nn.Module):
    def __init__(self, pretrained: bool = False):
        super().__init__()
        weights = "imagenet" if pretrained else None
        self.encoder = smp.encoders.get_encoder("efficientnet-b0", in_channels=3, depth=5, weights=weights)
        feat_dim = self.encoder.out_channels[-1]
        self.pool = nn.AdaptiveAvgPool2d(1)
        self.fc = nn.Linear(feat_dim, 1)

    def forward(self, x):
        feats = self.encoder(x)[-1]
        pooled = self.pool(feats).flatten(1)
        return self.fc(pooled)


def train_one_epoch(model, loader, opt, criterion, device):
    model.train()
    total = 0.0
    for x, y in loader:
        x, y = x.to(device), y.to(device)
        opt.zero_grad()
        logits = model(x)
        loss = criterion(logits, y)
        loss.backward()
        opt.step()
        total += loss.item()
    return total / len(loader)


@torch.no_grad()
def evaluate(model, loader, device):
    model.eval()
    tp = fp = tn = fn = 0
    for x, y in loader:
        x, y = x.to(device), y.to(device)
        prob = torch.sigmoid(model(x))
        pred = (prob > 0.5).float()
        tp += int(((pred == 1) & (y == 1)).sum())
        fp += int(((pred == 1) & (y == 0)).sum())
        tn += int(((pred == 0) & (y == 0)).sum())
        fn += int(((pred == 0) & (y == 1)).sum())
    total = tp + fp + tn + fn
    accuracy = (tp + tn) / max(1, total)
    precision = tp / max(1, tp + fp)
    recall = tp / max(1, tp + fn)
    f1 = 2 * precision * recall / max(1e-6, precision + recall)
    return {"accuracy": accuracy, "precision": precision, "recall": recall, "f1": f1, "tp": tp, "fp": fp, "tn": tn, "fn": fn}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="training_data")
    ap.add_argument("--out", default="models/weights/genuine_forged_classifier.pt")
    ap.add_argument("--epochs", type=int, default=10)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--val", type=float, default=0.15)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    torch.set_num_threads(os.cpu_count() or 4)
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)

    data_dir = Path(args.data)
    forged = list_forged(data_dir)
    genuine = list_genuine(data_dir)
    if not forged or not genuine:
        raise SystemExit(f"No data found: forged={len(forged)} genuine={len(genuine)} under {data_dir}")

    forged_train, forged_val = stratified_split(forged, args.val, args.seed)
    genuine_train, genuine_val = stratified_split(genuine, args.val, args.seed + 1)

    train_items = [(p, 1) for p in forged_train] + [(p, 0) for p in genuine_train]
    val_items = [(p, 1) for p in forged_val] + [(p, 0) for p in genuine_val]
    random.Random(args.seed).shuffle(train_items)

    print(f"forged: train={len(forged_train)} val={len(forged_val)}")
    print(f"genuine: train={len(genuine_train)} val={len(genuine_val)}")
    print(f"total: train={len(train_items)} val={len(val_items)}")

    pos_weight = torch.tensor([len(genuine_train) / max(1, len(forged_train))])
    criterion = nn.BCEWithLogitsLoss(pos_weight=pos_weight)

    device = torch.device("cpu")
    model = ForgeryClassifier().to(device)
    opt = optim.Adam(model.parameters(), lr=args.lr)
    train_loader = DataLoader(DocDataset(train_items, train=True), batch_size=args.batch, shuffle=True, num_workers=0)
    val_loader = DataLoader(DocDataset(val_items, train=False), batch_size=args.batch, num_workers=0)

    print("params(M):", round(sum(p.numel() for p in model.parameters()) / 1e6, 2))
    best_f1 = -1.0
    for epoch in range(1, args.epochs + 1):
        loss = train_one_epoch(model, train_loader, opt, criterion, device)
        metrics = evaluate(model, val_loader, device)
        print(f"epoch {epoch:02d} loss={loss:.4f} acc={metrics['accuracy']:.4f} "
              f"prec={metrics['precision']:.4f} recall={metrics['recall']:.4f} f1={metrics['f1']:.4f} "
              f"tp={metrics['tp']} fp={metrics['fp']} tn={metrics['tn']} fn={metrics['fn']}")
        if metrics["f1"] > best_f1:
            best_f1 = metrics["f1"]
            torch.save(model.state_dict(), str(Path(args.out)))
            print(f"  -> saved new best (f1={best_f1:.4f})")
    print(f"done. best val_f1={best_f1:.4f} artifact={args.out}")


def self_test():
    m = ForgeryClassifier()
    out = m(torch.randn(2, 3, SIZE, SIZE))
    assert out.shape == (2, 1), out.shape
    y = torch.tensor([[1.0], [0.0]])
    loss_fn = nn.BCEWithLogitsLoss()
    loss = loss_fn(out, y)
    assert torch.isfinite(loss)
    print("self-test OK: classifier forward + loss shapes valid")


if __name__ == "__main__":
    import sys
    if "--self-test" in sys.argv:
        self_test()
    else:
        main()
