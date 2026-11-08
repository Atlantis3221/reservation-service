import tempfile
import unittest
from pathlib import Path

from core import Receipt, Store, next_month, parse_receipt

SAMPLE = '''Т-БАНК
Квитанция
07.11.2026 12:25:57
Итого 800 ₽
Перевод По номеру телефона
Статус Успешно
Сумма 800 ₽
Комиссия 0 ₽
Квитанция № 1-120-464-699-798
'''


class ParserTests(unittest.TestCase):
    def test_sample(self):
        self.assertEqual(parse_receipt(SAMPLE), Receipt('1-120-464-699-798', '2026-11-07T12:25:57', 80000, 'Успешно'))

    def test_decimal_and_total_not_amount(self):
        self.assertEqual(parse_receipt(SAMPLE.replace('Итого 800 ₽', 'Итого\n1 234,56 ₽')).kopecks, 123456)

    def test_bad_receipts(self):
        for text in [SAMPLE.replace('Итого', 'Всего'), SAMPLE.replace('Успешно', 'Неуспешно'),
                     SAMPLE.replace('Успешно', 'В обработке'), SAMPLE.replace('07.11', '31.11'),
                     SAMPLE + '\nИтого 20 ₽', SAMPLE.replace('Квитанция №', 'Номер')]:
            with self.subTest(text=text), self.assertRaises(ValueError):
                parse_receipt(text)

    def test_generic_bank_receipt_without_status(self):
        text = ('Чек по операции\n02.11.2026 10:26:00\nПеревод\n'
                'Сумма операции\n1 234,56 ₽\nНомер операции\nAB12345678901234567890')
        self.assertEqual(parse_receipt(text), Receipt('AB12345678901234567890',
            '2026-11-02T10:26:00', 123456, 'Не указан: проверьте завершение операции'))
        with self.assertRaises(ValueError):
            parse_receipt(text + '\nОперация в обработке')


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.tmp.name) / 'db.sqlite3')
        self.store = Store(self.path)

    def tearDown(self):
        self.store.db.close()
        self.tmp.cleanup()

    def test_duplicates_auto_add_and_isolation(self):
        receipt = parse_receipt(SAMPLE)
        row, new = self.store.add(1, receipt, 'hash1')
        self.assertTrue(new)
        self.assertIn('Переводов: 1', self.store.report(1, '2026-11'))
        self.assertEqual(self.store.total(1), 80000)
        self.assertFalse(self.store.confirm(2, row['id']))
        self.assertFalse(self.store.confirm(1, row['id']))
        self.assertFalse(self.store.add(1, receipt, 'different image')[1])
        self.assertFalse(self.store.add(1, Receipt('other', receipt.occurred_at, 80000, receipt.status), 'hash1')[1])
        self.assertTrue(self.store.add(2, receipt, 'hash1')[1])
        self.assertIn('800,00 ₽', self.store.report(1, '2026-11'))
        self.assertIn('Переводов: 1', self.store.report(2, '2026-11'))
        self.assertIn('Переводов: 0', self.store.report(1, '2026-12'))

    def test_restart_and_report_cursor(self):
        self.store.register(1, '2026-11')
        self.assertEqual(len(self.store.due('2026-11')), 0)
        self.assertEqual(len(self.store.due('2027-01')), 1)
        self.store.reported(1, '2026-11')
        self.store.db.close()
        self.store = Store(self.path)
        self.store.register(1, '2027-01')
        self.assertEqual(self.store.due('2027-01')[0]['next_report'], '2026-12')
        self.store.reported(1, '2026-12')
        self.assertEqual(len(self.store.due('2027-01')), 0)

    def test_cancel(self):
        row, _ = self.store.add(1, parse_receipt(SAMPLE), 'a')
        self.assertFalse(self.store.cancel(2, row['id']))
        self.assertFalse(self.store.add(1, parse_receipt(SAMPLE), 'a')[1])
        self.assertTrue(self.store.cancel(1, row['id']))
        self.assertEqual(self.store.total(1), 0)
        self.assertIn('Итого: 0,00 ₽', self.store.report(1, '2026-11'))
        self.assertFalse(self.store.cancel(1, row['id']))
        self.assertTrue(self.store.add(1, parse_receipt(SAMPLE), 'a')[1])

    def test_month_boundaries(self):
        self.assertEqual(next_month('2026-12'), '2027-01')
        for i, date in enumerate(['2026-11-30T23:59:59', '2026-12-01T00:00:00']):
            row, _ = self.store.add(1, Receipt(str(i), date, 125, 'Успешно'), str(i))
            self.store.confirm(1, row['id'])
        self.assertIn('1,25 ₽', self.store.report(1, '2026-11'))
        self.assertIn('Переводов: 1', self.store.report(1, '2026-12'))


if __name__ == '__main__':
    unittest.main()
