# Scientific Pose Optimization — Development Handoff

Last updated: 2026-08-10

## How to continue on another computer

1. Copy, commit, or push the complete repository, including uncommitted changes.
2. Open the repository in Codex on the other computer.
3. Ask: `Read docs/POSE_OPTIMIZATION_HANDOFF.md and continue the pose optimization development.`
4. Do not discard `backend/data/techniques/jab/training-steps.json`; it contains edited/saved pose data.

This document is a technical summary rather than a verbatim chat transcript.

## Product objective

Build a scientific, martial-art-style-independent system that starts with one administrator-defined static human pose and finds a safer, more useful representative pose within a configured search region.

Current workflow:

```text
Initial pose
  -> angle and position tolerances
  -> generated safe variable ranges
  -> constraint validation
  -> coupled whole-skeleton biomechanics evaluation
  -> NSGA-II multi-objective optimization
  -> Pareto-optimal region
  -> deterministic sensitivity and robustness analysis
  -> representative optimized pose
  -> save to the technique step for user-studio feedback
```

The generic Reset skeleton is only a neutral starting geometry. An administrator should arrange it into a reasonable initial combat-ready pose before applying it.

## Critical modeling decision

Search bounds exist per variable, but optimization is not performed one joint at a time. NSGA-II operates on the complete decision vector simultaneously:

```text
X = [
  shoulder and elbow angles,
  hip, knee and ankle angles,
  stance width and depth,
  guard width and height,
  torso lean,
  pelvis and shoulder rotation,
  other supported pose variables
]
```

Every candidate is evaluated as one complete skeleton. The current evaluator has some coupled formulas, but its shoulder-elbow-wrist/guard-chain reasoning is still simplified and is the next major scientific improvement.

For a static pose, prefer the terms **kinematic chain** or **structural chain**. Reserve **kinetic chain** for future dynamic analysis with measured or estimated velocity, acceleration, torque, force, momentum, muscle activation, or ground reaction forces.

## Current UI

Route: `/admin-catalog`

Pose Studio currently contains:

- One editable **Initial** skeleton.
- One read-only **Optimized** skeleton.
- Two visually separated floor/grid regions in one shared Three.js canvas.
- Joint move and rotation tools.
- Grounding and fixed-bone behavior.
- Initial-pose angle values and tolerances.
- Generate ranges, then Run optimization workflow.
- Objective weights, live/representative target scores, optimal ranges, sensitivity, robustness, overlay, and Accept optimal pose action.
- Selectable Combat Guard anchor and guard-similarity objective.
- Full-safe-range mode for expanding non-exempt variables to anatomical constraint envelopes.
- Technique-specific variable exceptions that stay inside the selected tolerance and are omitted from guard/asymmetry penalties.
- Separate left/right hand-to-head variables so a strike hand can be exempt while the opposite hand remains optimized for guard.
- Compact/fullscreen/panel controls.

The UI was intentionally changed from decorative styling to a neutral, useful engineering layout.

## Manual catalog route

Route: `/admin-manual-catalog`

The optimizer catalog remains available unchanged for future development. The manual route reuses the catalog details, steps, archive and save workflows, but replaces the optimizer panel with a single manual skeleton workbench:

- Move joints with fixed bone lengths.
- Rotate limbs and edit XYZ coordinates.
- Enter exact joint angles.
- Configure angle and position tolerances.
- **Apply pose** writes the landmark skeleton and calculated angle ranges directly to the selected step draft.
- Applying a manual pose removes that step's `pose_optimization` payload so stale optimizer results cannot override manual data.
- The catalog-level **Save** action persists the manual reference pose and angle targets through the existing admin API.

Implementation files:

- `frontend/src/components/ManualPosePanel.jsx`
- `frontend/src/pages/ManualTechniqueCatalogAdmin.jsx`
- `frontend/src/pages/TechniqueCatalogAdmin.jsx` (`manualMode`)
- `frontend/src/App.jsx`
- `frontend/src/components/Navbar.jsx`

## One-pose tolerance workflow

The backend still accepts `pose_a` and `pose_b` for backward compatibility. The frontend sends the same Initial pose as both endpoints:

