"""Train and export a compact ST-GCN temporal state classifier.

The model predicts state probabilities only. Repetition counting and legal
ordering remain the responsibility of the deterministic temporal decoder.
"""

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

POSE_EDGES = [
    (0, 1), (1, 2), (2, 3), (3, 7), (0, 4), (4, 5), (5, 6), (6, 8),
    (9, 10), (11, 12), (11, 13), (13, 15), (15, 17), (15, 19),
    (15, 21), (17, 19), (12, 14), (14, 16), (16, 18), (16, 20),
    (16, 22), (18, 20), (11, 23), (12, 24), (23, 24), (23, 25),
    (25, 27), (27, 29), (29, 31), (27, 31), (24, 26), (26, 28),
    (28, 30), (30, 32), (28, 32),
]


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


def seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


def normalized_adjacency(joints: int = 33) -> torch.Tensor:
    adjacency = np.eye(joints, dtype=np.float32)
    for left, right in POSE_EDGES:
        adjacency[left, right] = 1
        adjacency[right, left] = 1
    degree = adjacency.sum(axis=1)
    inv_sqrt = np.diag(np.power(np.maximum(degree, 1), -0.5))
    return torch.tensor(inv_sqrt @ adjacency @ inv_sqrt, dtype=torch.float32)


class SpatialGraphBlock(nn.Module):
    def __init__(self, input_size: int, output_size: int, dropout: float):
        super().__init__()
        self.project = nn.Linear(input_size, output_size)
        self.norm = nn.LayerNorm(output_size)
        self.dropout = nn.Dropout(dropout)
        self.activation = nn.GELU()

    def forward(self, inputs: torch.Tensor, adjacency: torch.Tensor) -> torch.Tensor:
        aggregated = torch.einsum("vw,btwc->btvc", adjacency, inputs)
        return self.dropout(self.activation(self.norm(self.project(aggregated))))


