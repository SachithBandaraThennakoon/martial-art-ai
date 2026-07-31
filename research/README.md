# Combat Cognition Framework — Research Workspace

This folder contains the reproducible evaluation material for the thesis project.
It is separate from `training/` so the deployed application, existing models, and
earlier exploratory notebooks remain unchanged.

## Research scope

The system is evaluated as a **martial-artist cognitive simulation framework**:

`perception → motion reasoning → phase classification → situation awareness → reasoning/feedback`

The jab is a representative technique used to test the framework. It is not the
framework's only intended technique and should not be presented as universal
evidence.

## Evaluation stages

1. **Offline model evaluation** — grouped train/validation/test splits, baselines,
   model metrics, robustness checks, and repeated runs.
2. **Deployment verification** — PyTorch-to-ONNX numerical parity and latency.
3. **System evaluation** — rule-only versus hybrid pipeline, end-to-end outcomes,
   failure cases, and usability/pilot evidence.
4. **Reasoning evaluation** — blinded scoring of LLM and template feedback where
   the implementation evidence is available.

## Folder guide

- `notebooks/` — standalone end-to-end ACP-STGAT and temporal
  phase-classification Colab notebooks
- `data/` — data contracts and manifests; do not commit identifiable raw videos
- `configs/` — experiment configuration and provenance templates
- `architecture/` — component-to-code/model/evaluation evidence register
- `evidence/` — audits of supplied notebooks, outputs, screenshots, and logs
- `literature/` — verified-source literature matrix
- `outputs/` — generated metrics, plots, checkpoints, and exported ONNX models
- `figures/` — thesis-ready figures and a caption/source register
- `system-evaluation/` — end-to-end test matrix and results
- `llm-evaluation/` — blinded feedback-quality evaluation
- `pilot-study/` — three-participant pilot protocol and anonymized records
- `appendices/` — material intended for thesis appendices

## Reproducibility rules

- Split by participant when possible, otherwise by session, **before windowing**.
- Never place overlapping windows from one session in different data splits.
- Do not silently remap a non-MediaPipe skeleton to 33 landmarks.
- Label synthetic or smoke-test results clearly; they are not real-world accuracy.
- Keep test data untouched until the model and thresholds are finalized.
- Report mean, standard deviation, per-run results, and the exact random seeds.
- Store data/model hashes and software versions with every final experiment.
- A notebook without saved outputs is methodology, not experimental evidence.

## Recommended execution order

1. Complete `data/dataset_manifest.template.csv`.
2. Upload and run `ACP_STGAT_COMPLETE_TRAIN_EVALUATE_COLAB.ipynb`.
3. Return the executed notebook and its generated results ZIP.
4. Upload and run `TEMPORAL_PHASE_COMPLETE_TRAIN_EVALUATE_COLAB.ipynb`.
5. Return the executed notebook and its generated results ZIP.
6. Test the exported ONNX models and document the live-system integration
   separately.
7. Freeze final outputs; only then use them as thesis evidence.

No result in this folder should be treated as measured until the notebook was run
on the documented dataset and the output artifact was saved.
