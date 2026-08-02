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

This section is superseded by the **Current transfer update — 2026-07-31** below.
Both research notebooks have now been rebuilt and executed, and their supplied
result bundles have been archived and interpreted.

University format files previously supplied:

- `DS5299 Guidelines (1).pdf`
- `Report fromat guidelines (1).pdf`

Do not generate the report until the user explicitly asks.

---

## Current transfer update — 2026-07-31

This section supersedes earlier notebook/status statements above.

### Completed model-evidence work

- Rebuilt the standalone end-to-end ACP-STGAT notebook and guide in
  `research/notebooks/`.
- Archived and interpreted the supplied ACP-STGAT bundle under
  `research/outputs/acp_stgat/20260731T061529Z/`.
- Added `research/architecture/ACP_STGAT_MODEL_RATIONALE.md`.
- Rebuilt the standalone temporal phase-classification notebook and guide in
  `research/notebooks/`.
- Archived and interpreted the supplied phase-classifier bundle under
  `research/outputs/phase_classifier/20260731T091140Z/`.
- Documented that the current phase results use generated bootstrap data. They
  validate generator-defined structure and the pipeline, not real-world martial-
  arts accuracy. Real participant data and human annotations remain required.

### Completed software verification

- `research/system-evaluation/ALGORITHMIC_AWARENESS_VERIFICATION.md` records the
  sequential execution of 23 frontend test files: all 129 assertions passed.
- The backend coaching/conversation baseline passed 12 of 12 tests.
- These results verify specified software behavior; they are not end-to-end
  accuracy or evidence of human-equivalent awareness.

### Reasoning-layer status

- The checked repository has no operational OpenAI SDK/API call or OpenAI
  dependency. Current coaching wording is deterministic rule/template output.
- Do not describe the current operational reasoning layer as an OpenAI LLM.
- The implemented `coach_intelligence_context` boundary can support a replaceable
  OpenAI or future local model.
- `research/llm-evaluation/` now contains an implementation audit, protocol,
  12-scenario bank, blinded rating/log templates and an analysis script.

### Architecture and researcher-knowledge documentation

New authoritative files:

- `research/architecture/COMBAT_COGNITION_ARCHITECTURE_AND_EVIDENCE.md`
- `research/architecture/PRACTITIONER_KNOWLEDGE_METHODOLOGY.md`
- `research/architecture/component_evidence.csv`
- `research/architecture/design_knowledge_register.csv`

The design is explicitly informed by the researcher's 25+ years of martial-arts
practice/training/research, cross-style study, biomechanics, psychology, philosophy,
first-person observation of internal practice experience, and software experiments.
Use the label **expert-informed design-science with reflexive practitioner inquiry**.
First-person observations generate design hypotheses; they do not independently
prove universal brain mechanisms or system accuracy.

### Current agreed claim

Combat Cognition implements selected computational functions of martial-arts
perception, temporal reasoning, anticipation, situation awareness and coaching. It
is not a complete simulation of a human martial artist.

### Exact next task on the personal laptop

Prepare the end-to-end pilot/framework evaluation:

1. three participants, including the researcher as expert participant;
2. consented recorded jab trials as the evaluation case;
3. expert phase/form annotations and retention of original video;
4. rule-only versus hybrid system comparison;
5. logs, screenshots, latency, failure cases and usability ratings;
6. self-review bias disclosure and preferably a second expert; and
7. later replacement of generated phase data with grouped real annotated sessions.

After pilot evidence: consolidate figures/tables, complete verified literature,
agree chapter content against the university PDFs, and only then write the report.

Personal-laptop continuation prompt:

> Read `research/CHAT_HANDOFF.md` and `research/CHAT_TRANSCRIPT.md`, using the
> “Current transfer update — 2026-07-31” as authoritative. Continue with the
> end-to-end pilot and framework-evaluation protocol. Do not generate the thesis.

### Evidence continuation — 2026-08-01

This subsection supersedes only the participant/capture scope stated above.

- Practical scope is now one participant (P001): the researcher, developer, and
  martial-arts expert; jab only; laptop camera.
