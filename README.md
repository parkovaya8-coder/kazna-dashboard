# kazna-dashboard — Дашборд Казначейства

**Тип:** Web + API (Vercel + Google Apps Script)
**Статус:** active
**GitHub:** github.com/parkovaya8-coder/kazna-dashboard
**Deploy:** через Vercel (vercel.json)

## Назначение

Веб-дашборд для системы «Казначейство» — отображение финансовых данных из Google Sheets через API. Включает Telegram-бот и серверные функции на Vercel.

## Структура

```
kazna-dashboard/
├── index.html                 ← фронтенд дашборда
├── gas-web-app.js             ← Google Apps Script веб-приложение
├── 93_telegram_bot.js         ← Telegram-бот
├── api/                       ← серверные функции Vercel
├── logs/                      ← логи
├── kazna-dashboard-data.json  ← данные дашборда
├── package.json               ← зависимости
└── vercel.json                ← конфигурация деплоя
```

## Ключевые файлы

- `index.html` — главная страница дашборда
- `api/` — серверные функции (Vercel Serverless)
- `gas-web-app.js` — скрипт для Google Apps Script
- `vercel.json` — маршрутизация и настройки деплоя

## Как работать

- **Локально:** открыть index.html или `npx vercel dev`
- **Деплой:** `npx vercel deploy --prod --yes`

## Не трогать без проверки

- `vercel.json` — маршруты API, при изменении сломается деплой
- `api/` — серверные функции, связаны с фронтендом
- `kazna-dashboard-data.json` — структура данных для дашборда
