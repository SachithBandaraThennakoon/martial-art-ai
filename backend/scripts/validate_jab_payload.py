import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from routers import catalog_admin

root = Path(__file__).resolve().parents[2] / "backend" / "data" / "techniques" / "jab"
training_steps_path = root / "training-steps.json"
catalog_path = root / "catalog.json"
learning_content_path = root / "learning-content.json"

payload = catalog_admin.PackagePayload(**{
    "catalog": json.loads(catalog_path.read_text(encoding="utf-8")),
    "training_steps": json.loads(training_steps_path.read_text(encoding="utf-8")),
    "learning_content": json.loads(learning_content_path.read_text(encoding="utf-8")),
    "enabled": True,
})

try:
    package_id, catalog, training_steps, learning_content = catalog_admin._validate_payload(payload)
    assert learning_content["technique_id"] == package_id
    print("VALIDATION OK", package_id)
except Exception as e:
    print("VALIDATION FAILED")
    print(repr(e))
    raise
