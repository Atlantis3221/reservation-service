import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from bot import audit_message, connectivity_watchdog, payment_text, ping, start, status
from core import Store


class BotHealthTests(unittest.IsolatedAsyncioTestCase):
    async def test_watchdog_restarts_only_after_three_consecutive_failures(self):
        get_me = AsyncMock(side_effect=TimeoutError())
        stop_running = Mock()
        context = SimpleNamespace(bot=get_me, bot_data={},
                                  application=SimpleNamespace(stop_running=stop_running))
        context.bot = SimpleNamespace(get_me=get_me)

        await connectivity_watchdog(context)
        await connectivity_watchdog(context)
        stop_running.assert_not_called()

        get_me.side_effect = None
        await connectivity_watchdog(context)
        self.assertEqual(context.bot_data['connectivity_failures'], 0)

        get_me.side_effect = TimeoutError()
        for _ in range(3):
            await connectivity_watchdog(context)
        stop_running.assert_called_once_with()

    async def test_private_ping_and_start_reply_without_allowlist(self):
        reply = AsyncMock()
        update = SimpleNamespace(effective_chat=SimpleNamespace(type='private'),
                                 effective_user=SimpleNamespace(id=42),
                                 message=SimpleNamespace(reply_text=reply))
        context = SimpleNamespace(bot_data={'allowed': set()})
        await ping(update, context)
        await start(update, context)
        self.assertEqual(reply.await_count, 2)
        self.assertIn('на связи', reply.await_args.args[0])

    async def test_status_replies_in_private_and_group_without_counting_payment(self):
        reply = AsyncMock()
        message = SimpleNamespace(text='статус', reply_text=reply)
        update = SimpleNamespace(update_id=123, effective_chat=SimpleNamespace(type='private'),
                                 effective_user=SimpleNamespace(id=42), message=message)
        with self.assertLogs('bot', level='INFO') as captured:
            await payment_text(update, SimpleNamespace(bot_data={'allowed': set()}))
        self.assertIn('Бот на связи', reply.await_args.args[0])
        self.assertIn('Запрос «статус»', captured.output[0])
        self.assertIn('Ответ на «статус» отправлен', captured.output[1])

        with tempfile.TemporaryDirectory() as directory:
            store = Store(str(Path(directory) / 'test.db'))
            try:
                store.group_enable(-1001, '2026-11')
                store.group_add(-1001, 7, 'Катерина', '2026-11-10T10:18:42', 160000,
                                'receipt', 'receipt-1', True)
                update.effective_chat = SimpleNamespace(type='supergroup', id=-1001)
                context = SimpleNamespace(bot_data={'store': store})
                for text in ('статус', 'Брат, статус', '@bratbuhbot статус'):
                    reply.reset_mock()
                    message.text = text
                    await payment_text(update, context)
                    self.assertIn('Учёт группы включён', reply.await_args.args[0])
                    self.assertIn('1 600,00 ₽', reply.await_args.args[0])
                reply.reset_mock()
                await status(update, context)
                self.assertIn('Бот на связи', reply.await_args.args[0])
                self.assertEqual(store.group_history_total(-1001), 160000)
            finally:
                store.db.close()

    async def test_incoming_message_log_contains_metadata_only(self):
        update = SimpleNamespace(update_id=987, effective_chat=SimpleNamespace(type='supergroup'),
                                 effective_message=SimpleNamespace(text='секретный текст 800 ₽'))
        with self.assertLogs('bot', level='INFO') as captured:
            await audit_message(update, None)
        line = captured.output[0]
        self.assertIn('update_id=987', line)
        self.assertIn('chat_type=supergroup', line)
        self.assertIn('kind=text', line)
        self.assertNotIn('секретный текст', line)

    async def test_named_balance_question_gets_answer_without_counting_payment(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(str(Path(directory) / 'test.db'))
            try:
                store.group_enable(-1001, '2026-11')
                store.group_add(-1001, 7, 'Катерина', '2026-11-10T10:18:42', 160000,
                                'receipt', 'receipt-1', True)
                reply = AsyncMock()
                message = SimpleNamespace(text='Брат бухгалтер не за весь период считает?',
                                          reply_text=reply)
                update = SimpleNamespace(effective_chat=SimpleNamespace(type='supergroup', id=-1001),
                                         effective_user=SimpleNamespace(id=7, first_name='Катерина', last_name=''),
                                         message=message)
                context = SimpleNamespace(bot_data={'store': store})
                await payment_text(update, context)
                self.assertIn('За всё время: 1 600,00 ₽', reply.await_args.args[0])
                self.assertEqual(store.group_history_total(-1001), 160000)

                reply.reset_mock()
                message.text = 'Сегодня Катя берет два света'
                await payment_text(update, context)
                reply.assert_not_awaited()
            finally:
                store.db.close()
