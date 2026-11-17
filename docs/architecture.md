# Архитектура исторических данных

Статус: спецификация. PostgreSQL-слой в текущей версии ещё не реализован.

## Цель

Сохранять ежедневное нормализованное состояние проектов Procore и отвечать на вопросы, которые невозможно надёжно решить по live-данным:

- что изменилось со вчера;
- продвигается ли график;
- уменьшается ли число просрочек;
- как меняются прогноз бюджета и pending change orders;
- появилась ли новая полевая активность или задержки.

## Поток данных

```text
Procore REST API
       │
       ▼
ProcoreClient (OAuth, pagination, retry, in-memory cache)
       │
       ▼
ProcoreRepository → ProjectSnapshot
       ├──────────────► live analytics → MCP tools
       │
       └──────────────► SnapshotPersistence → PostgreSQL
                                      │
                                      ▼
                             HistoryAnalytics → MCP history tools
```

Сбор истории выполняется отдельным `daily-ingest` entrypoint. MCP stdio-процесс отвечает на запросы и не содержит встроенного scheduler.

## Границы компонентов

| Компонент | Ответственность |
|---|---|
| `ProcoreClient` | Получение данных из Procore, авторизация, pagination, retry и краткосрочный cache |
| `ProcoreRepository` | Разрешение проекта и сбор нормализованного `ProjectSnapshot` |
| `SnapshotPersistence` | Запись и чтение snapshots, миграции, идемпотентность |
| `HistoryAnalytics` | Сравнение snapshots и расчёт трендов |
| `daily-ingest` | Загрузка проектов и сохранение ежедневного состояния |
| MCP tools | Live-ответы и исторические запросы; без изменения Procore |

Persistence не должен смешиваться с `ProcoreRepository`: первый работает с локальной БД, второй — с API.

## Модель хранения

### `projects`

Кэш идентичности проекта Procore: `procore_project_id`, номер, название, стадия, active, даты проекта, URL, `updated_at`.

### `project_snapshots`

Одна запись на проект и календарную дату:

- `project_id` → `projects`;
- `snapshot_date` в `HISTORY_TIMEZONE`;
- `captured_at` как фактическое время загрузки;
- `status`: `complete` или `partial`;
- `warnings` и список успешно загруженных модулей;
- нормализованный snapshot в `snapshot_json JSONB`;
- агрегаты для быстрых запросов: прогресс графика, количество открытых/просроченных items, бюджет и daily-log показатели.

Ограничение: `UNIQUE (project_id, snapshot_date)`. Повторный сбор за дату выполняется через upsert.

### Индексы

- `(project_id, snapshot_date DESC)` для предыдущего snapshot;
- `snapshot_date` для диапазонных отчётов;
- при необходимости — индексы по `status` и JSONB только после проверки реальных запросов.

Отдельные нормализованные таблицы для всех сущностей не обязательны на первом этапе: JSONB остаётся источником восстановления, агрегаты обеспечивают быстрые тренды.

## Правила надёжности

1. Дата snapshot определяется в `HISTORY_TIMEZONE`, а не локальным временем машины.
2. Частично загруженный snapshot сохраняется как `partial` с warnings; он не маскируется под полный.
3. Ошибка PostgreSQL не ломает live-инструменты.
4. Исторический инструмент не использует неполный snapshot без явного указания его статуса.
5. Миграции запускаются явно до ingest; приложение не должно молча менять схему.
6. Retention и backup-политика задаются до production-запуска.

## Планируемые интерфейсы

Исторический слой должен предоставить:

- `saveSnapshot(snapshot, snapshotDate)`;
- `getSnapshot(projectId, date)`;
- `getPreviousSnapshot(projectId, beforeDate)`;
- `compareSnapshots(current, previous)`;
- получение диапазона snapshots для трендов.

Названия модулей могут измениться при реализации, но семантика этих операций должна сохраниться.
