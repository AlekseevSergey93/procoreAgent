# procore-mcp + procore-ceo

Агент для CEO строительной компании. Он отвечает в Telegram через OpenClaw на основе данных Procore:
- здоровье портфеля проектов;
- дедлайны и просрочки;
- кто из людей и подрядчиков что держит;
- риски, бюджет и активность на объекте.

```
Telegram ⇄ OpenClaw (LLM + cron) ── skill procore-ceo (skills/procore-ceo/SKILL.md)
                    │ MCP (stdio)
              procore-mcp (этот репозиторий)
   tools → analytics (правила рисков) → normalizers → Procore client (OAuth, пагинация, 429, кэш)
                    │ HTTPS
              Procore REST API
                    │
       PostgreSQL (история ежедневных snapshots; планируется)
```

- **Только чтение.** В сервере нет ни одного инструмента, который что-то меняет в Procore.
- **Риски считаются кодом** (`src/analytics/risks.ts`) по порогам из `config/thresholds.json`. LLM их только объясняет.
- **Ответы инструментов компактные:** счётчики, топ-N и ссылки на Procore. Сырой JSON не отдаётся, поэтому брифы получаются дешёвыми и точными.
- **История пока не подключена:** текущая версия получает актуальное состояние из Procore и использует только in-memory cache. PostgreSQL будет добавлен для ежедневных snapshots и сравнений «сегодня/вчера».
- Спецификация развития: [архитектура](docs/architecture.md), [требования](docs/requirements.md), [задачи](docs/tasks.md).

## Инструменты MCP

| Tool | Что даёт |
|---|---|
| `list_projects` | проекты: id, номер, стадия, даты |
| `get_portfolio_overview` | все активные проекты: 🟢🟡🔴, риски, просрочки, отклонение бюджета, перегруженные люди |
| `get_project_digest(project)` | сводка по проекту: график, RFI, submittals, punch, инспекции, бюджет, поле |
| `get_deadlines(project?, days_ahead, include_overdue, types?)` | просроченное и ближайшее по всем инструментам Procore с ответственными |
| `get_team_status(project?, person?)` | у кого что на руках (ball in court / assignee / ресурс графика), просрочки |
| `get_risks(project?, min_severity)` | список рисков с severity, доказательствами и ответственными |
| `get_budget_status(project)` | бюджет (original / revised / committed / projected), перерасход по статьям, change orders |
| `get_field_activity(project, from?, to?)` | daily logs (люди по дням, задержки), инспекции с замечаниями, punch |
| `get_item(project, type, id)` | детали одного объекта |

`project` принимает id, номер проекта или часть названия.

### Правила рисков

| Код | Когда | Severity |
|---|---|---|
| `schedule_overdue` | задача графика прошла плановый finish и не завершена | high на критическом пути, иначе medium |
| `schedule_at_risk` | до finish ≤ 7 дн, выполнено < 50% | high на критическом пути, иначе medium |
| `rfi_overdue` | открытый RFI просрочен | high при влиянии на график или просрочке ≥ 7 дн |
| `rfi_stale` | RFI открыт > 14 дн | low |
| `submittal_late_for_site` / `submittal_needed_on_site` | не согласован, а required-on-site уже прошёл / наступит в течение 14 дн | high / medium |
| `submittal_overdue` | просрочен due date | medium |
| `budget_overrun` | прогноз по проекту выше revised budget | high при ≥ 5%, иначе medium |
| `budget_line_overrun` | статья бюджета превышена > 5% | medium |
| `pending_change_orders` | pending CO > 3% от revised budget | medium |
| `inspection_deficient` / `inspection_overdue` | открытая инспекция с deficient-пунктами / просрочена | medium / low |
| `punch_overdue` | просроченные punch-элементы (одна агрегированная запись) | medium при ≥ 10, иначе low |
| `daily_log_gap` | нет daily log ≥ 2 рабочих дней на идущем проекте | medium |
| `site_delays` | delay logs за последние 7 дней | low |
| `person_overloaded` | у человека ≥ 5 просроченных позиций | medium |
| `project_past_completion` | проект активен, а плановое завершение прошло | medium |

Статус проекта: 🔴 при ≥ 2 high, 🟡 при ≥ 1 high или ≥ 3 medium, иначе 🟢. Все пороги задаются в `config/thresholds.json`.

## Установка

Требуется Node.js ≥ 20.

```bash
npm install
npm run build
cp .env.example .env   # заполнить, см. ниже
npm test
```

### 1. Доступ к Procore (sandbox)

