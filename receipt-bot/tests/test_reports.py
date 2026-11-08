import tempfile
import unittest
from datetime import datetime as RealDatetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from zoneinfo import ZoneInfo

from bot import reports
from core import Store


class ReportDeliveryTests(unittest.IsolatedAsyncioTestCase):
    async def test_failure_retry_restart_and_catchup(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(str(Path(directory) / 'test.db'))
            store.register(42, '2026-11')
            sender = AsyncMock(side_effect=RuntimeError('offline'))
            context = SimpleNamespace(bot_data={'store': store, 'tz': ZoneInfo('Asia/Tomsk'), 'allowed': {42}},
                                      bot=SimpleNamespace(send_message=sender))
            with patch('bot.datetime') as clock:
                clock.now.return_value = RealDatetime(2027, 1, 1, 0, 4)
                await reports(context)
                sender.assert_not_awaited()
                clock.now.return_value = RealDatetime(2027, 1, 1, 0, 5)
                await reports(context)
                self.assertEqual(store.due('2027-01')[0]['next_report'], '2026-11')
                sender.side_effect = None
                await reports(context)
                self.assertEqual(store.due('2027-01')[0]['next_report'], '2026-12')
                await reports(context)
                self.assertEqual(len(store.due('2027-01')), 0)
                await reports(context)
                self.assertEqual(sender.await_count, 3)
            store.db.close()

    async def test_group_report_delivery_and_cursor(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(str(Path(directory) / 'test.db'))
            store.group_enable(-1001, '2026-11')
            store.group_add(-1001, 5, 'Иван', '2026-11-04T10:00:00', 80000, 'text', 'msg:1', True)
            sender = AsyncMock()
            context = SimpleNamespace(bot_data={'store': store, 'tz': ZoneInfo('Asia/Tomsk'), 'allowed': set()},
                                      bot=SimpleNamespace(send_message=sender))
            with patch('bot.datetime') as clock:
                clock.now.return_value = RealDatetime(2026, 12, 1, 0, 5)
                await reports(context)
                self.assertEqual(sender.await_count, 1)
                args = sender.await_args.args
                self.assertEqual(args[0], -1001)
                self.assertIn('Иван: 800,00 ₽', args[1])
                await reports(context)
                self.assertEqual(sender.await_count, 1)
            store.db.close()
