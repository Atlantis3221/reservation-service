"""Opt-in integration tests using the user's local images and real Tesseract.

Run with RUN_RECEIPT_IMAGE_TESTS=1; images are intentionally not bundled.
"""
import hashlib
import os
import tempfile
import unittest
from io import BytesIO
from pathlib import Path

from PIL import Image

from core import Receipt, Store
from ocr import recognize


ROOT = Path(__file__).resolve().parents[1] / 'receipt-examples' / 'incoming'


@unittest.skipUnless(os.environ.get('RUN_RECEIPT_IMAGE_TESTS') == '1', 'Local image integration tests are opt-in')
class ReceiptImageTests(unittest.TestCase):
    def test_all_samples_and_duplicate_uploads(self):
        expected = {
            'photo_2026-11-08_18-07-57.jpg': Receipt('1-120-464-699-798', '2026-11-07T12:25:57', 80000, 'Успешно', 'Екатерина Фефилова'),
            'photo_2026-11-08_18-08-03.jpg': Receipt('1-112-467-670-921', '2026-11-07T12:24:44', 160000, 'Успешно', 'Анастасия Боева'),
            'photo_2026-11-08_18-08-08.jpg': Receipt('B63071212185521E0B10140011881102', '2026-11-03T15:12:20', 80000, 'Не указан: проверьте завершение операции', 'Севил Менгиевна С.'),
            'photo_2026-11-08_18-08-13.jpg': Receipt('A6306072559039030B10030011881102', '2026-11-02T10:26:00', 80000, 'Не указан: проверьте завершение операции', 'Полина Эдуардовна Ш.'),
        }
        with tempfile.TemporaryDirectory() as directory:
            store = Store(str(Path(directory) / 'test.sqlite3'))
            try:
                for name, receipt in expected.items():
                    with self.subTest(file=name):
                        data = (ROOT / name).read_bytes()
                        actual = recognize(data)
                        self.assertEqual(actual, receipt)
                        digest = hashlib.sha256(data).hexdigest()
                        row, new = store.add(1, actual, digest)
                        self.assertTrue(new)
                        self.assertTrue(row['confirmed'])
                        self.assertFalse(store.confirm(1, row['id']))
                        self.assertFalse(store.add(1, actual, digest)[1])
                        with Image.open(BytesIO(data)) as image:
                            output = BytesIO()
                            image.save(output, format='JPEG', quality=75)
                        recompressed = output.getvalue()
                        self.assertNotEqual(hashlib.sha256(recompressed).hexdigest(), digest)
                        self.assertEqual(recognize(recompressed), receipt)
                        self.assertFalse(store.add(1, receipt, hashlib.sha256(recompressed).hexdigest())[1])
                self.assertEqual(store.report(1, '2026-11'), 'За 2026-11\nПереводов: 4\nИтого: 4 000,00 ₽')
                self.assertIn('Переводов: 0', store.report(1, '2026-10'))
                for name in ['photo_2026-11-08_18-08-17.jpg', 'photo_2026-11-08_18-09-45.jpg']:
                    with self.subTest(rejected=name), self.assertRaises(ValueError):
                        recognize((ROOT / name).read_bytes())
                self.assertEqual((ROOT / 'photo_2026-11-08_18-08-17.jpg').read_bytes(),
                                 (ROOT / 'photo_2026-11-08_18-09-45.jpg').read_bytes())
            finally:
                store.db.close()
