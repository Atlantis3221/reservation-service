import asyncio
import hashlib
import logging
import os
import re
from datetime import datetime
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from telegram import BotCommand, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CallbackQueryHandler, CommandHandler, MessageHandler, filters

from core import Store, money, parse_backfill, parse_payment_text
from ocr import recognize

log = logging.getLogger(__name__)
MAX_BYTES = 10 * 1024 * 1024
INFO_TEXT = (
    'БРАТ БУХГАЛТЕР — учёт платежей в группе. Отправьте фото квитанции или файл PNG/JPEG/WebP: '
    'бот запишет перевод и покажет остаток казны. Ошибочную запись можно убрать кнопкой «Отменить».\n\n'
    'Команды:\n'
    '/info — эта справка\n'
    '/month — отчёт за текущий месяц\n'
    '/month 2026-11 — отчёт за выбранный месяц\n'
    '/balance — казна сейчас и сумма за всё время\n'
    '/enable — включить учёт в группе\n'
    '/chatid — ID группы для импорта истории\n'
    '/reset — обнулить казну с сохранением истории; только администратор группы\n'
    '/backfill — добавить проверенные старые платежи; формат описан ниже\n'
    '/start и /help — эта же справка\n\n'
    'Платёж текстом: «Оплатил 800 ₽» (от своего имени) или «Имя: 800 ₽». '
    'Для /backfill укажите с новой строки: ГГГГ-ММ-ДД ЧЧ:ММ:СС | Имя | Сумма | receipt:номер. '
    'Если номера нет, используйте manual:уникальный_ключ. Повторный импорт пропускает дубли.\n\n'
    'Отчёт за закрытый месяц приходит первого числа после 00:05 по времени Томска. '
    'Дата платежа по квитанции берётся из самой квитанции.'
)
BOT_COMMANDS = [
    BotCommand('start', 'Начать работу и открыть справку'),
    BotCommand('info', 'Все команды и правила учёта'),
    BotCommand('help', 'Справка по боту'),
    BotCommand('month', 'Отчёт за месяц'),
    BotCommand('balance', 'Казна сейчас и за всё время'),
    BotCommand('enable', 'Включить учёт в группе'),
    BotCommand('chatid', 'Показать ID группы'),
    BotCommand('reset', 'Обнулить казну, сохранив историю'),
    BotCommand('backfill', 'Загрузить старые платежи'),
]


def allowed(update, context):
    if update.effective_chat.type == 'private':
        return update.effective_user.id in context.bot_data['allowed']
    return context.bot_data['store'].group_enabled(update.effective_chat.id)


def group_chat(update):
    return update.effective_chat.type in ('group', 'supergroup')


def sender_name(user):
    return ' '.join(part for part in (user.first_name, user.last_name) if part).strip() or str(user.id)


def month_now(context):
    return datetime.now(context.bot_data['tz']).strftime('%Y-%m')


def register(update, context):
    if not group_chat(update):
        context.bot_data['store'].register(update.effective_user.id, month_now(context))


async def enable(update, context):
    if not group_chat(update):
        await update.message.reply_text('Команда /enable нужна в групповом чате.')
        return
    member = await context.bot.get_chat_member(update.effective_chat.id, update.effective_user.id)
    if member.status not in ('creator', 'administrator', 'member'):
        await update.message.reply_text('Включить учёт может участник группы.')
        return
    context.bot_data['store'].group_enable(update.effective_chat.id, month_now(context))
    await update.message.reply_text('Учёт включён. Квитанции добавляются сразу; отправивший может отменить запись кнопкой. '
        'Текст: «Оплатил 800 ₽» (от своего имени) или «Имя: 800 ₽». /month — отчёт по группе.')


async def start(update, context):
    if not group_chat(update) and not allowed(update, context):
        return
    register(update, context)
    await update.message.reply_text(INFO_TEXT)


async def month(update, context):
    if not allowed(update, context):
        return
    register(update, context)
    value = context.args[0] if context.args else month_now(context)
    try:
        if len(context.args) > 1 or not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', value) or not 2000 <= int(value[:4]) <= 9998:
            raise ValueError()
        store = context.bot_data['store']
        result = store.group_report(update.effective_chat.id, value) if group_chat(update) else store.report(update.effective_user.id, value)
    except ValueError:
        result = 'Формат: /month или /month 2026-11'
    await update.message.reply_text(result)


async def balance(update, context):
    if not allowed(update, context):
        return
    store = context.bot_data['store']
    if group_chat(update):
        result = store.group_balance(update.effective_chat.id)
    else:
        row = store.db.execute('SELECT COALESCE(SUM(kopecks),0) total FROM receipts WHERE user_id=? AND confirmed=1',
                               (update.effective_user.id,)).fetchone()
        result = 'Баланс за всё время: ' + money(row['total'])
    await update.message.reply_text(result)


async def chatid(update, context):
    if not group_chat(update) or not allowed(update, context):
        return
    await update.message.reply_text(f'ID этой группы: {update.effective_chat.id}')


