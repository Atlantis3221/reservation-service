"""Strict receipt parser and durable, per-user accounting (integer kopecks)."""
import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from pathlib import Path


@dataclass(frozen=True)
class Receipt:
    number: str
    occurred_at: str
    kopecks: int
    status: str
    payer: str = ''


def parse_receipt(text):
    text = text.replace('\xa0', ' ').replace('\u202f', ' ')
    text = text.replace('–', '-').replace('—', '-')
    if re.search(r'ожидает|ожидани[ея]|в обработке|неуспеш|отмен[её]н|отклон[её]н|отказ|ошибк[аи]|не выполнен', text, re.I):
        raise ValueError('Операция не завершена или отклонена.')
    if not re.search(r'квитанци|чек\s+(?:по|no|об)\s+операци|подтверждение\s+перевода', text, re.I):
        raise ValueError('Не найдено подтверждение банковской операции.')
    if not re.search(r'перевод|плат[её]ж|оплат[аы]', text, re.I):
        raise ValueError('Не найден признак перевода или платежа.')
    dates = re.findall(r'\b\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}(?::\d{2})?\b', text)
    months = {'января': 1, 'февраля': 2, 'марта': 3, 'апреля': 4, 'мая': 5, 'июня': 6,
              'июля': 7, 'августа': 8, 'сентября': 9, 'октября': 10, 'ноября': 11, 'декабря': 12}
    for day, word, year, clock in re.findall(r'\b(\d{1,2})\s+([А-Яа-яЁё]+)\s+(\d{4})\s+(\d{2}:\d{2}(?::\d{2})?)\b', text):
        if word.lower() in months:
            dates.append(f'{int(day):02d}.{months[word.lower()]:02d}.{year} {clock}')
    amount = r'(\d+(?:[ ]\d{3})*(?:[.,]\d{2})?)\s*(?:₽|Р|P|руб\.?)'
    totals = re.findall(r'Итого\s*:?\s*' + amount, text, re.I)
    if not totals:
        totals = re.findall(r'(?:Сумма\s+(?:перевода|операции|платежа)|К\s+переводу|К\s+оплате)\s*:?\s*' + amount, text, re.I)
    numbers = re.findall(r'Квитанция\s*(?:№|N[o°]?|#)\s*(\d+(?:\s*-\s*\d+){3,8})', text, re.I)
    if not numbers:
        operation_ids = re.findall(r'(?:Номер|№|ID)\s+(?:операции|транзакции|перевода)(?:\s+в\s+СБП)?\s*:?\s*([A-ZА-Я0-9]{20,50})\b', text, re.I)
        lookalikes = str.maketrans('АВЕКМНОРСТУХаеорсх', 'ABEKMHOPCTYXaeopcx')
        numbers = [value.translate(lookalikes).upper() for value in operation_ids]
    statuses = re.findall(r'Статус\s*:?\s*([^\n]+)', text, re.I)
    if not all(len(x) == 1 for x in (dates, totals, numbers)) or len(statuses) > 1:
        raise ValueError('Не удалось однозначно прочитать дату, сумму и номер операции.')
    status = statuses[0].strip().lower() if statuses else ''
    if status and status not in ('успешно', 'исполнено', 'выполнено', 'завершено'):
        raise ValueError('Статус операции не подтверждает успешное выполнение.')
    date = datetime.strptime(dates[0], '%d.%m.%Y %H:%M:%S' if dates[0].count(':') == 2 else '%d.%m.%Y %H:%M')
    money = int(Decimal(totals[0].replace(' ', '').replace(',', '.')) * 100)
    if money <= 0:
        raise ValueError('Сумма должна быть больше нуля.')
    payer = re.findall(r'^(?:ФИО\s+отправителя|Отправитель)\s*:?\s*([^\n]+)', text, re.I | re.M)
    if payer and payer[0].strip().lower() in ('', 'фио отправителя'):
        payer = []
    return Receipt(re.sub(r'\s', '', numbers[0]), date.isoformat(), money,
                   'Успешно' if status else 'Не указан: проверьте завершение операции', payer[0].strip() if payer else '')