class TemporalPhaseSTGCN(nn.Module):
    def __init__(self, classes: int, hidden_size: int = 96, dropout: float = 0.2):
        super().__init__()
        self.register_buffer("adjacency", normalized_adjacency())
        self.spatial1 = SpatialGraphBlock(4, hidden_size // 2, dropout)
        self.spatial2 = SpatialGraphBlock(hidden_size // 2, hidden_size, dropout)
        self.temporal = nn.Sequential(
            nn.Conv1d(hidden_size, hidden_size, kernel_size=5, padding=2),
            nn.BatchNorm1d(hidden_size),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Conv1d(
                hidden_size,
                hidden_size,
                kernel_size=5,
                padding=4,
                dilation=2,
            ),
            nn.BatchNorm1d(hidden_size),
            nn.GELU(),
            nn.Dropout(dropout),
        )
        self.classifier = nn.Linear(hidden_size, classes)

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        # inputs: [batch, time, joint, channel]
        spatial = self.spatial1(inputs, self.adjacency)
        spatial = self.spatial2(spatial, self.adjacency)
        visibility = inputs[..., 3].clamp(0, 1).unsqueeze(-1)
        pooled = (spatial * visibility).sum(dim=2) / visibility.sum(dim=2).clamp_min(1)
        temporal = self.temporal(pooled.transpose(1, 2)).transpose(1, 2)
        return self.classifier(temporal)


def split_by_session(groups: np.ndarray, seed: int) -> tuple[np.ndarray, ...]:
    indexes = np.arange(len(groups))
    first = GroupShuffleSplit(n_splits=1, test_size=0.30, random_state=seed)
    train_indexes, holdout_indexes = next(first.split(indexes, groups=groups))
    holdout_groups = groups[holdout_indexes]
    second = GroupShuffleSplit(n_splits=1, test_size=0.50, random_state=seed + 1)
    validation_local, test_local = next(
        second.split(holdout_indexes, groups=holdout_groups)
    )
    return (
        train_indexes,
        holdout_indexes[validation_local],
        holdout_indexes[test_local],
    )


def loader_for(
    features: np.ndarray,
    labels: np.ndarray,
    masks: np.ndarray,
    indexes: np.ndarray,
    batch_size: int,
    shuffle: bool,
) -> DataLoader:
    dataset = TensorDataset(
        torch.from_numpy(features[indexes]).float(),
        torch.from_numpy(labels[indexes]).long(),
        torch.from_numpy(masks[indexes]).bool(),
    )
    return DataLoader(dataset, batch_size=batch_size, shuffle=shuffle)


def class_weights(
    labels: np.ndarray, masks: np.ndarray, indexes: np.ndarray, classes: int
) -> torch.Tensor:
    values = labels[indexes][masks[indexes]]
    counts = np.bincount(values, minlength=classes).astype(np.float64)
    weights = counts.sum() / np.maximum(counts, 1)
    weights = weights / max(weights.mean(), 1e-6)
    weights[0] = 0
    return torch.tensor(weights, dtype=torch.float32)


@torch.no_grad()
def evaluate(
    model: nn.Module,
    loader: DataLoader,
    device: torch.device,
    pad_id: int,
) -> tuple[float, np.ndarray, np.ndarray]:
    model.eval()
    predictions: list[np.ndarray] = []
    targets: list[np.ndarray] = []
    for features, labels, masks in loader:
        logits = model(features.to(device))
        valid = masks.to(device) & labels.to(device).ne(pad_id)
        predictions.append(logits.argmax(dim=-1)[valid].cpu().numpy())
        targets.append(labels.to(device)[valid].cpu().numpy())
    y_pred = np.concatenate(predictions) if predictions else np.array([])
    y_true = np.concatenate(targets) if targets else np.array([])
    score = (
        f1_score(y_true, y_pred, average="macro", zero_division=0)
        if len(y_true)
        else 0.0
    )
    return float(score), y_true, y_pred


def main() -> None:
    args = parse_args()
    seed_everything(args.seed)
    data = np.load(args.dataset, allow_pickle=False)
    features = data["features"].astype(np.float32)
    labels = data["labels"].astype(np.int64)
    masks = data["mask"].astype(bool)
    groups = data["groups"].astype(str)
    origins = (
        data["origins"].astype(str)
        if "origins" in data.files
        else np.full(len(groups), "real")
    )
    label_names = data["label_names"].astype(str).tolist()
    if len(set(groups)) < 4:
        raise RuntimeError(
            "At least four independent sessions are required. Use more sessions "
            "before trusting validation results."
        )

    synthetic_ids = np.flatnonzero(origins == "synthetic")
    real_ids = np.flatnonzero(origins != "synthetic")
    if len(synthetic_ids) and len(set(groups[real_ids])) >= 4:
        real_train, real_validation, real_test = split_by_session(
            groups[real_ids], args.seed
        )
        train_ids = np.concatenate([real_ids[real_train], synthetic_ids])
        validation_ids = real_ids[real_validation]
        test_ids = real_ids[real_test]
        print(
            f"split: train includes {len(synthetic_ids)} synthetic windows; "
            "validation and test are real-only"
        )
    else:
        train_ids, validation_ids, test_ids = split_by_session(groups, args.seed)
        if len(synthetic_ids):
            print(
                "warning: no sufficient real sessions; validation is synthetic "
                "and is only a pipeline check"
            )
    train_loader = loader_for(
        features, labels, masks, train_ids, args.batch_size, True
    )
    validation_loader = loader_for(
        features, labels, masks, validation_ids, args.batch_size, False
    )
    test_loader = loader_for(
        features, labels, masks, test_ids, args.batch_size, False
    )
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = TemporalPhaseSTGCN(
        len(label_names), args.hidden_size, args.dropout
    ).to(device)
    weights = class_weights(
        labels, masks, train_ids, len(label_names)
    ).to(device)
    criterion = nn.CrossEntropyLoss(weight=weights, ignore_index=0)
    optimizer = torch.optim.AdamW(
        model.parameters(), lr=args.learning_rate, weight_decay=1e-4
    )

    args.output_dir.mkdir(parents=True, exist_ok=True)
    checkpoint_path = args.output_dir / "best_temporal_phase.pt"
    best_score = -1.0
    epochs_without_improvement = 0
    for epoch in range(1, args.epochs + 1):
        model.train()
        running_loss = 0.0
        batches = 0
        for batch_features, batch_labels, batch_masks in train_loader:
            batch_features = batch_features.to(device)
            batch_labels = batch_labels.to(device)
            batch_masks = batch_masks.to(device)
            optimizer.zero_grad(set_to_none=True)
            logits = model(batch_features)
            targets = batch_labels.masked_fill(~batch_masks, 0)
            loss = criterion(
                logits.reshape(-1, len(label_names)), targets.reshape(-1)
            )
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            running_loss += float(loss.item())
            batches += 1
        validation_f1, _, _ = evaluate(model, validation_loader, device, 0)
        print(
            f"epoch={epoch:03d} loss={running_loss / max(batches, 1):.4f} "
            f"validation_macro_f1={validation_f1:.4f}"
        )
        if validation_f1 > best_score:
            best_score = validation_f1
            epochs_without_improvement = 0
            torch.save(model.state_dict(), checkpoint_path)
        else:
            epochs_without_improvement += 1
            if epochs_without_improvement >= args.patience:
                print("Early stopping")
                break

    model.load_state_dict(torch.load(checkpoint_path, map_location=device))
    test_f1, y_true, y_pred = evaluate(model, test_loader, device, 0)
    report = classification_report(
        y_true,
        y_pred,
        labels=list(range(1, len(label_names))),
        target_names=label_names[1:],
        zero_division=0,
        output_dict=True,
    )
    print(f"test_macro_f1={test_f1:.4f}")

    model = model.cpu().eval()
    sequence_length = int(data["sequence_length"])
    dummy = torch.zeros(1, sequence_length, 33, 4, dtype=torch.float32)
    onnx_path = args.output_dir / "temporal_phase_classifier.onnx"
    torch.onnx.export(
        model,
        dummy,
        onnx_path,
        input_names=["landmarks"],
        output_names=["state_logits"],
        dynamic_axes={
            "landmarks": {0: "batch", 1: "time"},
            "state_logits": {0: "batch", 1: "time"},
        },
        opset_version=18,
    )
    metadata = {
        "schema_version": "1.0",
        "model_type": "temporal-state-emission",
        "architecture": "compact-stgcn-tcn",
        "input": {
            "name": "landmarks",
            "layout": "BTVC",
            "joints": 33,
            "channels": ["x", "y", "z", "visibility"],
            "sequence_length": sequence_length,
            "normalization": "hip-centered-torso-scale"
        },
        "output": {
            "name": "state_logits",
            "layout": "BTC",
            "labels": label_names
        },
        "validation": {
            "split_unit": "session",
            "validation_macro_f1": best_score,
            "test_macro_f1": test_f1,
            "train_sessions": int(len(set(groups[train_ids]))),
            "validation_sessions": int(len(set(groups[validation_ids]))),
            "test_sessions": int(len(set(groups[test_ids])))
        }
    }
    (args.output_dir / "temporal_phase_classifier.metadata.json").write_text(
        json.dumps(metadata, indent=2), encoding="utf-8"
    )
    (args.output_dir / "test_report.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )
    print(f"Exported {onnx_path}")


if __name__ == "__main__":
    main()
