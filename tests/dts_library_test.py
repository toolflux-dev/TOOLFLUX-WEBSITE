# Run: python -I tests/dts_library_test.py   (no Fusion needed)
import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'fusion'))
from dts_library import plan


class F:
    def __init__(self, name, t, fid=None):
        self.name, self.dateCreated, self.id = name, t, fid or name


class Plan(unittest.TestCase):
    def test_keeps_newest_ten_and_deletes_the_rest(self):
        files = [F('DTS-%02d part' % i, 1000 + i) for i in range(13)]
        kept, delete, held = plan(files, 10, set())
        self.assertEqual([f.name for f in kept][:2], ['DTS-12 part', 'DTS-11 part'])
        self.assertEqual(sorted(f.name for f in delete), ['DTS-00 part', 'DTS-01 part', 'DTS-02 part'])
        self.assertEqual(held, [])

    def test_never_touches_other_files(self):
        files = [F('DTS-%02d' % i, i) for i in range(12)] + [F('Roo fixture plate', 0), F('notes', -5)]
        kept, delete, held = plan(files, 10, set())
        self.assertTrue(all(f.name.startswith('DTS-') for f in kept + delete))
        self.assertEqual(len(delete), 2)

    def test_open_files_are_held_not_deleted(self):
        files = [F('DTS-%02d' % i, i) for i in range(12)]
        kept, delete, held = plan(files, 10, {'DTS-00'})
        self.assertEqual([f.name for f in held], ['DTS-00'])
        self.assertEqual([f.name for f in delete], ['DTS-01'])

    def test_under_the_limit_nothing_goes(self):
        kept, delete, held = plan([F('DTS-1', 1), F('DTS-2', 2)], 10, set())
        self.assertEqual((len(kept), delete, held), (2, [], []))


if __name__ == '__main__':
    unittest.main(verbosity=1)