```json
{
  "pose_a": "<initial pose>",
  "pose_b": "<same initial pose>",
  "margin": {
    "angle_degrees": 3,
    "position_normalized": 0.12
  }
}
```

This produces `initial value ± tolerance`, clipped to each variable's safety constraints.

New saved configurations also include:

```json
{
  "workflow": "initial_tolerance_v1",
  "initial_pose": "<pose>"
}
```

Legacy `pose_a`/`pose_b` fields remain populated so existing backend/database/catalog code continues working.

## Tolerance behavior

- Angle margin remains restricted to `0–30 degrees`.
- Position optimization margin has no artificial upper maximum.
- Position margin must be finite and non-negative.
- Body-normalized `1.0` is approximately one torso length.
- Large position margins are clipped independently by every variable's anatomical constraint.
- A margin of `5.0` was tested through range generation and a real NSGA-II run; it remained bounded and produced a representative pose.
- The reference-pose metadata tolerance remains capped at `0.5`; this is separate from the unlimited optimization search margin.
- Editing tolerance inputs does not call the evaluation API.
- Tolerances are committed when **Apply pose** is clicked.
- Editing skeleton geometry still triggers debounced real-time evaluation.

## Validation and 400-error protection

Previous problem: intermediate drag frames and unsafe poses were immediately stored and then submitted to `/ranges` and `/run`, producing 400 responses.

Current protection in `PoseOptimizationPanel.jsx`:

- Debounced backend evaluation.
- Evaluation sequence IDs ignore stale responses.
- The backend `valid` flag and constraint violations are respected.
- Generate and Run buttons are disabled until the current pose is valid.
- Client-side checks reject missing, non-finite, out-of-space, or overlapping bone landmarks before calling `/evaluate`.
- UI shows `Validating pose...` or `Pose valid` and an actionable violation message.

If a new 400 occurs, capture the JSON response `detail`, not only the Uvicorn access log. The frontend `postJson` function already displays backend detail in the status message.

## Main implementation files

Frontend:

- `frontend/src/components/PoseOptimizationPanel.jsx`
  - One-pose workflow, API calls, validation state, NSGA-II actions, results and save/apply behavior.
- `frontend/src/components/PoseRangeDesigner.jsx`
  - Three.js skeleton editor, grounding, fixed bone lengths, joint/angle editing, tolerance application, two-skeleton scene.
- `frontend/src/components/PoseStudioContext.jsx`
  - Shared Initial/Optimized scene context.
- `frontend/src/index.css`
  - Admin studio layout and pose-workbench styling. This file contains accumulated overrides and should eventually be refactored into smaller component CSS modules.

Backend:

- `backend/routers/catalog_admin.py`
  - `/pose-optimization/evaluate`, `/ranges`, and `/run` endpoints.
- `backend/services/pose_optimization_schema.py`
  - Pose and optimizer configuration validation.
- `backend/services/pose_variables.py`
  - Extraction of the generalized whole-skeleton decision vector.
- `backend/services/pose_search_ranges.py`
  - Range construction and safety clipping.
- `backend/services/pose_constraints.py`
  - Anatomical/safety envelopes.
- `backend/services/pose_biomechanics.py`
  - Deterministic static geometry scores.
- `backend/services/pose_optimizer.py`
  - NSGA-II and representative solution selection.
- `backend/services/pose_kinematics.py`
  - Reconstruction of landmark skeletons from optimized variables.
- `backend/services/pose_sensitivity.py`
  - Deterministic sensitivity and robustness analysis.
- `backend/services/pose_guard_anchor.py`
  - Versioned combat-guard target regions and exception-aware similarity scoring.

Tests:

- `backend/tests/test_pose_optimization_schema.py`
- `backend/tests/test_pose_search_ranges.py`
- `backend/tests/test_pose_optimizer.py`
- `backend/tests/test_pose_biomechanics.py`
- `backend/tests/test_pose_sensitivity.py`
- `backend/tests/test_pose_guard_anchor.py`
- Frontend Node tests under `frontend/tests/`

## Current modified working-tree files

At the 2026-08-10 handoff update, the structural-chain work is uncommitted in:

