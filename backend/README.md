# CoupleCount API (Part 1: backend)

FastAPI + async SQLAlchemy 2 + PostgreSQL. A Tricount-style shared ledger for two people, with monthly
budgets and installment plans (meses sin intereses).

## Layout

```
backend/
  app/
    config.py     settings (env vars)
    database.py   async engine/session, Base
    models.py     User, Device, MonthlyPeriod, MonthlyIncome, InstallmentPlan, Expense, ExpenseSplit
    schemas.py    Pydantic v2 request/response models (Decimal money)
    services.py   splits, installments, summary, settlement, hub
    auth.py       JWT + device binding
    main.py       routes
    seed.py       creates the two users from SEED_* env vars
  alembic/        migrations (0001 = initial schema)
  tests/          pytest suite (runs on SQLite, no Postgres needed)
  Dockerfile, docker-entrypoint.sh, railway.json
```

## Run locally

```bash
cd backend
python -m venv .venv && .venv/Scripts/activate      # Windows; use bin/activate on macOS/Linux
pip install -r requirements-dev.txt
pytest                                               # 19 tests
cp .env.example .env                                 # point DATABASE_URL at a local Postgres
alembic upgrade head && python -m app.seed
uvicorn app.main:app --reload                        # docs at http://localhost:8000/docs
```

## Deploy to Railway

1. Push this repo to GitHub.
2. In Railway, create a project, then **+ New → Database → PostgreSQL**.
3. **+ New → GitHub Repo** and pick this repo. In the service's **Settings → Source**, set **Root Directory**
   to `backend` so Railway finds `railway.json` and the `Dockerfile`.
4. In the service's **Variables** tab, add:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (the app converts it to `postgresql+asyncpg://` itself)
   - `JWT_SECRET`: a long random string
   - `SEED_USER_A_NAME/EMAIL/PASSWORD` and `SEED_USER_B_NAME/EMAIL/PASSWORD`
   - optional: `APP_TIMEZONE` (default `America/Mexico_City`), `MAX_DEVICES_PER_USER` (default 2)
5. **Settings → Networking → Generate Domain**. Every boot runs `alembic upgrade head`, then the seed,
   then uvicorn. The health check is `GET /health`.

## How the numbers work

Money is `NUMERIC(12,2)` in the database and `Decimal` in Python. JSON responses return it as strings
(`"1250.50"`). Splits and installments are computed in integer cents with largest-remainder rounding,
so the parts always add up exactly to the total.

| Metric | Definition |
|---|---|
| `total_income` | base income + extra income + your share of `income`-type entries |
| `consumed` | your share of every `expense` (proxy purchases count for the person they were bought for) |
| `money_left` | `total_income - consumed` |
| `card_outflow` | sum of the expenses you actually paid at the merchant |
| `net_balance` | positive: you are owed money; negative: you owe money |

Transaction types:
- **expense**: `paid_by` paid the merchant, and the splits say who consumed it.
- **income**: `paid_by` received the money (refund, shared bonus), and the splits say who it belongs to.
- **transfer**: `paid_by` sent money to the one user in the splits. Settle Up creates these. Transfers
  move the balance between you without changing either person's `consumed`.

Installments: `POST /expenses` with `"installment": {"num_installments": 6}` creates an `InstallmentPlan`
and 6 monthly expenses, opening future month ledgers as needed. Each person's share is exact over the
whole plan, and month amounts differ by at most one cent. Each child expense has an `installment_label`,
for example `"Installment 2/6 - Dyson Airwrap"`. Child expenses are locked: only the title, category and
notes can change. Use the hub endpoints for anything else:

- `GET /installments`: active plans, total remaining debt, what is committed next month, and totals per person
- `POST /installments/{id}/payoff`: move every later installment into one charge in the chosen month
- `POST /installments/{id}/cancel`: delete the future installments and keep past ones
- `DELETE /installments/{id}`: delete the plan and every installment, past ones included

Income carry-over: a new month copies each person's base income from the previous month. If you edit an
earlier month, the change carries forward through later months until it reaches one that was edited by hand.

## Main endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/login` | `{email, password, device_id, device_name}`, returns a JWT |
| GET | `/auth/me`, `/auth/devices` · DELETE `/auth/devices/{id}` | current user, list or unlink phones |
| GET | `/users` | the two users |
| GET | `/periods`, `/periods/current`, `/periods/{id}` | ledgers (the current month is created on first access) |
| POST | `/periods/monthly`, `/periods/events` | get or create a month, create a custom ledger such as Vacation |
| PUT | `/periods/{id}/incomes/{user_id}` | set income for that month (`propagate_forward` defaults to true) |
| GET | `/periods/{id}/expenses`, `/periods/{id}/summary` | feed, dashboard and balances |
| POST | `/periods/{id}/settle` | create the transfers that bring the balance to zero |
| POST · GET · PATCH · DELETE | `/expenses`, `/expenses/{id}` | expense CRUD |

Event ledgers (such as Vacation) are separate from the monthly budget and have no income pool.
