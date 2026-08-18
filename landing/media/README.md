# Медиа-файлы для лендинга

| Файл | Описание | Формат |
|---|---|---|
| `screen-calendar.png` | Скриншот панели управления — календарь записей | 578×1024 |
| `screen-booking-request.png` | Скриншот страницы клиента — форма заявки | 578×1024 |
| `fonts/inter-latin.woff2` | Inter, латиница (SIL Open Font License 1.1) | woff2, variable |
| `fonts/inter-cyrillic.woff2` | Inter, кириллица (SIL Open Font License 1.1) | woff2, variable |

Шрифты лежат локально, а не подключаются с `fonts.googleapis.com`: внешний
CSS блокирует рендер и в РФ часто отвечает медленно. Оба файла — variable
(веса 400–800 в одном файле), подключаются в `styles.css` через `@font-face`
с `unicode-range`, поэтому кириллица и латиница качаются раздельно.

Скриншот заявки снят с живого демо:
`https://slotik.tech/demo-banya?date=<дата>` → «Забронировать».

При сборке (`npm run build:landing`) всё копируется в `landing/dist/media/`.
