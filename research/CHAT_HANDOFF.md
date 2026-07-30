# Combat Cognition thesis — conversation handoff

Last updated: 2026-07-30  
Codex task title: **Combat Cognition Thesis & Evaluation**  
Task ID: `019fb1a5-e869-7c63-883e-90149e744a7e`

Portable discussion transcript: [`CHAT_TRANSCRIPT.md`](CHAT_TRANSCRIPT.md)

## How to continue

1. Sign in to Codex on the personal laptop using the same account.
2. Open the pinned task named **Combat Cognition Thesis & Evaluation**.
3. Let the OneDrive project finish synchronizing.
4. If the task is unavailable, open this file and give Codex this instruction:

   > Continue my Combat Cognition thesis planning from `research/CHAT_HANDOFF.md`.
   > Do not write the report yet. First help me prepare and evaluate the datasets
   > and execute the two research notebooks step by step.

The local path may differ on the personal laptop. Locate the synced
`martial-art-ai/research` directory rather than relying on the office-laptop path.

## Agreed research position

- Working core: **Combat Cognition Framework**.
- Overall research direction: a martial-artist cognitive simulation framework.
- Do not claim that the system completely simulates a real martial artist.
- Defensible wording: the project implements and evaluates core computational
  components of martial-artist perception, temporal reasoning, situation
  awareness, and feedback.
- Jab is a representative technique selected for evaluation. It is not the main
  research topic and does not establish universal martial-arts performance.
- Other techniques and broader generalization are future work.
- The current reasoning layer is intended to use a replaceable OpenAI LLM, with a
  possible locally owned model in future.
- Before describing the LLM as operational in the thesis, locate evidence of the
  actual API invocation, model/version, inputs, outputs, and logs. Interface labels
  or architecture plans alone are not sufficient evidence.

## Architecture to document

`video/input`
→ `perception and MediaPipe landmarks`
→ `L1 motion analysis`
→ `ACP-STGAT future-pose prediction`
→ `temporal phase classification`
→ `L2 action state`
→ `L3 session awareness`
→ `L4 user/history state`
→ `situation awareness`
→ `context packet`
→ `reasoning/feedback`
→ `practice recording and memory`

The full data pipeline is a major thesis contribution. Every component must be
classified as implemented, evaluated, or future work and linked to evidence.

## Models

### ACP-STGAT motion-prediction model

- Input: 60 recent live skeleton frames.
- Skeleton: 33 MediaPipe landmarks with x/y/z coordinates.
- Output: 30 predicted future skeleton frames.
- Application visualization: blue dashed skeleton.
- Intended uses include session awareness, coaching, practice recording, and
  robustness support.
- `Andyen512/DDHpose` on Hugging Face is a model/code repository, not itself the
  research dataset. Its documentation references Human3.6M and MPI-INF-3DHP.
- Public benchmark data can support offline evaluation, but own/manual
  martial-arts recordings are required for domain and end-to-end evaluation.
- Appropriate metrics: normalized MPJPE, ADE, FDE, per-horizon/per-joint error,
  bone-length error, robustness, and latency.
- Do not describe normalized-coordinate error as millimetres unless the data is
  physically calibrated.

### Temporal phase-classification model

- High-level name: **temporal phase-classification model**.
- Avoid making “universal” a central research claim.
- Input: 90 frames, 33 landmarks, x/y/z/visibility.
- Required metrics: accuracy, balanced accuracy, macro/per-class F1, confusion
  matrix, phase-boundary error, and repetition/sequence evaluation.
- Legacy synthetic scores are pipeline checks, not real-world accuracy.

## Agreed evaluation design

Evaluation has three stages:

1. Offline evaluation of both models in Colab.
2. PyTorch/ONNX parity, browser/runtime latency, and deployment verification.
3. End-to-end framework evaluation in the actual system.

Minimum system comparison:

- rule-only pipeline
- hybrid temporal-model and situation-awareness pipeline
- model-only condition may be used as an offline diagnostic
- template feedback versus LLM feedback when the real LLM implementation is
  confirmed

Use participant grouping where possible and split participants/sessions before
creating overlapping windows. The test set remains untouched until model and
threshold decisions are finalized.

## Pilot study

- Planned pilot: three participants.
- The researcher is a professional martial artist with more than 25 years of
  practice, training, study, and research experience.
- Expert ground truth is informed by martial-arts experience and biomechanical
  knowledge.
- Report the researcher's expert role and possible self-review bias.
- A second independent expert is recommended for a subset. If unavailable, use
  blinded review and repeat a subset later to estimate intra-rater consistency.
- Keep original consented video as well as compressed landmark/session output.
- Treat the study as feasibility/usability/failure-mode evidence, not a
  population-level effectiveness study.

## Long-term research direction

- Extend technique coverage.
- Improve perception, awareness, temporal reasoning, and the reasoning model.
- Add physical sensors and multimodal biomechanical data.
- Investigate optimization of martial-arts movement and reduction of unnecessary
  energy expenditure.
- These are future research directions, not current achieved outcomes.

## Research workspace already created

- `research/notebooks/01_acp_stgat_research_evaluation.ipynb`
- `research/notebooks/02_temporal_phase_research_evaluation.ipynb`
- `research/data/`
- `research/configs/`
- `research/architecture/`
- `research/literature/`
- `research/system-evaluation/`
- `research/llm-evaluation/`
- `research/pilot-study/`
- `research/figures/`
- `research/outputs/`
- `research/appendices/`
- `research/tools/`

The notebooks have passed structural and Python-syntax validation but have not
been executed because the real datasets have not yet been supplied. No results
have been fabricated and no thesis/report has been generated.

## Next work session

Start with data preparation:

1. Inventory available own recordings, landmark exports, Colab files, checkpoints,
   and screenshots.
2. Prepare the motion NPZ contract described in `research/data/README.md`.
3. Prepare human-verified temporal phase annotations.
4. Execute the ACP-STGAT notebook, inspect outputs and failure cases.
5. Execute the phase-classification notebook.
6. Test the exact exported ONNX models inside the application.
7. Only after evidence is frozen, discuss the report structure and write it
   according to the supplied university guidelines.

University format files previously supplied:

- `DS5299 Guidelines (1).pdf`
- `Report fromat guidelines (1).pdf`

Do not generate the report until the user explicitly asks.
