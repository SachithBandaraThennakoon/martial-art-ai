import unittest

from routers.catalog import get_catalog, get_catalog_node


class CatalogSnapshotTests(unittest.TestCase):
    def test_catalog_is_served_from_the_backend_snapshot(self):
        response = get_catalog()

        martial_arts = response["nodes"][0]
        self.assertEqual(martial_arts["slug"], "martial-arts")
        technique_training = get_catalog_node("3-technique-training")
        self.assertGreater(len(technique_training["children"]), 0)


if __name__ == "__main__":
    unittest.main()
