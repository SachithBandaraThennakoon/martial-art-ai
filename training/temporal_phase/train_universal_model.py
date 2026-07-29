"""Train and export one technique-conditioned temporal phase model."""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import numpy as np
import torch
from sklearn.metrics import classification_report, f1_score
from sklearn.model_selection import GroupShuffleSplit
from torch import nn
from torch.utils.data import DataLoader, TensorDataset

from train_phase_model import SpatialGraphBlock, normalized_adjacency


class UniversalTemporalSTGCN(nn.Module):
    def __init__(
        self,
        classes: int,
        techniques: int,
        hidden_size: int = 96,
        dropout: float = 0.2,
    ):
        super().__init__()
        self.register_buffer("adjacency", normalized_adjacency())
        self.spatial1 = SpatialGraphBlock(4, hidden_size // 2, dropout)
        self.spatial2 = SpatialGraphBlock(hidden_size // 2, hidden_size, dropout)
        self.technique_embedding = nn.Embedding(techniques, hidden_size)
        self.temporal = nn.Sequential(
            nn.Conv1d(hidden_size, hidden_size, 5, padding=2),
            nn.BatchNorm1d(hidden_size),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Conv1d(hidden_size, hidden_size, 5, padding=4, dilation=2),
            nn.BatchNorm1d(hidden_size),
            nn.GELU(),
            nn.Dropout(dropout),
        )
        self.classifier = nn.Linear(hidden_size, classes)

    def forward(
        self, landmarks: torch.Tensor, technique_id: torch.Tensor
    ) -> torch.Tensor:
        spatial = self.spatial1(landmarks, self.adjacency)
        spatial = self.spatial2(spatial, self.adjacency)
        visibility = landmarks[..., 3].clamp(0, 1).unsqueeze(-1)
        pooled = (spatial * visibility).sum(dim=2) / visibility.sum(
            dim=2
        ).clamp_min(1)
        conditioned = pooled + self.technique_embedding(technique_id).unsqueeze(1)
        temporal = self.temporal(conditioned.transpose(1, 2)).transpose(1, 2)
        return self.classifier(temporal)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--learning-rate", type=float, default=3e-4)
    parser.add_argument("--hidden-size", type=int, default=96)
    parser.add_argument("--dropout", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--patience", type=int, default=10)
    return parser.parse_args()


def split_groups(groups: np.ndarray, seed: int) -> tuple[np.ndarray, ...]:
    indexes = np.arange(len(groups))
    first = GroupShuffleSplit(n_splits=1, test_size=0.30, random_state=seed)
    train, holdout = next(first.split(indexes, groups=groups))
    second = GroupShuffleSplit(n_splits=1, test_size=0.50, random_state=seed + 1)
    validation_local, test_local = next(
        second.split(holdout, groups=groups[holdout])
    )
    return train, holdout[validation_local], holdout[test_local]


def make_loader(data: dict, indexes, batch_size: int, shuffle: bool) -> DataLoader:
    dataset = TensorDataset(
        torch.from_numpy(data["features"][indexes]).float(),
        torch.from_numpy(data["technique_ids"][indexes]).long(),
        torch.from_numpy(data["labels"][indexes]).long(),
        torch.from_numpy(data["mask"][indexes]).bool(),
    )
    return DataLoader(dataset, batch_size=batch_size, shuffle=shuffle)


@torch.no_grad()
def evaluate(model, loader, device) -> tuple[float, np.ndarray, np.ndarray]:
    model.eval()
    predictions, targets = [], []
    for landmarks, technique_ids, labels, mask in loader:
        logits = model(landmarks.to(device), technique_ids.to(device))
        valid = mask.to(device) & labels.to(device).ne(0)
        predictions.append(logits.argmax(-1)[valid].cpu().numpy())
        targets.append(labels.to(device)[valid].cpu().numpy())
    predicted = np.concatenate(predictions) if predictions else np.array([])
    actual = np.concatenate(targets) if targets else np.array([])
    score = (
        f1_score(actual, predicted, average="macro", zero_division=0)
        if len(actual)
        else 0.0
    )
    return float(score), actual, predicted


def main() -> None:
    args = parse_args()
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    raw = np.load(args.dataset, allow_pickle=False)
    required = {"features", "technique_ids", "technique_names", "labels", "mask"}
    missing = required.difference(raw.files)
    if missing:
        raise ValueError(f"Universal dataset missing: {sorted(missing)}")
    data = {
        "features": raw["features"].astype(np.float32),
        "technique_ids": raw["technique_ids"].astype(np.int64),
        "labels": raw["labels"].astype(np.int64),
        "mask": raw["mask"].astype(bool),
    }
    groups = raw["groups"].astype(str)
    label_names = raw["label_names"].astype(str).tolist()
    technique_names = raw["technique_names"].astype(str).tolist()
    if len(set(groups)) < 4:
        raise RuntimeError("At least four independent sessions are required")
    train_ids, validation_ids, test_ids = split_groups(groups, args.seed)
    loaders = [
        make_loader(data, ids, args.batch_size, shuffle)
        for ids, shuffle in [
            (train_ids, True),
            (validation_ids, False),
            (test_ids, False),
        ]
    ]
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = UniversalTemporalSTGCN(
        len(label_names), len(technique_names), args.hidden_size, args.dropout
    ).to(device)
    train_values = data["labels"][train_ids][data["mask"][train_ids]]
    counts = np.bincount(train_values, minlength=len(label_names)).astype(float)
    weights = counts.sum() / np.maximum(counts, 1)
    weights /= max(weights.mean(), 1e-6)
    weights[0] = 0
    criterion = nn.CrossEntropyLoss(
        weight=torch.tensor(weights, dtype=torch.float32, device=device),
        ignore_index=0,
    )
    optimizer = torch.optim.AdamW(
        model.parameters(), lr=args.learning_rate, weight_decay=1e-4
    )
    args.output_dir.mkdir(parents=True, exist_ok=True)
    checkpoint = args.output_dir / "best_universal_temporal.pt"
    best, stale = -1.0, 0
    for epoch in range(1, args.epochs + 1):
        model.train()
        losses = []
        for landmarks, technique_ids, labels, mask in loaders[0]:
            optimizer.zero_grad(set_to_none=True)
            logits = model(landmarks.to(device), technique_ids.to(device))
            targets = labels.to(device).masked_fill(~mask.to(device), 0)
            loss = criterion(logits.flatten(0, 1), targets.flatten())
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            losses.append(float(loss.item()))
        validation_f1, _, _ = evaluate(model, loaders[1], device)
        print(
            f"epoch={epoch:03d} loss={np.mean(losses):.4f} "
            f"validation_macro_f1={validation_f1:.4f}"
        )
        if validation_f1 > best:
            best, stale = validation_f1, 0
            torch.save(model.state_dict(), checkpoint)
        else:
            stale += 1
            if stale >= args.patience:
                break

    model.load_state_dict(torch.load(checkpoint, map_location=device))
    test_f1, actual, predicted = evaluate(model, loaders[2], device)
    report = classification_report(
        actual,
        predicted,
        labels=list(range(1, len(label_names))),
        target_names=label_names[1:],
        zero_division=0,
        output_dict=True,
    )
    model = model.cpu().eval()
    sequence_length = int(raw["sequence_length"])
    torch.onnx.export(
        model,
        (
            torch.zeros(1, sequence_length, 33, 4),
            torch.zeros(1, dtype=torch.int64),
        ),
        args.output_dir / "martial_arts_temporal.onnx",
        input_names=["landmarks", "technique_id"],
        output_names=["phase_logits"],
        dynamic_axes={
            "landmarks": {0: "batch", 1: "time"},
            "technique_id": {0: "batch"},
            "phase_logits": {0: "batch", 1: "time"},
        },
        opset_version=18,
    )
    mappings = json.loads(str(raw["phase_mappings_json"]))
    metadata = {
        "schema_version": "2.0",
        "model_type": "universal-temporal-phase",
        "model_version": "universal-temporal-v1",
        "runtime_mode": "primary",
        "architecture": "technique-conditioned-stgcn-tcn",
        "inputs": {
            "landmarks": {
                "name": "landmarks",
                "layout": "BTVC",
                "joints": 33,
                "channels": ["x", "y", "z", "visibility"],
                "sequence_length": sequence_length,
                "normalization": "hip-centered-torso-scale",
            },
            "technique": {
                "name": "technique_id",
                "dtype": "int64",
                "labels": technique_names,
            },
        },
        "output": {
            "name": "phase_logits",
            "layout": "BTC",
            "labels": label_names,
        },
        "techniques": mappings,
        "validation": {
            "split_unit": "session",
            "validation_macro_f1": best,
            "test_macro_f1": test_f1,
        },
    }
    (args.output_dir / "martial_arts_temporal.metadata.json").write_text(
        json.dumps(metadata, indent=2), encoding="utf-8"
    )
    (args.output_dir / "test_report.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )
    print(f"test_macro_f1={test_f1:.4f}")


if __name__ == "__main__":
    main()