- Classify the work as a **single-participant expert feasibility case study** or
  **expert self-evaluation**, not a three-participant pilot or effectiveness study.
- The researcher supplied 78 categorized screenshots covering Train Easy/Hard,
  Practice, Analysis, Admin diagnostics, Dashboard, and application pages.
- Copies and hashes are preserved under
  `research/outputs/framework_evaluation/20260801_screenshot_evidence/`.
- Screenshots are restricted identifiable functional/observational evidence.
  They do not independently establish accuracy, latency, LLM operation,
  generalization, or human-equivalent cognition.
- The protocol, templates, runbook, and analysis utility were adapted to n=1.
- Next evidence needed: machine-readable practice tape/session export, timing or
  latency evidence, configuration/model identifiers, and expert annotations or
  a structured commentary for selected frames. Original recordings are useful
  when the researcher can provide them securely.
- Do not generate the thesis yet.
- An authenticated `GET /research/export` endpoint and **Download research data**
  button were added. The export includes P001's jab practice/training sessions,
  repetitions, feedback, analytics and landmark tapes, with content hash and
  limitations. It excludes account identity and raw video.
- The user supplied the resulting 31.97 MB export. Its internal content hash was
  verified and it was archived under
  `research/outputs/framework_evaluation/20260801T143145Z_database_export/`.
  It contains 42 practice sessions, 58 repetitions, 22 landmark tapes with 7,277
  frames, 185 training sessions, 140 step attempts, and 3,623 feedback events.
  It has no response-time observations or experimental-condition labels, and the
  records include development history. Do not treat aggregate system scores as
  independent accuracy. Use `EXPORT_INTERPRETATION.md` as the evidence summary.
- The researcher confirmed `practice-42` as the valid/latest demonstrated session
  and asked that mixed historical/outlier data not be used. A derived subset and
  selection notes were created without altering the full export. The confirmed
  session also reveals a retained integration inconsistency: canonical summary
  reports 3 completed reps, rule-engine summary reports 0, and the database has
  one rep row with an implausible duration. Treat this as failure-mode evidence.
- P001 confirmed the post-session three-repetition clustering as good/correct and
  explained that practice screenshots 6–14 show selected clusters/moments. A
  cropped popup image and `P001_EXPERT_CLUSTER_VALIDATION.md` were archived. This
  is expert self-validation, not independent ground truth.
- Verified evidence was consolidated into
  `research/outputs/evidence_consolidation/20260801/Combat_Cognition_Evidence_Consolidation.xlsx`
  with separate model, software, framework-case, claim-control, and figure/table
  sheets. Candidate figures F1, F2 and F4 were frozen under
  `research/figures/verified/20260801/`. No combined overall accuracy was created.
- A 22-source verified core literature matrix was created under
  `research/outputs/literature/20260801/`, with a machine-readable CSV, nine
  controlled framework-claim mappings, explicit claim boundaries, and a
  prioritized full-text review queue. Verification currently covers primary
  citation metadata and abstracts; page-specific full-text extraction remains
  the next literature gate. No thesis prose was generated.
- Literature matrix v2 adds 17 page/section-specific evidence extracts from 10
  priority full texts: BlazePose, GHUM Holistic, MediaPipe Hands, ST-GCN,
  2s-AGCN, Martinez et al., MS-TCN, Endsley, Hevner et al., and Piorkowski et
  al. Eleven included sources remain in the full-text queue. The extracts enforce
  baseline, boundary-metric, monocular-uncertainty, design-science, and bounded
  situation-awareness claim controls. No thesis prose was generated.
- Literature matrix v3 adds 10 further extracts from MediaPipe Framework,
  MST-GCN, Mao et al., AS-GCN and ASFormer. The register now contains 27
  page/section-specific extracts across 15 sources, with six included sources
  remaining. Added controls cover timestamps/frame drops, non-causal learned
  graph links, DCT smoothing of rapid movement, participant/session grouping,
  and small-data temporal-model selection. No thesis prose was generated.
