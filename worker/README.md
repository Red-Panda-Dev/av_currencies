# AV Currencies VIN Worker

Бэкенд на Cloudflare Workers для опциональной функции обмена VIN-кодами в расширении AV Currencies.

## Бизнес-логика

Хранит и предоставляет VIN-данные для страниц объявлений на AV.by.

### POST /api/vin

Принимает JSON: `{ pageId, pageUrl, vin }`.

- Валидирует payload:
  - `pageId` — 6-12 цифр
  - `vin` — 17 символов (A-H, J-N, P-R, Z, 0-9, приводится к верхнему регистру)
  - `pageUrl` — URL вида `https://[cars.]av.by/.../pageId`
- Если записи нет — создает новую запись с подтверждением от отправителя.
- Если VIN совпадает с существующим — добавляет подтверждение записи (write confirmation).
- Если VIN отличается — возвращает ошибку `VIN_CONFLICT` (409).

### GET /api/vin/{pageId}

- Валидирует `pageId`.
- Если записи нет — возвращает `{ exists: false, pageId }`.
- Если запись есть — регистрирует read confirmation и возвращает:
  ```json
  {
    "exists": true,
    "pageId": "12345678",
    "vin": "WVWZZZ3CZWE123456",
    "confirmations": 5,
    "firstSeenAt": "2026-01-15T12:00:00.000Z",
    "lastSeenAt": "2026-06-01T10:30:00.000Z"
  }
  ```

### Подтверждения (confirmations)

- `confirmations` — общее число уникальных пользователей (write + read).
- `writeConfirmations` — число уникальных пользователей, отправивших VIN.
- `readConfirmations` — число уникальных пользователей, запросивших VIN.
- Максимум 50 хешей хранится для каждого типа подтверждений.

## Идентификация запросов

Идентичность определяется хешом: `SHA-256(IDENTITY_SALT + IP + User-Agent)`.

Сырые IP и User-Agent не хранятся — только хеш для дедупликации подтверждений.

## Платформа и инфраструктура

| Компонент | Значение |
|-----------|----------|
| Runtime | Cloudflare Workers (TypeScript) |
| Хранилище | KV namespace `VIN_DATA` |
| Секреты | `IDENTITY_SALT` из Secrets Store (store `629e5dd6594845a889e6ddabb26cc009`, secret `AV_BY_USERS_SALT`) |
| Базовый URL API | `https://avby.currencies-bel.top` |
| Observability | Логи и трейсы включены, head sampling 100% |
| Placement | Smart placement |

## CORS

Разрешенные origins (переменная `ALLOWED_ORIGINS`):
- `chrome-extension://*`
- `moz-extension://*`

Preflight (`OPTIONS`) возвращает 204 с заголовками CORS.

## API-эндпоинты

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/vin/{pageId}` | Получить VIN для страницы |
| POST | `/api/vin` | Отправить VIN для страницы |
| OPTIONS | любой | CORS preflight |

## Коды ошибок

| Код | HTTP | Описание |
|-----|------|----------|
| `INVALID_PAGE_ID` | 400 | Некорректный pageId |
| `INVALID_JSON` | 400 | Некорректный JSON в теле запроса |
| `INVALID_PAYLOAD` | 400 | Некорректные данные VIN (pageId/vin/pageUrl) |
| `VIN_CONFLICT` | 409 | VIN уже сохранен и отличается |
| `NOT_FOUND` | 404 | Маршрут не найден |

## Схема данных (VinRecord)

```typescript
{
  pageId: string;           // ID объявления
  pageUrl: string;          // URL объявления
  vin: string;              // VIN-код (17 символов)
  createdAt: string;        // ISO timestamp создания
  updatedAt: string;        // ISO timestamp последнего обновления
  firstSeenAt: string;      // Когда впервые увидели
  lastSeenAt: string;       // Когда видели последний раз
  confirmations: number;    // Всего уникальных подтверждений
  readConfirmations: number;   // Подтверждений чтением
  writeConfirmations: number;  // Подтверждений записью
  submissionCount: number;  // Всего POST-запросов
  submittedByHash: string;  // Хеш первого отправителя
  confirmedByHashes: string[];     // Хеши write-подтвердивших
  readConfirmedByHashes: string[]; // Хеши read-подтвердивших
  schemaVersion: 1;
}
```

## Поток запроса

1. Контент-скрипт или popup расширения отправляет сообщение в background script.
2. Background script вызывает Worker по HTTPS.
3. Worker валидирует входные данные, читает/пишет KV, возвращает JSON.

## Разработка

```bash
cd worker
npm install              # Установить зависимости
npm run build            # Проверка TypeScript (без emit)
npm test                 # Запустить тесты с coverage
npm run deploy           # Деплой через wrangler
./deploy.sh              # Build + deploy
```

Из корня репозитория:
```bash
make test-worker         # Запустить тесты Worker
make deploy-worker       # Деплой Worker
```