- `backend/services/pose_biomechanics.py`
- `backend/services/pose_optimizer.py`
- `backend/services/pose_guard_anchor.py`
- `backend/services/pose_optimization_schema.py`
- `backend/services/pose_search_ranges.py`
- `backend/services/pose_sensitivity.py`
- `backend/services/pose_variables.py`
- `backend/services/pose_structural_chain.py`
- `backend/tests/test_pose_biomechanics.py`
- `backend/tests/test_pose_optimizer.py`
- `backend/tests/test_pose_guard_anchor.py`
- `backend/tests/test_pose_optimization_schema.py`
- `backend/tests/test_pose_search_ranges.py`
- `backend/tests/test_pose_sensitivity.py`
- `backend/tests/test_pose_structural_chain.py`
- `frontend/src/components/PoseOptimizationPanel.jsx`
- `frontend/src/index.css`
- `other/private-notes/docs/POSE_OPTIMIZATION_HANDOFF.md`

The Jab `training-steps.json` catalog data is currently clean, but it contains the administrator-edited/saved pose data described above. Continue to treat it as user/catalog data and do not overwrite or revert it without reviewing it first.

## Last completed verification

- Frontend ESLint passed for `PoseOptimizationPanel.jsx`.
- Vite production build passed.
- Focused backend pose suite passed: 36 tests, including broad-range guard convergence, directional guard reconstruction, dropped-hand rejection, jab-arm exceptions, NSGA-II, biomechanics, structural-chain, schema, ranges, kinematics, sensitivity and robustness.
- Frontend suite ran 144 tests: 143 passed. One catalog-data assertion expects 12 Jab angle targets but the saved administrator data currently has 10; this was not changed because it is outside the structural-chain upgrade and the pose data must be preserved.
- Earlier manual large-margin NSGA-II smoke testing passed with position margin `5.0`, population `16`, generations `5`, and produced a representative pose.

Useful commands:

```powershell
# Backend
cd backend
python -m uvicorn main:app --reload
python -m unittest tests.test_pose_optimization_schema tests.test_pose_search_ranges tests.test_pose_optimizer

# Frontend
cd frontend
npm.cmd run dev
npm.cmd run lint -- --no-warn-ignored src/components/PoseOptimizationPanel.jsx src/components/PoseRangeDesigner.jsx
npm.cmd test -- --run
npm.cmd run build
```

If Uvicorn reports `WinError 10013`, try another explicit port and confirm the original port is not reserved or already occupied:

```powershell
python -m uvicorn main:app --reload --port 8001
```

## Recommended scientific roadmap

### Phase 1 — Coupled structural guard model

Create separate modules for:

- Shoulder-elbow-wrist alignment.
- Elbow-to-torso/rib connection.
- Hand relationship to head, jaw, torso and centerline target zones.
- Guard height, width, compactness and open corridors.
- Joint-chain collapse and overextension penalties.
- Whole-body support chain from feet through pelvis and torso to the arms.

Do not replace the existing evaluator. Add coupled components and version them.

### Phase 2 — Style-independent combat context

Do not encode boxing, karate, Muay Thai, or other named styles as the source of truth. Define task constraints instead:

```text
CombatContext =
  opponent direction and distance
  threat/attack corridor
  protected target priorities
  intended next-action set
  anthropometric profile
  environmental/rules constraints when relevant
```

The optimization should produce Pareto regions from human capabilities and context. Style-like solutions may emerge rather than being prescribed.

### Phase 3 — Target coverage geometry

- Add anatomical target volumes for head/jaw/neck/torso.
- Add opponent-relative attack rays or swept corridors.
- Measure occlusion/coverage by forearms, hands, shoulders and torso orientation.
- Penalize uncovered high-priority corridors.
- Make all calculations deterministic and independently testable.

### Phase 4 — Readiness and transition cost

Static stability alone can select a pose that is difficult to leave. Add estimated transition costs from the candidate pose to primitive actions such as:

- strike
- parry/block
- evade
- step in each direction
- recover to protected structure

Initially use kinematic displacement and joint reserve proxies. Later replace them with temporal/dynamic models.

