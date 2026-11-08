"""Import one Telegram Desktop chat export (JSON + photos) into an enabled group.

By default performs a dry run. Re-running --apply is idempotent for receipt
numbers and original Telegram message IDs.
"""
import argparse
import json
import os
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

from core import Store, money, parse_payment_text
from ocr import recognize


IMAGE_SUFFIXES = {'.jpg', '.jpeg', '.png', '.webp'}
MAX_BYTES = 10 * 1024 * 1024


def flatten_text(value):
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return ''.join(item if isinstance(item, str) else str(item.get('text', ''))
                       for item in value if isinstance(item, (str, dict)))
    return ''


def safe_media_path(root, value):
    if not isinstance(value, str) or not value:
        return None
    candidate = (root / value).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError:
        raise ValueError('Путь к изображению выходит за каталог экспорта.')
    if candidate.suffix.lower() not in IMAGE_SUFFIXES:
        return None
    return candidate


def collect(export_dir, tz):
    root = Path(export_dir).resolve()
    data = json.loads((root / 'result.json').read_text(encoding='utf-8'))
    if not isinstance(data, dict) or not isinstance(data.get('messages'), list):
        raise ValueError('Нужен JSON-экспорт одного чата с полем messages, а не экспорт всех чатов.')
    entries, errors = [], []
    for msg in data['messages']:
        if not isinstance(msg, dict) or msg.get('type') != 'message' or not isinstance(msg.get('id'), int):
            continue
        try:
            media = safe_media_path(root, msg.get('photo') or msg.get('file'))
            if media is not None:
                if not media.is_file():
                    raise ValueError('Изображение не найдено в экспорте.')
                if media.stat().st_size > MAX_BYTES:
                    raise ValueError('Изображение больше 10 МБ.')
                receipt = recognize(media.read_bytes())
                entries.append((msg['id'], receipt.payer or str(msg.get('from') or 'Неизвестный отправитель'),
                                receipt.occurred_at, receipt.kopecks, 'receipt', receipt.number))
                continue
            text = flatten_text(msg.get('text'))
            if not text.strip():
                continue
            try:
                payer, amount = parse_payment_text(text, str(msg.get('from') or 'Неизвестный отправитель'))
            except ValueError:
                continue
            timestamp = msg.get('date_unixtime')
            if timestamp is not None:
                date = datetime.fromtimestamp(int(timestamp), tz).replace(tzinfo=None).isoformat()
            else:
                date = datetime.fromisoformat(msg['date']).replace(tzinfo=None).isoformat()
            entries.append((msg['id'], payer, date, amount, 'text', str(msg['id'])))
        except Exception as error:
            errors.append((msg['id'], str(error)))
    return entries, errors, len(data['messages'])


def import_entries(store, chat_id, entries):
    if not store.group_enabled(chat_id):
        raise ValueError('Сначала добавьте бота в нужную группу и включите её командой /enable.')
    added = skipped = 0
    for message_id, payer, date, amount, source, key in entries:
        if source == 'text':
            key = f'{chat_id}:{message_id}'
        result = store.group_add(chat_id, 0, payer, date, amount, source, key, True)
        added += result is not None
        skipped += result is None
    return added, skipped


def main():
    load_dotenv()
    parser = argparse.ArgumentParser(description='Проверить или импортировать историю одной группы Telegram.')
    parser.add_argument('export_dir', help='Каталог с result.json и фотографиями')
    parser.add_argument('--chat-id', type=int, required=True, help='ID уже включённой группы')
    parser.add_argument('--apply', action='store_true', help='Записать в SQLite после проверки')
    args = parser.parse_args()
    tz = ZoneInfo(os.environ.get('TZ', 'Asia/Tomsk'))
    entries, errors, message_count = collect(args.export_dir, tz)
    print(f'Сообщений в экспорте: {message_count}; распознано платежей: {len(entries)}; ошибок: {len(errors)}')
    print(f'Сумма распознанного до исключения дублей: {money(sum(entry[3] for entry in entries))}')
    for message_id, reason in errors[:20]:
        print(f'Ошибка сообщения {message_id}: {reason}')
    if len(errors) > 20:
        print(f'И ещё ошибок: {len(errors) - 20}')
    if not args.apply:
        print('Предварительная проверка: база не изменена. После сверки запустите с --apply.')
        return
    store = Store(os.environ.get('DB_PATH', 'data/receipts.sqlite3'))
    try:
        added, skipped = import_entries(store, args.chat_id, entries)
        print(f'Добавлено: {added}; дублей пропущено: {skipped}')
        print(store.group_balance(args.chat_id))
    finally:
        store.db.close()


if __name__ == '__main__':
    main()
