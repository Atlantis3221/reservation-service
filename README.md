# reservation-service

Монорепа: Express API + Telegram-бот + React-фронт.

## Функционал

Сервис бронирования с интеграцией Telegram:
- Пользователь видит календарь со свободными датами и временем
- Выбирает удобный слот
- Нажимает кнопку "Забронировать"
- Перенаправляется в Telegram с предзаполненным сообщением о выбранной дате и времени

## Структура

```
reservation-service/
├── backend/          # Express + Telegraf (Telegram Bot API)
│   ├── src/
│   │   ├── index.ts           # точка входа
│   │   ├── types.ts           # типы (Business, TimeSlot, SlotStatus)
│   │   ├── routes/api.ts      # REST API расписания
│   │   └── services/
│   │       ├── bot.ts         # Telegram-бот (онбординг, команды)
│   │       ├── business.ts    # CRUD бизнесов, транслитерация, slug
│   │       ├── db.ts          # SQLite инициализация и миграции
│   │       ├── monitor.ts     # мониторинг: алерты, /health, ежедневный дайджест
│   │       └── schedule.ts    # логика расписания и слотов
│   ├── data/
│   │   └── reservations.db    # файл БД (создаётся автоматически)
│   ├── Dockerfile
│   └── package.json
├── frontend/         # React (Vite)
│   ├── src/
│   │   ├── App.tsx
│   │   └── components/
│   ├── vite.config.ts
│   └── package.json
├── landing/          # Статический лендинг (SEO)
│   ├── index.html           # исходник с {{BOT_URL}} плейсхолдером
│   └── dist/index.html      # собранный файл (после build:landing)
├── nginx/            # Nginx конфиги
│   ├── nginx.conf         # основной конфиг (HTTPS + проксирование)
│   └── nginx-init.conf    # временный конфиг (HTTP, для получения SSL)
├── scripts/
│   ├── deploy.sh              # единый деплой (backend + frontend + nginx)
│   ├── init-letsencrypt.sh    # первичное получение SSL-сертификата
│   ├── deploy-backend.sh     # (legacy) деплой бэкенда
│   └── deploy-frontend.sh    # (legacy) деплой фронтенда на GitHub Pages
├── docker-compose.yml         # backend + nginx + certbot
└── package.json               # npm workspaces root
```

## Быстрый старт

```bash
# Установка зависимостей (из корня)
npm install

# Создать .env файл для бэкенда
cp backend/.env.example backend/.env
# Вписать BOT_TOKEN и TELEGRAM_BOT_USERNAME в backend/.env

# Создать .env файл для фронтенда
cp frontend/.env.example frontend/.env

# Запуск бэкенда (dev, с --watch)
npm run dev:back

# Запуск фронта (Vite dev server)
npm run dev:front
```

## Переменные окружения

### Backend (`backend/.env`)

| Переменная              | Описание                                | Пример                          |
|-------------------------|-----------------------------------------|---------------------------------|
| `BOT_TOKEN`             | Токен Telegram-бота                     | `123456:ABC-DEF...`             |
| `TELEGRAM_BOT_USERNAME` | Username бота (без @)                   | `my_bot`                        |
| `FRONTEND_URL`          | URL фронтенда (для ссылок в боте)       | `http://192.168.0.23:5173`      |
| `PORT`                  | Порт сервера                            | `3000`                          |
| `DB_DIR`                | Путь к папке с БД (по умолчанию `./data`) | `/app/data`                   |
| `MONITOR_BOT_TOKEN`     | Токен отдельного Telegram-бота для мониторинга (алерты, `/health`, дайджест). Если не задан — мониторинг не активируется | `123456:ABC-DEF...` |

### Frontend (`frontend/.env`)

| Переменная                 | Описание                                | Пример                              |
|----------------------------|-----------------------------------------|--------------------------------------|
| `VITE_TELEGRAM_BOT_USERNAME` | Username бота для кнопки бронирования | `my_bot`                             |
| `VITE_API_URL`             | URL бэкенда (см. ниже)                  | `http://192.168.0.23:3000/api`       |

#### Как фронтенд находит бэкенд

- **Dev-режим без `VITE_API_URL`:** запросы идут на `/api`, Vite проксирует их на `http://localhost:3000` (настроено в `vite.config.ts`). Работает, если фронт и бэк на одной машине.
- **Dev-режим с `VITE_API_URL`:** запросы идут напрямую на указанный URL. Нужно, если тестируешь с телефона или другого устройства в локальной сети — задай `VITE_API_URL=http://<IP-бэкенда>:3000/api`.
- **Production:** фронтенд отдаётся nginx, запросы к `/api` проксируются на бэкенд. `VITE_API_URL` не нужен.

## Docker

```bash
# Поднять в контейнере
docker-compose up -d --build

# Остановить
docker-compose down
```

## База данных

SQLite (`better-sqlite3`), файл `data/reservations.db`. Создаётся автоматически при первом запуске. Миграции применяются автоматически.

### Таблица `businesses`

| Колонка             | Тип            | Описание                              |
|---------------------|----------------|---------------------------------------|
| `id`                | INTEGER, PK    | Автоинкремент                         |
| `slug`              | TEXT, UNIQUE   | URL-идентификатор бани                 |
| `name`              | TEXT           | Название бани                          |
| `owner_chat_id`     | TEXT           | Telegram chat ID владельца             |
| `telegram_username` | TEXT           | Telegram username владельца            |
| `created_at`        | TEXT           | Дата создания                          |

### Таблица `slots`