def parse_payment_text(text, sender_name):
    """Only explicit payment statements count; arbitrary chat numbers do not."""
    text = text.strip().replace('\xa0', ' ').replace('\u202f', ' ')
    amount = r'(\d+(?:[ ]\d{3})*(?:[.,]\d{1,2})?)\s*(?:₽|руб(?:лей|ля|ль|\.)?)?'
    own = re.fullmatch(r'(?:оплатил[аи]?|заплатил[аи]?|перев[её]л|внес[лё]а?)\s+' + amount, text, re.I)
    named = re.fullmatch(r'([\wА-Яа-яЁё][\wА-Яа-яЁё .-]{0,79})\s*:\s*' + amount, text, re.I)
    if own:
        payer, raw = sender_name, own[1]
    elif named:
        payer, raw = named[1].strip(), named[2]
    else:
        raise ValueError('Формат платежа: «Оплатил 800 ₽» или «Имя: 800 ₽».')
    value = Decimal(raw.replace(' ', '').replace(',', '.'))
    kopecks = int(value * 100)
    if kopecks <= 0 or kopecks > 10_000_000_00:
        raise ValueError('Сумма должна быть от 0,01 до 10 000 000 ₽.')
    return payer, kopecks


def next_month(month):
    year, num = map(int, month.split('-'))
    return f'{year + (num == 12):04d}-{num % 12 + 1:02d}'


def money(value):
    return f'{value // 100:,}'.replace(',', ' ') + f',{value % 100:02d} ₽'


