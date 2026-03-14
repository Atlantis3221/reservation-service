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
│   │   ├── types.ts           # типы
│   │   ├── routes/api.ts      # REST API расписания
│   │   └── services/
│   │       ├── bot.ts         # Telegram-бот
│   │       ├── db.ts          # SQLite инициализация и миграции
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
├── scripts/
│   ├── deploy-backend.sh     # деплой на финский сервер
│   └── deploy-frontend.sh    # деплой на GitHub Pages
├── docker-compose.yml
└── package.json              # npm workspaces root
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
| `ADMIN_CHAT_ID`         | Chat ID администратора                  | `123456789`                     |
| `FRONTEND_URL`          | URL фронтенда (для ссылок в боте)       | `http://192.168.0.23:5173`      |
| `PORT`                  | Порт сервера                            | `3000`                          |
| `DB_DIR`                | Путь к папке с БД (по умолчанию `./data`) | `/app/data`                   |

### Frontend (`frontend/.env`)

| Переменная                 | Описание                                | Пример                              |
|----------------------------|-----------------------------------------|--------------------------------------|
| `VITE_TELEGRAM_BOT_USERNAME` | Username бота для кнопки бронирования | `my_bot`                             |
| `VITE_API_URL`             | URL бэкенда (см. ниже)                  | `http://192.168.0.23:3000/api`       |

#### Как фронтенд находит бэкенд

- **Dev-режим без `VITE_API_URL`:** запросы идут на `/api`, Vite проксирует их на `http://localhost:3000` (настроено в `vite.config.ts`). Работает, если фронт и бэк на одной машине.
- **Dev-режим с `VITE_API_URL`:** запросы идут напрямую на указанный URL. Нужно, если тестируешь с телефона или другого устройства в локальной сети — задай `VITE_API_URL=http://<IP-бэкенда>:3000/api`.
- **Production:** если `VITE_API_URL` не задан, используется захардкоженный URL из кода.

## Docker

```bash
# Поднять бэкенд в контейнере
docker-compose up -d --build

# Остановить
docker-compose down
```

## База данных

SQLite (`better-sqlite3`), файл `data/reservations.db`. Создаётся автоматически при первом запуске.

### Таблица `slots`

| Колонка        | Тип       | Описание                                  |
|----------------|-----------|-------------------------------------------|
| `date_key`     | TEXT, PK  | Дата в формате `YYYY-MM-DD`               |
| `hour`         | INTEGER, PK | Час (0–23)                              |
| `status`       | TEXT      | `available` / `booked` / `blocked`        |
| `note`         | TEXT      | Комментарий (кем/чем занято)              |
| `client_name`  | TEXT      | Имя клиента                               |
| `client_phone` | TEXT      | Телефон клиента                           |

Первичный ключ: `(date_key, hour)`. Индекс по `date_key`.

Путь к файлу БД настраивается через переменную `DB_DIR` (по умолчанию `./data`).
В Docker данные сохраняются через volume `./data:/app/data`.

### Просмотр БД локально

```bash
sqlite3 -header -column backend/data/reservations.db "SELECT * FROM slots;"
```

## API

| Метод    | Путь                    | Описание                              |
|----------|-------------------------|---------------------------------------|
| `GET`    | `/health`               | Health check                          |
| `GET`    | `/api/available-dates`  | Даты со свободными слотами            |
| `GET`    | `/api/day-slots?date=YYYY-MM-DD` | Все слоты на конкретную дату |

## Деплой

### Backend → финский сервер
```bash
DEPLOY_HOST=1.2.3.4 DEPLOY_USER=deploy npm run deploy:backend
```

### Frontend → GitHub Pages
```bash
npm run deploy:frontend
```

> Не забудь поправить `base` в `frontend/vite.config.js` на имя своего репозитория.