| Колонка        | Тип          | Описание                                  |
|----------------|--------------|-------------------------------------------|
| `business_id`  | INTEGER, PK, FK | Ссылка на `businesses.id`              |
| `date_key`     | TEXT, PK     | Дата в формате `YYYY-MM-DD`               |
| `hour`         | INTEGER, PK  | Час (0–23)                                |
| `status`       | TEXT         | `available` / `booked` / `blocked`        |
| `note`         | TEXT         | Комментарий (кем/чем занято)              |
| `client_name`  | TEXT         | Имя клиента                               |
| `client_phone` | TEXT         | Телефон клиента                           |

Первичный ключ: `(business_id, date_key, hour)`. Индекс по `(business_id, date_key)`.

Путь к файлу БД настраивается через переменную `DB_DIR` (по умолчанию `./data`).
В Docker данные сохраняются через volume `./data:/app/data`.

### Просмотр БД локально

```bash
sqlite3 -header -column backend/data/reservations.db "SELECT * FROM businesses;"
sqlite3 -header -column backend/data/reservations.db "SELECT * FROM slots;"
```

## API

### Мультитенант (по slug)

| Метод    | Путь                                          | Описание                        |
|----------|-----------------------------------------------|---------------------------------|
| `GET`    | `/api/business/:slug`                         | Информация о бане               |
| `GET`    | `/api/business/:slug/available-dates`         | Даты со свободными слотами      |
| `GET`    | `/api/business/:slug/day-slots?date=YYYY-MM-DD` | Все слоты на конкретную дату |

### Legacy (обратная совместимость, business_id=1)

| Метод    | Путь                              | Описание                              |
|----------|-----------------------------------|---------------------------------------|
| `GET`    | `/health`                         | Health check                          |
| `GET`    | `/api/available-dates`            | Даты со свободными слотами            |
| `GET`    | `/api/day-slots?date=YYYY-MM-DD`  | Все слоты на конкретную дату          |

## Мониторинг

При установленном `MONITOR_BOT_TOKEN` запускается отдельный Telegram-бот для мониторинга.

### Настройка

1. Создать бота через @BotFather (например `slotik_monitor_bot`)
2. Добавить `MONITOR_BOT_TOKEN=<токен>` в `backend/.env`
3. Написать боту `/start` — он запомнит chat ID и начнёт отправлять алерты

### Алерты об ошибках

Автоматически отправляются при:
- `uncaughtException` / `unhandledRejection`
- Ошибках Express (500)

Rate limiting: не более 1 алерта в 60 секунд. Стектрейс обрезается до 1000 символов.

### Команда `/health`

Возвращает: uptime, RAM (rss/heap), количество бизнесов и слотов.

### Ежедневный дайджест

Каждый день в 09:00 MSK отправляется отчёт: uptime, RAM, количество бизнесов, слотов, бронирований за 24 часа.

Если `MONITOR_BOT_TOKEN` не задан — мониторинг не активируется, сервис работает как раньше.

## Production

| | |
|---|---|
| **Домен** | `slotik.tech` |
| **IP сервера** | `185.255.132.151` |
| **URL** | `https://slotik.tech` |
| **API** | `https://slotik.tech/api/*` |

## Лендинг

Статический HTML-лендинг для SEO. Раздаётся nginx на `/`, React SPA — на `/:slug`.

```bash
# Сборка (подставляет ссылку на бота из backend/.env или переменной TELEGRAM_BOT_USERNAME)
npm run build:landing

# Или с явным указанием бота
TELEGRAM_BOT_USERNAME=my_bot npm run build:landing
```

Результат — `landing/dist/index.html`. При деплое nginx раздаёт этот файл на корневой URL.

## Деплой

Деплой автоматический через **GitHub Actions** — push в `main` запускает сборку и деплой на сервер.

### GitHub Secrets

Настраиваются в репозитории: **Settings → Secrets and variables → Actions → Repository secrets**.

| Secret | Описание | Пример |
|---|---|---|
| `SSH_PRIVATE_KEY` | Приватный SSH-ключ для подключения к серверу. GitHub Actions использует его для rsync и ssh-команд. Генерируется через `ssh-keygen`, публичная часть должна быть в `~/.ssh/authorized_keys` на сервере | содержимое файла `~/.ssh/deploy_key` |
| `DEPLOY_HOST` | IP-адрес сервера, на который деплоится проект | `185.255.132.151` |
| `DEPLOY_USER` | SSH-пользователь на сервере | `root` |
| `DEPLOY_PATH` | Абсолютный путь на сервере, куда кладётся проект | `/opt/reservation-service` |

### Подготовка сервера (один раз)

```bash
ssh root@185.255.132.151

# 1. Docker и docker-compose
apt-get update && apt-get install -y docker.io rsync
curl -SL -o /usr/local/bin/docker-compose \
  https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64
chmod +x /usr/local/bin/docker-compose
docker-compose version  # проверить

# 2. Создать директорию проекта
mkdir -p /opt/reservation-service

# 3. Создать backend/.env с секретами (не попадает в git)
mkdir -p /opt/reservation-service/backend
cat > /opt/reservation-service/backend/.env <<'EOF'
BOT_TOKEN=<токен бота>
PORT=3000
NODE_ENV=production
FRONTEND_URL=https://slotik.tech
EOF
```

### Первый деплой (инициализация SSL)

```bash
# 1. Push в master → GitHub Actions задеплоит проект
# 2. На сервере: получить SSL-сертификат
ssh root@185.255.132.151
cd /opt/reservation-service
bash scripts/init-letsencrypt.sh
```

### Ручной деплой (если нужно)

```bash
DEPLOY_HOST=185.255.132.151 DEPLOY_USER=root npm run deploy
```
