#!/usr/bin/env python3
"""Train a binary genuine/forged signature classifier.

Data: training_data/signature_verification_dataset/<writer_id>/*.jpg (genuine)
and training_data/signature_verification_dataset/<writer_id>_forg/*.jpg (forged),
a CEDAR-style signature verification dataset pulled from Kaggle
(akashgundu/signature-verification-dataset).

This is a separate specialist model from the document-level tamper classifier:
it only judges a cropped signature image as genuine or forged. It does not
locate a signature inside a full document photo -- that would need its own
detector, which this project does not have.

Exports a state-dict artifact to models/weights/signature_classifier.pt.

Run with the project venv:
    python scripts/train_signature_classifier.py

Split is by writer id (not by individual image) so the same person's
handwriting never appears in both train and val.
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
import torch.optim as optim

import sys
sys.path.insert(0, str(Path(__file__).parent))
from train_classifier import ForgeryClassifier  # reuse the same architecture

SIZE = 160


def collect_by_writer(data_dir: Path):
    writer_dirs = sorted(d for d in data_dir.iterdir() if d.is_dir() and not d.name.endswith("_forg"))
    writers = []
    for d in writer_dirs:
        forg_dir = data_dir / f"{d.name}_forg"
        genuine = sorted(p for p in d.iterdir() if p.is_file())
        forged = sorted(p for p in forg_dir.iterdir() if p.is_file()) if forg_dir.exists() else []
        if genuine and forged:
            writers.append((d.name, genuine, forged))
    return writers


def split_writers(writers, val_fraction, seed):
    rng = random.Random(seed)
    shuffled = writers[:]
    rng.shuffle(shuffled)
    n_val = max(1, int(len(shuffled) * val_fraction))
    return shuffled[n_val:], shuffled[:n_val]


def flatten(writers):
    items = []
    for _, genuine, forged in writers:
        items.extend((p, 0) for p in genuine)
        items.extend((p, 1) for p in forged)
    return items


class SignatureDataset(Dataset):
    def __init__(self, items, size=SIZE, train=True):
        self.items = items
        self.size = size
        self.train = train
        self.normalize = T.Normalize((0.485, 0.456, 0.406), (0.229, 0.224, 0.225))

    def __len__(self):
        return len(self.items)

    def __getitem__(self, i):
        path, label = self.items[i]
        img = Image.open(path).convert("RGB").resize((self.size, self.size))
        if self.train and random.random() < 0.5:
            img = img.transpose(Image.FLIP_LEFT_RIGHT)
        x = T.ToTensor()(img)
        x = self.normalize(x)
        y = torch.tensor([float(label)])
        return x, y


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
    ap.add_argument("--data", default="training_data/signature_verification_dataset")
    ap.add_argument("--out", default="models/weights/signature_classifier.pt")
    ap.add_argument("--epochs", type=int, default=8)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--val", type=float, default=0.15)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    torch.set_num_threads(os.cpu_count() or 4)
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)

    writers = collect_by_writer(Path(args.data))
    if not writers:
        raise SystemExit(f"No writer folders with both genuine and forged signatures found under {args.data}")

    train_writers, val_writers = split_writers(writers, args.val, args.seed)
    train_items = flatten(train_writers)
    val_items = flatten(val_writers)
    random.Random(args.seed).shuffle(train_items)

    print(f"writers: total={len(writers)} train={len(train_writers)} val={len(val_writers)}")
    print(f"images: train={len(train_items)} val={len(val_items)}")

    criterion = nn.BCEWithLogitsLoss()  # balanced by construction (equal genuine/forged per writer)

    device = torch.device("cpu")
    model = ForgeryClassifier().to(device)
    opt = optim.Adam(model.parameters(), lr=args.lr)
    train_loader = DataLoader(SignatureDataset(train_items, train=True), batch_size=args.batch, shuffle=True, num_workers=0)
    val_loader = DataLoader(SignatureDataset(val_items, train=False), batch_size=args.batch, num_workers=0)

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


if __name__ == "__main__":
    main()
