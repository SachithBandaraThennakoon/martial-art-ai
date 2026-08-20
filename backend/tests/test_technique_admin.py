import copy
import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from models import technique, training_memory, user  # noqa: F401
from models.technique import Technique, TechniqueRevision
from models.user import User
from routers.technique_admin import (
    RuntimePublication,
    list_revisions,
    publish_runtime,
    rollback_revision,
    update_learning_content,
    update_training_config,
)
from services.system_snapshots import load_technique_snapshot


class TechniqueAdminTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.session = sessionmaker(bind=self.engine)()
        self.admin = User(id=99, name="Catalog Admin", email="admin@example.test", role="admin")
        self.session.add(self.admin)
        self.session.commit()
        snapshot = load_technique_snapshot("jab")
        self.assertIsNotNone(snapshot)
        payload = snapshot["technique"]
        self.session.add(Technique(
            id=payload["id"],
            slug=payload["slug"],
            name=payload["name"],
            category=payload["category"],
            subcategory=payload["subcategory"],
            difficulty=payload["difficulty"],
            price=payload["price"],
            required_plan=payload["required_plan"],
            description=payload["description"],
            status=payload["status"],
            version=payload["version"],
            training_config=copy.deepcopy(snapshot["training_config"]),
            learning_content=copy.deepcopy(snapshot["learning_content"]),
            metadata_json=copy.deepcopy(payload["metadata"]),
        ))
        self.session.commit()

    def tearDown(self):
        self.session.close()
        self.engine.dispose()

    def test_training_update_validates_and_persists_json_configuration(self):
        jab = self.session.query(Technique).filter(Technique.slug == "jab").one()
        config = copy.deepcopy(jab.training_config)
        config["steps"][0]["step_name"] = "Validated guard setup"

        response = update_training_config("jab", config, self.session, self.admin)

        self.assertEqual(response["version"], "1.0.1")
        self.assertEqual(jab.training_config["steps"][0]["step_name"], "Validated guard setup")
        self.assertEqual(jab.metadata_json["runtime_source"], "postgresql")

    def test_invalid_training_update_is_rejected_without_mutating_database(self):
        jab = self.session.query(Technique).filter(Technique.slug == "jab").one()
        original = copy.deepcopy(jab.training_config)
        invalid = copy.deepcopy(original)
        invalid["steps"][0]["angle_targets"][0]["min"] = 181

        with self.assertRaises(HTTPException):
            update_training_config("jab", invalid, self.session, self.admin)

        self.session.expire_all()
        stored = self.session.query(Technique).filter(Technique.slug == "jab").one()
        self.assertEqual(stored.training_config, original)

    def test_learning_content_can_be_cleared_without_changing_json_files(self):
        jab = self.session.query(Technique).filter(Technique.slug == "jab").one()
        jab.learning_content = {**(jab.learning_content or {}), "status": "DRAFT"}
        self.session.commit()
        response = update_learning_content("jab", None, self.session, self.admin)
        self.assertIsNone(response["learning_content"])
        self.assertIsNone(self.session.query(Technique).filter(Technique.slug == "jab").one().learning_content)

    def test_publish_creates_history_and_rollback_creates_a_new_version(self):
        jab = self.session.query(Technique).filter(Technique.slug == "jab").one()
        original = copy.deepcopy(jab.training_config)
        changed = copy.deepcopy(original)
        changed["steps"][0]["step_name"] = "Published setup"

        first = publish_runtime(
            "jab",
            RuntimePublication(training_config=original, learning_content=jab.learning_content),
            self.session,
            self.admin,
        )
        published = publish_runtime(
            "jab",
            RuntimePublication(training_config=changed, learning_content=jab.learning_content),
            self.session,
            self.admin,
        )
        history = list_revisions("jab", self.session, self.admin)
        self.assertEqual(len(history["revisions"]), 2)
        self.assertEqual(history["revisions"][0]["version"], published["version"])

        restored = rollback_revision(
            "jab", first["revision_id"], self.session, self.admin
        )
        self.assertEqual(restored["version"], "1.0.3")
        self.assertEqual(self.session.query(TechniqueRevision).count(), 3)
        self.assertEqual(
            self.session.query(Technique).filter(Technique.slug == "jab").one().training_config["steps"][0]["step_name"],
            original["steps"][0]["step_name"],
        )


if __name__ == "__main__":
    unittest.main()
