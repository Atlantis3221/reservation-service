# Медиа-файлы для лендинга

| Файл | Описание | Формат |
|---|---|---|
| `screen-client.png` | Страница записи глазами клиента — время и загрузка дня | 780×1560 (390×780 @2x) |
| `screen-owner.png` | Панель владельца — календарь с бронями | 780×1560 (390×780 @2x) |
| `fonts/inter-latin.woff2` | Inter, латиница — текст и заголовки | woff2, variable 400–800 |
| `fonts/inter-cyrillic.woff2` | Inter, кириллица | woff2, variable 400–800 |
| `fonts/lora-italic-latin.woff2` | Lora Italic, латиница — серифные акценты в заголовках | woff2, variable 400–700 |
| `fonts/lora-italic-cyrillic.woff2` | Lora Italic, кириллица | woff2, variable 400–700 |
| `fonts/jetbrains-mono-latin.woff2` | JetBrains Mono, латиница — мелкие технические подписи и индексы | woff2, variable 400–500 |
| `fonts/jetbrains-mono-cyrillic.woff2` | JetBrains Mono, кириллица | woff2, variable 400–500 |

Все шрифты — SIL Open Font License 1.1. Лежат локально, а не подключаются
с `fonts.googleapis.com`: внешний CSS блокирует рендер и в РФ часто отвечает
медленно. Файлы — variable (диапазон весов в одном файле), подключаются
в `styles.css` через `@font-face` с `unicode-range`, поэтому кириллица
и латиница качаются раздельно.

## Как пересобрать скриншоты

Оба снимаются с **живого приложения**, а не рисуются: ручные картинки уже
однажды разошлись с продуктом (на лендинге был показан пустой календарь и
форма с ручным вводом времени, которых в продукте больше нет).

Порядок:

1. Поднять локально бэкенд, `frontend` (5173) и `admin` (5174).
   Админку — с `VITE_FRONTEND_URL=https://slotik.tech`, иначе в кадр попадёт
   `localhost` вместо рабочего адреса.
2. Создать заведение с расписанием и парой броней. Имена и телефоны в кадре
   должны быть **заведомо вымышленными** (`+7 900 000-00-11` и подобные):
   это публичная страница, реальных контактов клиентов на ней быть не должно.
   День для кадра выбирать «живой»: пара броней и свободное время рядом —
   пустой день не показывает, зачем сервис нужен.
3. Снять кадры скриптом:

```bash
node scripts/shoot-landing-media.mjs \
  --client 'http://localhost:5173/<slug>?date=2026-08-21' \
  --owner  'http://localhost:5174/' \
  --token  '<JWT владельца из localStorage>' \
  --owner-date 2026-08-21
```

Скрипт поднимает headless Chrome и снимает через CDP
(`Emulation.setDeviceMetricsOverride`, 390×780, `deviceScaleFactor: 2`).
Флаг `--screenshot` у headless Chrome искажает вьюпорт и обрезает правый
край — им пользоваться нельзя, поэтому и понадобился CDP.

Без `--token` панель владельца снимется на экране входа: у свежего профиля
Chrome нет сессии. Токен лежит в `localStorage.token` в открытой админке.

При сборке (`npm run build:landing`) всё копируется в `landing/dist/media/`.