### Phase 5 — Anthropometrics and real mechanics

- Segment lengths and body proportions.
- Segment mass estimates and center of mass.
- Base-of-support polygon from actual foot contact geometry.
- Static joint torque/load proxies.
- Optional OpenSim or comparable musculoskeletal validation pipeline.
- Clearly label heuristic proxies versus measured/validated mechanics.

### Phase 6 — Dynamic optimization

Extend from a static vector `X` to a trajectory `X(t)`:

- velocity and acceleration
- timing and reaction delay
- momentum and impulse
- ground contact changes
- recovery and perturbation response
- temporal sensitivity and robustness

Only at this phase should the system make kinetic-chain claims.

### Phase 7 — Scientific validation

- Formula documentation and evaluator versioning.
- Unit tests with synthetic poses.
- Expert-reviewed reference sets.
- Motion-capture/force-platform validation where possible.
- Compare predicted optimal regions with measured outcomes.
- Report uncertainty and avoid claiming universal optimality.

## Best next coding task

Completed on 2026-08-10:

- Added `backend/services/pose_structural_chain.py` with a versioned deterministic static-geometry model.
- Added arm connection, body-normalized guard compactness, torso stack, lower-body support, whole-body support and joint-chain reserve measurements.
- Integrated transparent structural-chain components into Defense, Readiness, Structural Efficiency and Joint Safety without changing target ids or optimizer inputs.
- Advanced the evaluator to `1.1.0` and exposed `structural_chain_version` in evaluation and optimization results.
- Added the complete representative evaluation to optimization output so the admin catalog can show the evidence behind the selected pose.
- Added an admin analysis table for the structural-chain evidence and focused backend tests.

Also completed on 2026-08-10:

- Added the first backward-compatible optimization context with `anchor_mode`, `full_safe_ranges`, `guard_exempt_variables`, and `range_locked_variables`.
- Added `guard_similarity` as a transparent multi-objective target. Legacy backend callers default to no anchor; new Admin Pose Studio work defaults to Combat Guard.
- Added separate left/right hand-to-head distances and signed head-relative hand heights, increasing the coupled decision vector from 17 to 21 variables. Distance controls proximity; signed height prevents a hand near the torso from satisfying a spherical distance-only proxy.
- When a strike hand is exempt, combined two-hand guard measurements do not penalize it; the opposite hand remains independently scored.
- Verified deterministic seeded NSGA-II convergence from full safe ranges to a representative guard score above 95.
- Changed representative selection to rank the reconstructed landmark skeleton by the configured objectives instead of preferring projection convenience. A focused full-range reconstruction smoke test produced a feasible visible skeleton with guard similarity `92.83`.
- Guard similarity now gives critical weight to per-hand protection, so good legs/torso cannot hide dropped hands. Combat Guard runs reject final representatives below guard score `80` with an actionable range/exception message instead of displaying a misleading optimized pose.
- New Admin Combat Guard configurations default to full safe ranges. Exact Reset-pose reproduction showed that ordinary `±0.5` position tolerance cannot lift the low reset wrists into the head/jaw guard zone and correctly returns 422; full safe ranges succeeds with reconstructed guard score `91.3`.
- Resolved a deeper inverse-kinematics ambiguity: scalar angles/distances permitted crossed or raised non-guard limb directions. Combat Guard reconstruction now starts from and regularizes toward a feasible directional 3D guard landmark anchor, while exempt technique limbs retain the administrator pose. Final selection includes visual-anchor RMSE. Exact Reset reproduction now scores `98.45` with wrists above the elbows, hands forward near the head, elbows outside the shoulders and a staggered supported stance.
- Objective weights and context controls are reactive after the first optimization. Weight, Anchor State, full-range and exception changes debounce for `900 ms`, then regenerate ranges and rerun optimization automatically. The old optimized skeleton remains visible while status reads `Updating optimized pose...`, and the completed configuration is saved back to the step draft. This fixes the previous behavior where Anchor State and weights changed configuration without changing the visible result.

The next scientific task is to extend this initial context with opponent direction/distance, protected-target priorities and threat corridors before adding target-volume coverage geometry.