async def reset(update, context):
    if not group_chat(update) or not allowed(update, context):
        return
    member = await context.bot.get_chat_member(update.effective_chat.id, update.effective_user.id)
    if member.status not in ('creator', 'administrator'):
        await update.message.reply_text('Обнулить казну может администратор группы.')
        return
    store = context.bot_data['store']
    timestamp = datetime.now(context.bot_data['tz']).replace(tzinfo=None).isoformat(timespec='seconds')
    previous = store.group_reset(update.effective_chat.id, update.effective_user.id, timestamp)
    await update.message.reply_text(f'Казна обнулена. До обнуления: {money(previous)}. Сейчас в казне: 0,00 ₽. '
        f'История платежей сохранена, за всё время: {money(store.group_history_total(update.effective_chat.id))}.')


async def backfill(update, context):
    if not group_chat(update) or not allowed(update, context):
        return
    try:
        entries = parse_backfill(update.message.text)
        today = datetime.now(context.bot_data['tz']).date()
        if any(datetime.fromisoformat(entry[1]).date() > today for entry in entries):
            raise ValueError('Дата исторического платежа находится в будущем.')
    except ValueError as error:
        await update.message.reply_text(str(error))
        return
    store = context.bot_data['store']
    added = 0
    for payer, occurred, kopecks, source, key in entries:
        added += store.group_add(update.effective_chat.id, update.effective_user.id,
                                 payer, occurred, kopecks, source, key, True) is not None
    await update.message.reply_text(
        f'История загружена: {added}; дублей пропущено: {len(entries) - added}.\n'
        + store.group_report(update.effective_chat.id, month_now(context)))


async def photo(update, context):
    if not allowed(update, context):
        return
    register(update, context)
    attachment = update.message.photo[-1] if update.message.photo else update.message.document
    if attachment.file_size is None or attachment.file_size > MAX_BYTES:
        await update.message.reply_text('Максимальный размер изображения — 10 МБ.')
        return
    try:
        file = await attachment.get_file()
        data = bytes(await file.download_as_bytearray())
        if len(data) > MAX_BYTES:
            raise ValueError('Максимальный размер изображения — 10 МБ.')
        receipt = await asyncio.to_thread(recognize, data)
        if datetime.fromisoformat(receipt.occurred_at).date() > datetime.now(context.bot_data['tz']).date():
            raise ValueError('Дата квитанции находится в будущем. Проверьте скриншот.')
        store = context.bot_data['store']
        if group_chat(update):
            payer = receipt.payer or sender_name(update.effective_user)
            rid = store.group_add(update.effective_chat.id, update.effective_user.id, payer,
                receipt.occurred_at, receipt.kopecks, 'receipt', receipt.number, True)
            if rid is None:
                await update.message.reply_text('Эта квитанция уже загружена в группу.')
                return
        else:
            row, new = store.add(update.effective_user.id, receipt, hashlib.sha256(data).hexdigest())
            if not new and not row['confirmed']:
                new = store.confirm(update.effective_user.id, row['id'])
    except ValueError as error:
        await update.message.reply_text(str(error))
        return
    except Exception as error:
        log.warning('Image processing failed: %s', type(error).__name__)
        await update.message.reply_text('Не удалось обработать изображение. Попробуйте файл PNG/JPEG или повторите позже.')
        return
    if not group_chat(update) and not new:
        await update.message.reply_text('Эта квитанция уже учтена. Повторно не добавлена.')
        return
    prefix = 'g:' if group_chat(update) else ''
    key = rid if group_chat(update) else row['id']
    treasury = store.group_total(update.effective_chat.id) if group_chat(update) else store.total(update.effective_user.id)
    keyboard = InlineKeyboardMarkup([[InlineKeyboardButton('Отменить', callback_data=f'{prefix}no:{key}')]])
    await update.message.reply_text(f'Перевод добавлен. Проверьте данные:\nПлательщик: {receipt.payer or sender_name(update.effective_user)}\n'
        f'Дата: {receipt.occurred_at.replace("T", " ")}\nИтого: {money(receipt.kopecks)}\n'
        f'Статус: {receipt.status}\nКвитанция № {receipt.number}\n'
        f'Денег в казне: {money(treasury)}\n'
        'Если распознано неверно, нажмите «Отменить».', reply_markup=keyboard)


async def payment_text(update, context):
    if not group_chat(update) or not allowed(update, context):
        return
    try:
        payer, amount = parse_payment_text(update.message.text, sender_name(update.effective_user))
    except ValueError:
        return
    occurred = update.message.date.astimezone(context.bot_data['tz']).replace(tzinfo=None).isoformat()
    key = f'{update.effective_chat.id}:{update.message.message_id}'
    rid = context.bot_data['store'].group_add(update.effective_chat.id, update.effective_user.id,
        payer, occurred, amount, 'text', key, True)
    if rid:
        keyboard = InlineKeyboardMarkup([[InlineKeyboardButton('Отменить', callback_data=f'g:no:{rid}')]])
        treasury = context.bot_data['store'].group_total(update.effective_chat.id)
        await update.message.reply_text(f'Записано: {payer} — {money(amount)}.\nДенег в казне: {money(treasury)}\n/month — отчёт.', reply_markup=keyboard)


