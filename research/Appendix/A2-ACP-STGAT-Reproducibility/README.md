
# ACP-STGAT | 3D Human Motion Forecasting

**Action-Conditioned Physics-Informed Spatio-Temporal Graph Attention Transformer**  
*Technical project report and reproducibility evidence · Martial Art AI / Combat Cognition Framework*

ACP-STGAT predicts **30 future 3D skeleton poses from 60 observed poses**. It combines anatomical graph attention, motion-conditioned joint weighting, a temporal Transformer and a kinematic prior. The model was built to give Martial Art AI a forward estimate of movement. A jab, for example, can move from extension to deceleration and retraction within the forecast interval, which makes straight-line extrapolation unreliable over longer horizons.

**Benchmark result.** On 10,000 held-out Human3.6M windows, ACP-STGAT achieved **0.07839 ± 0.00155 normalized MPJPE** across three training seeds. Mean error was **18.6% lower than last pose** and **21.6% lower than constant velocity**. The validation-selected 17-joint checkpoint also passed PyTorch-to-ONNX parity and ran at **9.88 ms median CPU inference latency** in the archived model-only test. [Per-run metrics](metrics-by-run.csv) · [ONNX measurements](../../outputs/acp_stgat/20260731T061529Z/evidence/onnx_parity_latency.json)

## Architecture

![ACP-STGAT architecture overview showing 60 observed skeleton frames, motion context, a skeletal graph, attention, a temporal Transformer, and a 30-frame forecast](acp-stgat-architecture.png)

*Figure 1. Project architecture overview. The graphic combines the 30 FPS browser design target with the 17-joint benchmark results. Its skeletons and attention map illustrate the pipeline. The archived notebook defines the exact operation order, input features, and training procedure described below.*

### From observed skeletons to a forecast

1. **Construct joint features.** The benchmark receives a tensor of shape `[B, 60, 17, 3]`. It derives velocity and acceleration with first and second finite differences along the frame axis. Concatenating XYZ, velocity and acceleration yields nine features per joint. The benchmark takes XYZ as its external input. The visibility cues depicted in the graphic belong to the application context.
2. **Model spatial dependencies.** Each joint is a node and each bone is an undirected edge. A multi-head graph attention block operates within each frame and allows a joint to attend to itself and to joints up to two skeletal hops away. For example, this lets wrist features draw on the elbow and shoulder chain. The graph mask constrains information flow, while the training loss separately penalizes bone-length deviations.
3. **Summarize motion and weight joints.** Eight statistics are derived from the observed window. They capture overall speed, mean shoulder, elbow, wrist and knee speed, mean acceleration magnitude, a progress proxy based on speed relative to the batch mean, and a risk proxy based on acceleration and final wrist separation. An embedding of these statistics sets sigmoid weights on the graph features before joint pooling. The conditioning comes from observed kinematics and uses no action labels. The progress feature depends on which windows share a batch, which matters when reproducing the original evaluation.
4. **Encode the motion history.** Joint pooling produces one token per observed frame. Two temporal Transformer encoder layers process the 60 tokens using width 128, four attention heads and dropout of 0.1. The archived model feeds pooled tokens directly to the encoder and adds the action embedding to the encoded memory. Time cues come from the input finite differences and the decoder's ordered, learned queries. The positional encoding block in Figure 1 is part of the conceptual illustration.
5. **Decode all future poses.** Thirty learned future queries, each offset by the action embedding, attend to the observed memory through a two-layer Transformer decoder. The output head yields one 3D joint correction per future frame. The model adds a context-scaled correction to the kinematic prior to produce `[B, 30, 17, 3]`.

[Archived implementation](../../outputs/acp_stgat/20260731T061529Z/source_notebook.ipynb) · [Design rationale](../../architecture/ACP_STGAT_MODEL_RATIONALE.md)

### Kinematic prior and training objective

For future frame $h$, the archived model uses $s_h = h/30$ with velocity $v_t$ and acceleration $a_t$ computed from the last three observed poses. It adds a decoder correction $r_h$ scaled by a sigmoid gate $g$ shared across forecast frames and joints within each sample.

$$
p_h^{\mathrm{prior}} = p_t + s_h v_t + \tfrac{1}{2}s_h^2 a_t,
\qquad
\hat p_{t+h} = p_h^{\mathrm{prior}} + (1-g)r_h
$$

The normalized horizon step makes this a scaled kinematic heuristic. Its role is to give the decoder a starting trajectory based on recent motion. The objective combines Euclidean position error with L1 penalties on frame-to-frame velocity, acceleration, and lengths of connected bones.

