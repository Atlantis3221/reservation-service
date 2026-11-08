import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

from core import Receipt, Store
from import_history import collect, import_entries, safe_media_path


class ImportHistoryTests(unittest.TestCase):
    def test_export_and_repeat_import(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'photos').mkdir()
            (root / 'photos' / 'receipt.jpg').write_bytes(b'image')
            (root / 'result.json').write_text(json.dumps({'name': 'БРАТЬЯ СВЕТОВЫ', 'messages': [
                {'id': 10, 'type': 'message', 'from': 'Настя', 'date': '2026-11-02T12:00:00',
                 'photo': 'photos/receipt.jpg', 'text': 'За аренду света'},
                {'id': 11, 'type': 'message', 'from': 'Андрей', 'date': '2026-11-03T13:00:00',
                 'date_unixtime': '1793701200', 'text': 'Оплатил 500 ₽'},
                {'id': 12, 'type': 'message', 'from': 'Андрей', 'date': '2026-11-03T13:01:00',
                 'text': 'Аренда будет стоить 900 ₽'},
            ]}, ensure_ascii=False), encoding='utf-8')
            with patch('import_history.recognize', return_value=Receipt('1-120-464-699-798',
                    '2026-11-02T10:00:00', 80000, 'Успешно', 'Мария')):
                entries, errors, count = collect(root, ZoneInfo('Asia/Tomsk'))
            self.assertEqual((len(entries), len(errors), count), (2, 0, 3))
            store = Store(root / 'db.sqlite3')
            try:
                store.group_enable(-100123, '2026-11')
                self.assertEqual(import_entries(store, -100123, entries), (2, 0))
                self.assertEqual(import_entries(store, -100123, entries), (0, 2))
                self.assertEqual(store.group_total(-100123), 130000)
                self.assertIn('Мария: 800,00 ₽', store.group_report(-100123, '2026-11'))
                self.assertIn('Андрей: 500,00 ₽', store.group_report(-100123, '2026-11'))
            finally:
                store.db.close()

    def test_path_escape_and_invalid_export(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(ValueError):
                safe_media_path(root, '../secret.jpg')
            (root / 'result.json').write_text('{"chats":{"list":[]}}', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'одного чата'):
                collect(root, ZoneInfo('Asia/Tomsk'))


if __name__ == '__main__':
    unittest.main()