1. В [Procore Developer Portal](https://developers.procore.com) создайте приложение. Добавьте компонент **Developer Managed Service Account** и выдайте **только права на чтение** нужных инструментов: Projects, Schedule, RFIs, Submittals, Punch List, Inspections, Budget, Change Orders, Daily Log.
2. Установите приложение в sandbox-компанию (Company Admin → App Management → Install Custom App). Убедитесь, что сервисный аккаунт добавлен в Directory нужных проектов.
3. Впишите в `.env` `PROCORE_CLIENT_ID`, `PROCORE_CLIENT_SECRET`, `PROCORE_COMPANY_ID` и `PROCORE_ENV=sandbox`.

Для продакшна достаточно поставить `PROCORE_ENV=production`: хосты API, логина и веба переключатся сами.

### 2. Проверка на реальных данных

```bash
npm run probe                  # список проектов: доступ работает
npm run probe -- "Lenina 5"    # сырые ответы всех эндпоинтов → fixtures/sandbox/<id>/*.json
npx @modelcontextprotocol/inspector node dist/index.js   # вызвать инструменты вручную
```

`probe` показывает ключи полей каждого эндпоинта. Сверьте их с нормализаторами в `src/procore/endpoints/`. Особенно это касается **колонок бюджета**: они зависят от настройки budget view в компании. Если `get_budget_status` пишет `Budget columns not recognized`, укажите названия колонок в `config/thresholds.json`:

```json
"budget": { "columns": { "revisedBudget": ["Revised Budget"], "projected": ["Projected Costs"] } }
```

Файлы из `fixtures/sandbox/` той же структуры можно положить в `tests/fixtures/` и использовать как тестовые данные.

### 3. Подключение к OpenClaw

MCP-сервер прописывается в `~/.openclaw/openclaw.json`. Секреты сервер читает из `.env` этого репозитория, поэтому в конфиг OpenClaw они не попадают.

```json5
{
  mcp: {
    servers: {
      procore: {
        command: "node",
        args: ["/абсолютный/путь/ProcoreAgent/dist/index.js"],
      },
    },
  },
}
```

Skill:

```bash
ln -s "$(pwd)/skills/procore-ceo" ~/.openclaw/skills/procore-ceo
openclaw mcp list       # procore должен быть в списке
```

Skill подключается только при наличии `mcp.servers.procore` в конфиге.

### 4. Регулярные брифы в Telegram

```bash
openclaw cron add --name "Procore morning brief" --cron "0 8 * * 1-5" --tz "Europe/Moscow" \
  --session isolated --message "Утренний бриф по проектам Procore" \
  --announce --channel telegram --to "<chat_id владельца>"

openclaw cron add --name "Procore weekly report" --cron "0 9 * * 1" --tz "Europe/Moscow" \
  --session isolated --message "Недельный отчёт по проектам Procore: риски, дедлайны недели, кто держит просрочки" \
  --announce --channel telegram --to "<chat_id владельца>"
```

Для проверки временно поставьте `--cron` на ближайшую минуту.

### 5. Исторические данные в PostgreSQL (план)

После реализации исторического слоя PostgreSQL будет использоваться для хранения ежедневного состояния проектов. Снимок будет привязан к `project_id` Procore и календарной дате в `PROCORE_TIMEZONE`. Повторный запуск в тот же день будет обновлять снимок, а не создавать дубликат.

Сбор snapshots должен запускаться отдельным процессом по системному cron или OpenClaw cron. Долгоживущий MCP stdio-сервер не должен быть планировщиком:

```bash
# Команда появится вместе с daily-ingest entrypoint
npm run ingest:daily
```

Исторические MCP-инструменты будут показывать изменения прогресса графика, просроченных элементов, бюджета и активности. При недоступной PostgreSQL текущие live-инструменты продолжат работать, а исторический запрос вернёт явную ошибку.

## Проверка end-to-end

1. `npm test`: нормализаторы, правила рисков, дедлайны, команда, HTTP-клиент (пагинация, 429, 401) и все MCP-инструменты через in-memory транспорт.
2. MCP Inspector против sandbox: каждый инструмент отвечает, вывод компактный, `warnings` пустые или понятные.
3. В Telegram спросить: «что горит?», «как дела на <проект>?», «что у <имя>?», «что с бюджетом на <проект>?». Сверить ответы с UI Procore.

## Настройки

| Переменная | По умолчанию | |
|---|---|---|
| `PROCORE_ENV` | `sandbox` | `sandbox` / `production` |
| `PROCORE_API_BASE`, `PROCORE_LOGIN_BASE`, `PROCORE_WEB_BASE` | по `PROCORE_ENV` | ручное переопределение хостов |
| `PROCORE_TIMEZONE` | часовой пояс сервера | что считать «сегодня» |
| `PROCORE_CACHE_TTL_SECONDS` | 600 | кэш ответов API в памяти |
| `PROCORE_CONCURRENCY` | 3 | параллельная загрузка проектов для портфеля |
| `PROCORE_BUDGET_VIEW_ID` | первый view проекта | какой budget view читать |
| `PROCORE_THRESHOLDS_PATH` | `config/thresholds.json` | пороги рисков |
| `DATABASE_URL` | — | PostgreSQL connection string для исторического слоя (планируется) |
| `DB_POOL_MAX` | 10 | максимальный размер PostgreSQL pool (планируется) |
| `HISTORY_TIMEZONE` | `PROCORE_TIMEZONE` | timezone календарной даты snapshot (планируется) |

**Лимиты Procore.** Обзор портфеля делает около 11 запросов на проект, а Procore допускает примерно 3600 запросов в час. Кэш на 10 минут снимает повторные запросы в рамках одного разговора.

## Что сверить на sandbox

- Deep links в веб-интерфейс Procore (`src/procore/links.ts`) собраны по текущим маршрутам UI. Проверьте, что ссылки открываются.
- График читается из `GET /rest/v1.0/tasks`. Если компания ведёт график в новом Procore Schedule (v2), эндпоинт нужно будет заменить.
- Для change orders используется `change_order_packages`. Если компания ведёт CO на уровне prime contract или commitments, понадобится дополнительный источник.

## Дальше

- Ежедневные snapshots в PostgreSQL → «что изменилось со вчера», тренды по просрочкам и бюджету. Архитектура и требования описаны в `docs/`.
- Procore webhooks → мгновенные алерты в Telegram о критичных событиях (новый overdue RFI на критическом пути, проваленная инспекция).
