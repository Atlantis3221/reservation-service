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
│   │   ├── index.js          # точка входа
│   │   ├── routes/api.js     # REST API бронирований
│   │   └── services/bot.js   # Telegram-бот
│   ├── Dockerfile
│   └── package.json
├── frontend/         # React (Vite)
│   ├── src/
│   │   ├── App.jsx
│   │   └── components/
│   ├── vite.config.js
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

# Создать .env файл для фронтенда (опционально)
cp frontend/.env.example frontend/.env
# Вписать VITE_TELEGRAM_BOT_USERNAME в frontend/.env

# Запуск бэкенда (dev, с --watch)
npm run dev:back

# Запуск фронта (Vite dev server)
npm run dev:front
```

## Docker

```bash
# Поднять бэкенд в контейнере
docker-compose up -d --build

# Остановить
docker-compose down
```

## API

| Метод    | Путь                    | Описание                    |
|----------|-------------------------|-----------------------------|
| `GET`    | `/health`               | Health check                |
| `GET`    | `/api/reservations`     | Список всех бронирований    |
| `POST`   | `/api/reservations`     | Создать бронирование        |
| `GET`    | `/api/reservations/:id` | Получить по ID              |
| `DELETE` | `/api/reservations/:id` | Отменить бронирование       |
| `GET`    | `/api/available-slots`  | Получить свободные даты и время |

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
