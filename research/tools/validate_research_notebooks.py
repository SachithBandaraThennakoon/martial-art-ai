"""Structural and Python-syntax validation for generated research notebooks."""

from __future__ import annotations

import ast
import json
from pathlib import Path


NOTEBOOK_DIR = Path(__file__).resolve().parents[1] / "notebooks"
REQUIRED_PHRASES = {
    "ACP_STGAT_COMPLETE_TRAIN_EVALUATE_COLAB.ipynb": [
        "snapshot_download",
        "Andyen512/DDHpose",
        "USE_SYNTHETIC_FALLBACK = False",
        "h36m17_public_benchmark",
        "H36M_DRIVE_ID",
        "flatten_h36m_positions",
        "GroupShuffleSplit",
        "last_pose_baseline",
        "constant_velocity_baseline",
        "robustness",
        "torch.onnx.export",
        "onnx_parity_latency",
    ],
    "TEMPORAL_PHASE_COMPLETE_TRAIN_EVALUATE_COLAB.ipynb": [
        "technique-conditioned ST-GCN/TCN",
        "universal-jab-front-kick-bootstrap.json",
        "synthetic_bootstrap_pipeline_check",
        "fixed_stratified_group_split",
        "UniversalTemporalSTGCN",
        "classification_metrics",
        "balanced_accuracy",
        "macro_f1",
        "confusion_matrix",
        "boundary_result",
        "completed_sequences",
        "robustness",
        "torch.onnx.export",
        "onnx_parity_latency",
        "provenance.json",
    ],
}


def clean_notebook_syntax(source: str) -> str:
    """Remove IPython line magics before parsing the remaining Python."""
    return "\n".join(
        "" if line.lstrip().startswith(("!", "%")) else line
        for line in source.splitlines()
    )


def validate(path: Path) -> None:
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload["nbformat"] == 4
    assert payload["cells"], f"{path.name} has no cells"
    combined = ""
    for index, cell in enumerate(payload["cells"]):
        source = "".join(cell.get("source", []))
        combined += source
        if cell["cell_type"] == "code":
            assert cell.get("execution_count") is None
            assert cell.get("outputs") == []
            try:
                ast.parse(clean_notebook_syntax(source))
            except SyntaxError as error:
                raise SyntaxError(f"{path.name}, code cell {index}: {error}") from error
    for phrase in REQUIRED_PHRASES[path.name]:
        assert phrase in combined, f"{path.name} is missing {phrase!r}"
    print(f"Validated {path.name}: {len(payload['cells'])} cells")


if __name__ == "__main__":
    for notebook_name in REQUIRED_PHRASES:
        validate(NOTEBOOK_DIR / notebook_name)