async def confirm(update, context):
    query = update.callback_query
    await query.answer()
    if not allowed(update, context):
        return
    parts = query.data.split(':')
    if parts[0] == 'g':
        if not group_chat(update):
            return
        _, action, rid = parts
        result = context.bot_data['store'].group_confirm(update.effective_chat.id,
            update.effective_user.id, int(rid), action == 'yes')
        if result and action == 'no':
            treasury = context.bot_data['store'].group_total(update.effective_chat.id)
            text = f'Платёж отменён.\nДенег в казне: {money(treasury)}'
        else:
            text = 'Перевод добавлен.' if result else 'Отменить может только отправивший сообщение; запись уже обработана или отменена.'
        await query.edit_message_text(text)
        return
    action, rid = parts
    store = context.bot_data['store']
    if action == 'yes':
        added = store.confirm(update.effective_user.id, int(rid))
        text = 'Перевод добавлен. /month — отчёт.' if added else 'Квитанция уже обработана или отменена.'
    else:
        removed = store.cancel(update.effective_user.id, int(rid))
        text = f'Платёж отменён.\nДенег в казне: {money(store.total(update.effective_user.id))}' if removed else 'Запись уже отменена.'
    await query.edit_message_text(text)


async def reports(context):
    now = datetime.now(context.bot_data['tz'])
    if now.day == 1 and now.hour == 0 and now.minute < 5:
        return
    store = context.bot_data['store']
    for user in store.due(now.strftime('%Y-%m')):
        if user['user_id'] not in context.bot_data['allowed']:
            continue
        period = user['next_report']
        try:
            await context.bot.send_message(user['user_id'], 'Месячный отчёт\n' + store.report(user['user_id'], period)
                + '\nПо подтверждённым квитанциям на момент отправки. Актуальный итог: /month ' + period)
            store.reported(user['user_id'], period)
        except Exception as error:
            log.warning('Report delivery failed: %s', type(error).__name__)
    for chat in store.group_due(now.strftime('%Y-%m')):
        period = chat['next_report']
        try:
            await context.bot.send_message(chat['chat_id'], 'Месячный отчёт группы\n' + store.group_report(chat['chat_id'], period))
            store.group_reported(chat['chat_id'], period)
        except Exception as error:
            log.warning('Group report delivery failed: %s', type(error).__name__)


async def on_error(update, context):
    # Do not log tokens, message contents or receipt details.
    log.error('Update failed: %s', type(context.error).__name__)


async def on_started(app):
    me = await app.bot.get_me()
    await app.bot.set_my_commands(BOT_COMMANDS)
    print(f'Бот @{me.username} подключён к Telegram. Для группы: добавьте бота и отправьте /enable.', flush=True)


def main():
    load_dotenv()
    token = os.environ.get('BOT_TOKEN', '')
    ids = {int(x.strip()) for x in os.environ.get('ALLOWED_USER_IDS', '').split(',') if x.strip()}
    if not token or token.startswith('replace_'):
        raise SystemExit('Заполните BOT_TOKEN в .env')
    tz = ZoneInfo(os.environ.get('TZ', 'Asia/Tomsk'))
    store = Store(os.environ.get('DB_PATH', 'data/receipts.sqlite3'))
    builder = (Application.builder().token(token)
               .connect_timeout(30).get_updates_connect_timeout(30))
    proxy = os.environ.get('TELEGRAM_PROXY_URL')
    if proxy:
        builder = builder.proxy(proxy).get_updates_proxy(proxy)
    app = builder.post_init(on_started).build()
    app.bot_data.update(store=store, tz=tz, allowed=ids)
    app.add_handler(CommandHandler(['start', 'help', 'info'], start))
    app.add_handler(CommandHandler('month', month))
    app.add_handler(CommandHandler('balance', balance))
    app.add_handler(CommandHandler('chatid', chatid))
    app.add_handler(CommandHandler('enable', enable))
    app.add_handler(CommandHandler('reset', reset))
    app.add_handler(CommandHandler('backfill', backfill))
    app.add_handler(CallbackQueryHandler(confirm, pattern=r'^(?:g:)?(?:yes|no):\d+$'))
    app.add_handler(MessageHandler(filters.PHOTO | filters.Document.IMAGE, photo))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, payment_text))
    app.add_error_handler(on_error)
    app.job_queue.run_repeating(reports, interval=60, first=5)
    try:
        app.run_polling(allowed_updates=['message', 'callback_query'])
    finally:
        store.db.close()


if __name__ == '__main__':
    logging.basicConfig(level=logging.WARNING)
    main()
