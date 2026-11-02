import json
import os
import pathlib
import runpy
import sys
import tempfile
import unittest
from unittest.mock import patch
from region_policy import excluded_generated_path

HERE = pathlib.Path(__file__).resolve().parent
CATALOG = json.loads((HERE / '../src/main/assets/regions.json').read_text())


class RegionPublicationTests(unittest.TestCase):
    def test_excluded_paths(self):
        for relative in ['regions/east_asia.json', 'regions/korea.json', 'bundles/east_asia.json', 'bundles/korea.json', 'shards/east_asia-2.json', 'shards/korea-0.json', 'snapshots/ICN-NRT-2027-01.json', 'snapshots/NRT-ICN-2027-01.json', 'errors/ICN-CAN-2026-11.json', 'snapshots/ICN-GMP-2026-11.json', 'snapshots/GMP-ICN-2026-11.json']:
            with self.subTest(relative=relative):
                self.assertTrue(excluded_generated_path(relative, CATALOG))

    def test_origin_anchor_and_other_regions_are_retained(self):
        for relative in ['regions/europe.json', 'bundles/americas.json', 'shards/se_asia-0.json', 'snapshots/ICN-CDG-2027-01.json', 'snapshots/CDG-ICN-2027-01.json', 'snapshots/ICN-JFK-2027-01.json', 'errors/BKK-ICN-2026-11.json', 'snapshots/ICN-ZZZ-2026-11.json']:
            with self.subTest(relative=relative):
                self.assertFalse(excluded_generated_path(relative, CATALOG))
        self.assertFalse(excluded_generated_path('snapshots/GMP-CDG-2026-11.json', CATALOG, origin='GMP'))
        self.assertTrue(excluded_generated_path('snapshots/GMP-ICN-2026-11.json', CATALOG, origin='GMP'))

    def test_publisher_suppresses_excluded_restored_files_before_remote_tree_writes(self):
        calls = []

        class Reply:
            def __init__(self, value):
                self.value = value
            def __enter__(self):
                return self
            def __exit__(self, *_):
                return False
            def read(self):
                return json.dumps(self.value).encode()

        def fake_open(request, timeout):
            method, url = request.get_method(), request.full_url
            body = None if request.data is None else json.loads(request.data)
            calls.append((method, url, body))
            if method == 'GET' and '/git/ref/heads/' in url:
                return Reply({'object': {'sha': 'original-head'}})
            if method == 'GET' and '/git/commits/' in url:
                return Reply({'tree': {'sha': 'original-tree'}})
            if method == 'GET' and '/git/trees/' in url:
                return Reply({'tree': []})
            if method == 'POST' and url.endswith('/git/trees'):
                return Reply({'sha': 'filtered-tree'})
            if method == 'POST' and url.endswith('/git/commits'):
                return Reply({'sha': 'filtered-commit'})
            if method == 'PATCH' and '/git/refs/heads/' in url:
                return Reply({})
            raise AssertionError((method, url))

        with tempfile.TemporaryDirectory(prefix='sky-publish-filter-') as directory:
            root = pathlib.Path(directory)
            for relative in ['regions/east_asia.json', 'bundles/korea.json', 'shards/east_asia-0.json', 'snapshots/ICN-NRT-2027-01.json', 'errors/GMP-ICN-2026-11.json', 'snapshots/ICN-CDG-2027-01.json', 'snapshots/CDG-ICN-2027-01.json', 'regions/europe.json']:
                file = root / relative
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text('{}')
            with patch.dict(os.environ, {'GITHUB_TOKEN': 'test-placeholder', 'GITHUB_REPOSITORY': 'test/repo', 'SKY_ORIGIN': 'ICN'}), patch.object(sys, 'argv', ['publish.py', str(root)]), patch('urllib.request.urlopen', fake_open):
                runpy.run_path(str(HERE / 'publish.py'), run_name='__main__')
        trees = [body for method, url, body in calls if method == 'POST' and url.endswith('/git/trees')]
        self.assertEqual(len(trees), 1)
        self.assertEqual({entry['path'] for entry in trees[0]['tree']}, {'data/snapshots/ICN-CDG-2027-01.json', 'data/snapshots/CDG-ICN-2027-01.json', 'data/regions/europe.json'})


if __name__ == '__main__':
    unittest.main()