- Literature matrix v4 closes the core queue: all 21 included/cautious sources
  now have selected-claim analytic extraction, comprising 39 page/section-specific
  entries. One pedestrian-trajectory STGAT paper remains explicitly excluded as
  direct support. Final additions cover Human3.6M, MPI-INF-3DHP, 3DPW,
  probabilistic monocular uncertainty, the Lockwood/Tant jab study, and the 2024
  straight-punch study. The next gate is literature-to-local-evidence
  reconciliation and an unresolved evaluation-action register. No thesis prose
  was generated.
- Literature-to-local-evidence reconciliation is now frozen under
  `research/outputs/claim_reconciliation/20260801/`. The register classifies all
  nine controlled claims: four are supported with mandatory boundaries (C03,
  C05, C07 and C09), five are partially supported (C01, C02, C04, C06 and C08),
  and none are wholly unsupported. EA03 was closed because the frozen ACP package
  already includes last-pose and constant-velocity baselines; EA01, EA02 and
  EA04–EA06 carry into the next gate.
  The next task is to create the unresolved evaluation-action register and
  decide which items must be completed now, reported as limitations, or deferred
  as future evaluation. No thesis prose was generated.
- The unresolved evaluation-action register is now frozen under
  `research/outputs/evaluation_actions/20260801/`. Twelve actions were audited:
  four are closed/complete and eight are open but bounded as explicit
  limitations/future evaluation. No new participants, recordings, cameras,
  techniques or retrospective ratings are required before chapter planning.
  EA03 is complete because the ACP package already contains last-pose and
  constant-velocity baselines. The next gate is preparation step 3: finalize
  figures, tables and appendices, including the missing architecture/evidence-
  flow figure. No thesis prose was generated.
- Preparation step 3 is complete under
  `research/outputs/report_artifacts/20260801/`. The final register freezes four
  figures, seven tables, eight curated appendices and six explicit exclusions.
  The missing F3 architecture/evidence-flow figure now exists as verified SVG
  and PNG under `research/figures/verified/20260801/`. F1–F3 are eligible with
  mandatory caption boundaries; F4 remains restricted and conditional on final
  privacy review. Original recordings, the raw database export/landmark tapes,
  unnecessary screenshots, operational-LLM claims and combined overall accuracy
  are excluded. The next and final preparation gate is the university-format
  chapter plan and controlled-claim approval. No thesis prose was generated.
- Preparation step 4, the final pre-writing gate, is complete under
  `research/outputs/chapter_plan/20260801/`. The workbook maps the extracted
  university format to eight logical report parts, one research question, six
  bounded objectives and fourteen approved controlled claims. There are no
  remaining scientific evidence blockers for a P001 jab-only laptop-camera
  expert feasibility/self-evaluation report. Six administrative confirmations
  remain before document generation: official title, conclusions chapter
  number, required preliminary pages, title-page metadata, optional F4 privacy
  approval and explicit user authorization to begin writing. The university
  PDFs are not present on this laptop; their earlier reviewed requirements are
  preserved in `research/CHAT_TRANSCRIPT.md`. Do not generate the thesis until
  the user explicitly asks.
- The user subsequently supplied both original university PDFs. They were
  visually reviewed in full and preserved with hashes under
  `research/inputs/university_guidelines/20260801/`. The review directly confirms
  A4, Times New Roman 12 pt, 1.5 spacing, 40/15/25 mm margins, chapter-heading,
  caption/title, page-numbering, reference-style and final-PDF rules. It also
  confirms the two source-level ambiguities: DS5299 explicitly jumps from
  Chapter 4 to Chapter 6, and its preliminary-page list is shorter than the
  general guideline. Keep both as lecturer-confirmation items. The chapter-plan
  workbook was updated; no thesis prose was generated.