class Store:
    def __init__(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
          PRAGMA journal_mode=WAL;
          CREATE TABLE IF NOT EXISTS users(user_id INTEGER PRIMARY KEY, next_report TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS receipts(
            id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL,
            number TEXT NOT NULL, occurred_at TEXT NOT NULL, kopecks INTEGER NOT NULL CHECK(kopecks>0),
            status TEXT NOT NULL, sha256 TEXT NOT NULL, confirmed INTEGER NOT NULL DEFAULT 0,
            UNIQUE(user_id, number), UNIQUE(user_id, sha256));
          CREATE TABLE IF NOT EXISTS group_chats(chat_id INTEGER PRIMARY KEY, next_report TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS group_entries(
            id INTEGER PRIMARY KEY, chat_id INTEGER NOT NULL, uploader_id INTEGER NOT NULL,
            payer TEXT NOT NULL, occurred_at TEXT NOT NULL, kopecks INTEGER NOT NULL CHECK(kopecks>0),
            source TEXT NOT NULL, source_key TEXT NOT NULL, confirmed INTEGER NOT NULL DEFAULT 0,
            UNIQUE(chat_id, source, source_key));
        ''')

    def register(self, uid, month):
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO users VALUES (?,?)', (uid, month))

    def add(self, uid, receipt, digest):
        with self.db:
            row = self.db.execute('SELECT * FROM receipts WHERE user_id=? AND (number=? OR sha256=?)', (uid, receipt.number, digest)).fetchone()
            if row:
                return row, False
            cur = self.db.execute('INSERT INTO receipts(user_id,number,occurred_at,kopecks,status,sha256,confirmed) VALUES (?,?,?,?,?,?,1)',
                                  (uid, receipt.number, receipt.occurred_at, receipt.kopecks, receipt.status, digest))
            return self.db.execute('SELECT * FROM receipts WHERE id=?', (cur.lastrowid,)).fetchone(), True

    def confirm(self, uid, rid):
        with self.db:
            return self.db.execute('UPDATE receipts SET confirmed=1 WHERE id=? AND user_id=? AND confirmed=0', (rid, uid)).rowcount == 1

    def cancel(self, uid, rid):
        with self.db:
            return self.db.execute('DELETE FROM receipts WHERE id=? AND user_id=?', (rid, uid)).rowcount == 1

    def report(self, uid, month):
        datetime.strptime(month + '-01', '%Y-%m-%d')
        row = self.db.execute('SELECT COUNT(*) n, COALESCE(SUM(kopecks),0) total FROM receipts WHERE user_id=? AND confirmed=1 AND occurred_at>=? AND occurred_at<?',
                              (uid, month + '-01', next_month(month) + '-01')).fetchone()
        return f'За {month}\nПереводов: {row["n"]}\nИтого: {money(row["total"])}'

    def total(self, uid):
        return self.db.execute('SELECT COALESCE(SUM(kopecks),0) FROM receipts WHERE user_id=? AND confirmed=1',
                               (uid,)).fetchone()[0]

    def due(self, current_month):
        return self.db.execute('SELECT * FROM users WHERE next_report<?', (current_month,)).fetchall()

    def reported(self, uid, month):
        with self.db:
            self.db.execute('UPDATE users SET next_report=? WHERE user_id=?', (next_month(month), uid))

    def group_enable(self, chat_id, month):
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO group_chats VALUES (?,?)', (chat_id, month))

    def group_enabled(self, chat_id):
        return self.db.execute('SELECT 1 FROM group_chats WHERE chat_id=?', (chat_id,)).fetchone() is not None

    def group_add(self, chat_id, uploader_id, payer, occurred_at, kopecks, source, source_key, confirmed):
        with self.db:
            try:
                cur = self.db.execute('INSERT INTO group_entries(chat_id,uploader_id,payer,occurred_at,kopecks,source,source_key,confirmed) VALUES (?,?,?,?,?,?,?,?)',
                                      (chat_id, uploader_id, payer, occurred_at, kopecks, source, source_key, int(confirmed)))
            except sqlite3.IntegrityError:
                return None
            return cur.lastrowid

    def group_confirm(self, chat_id, uploader_id, entry_id, accept):
        with self.db:
            if accept:
                return self.db.execute('UPDATE group_entries SET confirmed=1 WHERE id=? AND chat_id=? AND uploader_id=? AND confirmed=0',
                                       (entry_id, chat_id, uploader_id)).rowcount == 1
            return self.db.execute('DELETE FROM group_entries WHERE id=? AND chat_id=? AND uploader_id=?',
                                   (entry_id, chat_id, uploader_id)).rowcount == 1

    def group_report(self, chat_id, month):
        datetime.strptime(month + '-01', '%Y-%m-%d')
        rows = self.db.execute('SELECT payer,COUNT(*) n,SUM(kopecks) total FROM group_entries WHERE chat_id=? AND confirmed=1 AND occurred_at>=? AND occurred_at<? GROUP BY payer ORDER BY total DESC,payer',
                               (chat_id, month + '-01', next_month(month) + '-01')).fetchall()
        count = sum(row['n'] for row in rows)
        total = sum(row['total'] for row in rows)
        by_payer = '\n'.join(f'• {row["payer"]}: {money(row["total"])} ({row["n"]})' for row in rows)
        return f'За {month}\nПлатежей: {count}\nИтого: {money(total)}' + ('\n\nПо плательщикам:\n' + by_payer if rows else '')

    def group_balance(self, chat_id):
        rows = self.db.execute('SELECT payer,COUNT(*) n,SUM(kopecks) total FROM group_entries WHERE chat_id=? AND confirmed=1 GROUP BY payer ORDER BY total DESC,payer',
                               (chat_id,)).fetchall()
        total = sum(row['total'] for row in rows)
        lines = '\n'.join(f'• {row["payer"]}: {money(row["total"])} ({row["n"]})' for row in rows)
        return f'Баланс группы за всё время: {money(total)}' + ('\n' + lines if lines else '')

    def group_total(self, chat_id):
        return self.db.execute('SELECT COALESCE(SUM(kopecks),0) FROM group_entries WHERE chat_id=? AND confirmed=1',
                               (chat_id,)).fetchone()[0]

    def group_due(self, current_month):
        return self.db.execute('SELECT * FROM group_chats WHERE next_report<?', (current_month,)).fetchall()

    def group_reported(self, chat_id, month):
        with self.db:
            self.db.execute('UPDATE group_chats SET next_report=? WHERE chat_id=?', (next_month(month), chat_id))
