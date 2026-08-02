# Verified evidence consolidation — 2026-08-01

This package consolidates evidence for planning tables, figures, results, and
limitations. It is not thesis prose and must not be pasted into the report without
the later chapter-content review.

## Deliverables

- `Combat_Cognition_Evidence_Consolidation.xlsx`: six-sheet audit workbook
- `research/figures/verified/20260801/`: frozen copies of three candidate figures
- rendered sheet previews and `verification.txt`: visual/formula QA records

## Workbook sheets

1. **Evidence Summary** — separates the four evidence tiers and prohibits an
   invalid combined “overall accuracy”.
2. **Model Metrics** — ACP normalized errors/baselines/robustness and phase
   generated-data metrics/robustness/ONNX latency.
3. **Software Verification** — frontend assertions, backend tests and build checks.
4. **Framework Case** — the confirmed P001 practice-42 evidence and the retained
   canonical/rule-engine/database inconsistency.
5. **Claim Register** — permitted claims, prohibited overclaims and evidence gaps.
6. **Figure Table Register** — provisional report artifact inventory.

## Frozen headline values

- ACP-STGAT mean normalized MPJPE/ADE: 0.07839 (SD 0.00155)
- ACP ONNX CPU model-only latency: median 9.88 ms; p95 12.81 ms
- Phase generated-bootstrap macro F1: 0.89155 (SD 0.00930)
- Phase generated-bootstrap accuracy: 0.87841 (SD 0.01309)
- Phase ONNX CPU model-only latency: median 5.74 ms; p95 30.49 ms
- Frontend verification: 129/129 assertions across 23 test files
- Current backend suite: 24/24 tests
- P001 practice-42: three expert-confirmed clusters, 250 frames, 96% tracking,
  with 22 frames changed by post-session decoding

The phase values validate generator-defined structure only. P001 values are a
single expert self-evaluation. Model-only latency is not end-to-end latency.

## Candidate figures

- F1: ACP error by prediction horizon — ready with normalized-unit caveat
- F2: phase confusion matrix — usable only as generated-data pipeline evidence
- F3: Combat Cognition architecture/evidence flow — still needs a final drawing
- F4: P001 three-cluster timeline — derived screenshot, must remain anonymized and
  identified as expert self-validation

Original videos remain private evidence and are not candidate report figures.

## Remaining gaps before chapter-content agreement

- verified literature matrix and final citation set;
- final architecture figure;
- university-guideline chapter-content mapping;
- no live end-to-end latency measurement;
- no controlled rule-only versus hybrid replay result;
- no independent expert/participant evaluation;
- no grouped real-data phase-model evaluation.

These gaps must appear as limitations or future evaluation, not be silently
converted into achieved results.
