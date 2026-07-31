"""Build the standalone temporal phase-classifier Colab notebook."""

from __future__ import annotations

import json
import textwrap
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE_NOTEBOOK = ROOT / "training" / "temporal_phase" / "colab_universal_training.ipynb"
TARGET = (
    ROOT
    / "research"
    / "notebooks"
    / "TEMPORAL_PHASE_COMPLETE_TRAIN_EVALUATE_COLAB.ipynb"
)


def source(value: str) -> list[str]:
    text = textwrap.dedent(value).strip("\n") + "\n"
    return text.splitlines(keepends=True)


def markdown(value: str) -> dict:
    return {"cell_type": "markdown", "metadata": {}, "source": source(value)}


def code(value: str) -> dict:
    return {
        "cell_type": "code",
        "execution_count": None,
        "metadata": {},
        "outputs": [],
        "source": source(value),
    }


def build() -> None:
    original = json.loads(SOURCE_NOTEBOOK.read_text(encoding="utf-8"))
    embedded_pipeline_cell = original["cells"][4]
    embedded_pipeline_cell["execution_count"] = None
    embedded_pipeline_cell["outputs"] = []

    cells = [
        markdown(
            """
            # Temporal Phase Classifier — Complete Train, Evaluate and Export

            This standalone Google Colab trains and evaluates the
            **technique-conditioned ST-GCN/TCN temporal phase-classification
            model** used by the Combat Cognition Framework.

            Default input: the pinned Jab + Front Kick synthetic bootstrap bundle.
            The bootstrap run validates the complete pipeline and produces
            reproducible engineering evidence. **Synthetic scores are not
            real-world martial-arts accuracy and must not be reported as such.**

            The notebook produces:

            - session-separated train/validation/test splits;
            - three independently initialized training runs;
            - accuracy, balanced accuracy, macro/weighted F1 and per-phase scores;
            - a majority baseline and per-technique results;
            - confusion matrix and phase-boundary measurements;
            - coarse completed-sequence/repetition measurements;
            - noise and missing-landmark robustness tests;
            - PyTorch/ONNX parity and CPU latency;
            - checkpoints, histories, hashes, provenance and a downloadable ZIP.
            """
        ),
        markdown(
            """
            ## 1. Environment

            In Colab choose **Runtime → Change runtime type → T4 GPU**, then run
            every cell in order.
            """
        ),
        code(
            """
            !pip -q install onnx onnxruntime scikit-learn pandas matplotlib seaborn
            """
        ),
        code(
            """
            import hashlib, importlib.util, json, os, platform, random, shutil, sys, time
            import urllib.request
            from dataclasses import asdict, dataclass
            from datetime import datetime, timezone
            from pathlib import Path

            import matplotlib.pyplot as plt
            import numpy as np
            import pandas as pd
            import seaborn as sns
            import sklearn
            import torch
            import torch.nn as nn
            from sklearn.metrics import (
                accuracy_score, balanced_accuracy_score, classification_report,
                confusion_matrix, f1_score, precision_score, recall_score
            )
            from torch.utils.data import DataLoader, TensorDataset

            DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            print("Device:", DEVICE)
            print("Python:", platform.python_version())
            print("PyTorch:", torch.__version__)
            if torch.cuda.is_available():
                print("GPU:", torch.cuda.get_device_name(0))
            """
        ),
        markdown(
            """
            ## 2. Configuration and data acquisition

            `DATA_SOURCE="github_sample"` makes the notebook runnable by anyone:
            it downloads the exact bootstrap file from a pinned project commit.
            Set `DATA_SOURCE="upload"` to select a compatible Temporal Data Lab
            JSON export from the local computer.

            The default dataset contains 24 synthetic Jab sessions and 24
            synthetic Front Kick sessions. It is deliberately included because
            the requested experiment is a bootstrap/pipeline evaluation.
            """
        ),
        code(
            """
            @dataclass
            class Config:
                data_source: str = "github_sample"  # github_sample | upload
                window: int = 90
                stride: int = 15
                batch_size: int = 32
                epochs: int = 60
                patience: int = 10
                learning_rate: float = 3e-4
                weight_decay: float = 1e-4
                hidden_size: int = 96
                dropout: float = 0.20
                seeds: tuple = (42, 43, 44)
                split_seed: int = 5299
                validation_fraction: float = 0.15
                test_fraction: float = 0.15
                boundary_tolerance_frames: int = 5
                boundary_smoothing_frames: int = 5

            CFG = Config()
            WORK_DIR = Path("/content/temporal_phase_research")
            PIPELINE_DIR = WORK_DIR / "pipeline"
            DATA_DIR = WORK_DIR / "data"
            OUTPUT_ROOT = Path("/content/research_outputs/phase_classifier")
            RUN_ID = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            RUN_DIR = OUTPUT_ROOT / RUN_ID
            for directory in (WORK_DIR, DATA_DIR, RUN_DIR):
                directory.mkdir(parents=True, exist_ok=True)

            PINNED_COMMIT = "c1ae68b540b2bb4c9b70da7ce0c8783a5a9e0aae"
            SAMPLE_URL = (
                "https://raw.githubusercontent.com/"
                "SachithBandaraThennakoon/martial-art-ai/"
                f"{PINNED_COMMIT}/training/temporal_phase/samples/"
                "universal-jab-front-kick-bootstrap.json"
            )
            DATA_FILE = DATA_DIR / "universal-jab-front-kick-bootstrap.json"

            if CFG.data_source == "github_sample":
                print("Downloading pinned bootstrap data...")
                urllib.request.urlretrieve(SAMPLE_URL, DATA_FILE)
            elif CFG.data_source == "upload":
                from google.colab import files
                uploaded = files.upload()
                if len(uploaded) != 1:
                    raise ValueError("Upload exactly one compatible JSON bundle.")
                name, payload = next(iter(uploaded.items()))
                DATA_FILE = DATA_DIR / name
                DATA_FILE.write_bytes(payload)
            else:
                raise ValueError("DATA_SOURCE must be 'github_sample' or 'upload'.")

            def sha256_file(path, block_size=1 << 20):
                digest = hashlib.sha256()
                with open(path, "rb") as handle:
                    for block in iter(lambda: handle.read(block_size), b""):
                        digest.update(block)
                return digest.hexdigest()

            print("Data:", DATA_FILE)
            print("Bytes:", DATA_FILE.stat().st_size)
            print("SHA-256:", sha256_file(DATA_FILE))
            """
        ),
        markdown(
            """
            ## 3. Embedded preparation and model implementation

            This cell restores the exact preparation and model code into the
            temporary Colab workspace. No Git clone or separate source-code
            download is required.
            """
        ),
        embedded_pipeline_cell,
        markdown(
            """
            ## 4. Validate the raw bundle

            The audit records dataset origin, session count, technique coverage,
            annotation status, frames and phase support before training starts.
            """
        ),
        code(
            """
            payload = json.loads(DATA_FILE.read_text(encoding="utf-8"))
            documents = payload.get("sessions") if isinstance(payload, dict) else payload
            if not isinstance(documents, list) or not documents:
                raise ValueError("The JSON bundle contains no sessions.")

            audit_rows = []
            for document in documents:
                annotation = document.get("manual_annotation") or {}
                provenance = document.get("provenance") or {}
                audit_rows.append({
                    "session_id": str(document.get("session_id", "")),
                    "participant_id": str(
                        document.get("participant_id")
                        or (document.get("metadata") or {}).get("participantId")
                        or ""
                    ),
                    "technique": str(document.get("technique_id", "")).lower(),
                    "origin": str(provenance.get("origin", "real")),
                    "annotation_status": str(annotation.get("status", "unverified")),
                    "frames": len(document.get("frames") or []),
                    "segments": len(annotation.get("segments") or []),
                })
            raw_audit = pd.DataFrame(audit_rows)
            display(raw_audit.groupby(
                ["technique", "origin", "annotation_status"], dropna=False
            ).agg(sessions=("session_id", "count"), frames=("frames", "sum")))
            if raw_audit.session_id.duplicated().any():
                raise ValueError("Session IDs must be unique.")
            if raw_audit.technique.nunique() < 2:
                raise ValueError("This technique-conditioned experiment requires two techniques.")

            SYNTHETIC_ONLY = bool((raw_audit.origin == "synthetic").all())
            EVALUATION_ORIGIN = (
                "synthetic_bootstrap_pipeline_check"
                if SYNTHETIC_ONLY else
                "contains_human_or_mixed_sessions_review_before_reporting"
            )
            print("Evaluation origin:", EVALUATION_ORIGIN)
            if SYNTHETIC_ONLY:
                print("WARNING: resulting scores are not real-world model accuracy.")
            raw_audit.to_csv(RUN_DIR / "raw_dataset_audit.csv", index=False)
            """
        ),
        markdown(
            """
            ## 5. Create the 90-frame MediaPipe-33 dataset

            Native technique states are mapped to the shared phase vocabulary.
            Pose coordinates are hip-centred and torso-scaled. Synthetic sessions
            are included only because this run explicitly requests the bootstrap
            dataset.
            """
        ),
        code(
            """
            import subprocess

            TAPE_DIR = WORK_DIR / "tapes"
            if TAPE_DIR.exists():
                shutil.rmtree(TAPE_DIR)
            TAPE_DIR.mkdir(parents=True)
            shutil.copy2(DATA_FILE, TAPE_DIR / DATA_FILE.name)
            DATASET_PATH = WORK_DIR / "universal_temporal_dataset.npz"
            subprocess.run([
                sys.executable, str(PIPELINE_DIR / "prepare_universal_dataset.py"),
                "--input-dir", str(TAPE_DIR),
                "--output", str(DATASET_PATH),
                "--label-config", str(PIPELINE_DIR / "universal-labels.json"),
                "--sequence-length", str(CFG.window),
                "--stride", str(CFG.stride),
                "--include-synthetic",
            ], check=True)

            raw = np.load(DATASET_PATH, allow_pickle=False)
            data = {
                "features": raw["features"].astype(np.float32),
                "technique_ids": raw["technique_ids"].astype(np.int64),
                "labels": raw["labels"].astype(np.int64),
                "mask": raw["mask"].astype(bool),
            }
            groups = raw["groups"].astype(str)
            origins = raw["origins"].astype(str)
            label_names = raw["label_names"].astype(str).tolist()
            technique_names = raw["technique_names"].astype(str).tolist()
            phase_mappings = json.loads(str(raw["phase_mappings_json"]))
            LABEL_TO_ID = {name: index for index, name in enumerate(label_names)}
            TECHNIQUE_TO_ID = {name: index for index, name in enumerate(technique_names)}

            print("Features:", data["features"].shape)
            print("Labels:", data["labels"].shape)
            print("Sessions:", len(np.unique(groups)))
            print("Techniques:", technique_names)
            print("Phases:", label_names)
            """
        ),
        markdown(
            """
            ## 6. Fixed session-separated split

            Sessions are separated by technique into training, validation and
            test groups. Every overlapping window from one session remains in the
            same split. The same split is reused for all three training seeds so
            their variation measures initialization/training variation rather
            than different test samples.

            Synthetic sessions do not contain real participant identities, so
            this run uses session-level grouping. A final human study should use
            participant-level separation or leave-one-participant-out evaluation.
            """
        ),
        code(
            """
            def fixed_stratified_group_split(groups, technique_ids, cfg):
                rng = np.random.default_rng(cfg.split_seed)
                allocation = {"train": [], "validation": [], "test": []}
                for technique_id, technique_name in enumerate(technique_names):
                    technique_groups = np.unique(groups[technique_ids == technique_id])
                    rng.shuffle(technique_groups)
                    count = len(technique_groups)
                    if count < 6:
                        raise ValueError(
                            f"{technique_name} needs at least six independent sessions."
                        )
                    test_count = max(1, int(round(count * cfg.test_fraction)))
                    validation_count = max(1, int(round(count * cfg.validation_fraction)))
                    allocation["test"].extend(technique_groups[:test_count])
                    allocation["validation"].extend(
                        technique_groups[test_count:test_count + validation_count]
                    )
                    allocation["train"].extend(
                        technique_groups[test_count + validation_count:]
                    )
                indexes = {
                    name: np.flatnonzero(np.isin(groups, selected))
                    for name, selected in allocation.items()
                }
                sets = {name: set(values) for name, values in allocation.items()}
                assert sets["train"].isdisjoint(sets["validation"])
                assert sets["train"].isdisjoint(sets["test"])
                assert sets["validation"].isdisjoint(sets["test"])
                return allocation, indexes

            split_groups, split_ids = fixed_stratified_group_split(
                groups, data["technique_ids"], CFG
            )
            split_rows = []
            for split_name, selected_groups in split_groups.items():
                ids = split_ids[split_name]
                print(
                    split_name,
                    "sessions=", len(selected_groups),
                    "windows=", len(ids),
                    "techniques=", sorted(set(data["technique_ids"][ids].tolist())),
                )
                split_rows.extend(
                    {"split": split_name, "group": group}
                    for group in selected_groups
                )
            pd.DataFrame(split_rows).to_csv(RUN_DIR / "split_groups.csv", index=False)
            """
        ),
        markdown(
            """
            ## 7. Recover complete session timelines

            Complete timelines allow unique-frame evaluation rather than counting
            the same frame repeatedly in overlapping windows. They are also used
            for transition-boundary and completed-sequence measurements.
            """
        ),
        code(
            """
            sys.path.insert(0, str(PIPELINE_DIR))
            from prepare_dataset import (
                normalize_pose, select_landmarks, verified_manual_labels
            )
            from train_universal_model import UniversalTemporalSTGCN

            def recover_sessions(documents):
                recovered = []
                for document in documents:
                    technique = str(document.get("technique_id", "")).lower()
                    if technique not in TECHNIQUE_TO_ID:
                        continue
                    frames = document.get("frames") or []
                    native = verified_manual_labels(document, len(frames), True)
                    if native is None:
                        continue
                    mapping = phase_mappings[technique]["native_to_phase"]
                    universal = [
                        state if state in {"__UNKNOWN__", "__TRACKING_LOST__"}
                        else mapping[state]
                        for state in native
                    ]
                    annotation = document.get("manual_annotation") or {}
                    rep_values = [
                        int(segment.get("rep", 0) or 0)
                        for segment in annotation.get("segments") or []
                    ]
                    session_id = str(document.get("session_id"))
                    recovered.append({
                        "group": f"{technique}:{session_id}",
                        "session_id": session_id,
                        "technique": technique,
                        "technique_id": TECHNIQUE_TO_ID[technique],
                        "fps": float(document.get("nominal_fps", 30)),
                        "x": np.asarray([
                            normalize_pose(select_landmarks(frame)) for frame in frames
                        ], dtype=np.float32),
                        "y": np.asarray([LABEL_TO_ID[state] for state in universal]),
                        "true_repetitions": max(rep_values, default=0),
                    })
                return recovered

            complete_sessions = recover_sessions(documents)
            by_group = {session["group"]: session for session in complete_sessions}
            if len(by_group) != len(np.unique(groups)):
                raise ValueError("Could not recover every prepared session timeline.")
            split_sessions = {
                name: [by_group[group] for group in selected]
                for name, selected in split_groups.items()
            }
            print({name: len(values) for name, values in split_sessions.items()})
            """
        ),
        markdown(
            """
            ## 8. Model, loaders and training

            The architecture matches the deployed technique-conditioned
            ST-GCN/TCN:

            `MediaPipe-33 graph blocks → visibility-weighted pooling → technique embedding → temporal convolutions → per-frame phase logits`

            Class weights are calculated from training frames only. Validation
            macro-F1 chooses each seed's checkpoint. Test labels do not influence
            training or checkpoint selection.
            """
        ),
        code(
            """
            def seed_everything(seed):
                random.seed(seed)
                np.random.seed(seed)
                torch.manual_seed(seed)
                if torch.cuda.is_available():
                    torch.cuda.manual_seed_all(seed)

            def make_loader(ids, shuffle, seed=0):
                dataset = TensorDataset(
                    torch.from_numpy(data["features"][ids]).float(),
                    torch.from_numpy(data["technique_ids"][ids]).long(),
                    torch.from_numpy(data["labels"][ids]).long(),
                    torch.from_numpy(data["mask"][ids]).bool(),
                )
                generator = torch.Generator().manual_seed(seed)
                return DataLoader(
                    dataset, batch_size=CFG.batch_size, shuffle=shuffle,
                    generator=generator if shuffle else None
                )

            ACTIVE_CLASS_IDS = sorted(
                set(data["labels"][data["mask"]].tolist()) - {LABEL_TO_ID["__PAD__"]}
            )

            @torch.no_grad()
            def window_predictions(model, loader):
                model.eval()
                true_values, predicted_values = [], []
                for x, technique_ids, labels, mask in loader:
                    logits = model(x.to(DEVICE), technique_ids.to(DEVICE))
                    valid = mask.to(DEVICE) & labels.to(DEVICE).ne(LABEL_TO_ID["__PAD__"])
                    true_values.append(labels.to(DEVICE)[valid].cpu().numpy())
                    predicted_values.append(logits.argmax(-1)[valid].cpu().numpy())
                return np.concatenate(true_values), np.concatenate(predicted_values)

            def macro_f1(y_true, y_pred):
                return float(f1_score(
                    y_true, y_pred, labels=ACTIVE_CLASS_IDS,
                    average="macro", zero_division=0
                ))

            def training_weights(train_ids):
                values = data["labels"][train_ids][data["mask"][train_ids]]
                counts = np.bincount(values, minlength=len(label_names)).astype(float)
                weights = counts.sum() / np.maximum(counts, 1)
                weights /= max(weights[ACTIVE_CLASS_IDS].mean(), 1e-8)
                weights[LABEL_TO_ID["__PAD__"]] = 0
                return torch.tensor(weights, dtype=torch.float32, device=DEVICE)

            def train_one_seed(seed):
                seed_everything(seed)
                train_loader = make_loader(split_ids["train"], True, seed)
                validation_loader = make_loader(split_ids["validation"], False)
                model = UniversalTemporalSTGCN(
                    len(label_names), len(technique_names),
                    CFG.hidden_size, CFG.dropout
                ).to(DEVICE)
                criterion = nn.CrossEntropyLoss(
                    weight=training_weights(split_ids["train"]),
                    ignore_index=LABEL_TO_ID["__PAD__"],
                )
                optimizer = torch.optim.AdamW(
                    model.parameters(), lr=CFG.learning_rate,
                    weight_decay=CFG.weight_decay
                )
                best_score, best_state, stale, history = -1.0, None, 0, []
                for epoch in range(1, CFG.epochs + 1):
                    model.train()
                    losses = []
                    for x, technique_ids, labels, mask in train_loader:
                        optimizer.zero_grad(set_to_none=True)
                        logits = model(x.to(DEVICE), technique_ids.to(DEVICE))
                        targets = labels.to(DEVICE).masked_fill(~mask.to(DEVICE), 0)
                        loss = criterion(
                            logits.flatten(0, 1), targets.flatten()
                        )
                        loss.backward()
                        nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                        optimizer.step()
                        losses.append(float(loss.item()))
                    actual, predicted = window_predictions(model, validation_loader)
                    score = macro_f1(actual, predicted)
                    history.append({
                        "epoch": epoch,
                        "train_loss": float(np.mean(losses)),
                        "validation_macro_f1": score,
                    })
                    print(
                        f"seed={seed} epoch={epoch:03d} "
                        f"loss={np.mean(losses):.5f} val_macro_f1={score:.5f}"
                    )
                    if score > best_score:
                        best_score, stale = score, 0
                        best_state = {
                            key: value.detach().cpu().clone()
                            for key, value in model.state_dict().items()
                        }
                    else:
                        stale += 1
                    if stale >= CFG.patience:
                        print("Early stopping")
                        break
                model.load_state_dict(best_state)
                return model.cpu().eval(), best_score, pd.DataFrame(history)
            """
        ),
        markdown(
            """
            ## 9. Unique-frame session evaluation

            Overlapping window probabilities are averaged to reconstruct every
            held-out session. Reported test frame metrics therefore count each
            original session frame once.
            """
        ),
        code(
            """
            def window_starts(length, window, stride):
                starts = list(range(0, max(1, length - window + 1), stride))
                last = max(0, length - window)
                if last not in starts:
                    starts.append(last)
                return starts

            @torch.no_grad()
            def predict_session(model, session, corruption=None, seed=0):
                model.eval()
                x = session["x"].copy()
                if corruption is not None:
                    x = corruption(x, np.random.default_rng(seed))
                starts = window_starts(len(x), CFG.window, CFG.stride)
                windows, valid_counts = [], []
                for start in starts:
                    valid = min(CFG.window, len(x) - start)
                    window = np.zeros((CFG.window, 33, 4), dtype=np.float32)
                    window[:valid] = x[start:start + valid]
                    windows.append(window)
                    valid_counts.append(valid)
                batch = torch.from_numpy(np.stack(windows)).float().to(DEVICE)
                technique = torch.full(
                    (len(windows),), session["technique_id"],
                    dtype=torch.long, device=DEVICE
                )
                probabilities = torch.softmax(model(batch, technique), -1).cpu().numpy()
                total = np.zeros((len(x), len(label_names)), dtype=np.float64)
                counts = np.zeros(len(x), dtype=np.float64)
                for start, valid, window_probabilities in zip(
                    starts, valid_counts, probabilities
                ):
                    total[start:start + valid] += window_probabilities[:valid]
                    counts[start:start + valid] += 1
                if np.any(counts == 0):
                    raise RuntimeError("A session frame received no prediction.")
                mean_probabilities = total / counts[:, None]
                return mean_probabilities.argmax(-1), mean_probabilities

            def predict_sessions(model, sessions, corruption=None, seed=0):
                rows, actual, predicted = [], [], []
                session_outputs = []
                for index, session in enumerate(sessions):
                    y_pred, probabilities = predict_session(
                        model, session, corruption, seed + index
                    )
                    actual.append(session["y"])
                    predicted.append(y_pred)
                    session_outputs.append((session, y_pred, probabilities))
                    for frame, (true_id, predicted_id) in enumerate(
                        zip(session["y"], y_pred)
                    ):
                        rows.append({
                            "session_id": session["session_id"],
                            "technique": session["technique"],
                            "frame": frame,
                            "true_phase": label_names[int(true_id)],
                            "predicted_phase": label_names[int(predicted_id)],
                            "confidence": float(probabilities[frame, predicted_id]),
                        })
                return (
                    np.concatenate(actual), np.concatenate(predicted),
                    session_outputs, pd.DataFrame(rows)
                )

            def classification_metrics(y_true, y_pred):
                return {
                    "accuracy": float(accuracy_score(y_true, y_pred)),
                    "balanced_accuracy": float(balanced_accuracy_score(y_true, y_pred)),
                    "macro_precision": float(precision_score(
                        y_true, y_pred, labels=ACTIVE_CLASS_IDS,
                        average="macro", zero_division=0
                    )),
                    "macro_recall": float(recall_score(
                        y_true, y_pred, labels=ACTIVE_CLASS_IDS,
                        average="macro", zero_division=0
                    )),
                    "macro_f1": macro_f1(y_true, y_pred),
                    "weighted_f1": float(f1_score(
                        y_true, y_pred, labels=ACTIVE_CLASS_IDS,
                        average="weighted", zero_division=0
                    )),
                }
            """
        ),
        code(
            """
            trained_models, validation_scores, run_rows = {}, {}, []
            for seed in CFG.seeds:
                model, validation_f1, history = train_one_seed(seed)
                trained_models[seed] = model
                validation_scores[seed] = validation_f1
                history.to_csv(RUN_DIR / f"training_history_seed_{seed}.csv", index=False)
                torch.save(model.state_dict(), RUN_DIR / f"checkpoint_seed_{seed}.pt")
                model = model.to(DEVICE)
                y_true, y_pred, _, _ = predict_sessions(
                    model, split_sessions["test"], seed=seed
                )
                metrics = classification_metrics(y_true, y_pred)
                metrics.update({
                    "seed": seed,
                    "method": "technique_conditioned_stgcn_tcn",
                    "validation_macro_f1": validation_f1,
                })
                run_rows.append(metrics)

            # Technique-conditioned training-frame majority baseline.
            majority_by_technique = {}
            for technique in technique_names:
                labels = np.concatenate([
                    session["y"] for session in split_sessions["train"]
                    if session["technique"] == technique
                ])
                majority_by_technique[technique] = int(
                    np.bincount(labels, minlength=len(label_names)).argmax()
                )
            baseline_true = np.concatenate([
                session["y"] for session in split_sessions["test"]
            ])
            baseline_pred = np.concatenate([
                np.full(len(session["y"]), majority_by_technique[session["technique"]])
                for session in split_sessions["test"]
            ])
            baseline_metrics = classification_metrics(baseline_true, baseline_pred)
            baseline_metrics.update({
                "seed": np.nan, "method": "technique_majority_baseline",
                "validation_macro_f1": np.nan,
            })
            run_rows.append(baseline_metrics)

            results = pd.DataFrame(run_rows)
            display(results)
            results.to_csv(RUN_DIR / "metrics_by_run.csv", index=False)
            learned = results[results.method == "technique_conditioned_stgcn_tcn"]
            summary = learned.select_dtypes("number").drop(
                columns=["seed"], errors="ignore"
            ).agg(["mean", "std"])
            display(summary)
            summary.to_csv(RUN_DIR / "metrics_summary.csv")
            """
        ),
        markdown(
            """
            ## 10. Best validation-selected model: phase and technique analysis

            The deployment candidate is selected using validation macro-F1 only,
            never test performance.
            """
        ),
        code(
            """
            best_seed = max(validation_scores, key=validation_scores.get)
            final_model = trained_models[best_seed].to(DEVICE)
            y_true, y_pred, session_outputs, prediction_rows = predict_sessions(
                final_model, split_sessions["test"], seed=best_seed
            )
            prediction_rows.to_csv(RUN_DIR / "test_frame_predictions.csv", index=False)

            report = classification_report(
                y_true, y_pred, labels=ACTIVE_CLASS_IDS,
                target_names=[label_names[index] for index in ACTIVE_CLASS_IDS],
                output_dict=True, zero_division=0
            )
            with open(RUN_DIR / "classification_report.json", "w") as handle:
                json.dump(report, handle, indent=2)
            display(pd.DataFrame(report).T)

            technique_rows = []
            for technique in technique_names:
                selected = prediction_rows.technique.eq(technique).to_numpy()
                technique_true = np.asarray([
                    LABEL_TO_ID[value] for value in prediction_rows.loc[selected, "true_phase"]
                ])
                technique_pred = np.asarray([
                    LABEL_TO_ID[value] for value in prediction_rows.loc[selected, "predicted_phase"]
                ])
                row = classification_metrics(technique_true, technique_pred)
                row["technique"] = technique
                technique_rows.append(row)
            technique_table = pd.DataFrame(technique_rows)
            display(technique_table)
            technique_table.to_csv(RUN_DIR / "metrics_by_technique.csv", index=False)

            matrix = confusion_matrix(y_true, y_pred, labels=ACTIVE_CLASS_IDS)
            active_names = [label_names[index] for index in ACTIVE_CLASS_IDS]
            plt.figure(figsize=(10, 8))
            sns.heatmap(
                matrix, annot=True, fmt="d", cmap="Blues",
                xticklabels=active_names, yticklabels=active_names
            )
            plt.xlabel("Predicted phase")
            plt.ylabel("True phase")
            plt.title("Held-out session phase confusion matrix")
            plt.tight_layout()
            plt.savefig(RUN_DIR / "confusion_matrix.png", dpi=200)
            plt.show()
            """
        ),
        markdown(
            """
            ## 11. Boundary and completed-sequence evaluation

            A five-frame majority filter suppresses isolated label flicker before
            transition analysis. A predicted boundary matches a true boundary
            only if the destination phase is the same and its timing is within
            the declared tolerance.

            Completed-sequence counts use technique-specific canonical orders.
            This is a coarse offline diagnostic; the authoritative runtime ordered
            decoder must still be evaluated separately in the application.
            """
        ),
        code(
            """
            def majority_smooth(values, width):
                radius = width // 2
                output = values.copy()
                for index in range(len(values)):
                    local = values[max(0, index-radius):min(len(values), index+radius+1)]
                    output[index] = np.bincount(
                        local, minlength=len(label_names)
                    ).argmax()
                return output

            def transition_events(values):
                indexes = np.flatnonzero(values[1:] != values[:-1]) + 1
                return [(int(index), int(values[index])) for index in indexes]

            def boundary_result(true_values, predicted_values, tolerance):
                true_events = transition_events(true_values)
                predicted_events = transition_events(predicted_values)
                used, errors = set(), []
                for true_index, destination in true_events:
                    candidates = [
                        (abs(pred_index - true_index), candidate_index)
                        for candidate_index, (pred_index, pred_destination)
                        in enumerate(predicted_events)
                        if candidate_index not in used
                        and pred_destination == destination
                        and abs(pred_index - true_index) <= tolerance
                    ]
                    if candidates:
                        error, candidate = min(candidates)
                        used.add(candidate)
                        errors.append(error)
                matches = len(errors)
                return {
                    "matches": matches,
                    "true_boundaries": len(true_events),
                    "predicted_boundaries": len(predicted_events),
                    "boundary_precision": matches / max(len(predicted_events), 1),
                    "boundary_recall": matches / max(len(true_events), 1),
                    "boundary_f1": (
                        2 * matches / max(len(true_events) + len(predicted_events), 1)
                    ),
                    "boundary_mae_frames": float(np.mean(errors)) if errors else np.nan,
                }

            PHASE_ORDERS = {
                "jab": ["PREPARATION", "EXECUTION", "PEAK", "RETRACTION", "RECOVERY"],
                "front-kick": ["PREPARATION", "ENTRY", "PEAK", "RETRACTION", "RECOVERY"],
            }

            def completed_sequences(values, technique):
                collapsed = [
                    value for index, value in enumerate(values)
                    if index == 0 or value != values[index - 1]
                ]
                ignored = {
                    LABEL_TO_ID["__PAD__"], LABEL_TO_ID["__UNKNOWN__"],
                    LABEL_TO_ID["__TRACKING_LOST__"]
                }
                phases = [label_names[value] for value in collapsed if value not in ignored]
                order = PHASE_ORDERS[technique]
                position, count = 0, 0
                for phase in phases:
                    if phase == order[position]:
                        position += 1
                        if position == len(order):
                            count += 1
                            position = 0
                    elif phase == order[0]:
                        position = 1
                return count

            boundary_rows, repetition_rows = [], []
            for session, predicted, _ in session_outputs:
                smoothed = majority_smooth(
                    predicted, CFG.boundary_smoothing_frames
                )
                boundary = boundary_result(
                    session["y"], smoothed, CFG.boundary_tolerance_frames
                )
                boundary.update({
                    "session_id": session["session_id"],
                    "technique": session["technique"],
                })
                boundary_rows.append(boundary)
                repetition_rows.append({
                    "session_id": session["session_id"],
                    "technique": session["technique"],
                    "true_repetitions": session["true_repetitions"],
                    "predicted_repetitions": completed_sequences(
                        smoothed, session["technique"]
                    ),
                })

            boundary_table = pd.DataFrame(boundary_rows)
            repetition_table = pd.DataFrame(repetition_rows)
            display(boundary_table)
            display(repetition_table)
            boundary_table.to_csv(RUN_DIR / "boundary_metrics_by_session.csv", index=False)
            repetition_table.to_csv(RUN_DIR / "repetition_counts_by_session.csv", index=False)

            total_true = int(repetition_table.true_repetitions.sum())
            total_predicted = int(repetition_table.predicted_repetitions.sum())
            matched = int(np.minimum(
                repetition_table.true_repetitions,
                repetition_table.predicted_repetitions
            ).sum())
            sequence_summary = {
                "boundary_precision_mean": float(boundary_table.boundary_precision.mean()),
                "boundary_recall_mean": float(boundary_table.boundary_recall.mean()),
                "boundary_f1_mean": float(boundary_table.boundary_f1.mean()),
                "boundary_mae_frames_mean": float(boundary_table.boundary_mae_frames.mean()),
                "repetition_count_mae": float(np.mean(np.abs(
                    repetition_table.true_repetitions
                    - repetition_table.predicted_repetitions
                ))),
                "coarse_repetition_precision": matched / max(total_predicted, 1),
                "coarse_repetition_recall": matched / max(total_true, 1),
                "false_repetitions_per_minute_on_unrelated_motion": None,
                "false_repetition_note": (
                    "Not measurable: this bootstrap contains no dedicated "
                    "unrelated-motion negative sessions."
                ),
            }
            print(json.dumps(sequence_summary, indent=2))
            with open(RUN_DIR / "sequence_summary.json", "w") as handle:
                json.dump(sequence_summary, handle, indent=2)
            """
        ),
        markdown(
            """
            ## 12. Robustness

            These controlled corruptions test sensitivity to normalized-coordinate
            noise and missing landmarks. They do not reproduce every real
            MediaPipe failure mode.
            """
        ),
        code(
            """
            def coordinate_noise(std):
                def apply(values, rng):
                    output = values.copy()
                    output[..., :3] += rng.normal(
                        0, std, output[..., :3].shape
                    ).astype(np.float32)
                    return output
                return apply

            def missing_landmarks(probability):
                def apply(values, rng):
                    output = values.copy()
                    missing = rng.random(output.shape[:2]) < probability
                    output[missing, :3] = 0
                    output[missing, 3] = 0
                    return output
                return apply

            robustness_conditions = [
                ("clean", None),
                ("noise_0.005", coordinate_noise(0.005)),
                ("noise_0.010", coordinate_noise(0.010)),
                ("missing_0.05", missing_landmarks(0.05)),
                ("missing_0.10", missing_landmarks(0.10)),
            ]
            robustness_rows = []
            for name, corruption in robustness_conditions:
                robust_true, robust_pred, _, _ = predict_sessions(
                    final_model, split_sessions["test"],
                    corruption=corruption, seed=7300
                )
                row = classification_metrics(robust_true, robust_pred)
                row["condition"] = name
                robustness_rows.append(row)
            robustness = pd.DataFrame(robustness_rows)
            display(robustness)
            robustness.to_csv(RUN_DIR / "robustness.csv", index=False)
            """
        ),
        markdown(
            """
            ## 13. ONNX parity and model-only CPU latency

            The exact exported ONNX file should be used in the application.
            Browser and complete camera-to-feedback latency remain separate
            system-level measurements.
            """
        ),
        code(
            """
            import onnx
            import onnxruntime as ort

            final_model = final_model.cpu().eval()
            onnx_path = RUN_DIR / "martial_arts_temporal.onnx"
            example_landmarks = torch.from_numpy(
                data["features"][split_ids["test"][:1]]
            ).float()
            example_technique = torch.from_numpy(
                data["technique_ids"][split_ids["test"][:1]]
            ).long()
            torch.onnx.export(
                final_model,
                (example_landmarks, example_technique),
                onnx_path,
                input_names=["landmarks", "technique_id"],
                output_names=["phase_logits"],
                dynamic_axes={
                    "landmarks": {0: "batch", 1: "time"},
                    "technique_id": {0: "batch"},
                    "phase_logits": {0: "batch", 1: "time"},
                },
                opset_version=18,
                dynamo=False,
            )
            onnx.checker.check_model(onnx.load(onnx_path))
            runtime = ort.InferenceSession(
                str(onnx_path), providers=["CPUExecutionProvider"]
            )
            with torch.no_grad():
                torch_output = final_model(
                    example_landmarks, example_technique
                ).numpy()
            onnx_output = runtime.run(None, {
                "landmarks": example_landmarks.numpy(),
                "technique_id": example_technique.numpy(),
            })[0]

            for _ in range(10):
                runtime.run(None, {
                    "landmarks": example_landmarks.numpy(),
                    "technique_id": example_technique.numpy(),
                })
            latencies = []
            for _ in range(200):
                started = time.perf_counter()
                runtime.run(None, {
                    "landmarks": example_landmarks.numpy(),
                    "technique_id": example_technique.numpy(),
                })
                latencies.append((time.perf_counter() - started) * 1000)

            parity = {
                "max_abs_error": float(np.max(np.abs(torch_output - onnx_output))),
                "mean_abs_error": float(np.mean(np.abs(torch_output - onnx_output))),
                "predicted_labels_equal": bool(np.array_equal(
                    torch_output.argmax(-1), onnx_output.argmax(-1)
                )),
                "passed_at_1e-4": bool(
                    np.max(np.abs(torch_output - onnx_output)) < 1e-4
                    and np.array_equal(
                        torch_output.argmax(-1), onnx_output.argmax(-1)
                    )
                ),
                "cpu_latency_median_ms": float(np.median(latencies)),
                "cpu_latency_p95_ms": float(np.percentile(latencies, 95)),
                "onnx_sha256": sha256_file(onnx_path),
            }
            print(json.dumps(parity, indent=2))
            with open(RUN_DIR / "onnx_parity_latency.json", "w") as handle:
                json.dump(parity, handle, indent=2)
            """
        ),
        markdown(
            """
            ## 14. Metadata, provenance and downloadable evidence

            The archive explicitly labels the evaluation origin. When the default
            bootstrap is used, high classification scores mean the implementation
            learned generator-produced patterns; they do not establish human,
            camera or martial-arts generalization.
            """
        ),
        code(
            """
            metadata = {
                "schema_version": "3.0",
                "model_type": "temporal-phase-classifier",
                "architecture": "technique-conditioned-stgcn-tcn",
                "model_version": "research-evaluation-v1",
                "run_id": RUN_ID,
                "inputs": {
                    "landmarks": {
                        "layout": "BTVC",
                        "frames": CFG.window,
                        "joints": 33,
                        "channels": ["x", "y", "z", "visibility"],
                        "normalization": "hip-centered-torso-scale",
                    },
                    "technique_id": {"labels": technique_names},
                },
                "output": {"layout": "BTC", "phase_labels": label_names},
                "techniques": phase_mappings,
                "selected_seed": best_seed,
                "selection_rule": "highest validation macro F1",
                "evaluation_origin": EVALUATION_ORIGIN,
            }
            with open(RUN_DIR / "model_metadata.json", "w") as handle:
                json.dump(metadata, handle, indent=2)

            provenance = {
                "run_id": RUN_ID,
                "data_source": CFG.data_source,
                "source_url": SAMPLE_URL if CFG.data_source == "github_sample" else None,
                "pinned_commit": PINNED_COMMIT if CFG.data_source == "github_sample" else None,
                "dataset_sha256": sha256_file(DATA_FILE),
                "dataset_origin": EVALUATION_ORIGIN,
                "configuration": asdict(CFG),
                "split_unit": "session",
                "split_groups": split_groups,
                "active_evaluation_classes": [
                    label_names[index] for index in ACTIVE_CLASS_IDS
                ],
                "versions": {
                    "python": platform.python_version(),
                    "torch": torch.__version__,
                    "numpy": np.__version__,
                    "pandas": pd.__version__,
                    "sklearn": sklearn.__version__,
                    "onnxruntime": ort.__version__,
                },
                "device": str(DEVICE),
                "limitations": [
                    "Synthetic bootstrap scores are pipeline checks, not human accuracy.",
                    "The synthetic split is session-level because it has no real participants.",
                    "No unrelated-motion negative sessions are available for false-repetition rate.",
                    "The offline repetition count is not the authoritative runtime ordered decoder.",
                    "Browser and end-to-end system latency require separate measurement.",
                ],
            }
            with open(RUN_DIR / "provenance.json", "w") as handle:
                json.dump(provenance, handle, indent=2)

            archive = shutil.make_archive(str(RUN_DIR), "zip", RUN_DIR)
            print("Results directory:", RUN_DIR)
            print("Archive:", archive)
            print("Archive bytes:", Path(archive).stat().st_size)

            from google.colab import files
            files.download(archive)
            """
        ),
        markdown(
            """
            ## Expected interpretation

            A successful bootstrap run should:

            - create valid train/validation/test session groups for both techniques;
            - train all three seeds without leakage;
            - beat the technique-majority baseline on macro-F1;
            - produce a readable confusion matrix and per-phase report;
            - pass PyTorch/ONNX parity at `1e-4`;
            - show model-only latency suitable for later real-time testing; and
            - download one timestamped ZIP containing the evidence.

            There is no guaranteed expected accuracy value. The measured values
            must come from the executed notebook. Even a very high synthetic score
            is reported only as **synthetic bootstrap pipeline performance**.

            Final thesis claims about real phase-classification accuracy require
            human-verified recordings, participant-separated testing, unrelated
            movement negatives and evaluation of the deployed ordered decoder.
            """
        ),
    ]

    notebook = {
        "cells": cells,
        "metadata": {
            "accelerator": "GPU",
            "colab": {"name": TARGET.name, "provenance": []},
            "kernelspec": {
                "display_name": "Python 3",
                "language": "python",
                "name": "python3",
            },
            "language_info": {"name": "python", "version": "3"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(json.dumps(notebook, indent=1), encoding="utf-8")
    print(f"Wrote {TARGET}")


if __name__ == "__main__":
    build()
