#!/usr/bin/env python3
"""Train a binary genuine/forged document classifier on domain-matched data.

Unlike train_classifier.py (DocTamper photos vs. RVL-CDIP scans -- two
mismatched sources the model could trivially tell apart without learning
anything about forgery), this uses the "Find it again!" dataset: 988 scanned
SROIE receipts (825 genuine, 163 forged) from L3i, University of La
Rochelle. Genuine and forged examples come from the SAME scanning pipeline,
so there is no free dataset-identity shortcut to exploit.

Data: training_data/findit2/{train,val,test}/*.png with labels in
training_data/findit2/{train,val,test}.txt (CSV: image,digital
annotation,handwritten annotation,forged,forgery annotations).
Uses the dataset's own train/val/test split rather than re-splitting, to
match how the authors intended it to be evaluated.

Exports a state-dict artifact to models/weights/genuine_forged_classifier_findit.pt.

Run with the project venv:
    python scripts/train_classifier_findit.py
"""
import argparse
import csv
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

SIZE = 224


def load_split(data_dir: Path, split: str):
    items = []
    with open(data_dir / f"{split}.txt", newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        next(reader)  # header
        for row in reader:
            if not row:
                continue
            fname, label = row[0], row[3]
            path = data_dir / split / fname
            if path.exists():
                items.append((path, 1 if label == "1" else 0))
    return items


class FinditDataset(Dataset):
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
    ap.add_argument("--data", default="training_data/findit2")
    ap.add_argument("--out", default="models/weights/genuine_forged_classifier_findit.pt")
    ap.add_argument("--epochs", type=int, default=15)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--lr", type=float, default=3e-4)
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
        g = sum(1 for _, l in items if l == 0)
        f = sum(1 for _, l in items if l == 1)
        return g, f

    tg, tf = counts(train_items)
    vg, vf = counts(val_items)
    xg, xf = counts(test_items)
    print(f"train: genuine={tg} forged={tf} total={len(train_items)}")
    print(f"val:   genuine={vg} forged={vf} total={len(val_items)}")
    print(f"test:  genuine={xg} forged={xf} total={len(test_items)} (held out, not used for model selection)")

    pos_weight = torch.tensor([tg / max(1, tf)])
    criterion = nn.BCEWithLogitsLoss(pos_weight=pos_weight)

    device = torch.device("cpu")
    model = ForgeryClassifier(pretrained=True).to(device)
    opt = optim.Adam(model.parameters(), lr=args.lr)
    train_loader = DataLoader(FinditDataset(train_items, train=True), batch_size=args.batch, shuffle=True, num_workers=0)
    val_loader = DataLoader(FinditDataset(val_items, train=False), batch_size=args.batch, num_workers=0)
    test_loader = DataLoader(FinditDataset(test_items, train=False), batch_size=args.batch, num_workers=0)

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
            print(f"  -> saved new best (val f1={best_f1:.4f})")

    print(f"done. best val_f1={best_f1:.4f} artifact={args.out}")

    # Final report on the held-out test split, using the best-val checkpoint.
    model.load_state_dict(torch.load(str(Path(args.out)), map_location=device))
    test_metrics = evaluate(model, test_loader, device)
    print(f"HELD-OUT TEST: acc={test_metrics['accuracy']:.4f} prec={test_metrics['precision']:.4f} "
          f"recall={test_metrics['recall']:.4f} f1={test_metrics['f1']:.4f} "
          f"tp={test_metrics['tp']} fp={test_metrics['fp']} tn={test_metrics['tn']} fn={test_metrics['fn']}")


if __name__ == "__main__":
    main()
