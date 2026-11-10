"""Read-only production check for the GitHub Actions status summary."""

import os
import re
import shlex
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


REMOTE_SCRIPT = r'''
set -u
cd "$1" || exit 20
docker info >/dev/null 2>&1 || exit 21
docker-compose version >/dev/null 2>&1 || exit 21
for service in bot xray; do
  container="$(docker-compose -f receipt-bot/compose.yaml ps -a -q "$service" 2>/dev/null)"
  if [ -z "$container" ]; then
    printf 'CONTAINER|%s|missing|0|false\n' "$service"
  else
    docker inspect -f "CONTAINER|$service|{{.State.Status}}|{{.RestartCount}}|{{.State.OOMKilled}}" "$container" \
      || printf 'CONTAINER|%s|unknown|0|false\n' "$service"
  fi
done
if docker-compose -f receipt-bot/compose.yaml ps -q bot | grep -q .; then
  docker-compose -f receipt-bot/compose.yaml exec -T bot python -c '
import asyncio, os, time
from telegram import Bot
from telegram.request import HTTPXRequest
start = time.monotonic()
try:
    request = HTTPXRequest(connect_timeout=30, read_timeout=30, proxy=os.environ["TELEGRAM_PROXY_URL"])
    me = asyncio.run(Bot(os.environ["BOT_TOKEN"], request=request).get_me())
    print("TELEGRAM|ok|%s|%.1f" % (me.username, time.monotonic() - start))
except Exception as exc:
    print("TELEGRAM|error|%s|0" % type(exc).__name__)
  ' 2>/dev/null || printf 'TELEGRAM|error|probe_failed|0\n'
else
  printf 'TELEGRAM|error|bot_stopped|0\n'
fi
printf '__LOGS__\n'
docker-compose -f receipt-bot/compose.yaml logs -t --since=1h --tail=200 bot xray 2>/dev/null || true
'''

EXCEPTION = re.compile(r'\b([A-Z][A-Za-z]*(?:Error|Exception|Timeout|TimedOut))\b')
TIMESTAMP = re.compile(r'20\d\d-\d\d-\d\d[T ]\d\d:\d\d:\d\d')


def recent_error(logs):
    """Return only the exception type and time; logs can contain private chat data."""
    latest = None
    for line in logs.splitlines():
        match = EXCEPTION.search(line)
        if match:
            when = TIMESTAMP.search(line)
            latest = (match.group(1), when.group(0) if when else 'время неизвестно')
        elif 'ERROR' in line or 'Traceback' in line:
            when = TIMESTAMP.search(line)
            latest = ('ошибка в журнале', when.group(0) if when else 'время неизвестно')
    return latest


def run_probe():
    if os.environ.get('SSH_SETUP_OUTCOME') != 'success':
        return None, 'SSH: не удалось подключиться к серверу или проверить его ключ'
    host = os.environ['DEPLOY_HOST']
    user = os.environ['DEPLOY_USER']
    path = os.environ['DEPLOY_PATH']
    command = ['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
               f'{user}@{host}', f'bash -s -- {shlex.quote(path)}']
    try:
        result = subprocess.run(command, input=REMOTE_SCRIPT, text=True,
                                capture_output=True, timeout=90, check=False)
    except subprocess.TimeoutExpired:
        return None, 'SSH: сервер не ответил за 90 секунд'
    if result.returncode:
        if result.returncode == 21:
            return None, 'Docker или docker-compose недоступен на сервере'
        return None, f'Проверка сервера завершилась с кодом {result.returncode}'
    return result.stdout, None


def build_summary(output, failure):
    now = datetime.now(ZoneInfo('Asia/Tomsk')).strftime('%d.%m.%Y %H:%M')
    lines = ['# БРАТ БУХГАЛТЕР — состояние', '', f'Проверено: {now} (Томск).', '']
    if failure:
        lines += ['🔴 **Проверка не прошла.**', '', failure,
                  '', 'Состояние контейнеров неизвестно, пока сервер недоступен.']
        return '\n'.join(lines) + '\n', False

    metadata, _, logs = output.partition('__LOGS__\n')
    containers = {}
    telegram = None
    for line in metadata.splitlines():
        parts = line.split('|')
        if len(parts) == 5 and parts[0] == 'CONTAINER' and parts[1] in ('bot', 'xray'):
            containers[parts[1]] = parts[2:]
        elif len(parts) == 4 and parts[0] == 'TELEGRAM':
            telegram = parts[1:]
    ok = all(containers.get(name, ['missing'])[0] == 'running' for name in ('bot', 'xray'))
    ok = ok and telegram is not None and telegram[0] == 'ok'
    lines += ['🟢 **Бот доступен.**' if ok else '🔴 **Бот недоступен или проверка неполная.**', '',
              '| Компонент | Состояние | Подробности |', '| --- | --- | --- |']
    for name, label in (('bot', 'Бот'), ('xray', 'Xray')):
        state, restarts, oom = containers.get(name, ['unknown', '0', 'false'])
        icon = '🟢' if state == 'running' else '🔴'
        lines.append(f'| {label} | {icon} `{state}` | Перезапусков: {restarts}; OOM: {oom} |')
    if telegram and telegram[0] == 'ok':
        lines.append(f'| Telegram API | 🟢 отвечает | @{telegram[1]}, {telegram[2]} с |')
    else:
        reason = telegram[1] if telegram else 'нет результата'
        lines.append(f'| Telegram API | 🔴 не отвечает | `{reason}` |')
    error = recent_error(logs)
    lines += ['', 'Последняя ошибка за час: ' +
              (f'`{error[0]}` ({error[1]})' if error else 'не найдена') + '.',
              '', 'Проверка читает состояние и журналы, не перезапускает контейнеры.']
    return '\n'.join(lines) + '\n', ok


def main():
    output, failure = run_probe()
    summary, ok = build_summary(output, failure)
    summary_path = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary_path:
        with Path(summary_path).open('a', encoding='utf-8') as file:
            file.write(summary)
    print(summary)
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