$$
\mathcal{L}=\mathcal{L}_{\mathrm{position}} + 0.25\mathcal{L}_{\mathrm{velocity}} + 0.10\mathcal{L}_{\mathrm{acceleration}} + 0.10\mathcal{L}_{\mathrm{bone}}
$$

## Benchmark protocol

| Setting | Archived Human3.6M-17 experiment |
| --- | --- |
| Dataset | Processed Human3.6M 3D pose sequences distributed via DDHPose |
| Preprocessing | Select 17 joints, subtract the pelvis per frame and divide by the sequence median pelvis-to-thorax distance |
| Split | Grouped by participant before generating windows. Held-out test participants were `S1` and `S11` |
| Windows | 60 observed frames followed by 30 target frames, stride 10. The test manifest contains 10,000 windows |
| Time scale | Native **50 FPS** in the archive. The history contains about **1.2 s** of samples and frame 30 is **0.6 s** after the last observation |
| Training | PyTorch on CUDA, AdamW, batch size 32, learning rate `3e-4`, weight decay `1e-4`, gradient norm clipping at `1.0` |
| Model selection | Seeds `42`, `43`, `44`, up to 60 epochs each, early-stopping patience 10. Each run restored the checkpoint with lowest validation MPJPE before test scoring |
| Baselines | Repeat the last observed pose, or extrapolate its most recent velocity one step at a time |

The pose coordinates are pelvis-relative and scaled by torso size. MPJPE is the mean Euclidean joint error across windows, frames and joints. The notebook computes average displacement error (ADE) identically. Final displacement error (FDE) averages joint errors at frame 30. Bone-length MAE measures how closely predicted bone lengths match the target skeletons. All errors are in normalized coordinate units. [Run provenance](../../outputs/acp_stgat/20260731T061529Z/evidence/provenance.json) · [Test-window manifest](../../outputs/acp_stgat/20260731T061529Z/evidence/test_windows.csv)

## Results

Lower is better. The model row reports mean ± sample standard deviation across the three seeds on the same held-out windows.

| Method | Normalized MPJPE / ADE | Final displacement error | Bone-length MAE |
| --- | ---: | ---: | ---: |
| **ACP-STGAT** | **0.07839 ± 0.00155** | **0.13639 ± 0.00237** | 0.00576 ± 0.00019 |
| Last pose | 0.09629 | 0.16470 | ≈ 0.00000 |
| Constant velocity | 0.10004 | 0.22710 | 0.02487 |

| Seed | Best validation epoch | Test MPJPE / ADE | Test FDE |
| ---: | ---: | ---: | ---: |
| 42 | 47 | 0.07741 | 0.13468 |
| 43 | 50 | 0.07759 | 0.13539 |
| 44 | 47 | 0.08018 | 0.13910 |

At the final frame, mean ACP-STGAT error was **17.2% lower than last pose** and **39.9% lower than constant velocity**. Constant velocity led at early frames, including frame 10, but its error exceeded the model's by frame 20. The frozen-pose baseline preserves bone lengths by keeping the skeleton static. ACP-STGAT reduced structural error relative to constant velocity while improving trajectory error over both baselines. [Summary CSV](../../outputs/acp_stgat/20260731T061529Z/evidence/metrics_summary.csv) · [Per-frame and per-joint metrics](../../outputs/acp_stgat/20260731T061529Z/evidence/metrics_complete.json)

![Line chart of held-out normalized pose error by forecast frame for ACP-STGAT, last pose and constant velocity](../../outputs/acp_stgat/20260731T061529Z/evidence/error_by_horizon.png)

*Figure 2. Archived forecast error by frame. The ACP-STGAT curve uses seed 42, selected by validation MPJPE. The aggregate table uses all three seeds.*

### Sensitivity to imperfect observations

These stress tests perturbed the observed window of the seed-42 checkpoint after training. Missing joints were simulated by carrying forward the previous observed coordinates. Gaussian noise was added independently to input coordinates.

| Input condition | Normalized MPJPE | Change from clean |
| --- | ---: | ---: |
| Clean input | 0.07741 | Reference |
| Gaussian noise, SD `0.005` | 0.09167 | +18.4% |
| Gaussian noise, SD `0.010` | 0.11645 | +50.4% |
| 5% simulated missing joints | 0.07792 | +0.7% |
| 10% simulated missing joints | 0.07864 | +1.6% |

Coordinate jitter had a larger effect than the carry-forward missing-joint simulation. The robustness findings apply to these corruption settings. [Robustness CSV](../../outputs/acp_stgat/20260731T061529Z/evidence/robustness.csv)

