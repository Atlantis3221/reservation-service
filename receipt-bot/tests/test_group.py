import tempfile
import unittest
from pathlib import Path

from core import Store, parse_payment_text


class GroupTests(unittest.TestCase):
    def test_reset_keeps_history_and_excludes_late_backfill(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / 'db.sqlite3')
            store = Store(path)
            try:
                store.group_enable(-1001, '2026-11')
                store.group_add(-1001, 1, 'Мария', '2026-11-02T10:00:00', 80000, 'receipt', 'R1', True)
                self.assertEqual(store.group_reset(-1001, 1, '2026-11-08T12:00:00'), 80000)
                self.assertEqual(store.group_total(-1001), 0)
                store.group_add(-1001, 1, 'Полина', '2026-11-03T10:00:00', 80000, 'receipt', 'R2', True)
                store.group_add(-1001, 1, 'Катерина', '2026-11-09T10:00:00', 80000, 'receipt', 'R3', True)
                self.assertEqual(store.group_total(-1001), 80000)
                self.assertEqual(store.group_history_total(-1001), 240000)
                self.assertIn('За месяц: 2 400,00 ₽', store.group_report(-1001, '2026-11'))
                self.assertIn('Сейчас в казне: 800,00 ₽', store.group_balance(-1001))
                store.db.close()
                store = Store(path)
                self.assertEqual(store.group_total(-1001), 80000)
                self.assertEqual(store.group_history_total(-1001), 240000)
            finally:
                store.db.close()

    def test_text_formats_and_noise(self):
        self.assertEqual(parse_payment_text('Оплатил 800 ₽', 'Иван'), ('Иван', 80000))
        self.assertEqual(parse_payment_text('Полина Ш.: 1 234,50 руб', 'Иван'), ('Полина Ш.', 123450))
        for text in ('Встреча в 18:00, возьмите 800 ₽', '800', 'Итого 800 ₽', 'Оплатил 0 ₽'):
            with self.subTest(text=text), self.assertRaises(ValueError):
                parse_payment_text(text, 'Иван')

    def test_chat_isolation_confirmation_and_report(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(str(Path(directory) / 'db.sqlite3'))
            try:
                store.group_enable(-1001, '2026-11')
                self.assertTrue(store.group_enabled(-1001))
                self.assertFalse(store.group_enabled(-1002))
                a = store.group_add(-1001, 1, 'Иван', '2026-11-02T10:00:00', 80000, 'text', '-1001:10', True)
                self.assertIsNotNone(a)
                self.assertIsNone(store.group_add(-1001, 1, 'Иван', '2026-11-02T10:00:00', 80000, 'text', '-1001:10', True))
                b = store.group_add(-1001, 2, 'Полина', '2026-11-03T11:00:00', 160000, 'receipt', 'R-123', True)
                self.assertFalse(store.group_confirm(-1001, 1, b, False))
                self.assertIn('Полина: 1 600,00 ₽', store.group_report(-1001, '2026-11'))
                self.assertIn('За месяц: 2 400,00 ₽', store.group_report(-1001, '2026-11'))
                self.assertIn('За всё время: 2 400,00 ₽', store.group_report(-1001, '2026-11'))
                self.assertIn('Сейчас в казне: 2 400,00 ₽', store.group_balance(-1001))
                self.assertEqual(store.group_total(-1001), 240000)
                self.assertIn('За месяц: 0,00 ₽', store.group_report(-1002, '2026-11'))
                self.assertIn('За месяц: 0,00 ₽', store.group_report(-1001, '2026-12'))
                self.assertIsNone(store.group_add(-1001, 3, 'Кто-то', '2026-11-03T11:00:00', 160000, 'receipt', 'R-123', True))
                self.assertTrue(store.group_confirm(-1001, 2, b, False))
                self.assertFalse(store.group_confirm(-1001, 2, b, False))
                self.assertIn('За месяц: 800,00 ₽', store.group_report(-1001, '2026-11'))
                self.assertTrue(store.group_confirm(-1001, 1, a, False))
                self.assertIn('За месяц: 0,00 ₽', store.group_report(-1001, '2026-11'))
                self.assertEqual(store.group_total(-1001), 0)
                self.assertEqual(len(store.group_due('2026-12')), 1)
                store.group_reported(-1001, '2026-11')
                self.assertEqual(len(store.group_due('2026-12')), 0)
            finally:
                store.db.close()
