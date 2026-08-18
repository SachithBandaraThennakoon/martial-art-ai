import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from models import catalog, target_angle, target_position, technique, technique_step  # noqa: F401
from models.catalog import CatalogItem, CatalogNode, CatalogPlacement
from models.technique import Technique
from routers.catalog import get_catalog
from services.catalog_sync import sync_technique_catalog


class CatalogSyncTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.session = sessionmaker(bind=self.engine)()

    def tearDown(self):
        self.session.close()
        self.engine.dispose()

    def test_sync_imports_packages_as_json_configuration_and_is_idempotent(self):
        first = sync_technique_catalog(self.session)
        second = sync_technique_catalog(self.session)

        self.assertGreaterEqual(first["created"], 33)
        self.assertEqual(second["created"], 0)

        jab = self.session.query(Technique).filter(Technique.slug == "jab").one()
        front_kick = self.session.query(Technique).filter(Technique.slug == "front-kick").one()
        self.assertEqual(jab.training_config["technique_id"], "jab")
        self.assertEqual(jab.learning_content["technique_id"], "jab")
        self.assertEqual(front_kick.training_config["technique_id"], "front-kick")
        self.assertIsNone(front_kick.learning_content)

        root = self.session.query(CatalogNode).filter(CatalogNode.slug == "martial-arts").one()
        self.assertEqual(root.node_type, "root")
        jab_item = self.session.query(CatalogItem).filter(CatalogItem.slug == "jab").one()
        placements = self.session.query(CatalogPlacement).filter(
            CatalogPlacement.catalog_item_id == jab_item.id
        ).all()
        self.assertEqual(len(placements), 1)
        self.assertTrue(placements[0].is_primary)

        response = get_catalog(db=self.session)
        martial_arts = response["nodes"][0]
        technique_training = next(node for node in martial_arts["children"] if node["name"] == "Technique Training")
        punching = next(node for node in technique_training["children"] if node["name"] == "Punching")
        self.assertEqual(next(item for item in punching["items"] if item["slug"] == "jab")["title"], "Jab")


if __name__ == "__main__":
    unittest.main()