## ONNX export and browser integration

| | Research export | Browser integration |
| --- | --- | --- |
| Skeleton | 17 Human3.6M joints | 33 MediaPipe landmarks |
| Input → output | `[B, 60, 17, 3]` → `[B, 30, 17, 3]` | 60 × 33 × 3 → 30 × 33 × 3 per sample |
| Forecast interval | 0.6 s at the recorded 50 FPS | About 1 s at the nominal 30 FPS |
| Evidence | Held-out benchmark and model-only ONNX Runtime CPU test | Separate ONNX model, runtime contract and forecast integration code |

The 17-joint export matched PyTorch on a held-out single-sample input with a maximum absolute difference of **1.19 × 10⁻⁷** and a mean difference of **1.84 × 10⁻⁹**, passing the `1e-4` threshold. ONNX Runtime CPU timing used up to 100 single-sample calls and measured **9.88 ms median** and **12.81 ms p95**. The timing covers model execution and its input conversion within the test loop. [ONNX parity and latency JSON](../../outputs/acp_stgat/20260731T061529Z/evidence/onnx_parity_latency.json)

In Martial Art AI, the browser predictor normalizes landmarks around the hip center using shoulder or torso scale. An optional forecast layer buffers observations, throttles model calls and updates per-horizon reliability by comparing predictions with subsequently observed landmarks. The forecast is advisory input to the coaching pipeline. [Browser model contract](../../../frontend/public/models/acp_stgat_motion_predictor_metadata.json) · [Browser predictor](../../../frontend/src/temporal/stgatOnnxPredictor.js) · [Forecast integration](../../../frontend/src/temporal/sharedAcpForecastLayer.js)

## What the evidence establishes

- **Benchmark scope.** The results cover a participant-held-out, pelvis-relative Human3.6M task, compared with two simple forecasting baselines. Individual component effects and performance relative to published forecasting models remain open evaluation questions.
- **Application scope.** Quantitative accuracy for martial-arts movements, including jab prediction, requires held-out MediaPipe-33 recordings and future-pose targets. End-to-end browser latency also requires separate timing that includes camera capture, pose extraction, preprocessing and visualization.
- **Model scope.** ACP-STGAT predicts one future trajectory per observation window. The kinematic prior uses position differences and the bone loss encourages geometric consistency. The implementation leaves force, torque, contact dynamics and hard anatomical constraints outside the model.

## Reproduce or audit the experiment

1. Open the training notebook in a CUDA-enabled Colab session. Run the default `smoke` profile to verify the environment and data preparation. Use `RUN_PROFILE = "full"` and `TRAINING_MODE = "scratch"` for a fresh three-seed run. [Training notebook](../../notebooks/ACP_STGAT_COMPLETE_TRAIN_EVALUATE_COLAB.ipynb) · [Notebook guide](../../notebooks/ACP_STGAT_COMPLETE_TRAIN_EVALUATE_COLAB_GUIDE.md)
2. For the experiment reported here, use the configuration and environment recorded under run ID **`20260731T061529Z`**. The provenance lists the prepared dataset SHA-256, split indices and software versions. The archived notebook records the exact procedure used for the frozen results. [Archived notebook](../../outputs/acp_stgat/20260731T061529Z/source_notebook.ipynb) · [Provenance JSON](../../outputs/acp_stgat/20260731T061529Z/evidence/provenance.json)
3. Audit the predictions and export using the archived tables, histories and checkpoint files. The research ONNX model uses a companion `.onnx.data` file. Keep both files together when loading it. [Evidence directory](../../outputs/acp_stgat/20260731T061529Z/evidence/) · [Original output ZIP](../../outputs/acp_stgat/20260731T061529Z/original_output_bundle.zip) · [Archive checksums](../../outputs/acp_stgat/20260731T061529Z/RESULT_INTERPRETATION.md#preserved-evidence)

## Colab notebook

- [View the complete notebook on GitHub](https://github.com/SachithBandaraThennakoon/martial-art-ai/blob/main/research/notebooks/ACP_STGAT_COMPLETE_TRAIN_EVALUATE_COLAB.ipynb)
- [Open the notebook in Google Colab](https://colab.research.google.com/github/SachithBandaraThennakoon/martial-art-ai/blob/main/research/notebooks/ACP_STGAT_COMPLETE_TRAIN_EVALUATE_COLAB.ipynb)

## Included evidence

- [Result interpretation](result-interpretation.md)
- [Metrics by run](metrics-by-run.csv)