- Current thesis-generation update — 2026-08-01: the user authorized thesis
  generation and requested that the supervisor field remain blank. A complete
  editable DOCX and submission PDF were generated under
  `research/outputs/thesis/20260801/`. The PDF is 36 pages and contains the
  approved preliminary pages, Chapters 1–5, 22 references, four figures, ten
  numbered main-text tables, and eight appendices. The evidence boundaries are
  preserved: P001 expert self-evaluation only, jab only, laptop camera only,
  generated model data distinguished from real-human evidence, no operational
  LLM, no combined overall accuracy, private videos excluded, and the retained
  practice-42 persistence inconsistency reported. DOCX integrity and PDF text
  structure passed automated checks, and every rendered PDF page was visually
  inspected. See `research/outputs/thesis/20260801/THESIS_BUILD_NOTES.md`.
- Screenshot revision — 2026-08-02: after the user requested fuller screenshot
  inclusion, the thesis was revised to 48 pages with Appendix A9, "System
  Interface and Functional Evidence." Twelve account-name-masked representative
  figures now cover Studio selection, dashboard filters, Train Hard corrections
  and voice transitions, completion/restart, Easy-mode hand tracking, live
  Practice, full-session analysis, Analysis mode, administrator L1/L2 overlays,
  live diagnostics and multi-level data layers. Chapter 4 now explicitly links
  to this appendix and preserves the boundary that screenshots demonstrate
  displayed interface states, not independent accuracy or effectiveness. The
  list of figures and static page numbers were updated. DOCX integrity and image
  audits passed (16 inline figures total), and all 48 PDF pages were visually
  checked. Final hashes are recorded in the thesis build notes.
- Word-only terminology correction — 2026-08-02: the ACP-STGAT expansion in
  the thesis abbreviation table and the reproducible DOCX builder was corrected
  to "Action-Conditioned Physics-Informed Spatio-Temporal Graph Attention
  Transformer." The prior incorrect expansion was removed. The editable DOCX
  passed structural checks; the PDF was deliberately not regenerated because
  the user is now editing the Word thesis through the VS Code extension.
- Appendix externalization — 2026-08-02: a publication-ready
  `research/Appendix/` package was created with A1–A9 directories, concise
  READMEs, selected reproducibility/audit records and 12 anonymized screenshots
  renamed descriptively. The Word thesis now links to the GitHub appendix at
  `https://github.com/SachithBandaraThennakoon/martial-art-ai/tree/main/research/Appendix`.
  The duplicated A9 screenshot pages and their List-of-Figures entries were
  removed from the DOCX; orphaned image payloads were also removed, leaving four
  embedded core thesis figures. The PDF was intentionally not regenerated and
  therefore still reflects the earlier screenshot-embedded version.
- Appendix-link revision - 2026-08-02: each Appendix A1-A9 summary in the
  editable DOCX now includes a separate clickable GitHub link to its matching
  `research/Appendix/A#-.../` directory. The builder and an idempotent surgical
  updater preserve this structure. DOCX archive integrity passed with nine
  unique appendix hyperlinks, four embedded core figures and 11 tables. The
  PDF was intentionally left unchanged for the user's Word-only editing phase.
- Expanded A9 screenshot revision - 2026-08-02: all 78 user-supplied screenshots
  were reviewed. Appendix A9 now retains 47 distinct account-name-masked views
  embedded in its README. The former completion/restart pair and administrator
  overlay/diagnostic composites were replaced by separate full-resolution
  images. Repetitive frames and authentication/payment or unnecessary personal
  material remain excluded. The DOCX and PDF were not regenerated.
- A5 visual-traceability revision - 2026-08-02: the Practice-42 table no longer
  shows inaccessible source-path labels. Its nine distinct evidence rows now
  link to curated A9 files, and the same overview/selected frames are embedded
  inline in A5. Four previously omitted non-duplicate selected frames were added
  to A9, bringing the curated screenshot set to 51. The DOCX/PDF were unchanged.
- Appendix renumbering revision - 2026-08-02: at the user's request, System
  Interface and Functional Evidence moved from A9 to A4; P001 remains A5;
  Software Verification moved from A4 to A6; Database, Literature and Evaluation
  Actions shifted to A7, A8 and A9 respectively. Folder names, Markdown links,
  DOCX headings/order, nine GitHub hyperlinks and reproducible builders were
  updated consistently. The PDF was deliberately not regenerated.
