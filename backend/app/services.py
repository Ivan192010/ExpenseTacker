"""Business logic: ledgers, split resolution, installments, summaries, settlement.

Money rule: every split and installment is computed in integer cents with a
largest-remainder allocation, so the parts ALWAYS add up exactly to the total
(no lost or invented cents, no float maths anywhere).
"""

from __future__ import annotations

import calendar
import datetime as dt
import math
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from decimal import Decimal
from fractions import Fraction

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import (
    Category,
    Expense,
    ExpenseSplit,
    InstallmentPlan,
    InstallmentStatus,
    MonthlyIncome,
    MonthlyPeriod,
    PeriodKind,
    SplitMode,
    TransactionType,
    User,
)
from app.schemas import (
    CategoryTotal,
    CombinedSummary,
    Debt,
    ExpenseCreate,
    ExpenseUpdate,
    IncomeUpdate,
    InstallmentHub,
    InstallmentPayoffRequest,
    InstallmentPlanRead,
    InstallmentPlanUpdate,
    InstallmentScheduleItem,
    InstallmentUserTotals,
    PeriodRead,
    PeriodSummary,
    SettleRequest,
    SplitInput,
    UserAmount,
    UserSummary,
)

CENT = Decimal("0.01")
ZERO = Decimal("0.00")
MONTH_NAMES = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]  # fmt: skip


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class DomainError(Exception):
    status_code = 400

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class NotFound(DomainError):
    status_code = 404


class Conflict(DomainError):
    status_code = 409


# ---------------------------------------------------------------------------
# Money helpers
# ---------------------------------------------------------------------------


def to_cents(amount: Decimal) -> int:
    return int(amount.quantize(CENT) * 100)


def from_cents(cents: int) -> Decimal:
    return (Decimal(cents) / 100).quantize(CENT)


def allocate_cents(total_cents: int, weights: Sequence[Decimal | int]) -> list[int]:
    """Split `total_cents` proportionally to `weights` (largest remainder method).

    Result always sums to `total_cents`; ties go to the earliest index.
    A zero weight always gets 0.
    """
    fw = [Fraction(w) for w in weights]
    total_w = sum(fw)
    if total_w <= 0:
        raise DomainError("Split weights must add up to more than zero")
    raw = [Fraction(total_cents) * w / total_w for w in fw]
    parts = [math.floor(r) for r in raw]
    remainder = total_cents - sum(parts)
    order = sorted(range(len(raw)), key=lambda i: (-(raw[i] - parts[i]), i))
    for i in order[:remainder]:
        parts[i] += 1
    return parts


@dataclass(frozen=True)
class ResolvedSplit:
    user_id: int
    cents: int
    input_value: Decimal | None


def resolve_splits(amount: Decimal, mode: SplitMode, splits: Iterable[SplitInput]) -> list[ResolvedSplit]:
    """Turn the "For whom" rows into exact currency shares. Zero shares are dropped."""
    rows = sorted(splits, key=lambda s: s.user_id)
    total = to_cents(amount)

    if mode == SplitMode.EQUAL:
        cents = allocate_cents(total, [1] * len(rows))
    elif mode == SplitMode.EXACT:
        cents = [to_cents(s.value) for s in rows]  # type: ignore[arg-type]
        if sum(cents) != total:
            raise DomainError(
                f"Exact amounts add up to {from_cents(sum(cents))} but the expense is {from_cents(total)}"
            )
    elif mode == SplitMode.PERCENTAGE:
        if sum(s.value for s in rows) != 100:  # type: ignore[misc]
            raise DomainError("Percentages must add up to exactly 100")
        cents = allocate_cents(total, [s.value for s in rows])  # type: ignore[misc]
    elif mode == SplitMode.SHARES:
        cents = allocate_cents(total, [s.value for s in rows])  # type: ignore[misc]
    else:  # pragma: no cover
        raise DomainError(f"Unknown split mode {mode}")

    resolved = [
        ResolvedSplit(s.user_id, c, None if mode == SplitMode.EQUAL else s.value)
        for s, c in zip(rows, cents)
        if c > 0
    ]
    if not resolved:
        raise DomainError("At least one person must have a non-zero share")
    return resolved


def schedule_installments(total_cents: int, n: int, user_totals: dict[int, int]) -> list[dict[int, int]]:
    """Spread a purchase over `n` months.

    Guarantees, simultaneously:
      * each month's shares add up to that month's installment amount, and
      * each user's shares across all months add up to that user's total share.
    Month amounts differ by at most one cent (extra cents go to the first months).
    """
    month_cents = allocate_cents(total_cents, [1] * n)
    remaining = dict(user_totals)
    users = sorted(remaining)
    schedule: list[dict[int, int]] = []
    for k, c in enumerate(month_cents):
        if k == n - 1:
            alloc = {u: remaining[u] for u in users}
        else:
            parts = allocate_cents(c, [remaining[u] for u in users])
            alloc = dict(zip(users, parts))
        for u in users:
            remaining[u] -= alloc[u]
        schedule.append({u: v for u, v in alloc.items() if v > 0})
    return schedule


# ---------------------------------------------------------------------------
# Calendar helpers
# ---------------------------------------------------------------------------


def add_months(year: int, month: int, k: int) -> tuple[int, int]:
    idx = year * 12 + (month - 1) + k
    return idx // 12, idx % 12 + 1


def ym_ord(year: int, month: int) -> int:
    return year * 12 + month


def today_local() -> dt.date:
    return dt.datetime.now(get_settings().tz).date()


def current_ym() -> tuple[int, int]:
    t = today_local()
    return t.year, t.month


def clamp_day(year: int, month: int, day: int) -> dt.date:
    return dt.date(year, month, min(day, calendar.monthrange(year, month)[1]))


_period_ord = MonthlyPeriod.year * 12 + MonthlyPeriod.month


# ---------------------------------------------------------------------------
# Lookups
# ---------------------------------------------------------------------------


async def list_users(session: AsyncSession) -> list[User]:
    return list(await session.scalars(select(User).order_by(User.id)))


async def _ensure_users_exist(session: AsyncSession, user_ids: Iterable[int]) -> None:
    wanted = set(user_ids)
    found = set(await session.scalars(select(User.id).where(User.id.in_(wanted))))
    missing = wanted - found
    if missing:
        raise DomainError(f"Unknown user id(s): {sorted(missing)}")


async def get_period(session: AsyncSession, period_id: int) -> MonthlyPeriod:
    period = await session.get(MonthlyPeriod, period_id)
    if period is None:
        raise NotFound(f"Period {period_id} not found")
    return period


async def load_expenses(session: AsyncSession, ids: Sequence[int]) -> list[Expense]:
    """Fresh load (splits + plan eagerly loaded) in the order of `ids`."""
    if not ids:
        return []
    rows = await session.scalars(
        select(Expense).where(Expense.id.in_(ids)).execution_options(populate_existing=True)
    )
    by_id = {e.id: e for e in rows}
    return [by_id[i] for i in ids]


async def get_expense(session: AsyncSession, expense_id: int) -> Expense:
    expense = await session.scalar(
        select(Expense).where(Expense.id == expense_id).execution_options(populate_existing=True)
    )
    if expense is None:
        raise NotFound(f"Expense {expense_id} not found")
    return expense


# ---------------------------------------------------------------------------
# Periods & income
# ---------------------------------------------------------------------------


async def _find_monthly(session: AsyncSession, year: int, month: int) -> MonthlyPeriod | None:
    return await session.scalar(
        select(MonthlyPeriod).where(
            MonthlyPeriod.kind == PeriodKind.MONTHLY,
            MonthlyPeriod.year == year,
            MonthlyPeriod.month == month,
        )
    )


async def get_or_create_monthly_period(session: AsyncSession, year: int, month: int) -> MonthlyPeriod:
    """Idempotent. A new month inherits each user's base income from the most
    recent earlier month (flagged `is_carried_over`)."""
    period = await _find_monthly(session, year, month)
    if period is not None:
        return period
    try:
        async with session.begin_nested():
            period = MonthlyPeriod(
                kind=PeriodKind.MONTHLY, name=f"{MONTH_NAMES[month]} {year}", year=year, month=month
            )
            session.add(period)
            await session.flush()
            await _carry_over_incomes(session, period)
    except IntegrityError:  # created concurrently by the partner's phone
        period = await _find_monthly(session, year, month)
        assert period is not None
    return period


async def _carry_over_incomes(session: AsyncSession, period: MonthlyPeriod) -> None:
    assert period.year is not None and period.month is not None
    target = ym_ord(period.year, period.month)
    for user_id in await session.scalars(select(User.id)):
        prev = await session.scalar(
            select(MonthlyIncome)
            .join(MonthlyPeriod, MonthlyPeriod.id == MonthlyIncome.period_id)
            .where(
                MonthlyIncome.user_id == user_id,
                MonthlyPeriod.kind == PeriodKind.MONTHLY,
                _period_ord < target,
            )
            .order_by(_period_ord.desc())
            .limit(1)
        )
        session.add(
            MonthlyIncome(
                period_id=period.id,
                user_id=user_id,
                base_amount=prev.base_amount if prev else ZERO,
                extra_amount=ZERO,
                is_carried_over=True,
            )
        )
    await session.flush()


async def create_event_ledger(session: AsyncSession, name: str) -> MonthlyPeriod:
    period = MonthlyPeriod(kind=PeriodKind.EVENT, name=name.strip())
    session.add(period)
    await session.commit()
    return period


async def list_periods(session: AsyncSession, include_archived: bool = False) -> list[MonthlyPeriod]:
    stmt = select(MonthlyPeriod)
    if not include_archived:
        stmt = stmt.where(MonthlyPeriod.is_archived.is_(False))
    stmt = stmt.order_by(
        MonthlyPeriod.kind,  # 'event' < 'monthly'
        MonthlyPeriod.year.desc(),
        MonthlyPeriod.month.desc(),
        MonthlyPeriod.id.desc(),
    )
    return list(await session.scalars(stmt))


async def get_incomes(session: AsyncSession, period_id: int) -> list[MonthlyIncome]:
    return list(
        await session.scalars(
            select(MonthlyIncome).where(MonthlyIncome.period_id == period_id).order_by(MonthlyIncome.user_id)
        )
    )


async def update_income(
    session: AsyncSession, period_id: int, user_id: int, data: IncomeUpdate
) -> MonthlyIncome:
    period = await get_period(session, period_id)
    if period.kind != PeriodKind.MONTHLY:
        raise DomainError("Income can only be set on monthly periods")
    await _ensure_users_exist(session, [user_id])

    income = await session.scalar(
        select(MonthlyIncome).where(MonthlyIncome.period_id == period_id, MonthlyIncome.user_id == user_id)
    )
    if income is None:
        income = MonthlyIncome(period_id=period_id, user_id=user_id)
        session.add(income)
    income.base_amount = data.base_amount
    income.extra_amount = data.extra_amount
    income.note = data.note
    income.is_carried_over = False

    if data.propagate_forward:
        assert period.year is not None and period.month is not None
        later = await session.scalars(
            select(MonthlyIncome)
            .join(MonthlyPeriod, MonthlyPeriod.id == MonthlyIncome.period_id)
            .where(
                MonthlyIncome.user_id == user_id,
                MonthlyPeriod.kind == PeriodKind.MONTHLY,
                _period_ord > ym_ord(period.year, period.month),
            )
            .order_by(_period_ord)
        )
        for row in later:
            if not row.is_carried_over:
                break  # stop at the first month someone set explicitly
            row.base_amount = data.base_amount

    await session.commit()
    await session.refresh(income)
    return income


# ---------------------------------------------------------------------------
# Expenses
# ---------------------------------------------------------------------------


def _check_transfer_shape(paid_by_id: int, split_user_ids: Sequence[int]) -> None:
    if len(split_user_ids) != 1 or split_user_ids[0] == paid_by_id:
        raise DomainError("A transfer needs exactly one recipient different from the sender")


async def create_expense(
    session: AsyncSession, data: ExpenseCreate, actor: User
) -> tuple[list[Expense], InstallmentPlan | None]:
    """Create a single expense, or an InstallmentPlan + N monthly child expenses."""
    await _ensure_users_exist(session, {data.paid_by_id, *(s.user_id for s in data.splits)})
    resolved = resolve_splits(data.amount, data.split_mode, data.splits)

    # ---- Single expense / income / transfer --------------------------------
    if data.installment is None:
        if data.period_id is not None:
            period = await get_period(session, data.period_id)
        else:
            period = await get_or_create_monthly_period(session, data.date.year, data.date.month)

        expense = Expense(
            period_id=period.id,
            title=data.title.strip(),
            amount=data.amount,
            date=data.date,
            category=data.category,
            type=data.type,
            split_mode=data.split_mode,
            paid_by_id=data.paid_by_id,
            notes=data.notes,
            created_by_id=actor.id,
            splits=[
                ExpenseSplit(user_id=r.user_id, amount=from_cents(r.cents), input_value=r.input_value)
                for r in resolved
            ],
        )
        session.add(expense)
        await session.commit()
        return await load_expenses(session, [expense.id]), None

    # ---- Installments (Meses sin Intereses) --------------------------------
    inst = data.installment
    if inst.start_year is not None and inst.start_month is not None:
        start_y, start_m = inst.start_year, inst.start_month
    else:
        start_y, start_m = data.date.year, data.date.month

    plan = InstallmentPlan(
        title=data.title.strip(),
        category=data.category,
        total_amount=data.amount,
        num_installments=inst.num_installments,
        start_year=start_y,
        start_month=start_m,
        purchase_date=data.date,
        paid_by_id=data.paid_by_id,
        split_mode=data.split_mode,
        split_template=[
            {"user_id": s.user_id, "value": None if s.value is None else str(s.value)} for s in data.splits
        ],
        status=InstallmentStatus.ACTIVE,
        notes=data.notes,
        created_by_id=actor.id,
    )
    session.add(plan)
    await session.flush()

    input_by_user = {r.user_id: r.input_value for r in resolved}
    schedule = schedule_installments(
        to_cents(data.amount), inst.num_installments, {r.user_id: r.cents for r in resolved}
    )

    child_ids: list[int] = []
    for k, alloc in enumerate(schedule):
        y, m = add_months(start_y, start_m, k)
        period = await get_or_create_monthly_period(session, y, m)
        child = Expense(
            period_id=period.id,
            title=plan.title,
            amount=from_cents(sum(alloc.values())),
            date=clamp_day(y, m, data.date.day),
            category=data.category,
            type=TransactionType.EXPENSE,
            split_mode=data.split_mode,
            paid_by_id=data.paid_by_id,
            notes=data.notes,
            installment_plan_id=plan.id,
            installment_number=k + 1,
            created_by_id=actor.id,
            splits=[
                ExpenseSplit(
                    user_id=u,
                    amount=from_cents(c),
                    # For EXACT the typed value refers to the whole purchase; store the monthly share.
                    input_value=from_cents(c) if data.split_mode == SplitMode.EXACT else input_by_user.get(u),
                )
                for u, c in sorted(alloc.items())
            ],
        )
        session.add(child)
        await session.flush()
        child_ids.append(child.id)

    await session.commit()
    await session.refresh(plan)
    return await load_expenses(session, child_ids), plan


async def list_period_expenses(session: AsyncSession, period_id: int) -> list[Expense]:
    await get_period(session, period_id)
    return list(
        await session.scalars(
            select(Expense)
            .where(Expense.period_id == period_id)
            .order_by(Expense.date.desc(), Expense.id.desc())
            .execution_options(populate_existing=True)
        )
    )


_INSTALLMENT_LOCKED_FIELDS = {"amount", "date", "paid_by_id", "period_id", "split_mode", "splits"}


async def update_expense(session: AsyncSession, expense_id: int, data: ExpenseUpdate) -> Expense:
    expense = await get_expense(session, expense_id)
    changed = {f for f in data.model_fields_set if getattr(data, f) is not None}

    if expense.installment_plan_id is not None and changed & _INSTALLMENT_LOCKED_FIELDS:
        raise Conflict(
            "Installment entries only allow changing title, category and notes. "
            "Use the Installments hub to pay off or cancel the plan."
        )

    if data.title is not None:
        expense.title = data.title.strip()
    if data.category is not None:
        expense.category = data.category
    if "notes" in data.model_fields_set:
        expense.notes = data.notes
    if data.paid_by_id is not None:
        await _ensure_users_exist(session, [data.paid_by_id])
        expense.paid_by_id = data.paid_by_id

    if data.period_id is not None:
        expense.period_id = (await get_period(session, data.period_id)).id
    if data.date is not None:
        expense.date = data.date
        current = await get_period(session, expense.period_id)
        # Moving a monthly expense to another month's date moves it to that ledger.
        if data.period_id is None and current.kind == PeriodKind.MONTHLY and (
            current.year,
            current.month,
        ) != (data.date.year, data.date.month):
            expense.period_id = (await get_or_create_monthly_period(session, data.date.year, data.date.month)).id

    if data.amount is not None or data.splits is not None or data.paid_by_id is not None:
        mode = data.split_mode or expense.split_mode
        split_inputs = data.splits or [SplitInput(user_id=s.user_id, value=s.input_value) for s in expense.splits]
        amount = data.amount or expense.amount
        await _ensure_users_exist(session, [s.user_id for s in split_inputs])
        resolved = resolve_splits(amount, mode, split_inputs)
        if expense.type == TransactionType.TRANSFER:
            _check_transfer_shape(expense.paid_by_id, [r.user_id for r in resolved])

        expense.amount = amount
        expense.split_mode = mode
        new_by_user = {r.user_id: r for r in resolved}
        for split in list(expense.splits):
            r = new_by_user.pop(split.user_id, None)
            if r is None:
                expense.splits.remove(split)
            else:
                split.amount = from_cents(r.cents)
                split.input_value = r.input_value
        for r in new_by_user.values():
            expense.splits.append(
                ExpenseSplit(user_id=r.user_id, amount=from_cents(r.cents), input_value=r.input_value)
            )

    await session.commit()
    return (await load_expenses(session, [expense.id]))[0]


async def delete_expense(session: AsyncSession, expense_id: int) -> None:
    expense = await get_expense(session, expense_id)
    if expense.installment_plan_id is not None:
        raise Conflict("This is part of an installment plan. Cancel or pay off the plan from the Installments hub.")
    await session.delete(expense)
    await session.commit()


# ---------------------------------------------------------------------------
# Monthly summary & balances
# ---------------------------------------------------------------------------


def simplify_debts(net: dict[int, Decimal]) -> list[tuple[int, int, Decimal]]:
    """Greedy settlement: (debtor, creditor, amount). For a couple this is at most one row."""
    creditors = sorted(((u, v) for u, v in net.items() if v > 0), key=lambda x: (-x[1], x[0]))
    debtors = sorted(((u, -v) for u, v in net.items() if v < 0), key=lambda x: (-x[1], x[0]))
    out: list[tuple[int, int, Decimal]] = []
    i = j = 0
    cred = [list(c) for c in creditors]
    debt = [list(d) for d in debtors]
    while i < len(debt) and j < len(cred):
        amount = min(debt[i][1], cred[j][1])
        if amount > 0:
            out.append((debt[i][0], cred[j][0], amount))
        debt[i][1] -= amount
        cred[j][1] -= amount
        if debt[i][1] == 0:
            i += 1
        if cred[j][1] == 0:
            j += 1
    return out


async def compute_period_summary(session: AsyncSession, period_id: int) -> PeriodSummary:
    period = await get_period(session, period_id)
    users = await list_users(session)
    incomes = {i.user_id: i for i in await get_incomes(session, period_id)}
    expenses = await list_period_expenses(session, period_id)

    def zeros() -> defaultdict[int, Decimal]:
        return defaultdict(lambda: ZERO)

    income_tx, consumed, consumed_inst = zeros(), zeros(), zeros()
    outflow, t_sent, t_recv, net = zeros(), zeros(), zeros(), zeros()
    by_category: defaultdict[Category, Decimal] = defaultdict(lambda: ZERO)

    for e in expenses:
        payer = e.paid_by_id
        if e.type == TransactionType.EXPENSE:
            outflow[payer] += e.amount
            net[payer] += e.amount
            for s in e.splits:
                consumed[s.user_id] += s.amount
                net[s.user_id] -= s.amount
                if e.installment_plan_id is not None:
                    consumed_inst[s.user_id] += s.amount
            by_category[e.category] += e.amount
        elif e.type == TransactionType.INCOME:
            # payer RECEIVED the money and holds the beneficiaries' shares
            net[payer] -= e.amount
            for s in e.splits:
                income_tx[s.user_id] += s.amount
                net[s.user_id] += s.amount
        else:  # TRANSFER: moves debt only, never touches budgets
            t_sent[payer] += e.amount
            net[payer] += e.amount
            for s in e.splits:
                t_recv[s.user_id] += s.amount
                net[s.user_id] -= s.amount

    names = {u.id: u.name for u in users}
    user_rows: list[UserSummary] = []
    for u in users:
        inc = incomes.get(u.id)
        base = inc.base_amount if inc else ZERO
        extra = inc.extra_amount if inc else ZERO
        total_income = base + extra + income_tx[u.id]
        user_rows.append(
            UserSummary(
                user_id=u.id,
                name=u.name,
                base_income=base,
                extra_income=extra,
                income_transactions=income_tx[u.id],
                total_income=total_income,
                consumed=consumed[u.id],
                consumed_installments=consumed_inst[u.id],
                money_left=total_income - consumed[u.id],
                card_outflow=outflow[u.id],
                transfers_sent=t_sent[u.id],
                transfers_received=t_recv[u.id],
                net_balance=net[u.id],
            )
        )

    combined = CombinedSummary(
        total_income=sum((r.total_income for r in user_rows), ZERO),
        consumed=sum((r.consumed for r in user_rows), ZERO),
        money_left=sum((r.money_left for r in user_rows), ZERO),
        card_outflow=sum((r.card_outflow for r in user_rows), ZERO),
    )
    debts = [
        Debt(from_user_id=d, from_name=names.get(d, "?"), to_user_id=c, to_name=names.get(c, "?"), amount=a)
        for d, c, a in simplify_debts(dict(net))
    ]
    return PeriodSummary(
        period=PeriodRead.model_validate(period),
        users=user_rows,
        combined=combined,
        debts=debts,
        by_category=[
            CategoryTotal(category=c, amount=a)
            for c, a in sorted(by_category.items(), key=lambda kv: kv[1], reverse=True)
        ],
        expense_count=len(expenses),
    )


def _default_entry_date(period: MonthlyPeriod) -> dt.date:
    today = today_local()
    if period.kind == PeriodKind.MONTHLY and period.year and period.month:
        if (today.year, today.month) == (period.year, period.month):
            return today
        return clamp_day(period.year, period.month, 31)
    return today


async def settle_period(
    session: AsyncSession, period_id: int, data: SettleRequest, actor: User
) -> list[Expense]:
    """Create TRANSFER entries that zero out the period's balances.
    Transfers don't count as consumption, so budgets are untouched."""
    period = await get_period(session, period_id)
    summary = await compute_period_summary(session, period_id)
    if not summary.debts:
        raise Conflict("Everyone is already settled up for this period")

    entry_date = data.date or _default_entry_date(period)
    created: list[Expense] = []
    for d in summary.debts:
        transfer = Expense(
            period_id=period.id,
            title=f"Settle up: {d.from_name} → {d.to_name}",
            amount=d.amount,
            date=entry_date,
            category=Category.SETTLEMENT,
            type=TransactionType.TRANSFER,
            split_mode=SplitMode.EXACT,
            paid_by_id=d.from_user_id,
            notes=data.notes,
            created_by_id=actor.id,
            splits=[ExpenseSplit(user_id=d.to_user_id, amount=d.amount, input_value=d.amount)],
        )
        session.add(transfer)
        created.append(transfer)
    await session.commit()
    return await load_expenses(session, [t.id for t in created])


# ---------------------------------------------------------------------------
# Installments hub
# ---------------------------------------------------------------------------


async def _plan_children(
    session: AsyncSession, plan_ids: Sequence[int]
) -> dict[int, list[tuple[Expense, int, int]]]:
    """plan_id -> [(expense, year, month)] ordered by month."""
    if not plan_ids:
        return {}
    rows = await session.execute(
        select(Expense, MonthlyPeriod.year, MonthlyPeriod.month)
        .join(MonthlyPeriod, MonthlyPeriod.id == Expense.period_id)
        .where(Expense.installment_plan_id.in_(plan_ids))
        .order_by(_period_ord, Expense.id)
        .execution_options(populate_existing=True)
    )
    grouped: dict[int, list[tuple[Expense, int, int]]] = defaultdict(list)
    for expense, y, m in rows.all():
        grouped[expense.installment_plan_id].append((expense, y, m))  # type: ignore[index]
    return grouped


def _plan_read(
    plan: InstallmentPlan,
    children: list[tuple[Expense, int, int]],
    as_of: tuple[int, int],
    include_schedule: bool,
) -> InstallmentPlanRead:
    cur = ym_ord(*as_of)
    nxt = cur + 1
    billed_n = remaining_n = 0
    billed_amt = remaining_amt = next_amt = ZERO
    remaining_by_user: defaultdict[int, Decimal] = defaultdict(lambda: ZERO)
    schedule: list[InstallmentScheduleItem] = []

    for e, y, m in children:
        o = ym_ord(y, m)
        billed = o <= cur
        if billed:
            billed_n += 1
            billed_amt += e.amount
        else:
            remaining_n += 1
            remaining_amt += e.amount
            for s in e.splits:
                remaining_by_user[s.user_id] += s.amount
        if o == nxt:
            next_amt += e.amount
        if include_schedule:
            schedule.append(
                InstallmentScheduleItem(
                    expense_id=e.id,
                    installment_number=e.installment_number,
                    is_payoff=e.is_installment_payoff,
                    period_id=e.period_id,
                    year=y,
                    month=m,
                    amount=e.amount,
                    is_billed=billed,
                    splits=[UserAmount(user_id=s.user_id, amount=s.amount) for s in e.splits],
                )
            )

    if children:
        end_y, end_m = children[-1][1], children[-1][2]
    else:
        end_y, end_m = add_months(plan.start_year, plan.start_month, plan.num_installments - 1)

    return InstallmentPlanRead(
        id=plan.id,
        title=plan.title,
        category=plan.category,
        total_amount=plan.total_amount,
        num_installments=plan.num_installments,
        start_year=plan.start_year,
        start_month=plan.start_month,
        end_year=end_y,
        end_month=end_m,
        purchase_date=plan.purchase_date,
        paid_by_id=plan.paid_by_id,
        split_mode=plan.split_mode,
        status=plan.status,
        notes=plan.notes,
        created_at=plan.created_at,
        installments_billed=billed_n,
        installments_remaining=remaining_n,
        billed_amount=billed_amt,
        remaining_amount=remaining_amt,
        next_month_amount=next_amt,
        remaining_by_user=[UserAmount(user_id=u, amount=a) for u, a in sorted(remaining_by_user.items())],
        schedule=schedule if include_schedule else None,
    )


async def _get_plan(session: AsyncSession, plan_id: int) -> InstallmentPlan:
    plan = await session.get(InstallmentPlan, plan_id, populate_existing=True)
    if plan is None:
        raise NotFound(f"Installment plan {plan_id} not found")
    return plan


async def get_installment_plan_read(
    session: AsyncSession, plan_id: int, include_schedule: bool = True
) -> InstallmentPlanRead:
    plan = await _get_plan(session, plan_id)
    children = (await _plan_children(session, [plan.id])).get(plan.id, [])
    return _plan_read(plan, children, current_ym(), include_schedule)


async def installments_hub(session: AsyncSession, include_closed: bool = False) -> InstallmentHub:
    as_of = current_ym()
    plans = list(await session.scalars(select(InstallmentPlan).order_by(InstallmentPlan.created_at.desc())))
    children = await _plan_children(session, [p.id for p in plans])
    reads = [_plan_read(p, children.get(p.id, []), as_of, include_schedule=False) for p in plans]

    nxt = ym_ord(*as_of) + 1
    per_user_remaining: defaultdict[int, Decimal] = defaultdict(lambda: ZERO)
    per_user_next: defaultdict[int, Decimal] = defaultdict(lambda: ZERO)
    for rows in children.values():
        for e, y, m in rows:
            if ym_ord(y, m) > ym_ord(*as_of):
                for s in e.splits:
                    per_user_remaining[s.user_id] += s.amount
                    if ym_ord(y, m) == nxt:
                        per_user_next[s.user_id] += s.amount

    user_ids = sorted({*per_user_remaining, *(u.id for u in await list_users(session))})
    return InstallmentHub(
        as_of_year=as_of[0],
        as_of_month=as_of[1],
        total_remaining_debt=sum((r.remaining_amount for r in reads), ZERO),
        committed_next_month=sum((r.next_month_amount for r in reads), ZERO),
        per_user=[
            InstallmentUserTotals(user_id=u, remaining=per_user_remaining[u], next_month=per_user_next[u])
            for u in user_ids
        ],
        plans=[r for r in reads if include_closed or r.installments_remaining > 0],
    )


async def update_installment_plan(
    session: AsyncSession, plan_id: int, data: InstallmentPlanUpdate
) -> InstallmentPlanRead:
    plan = await _get_plan(session, plan_id)
    children = (await _plan_children(session, [plan.id])).get(plan.id, [])
    if data.title is not None:
        plan.title = data.title.strip()
        for e, _, _ in children:
            e.title = plan.title
    if data.category is not None:
        plan.category = data.category
        for e, _, _ in children:
            e.category = data.category
    if "notes" in data.model_fields_set:
        plan.notes = data.notes
    await session.commit()
    return await get_installment_plan_read(session, plan_id)


async def pay_off_installment_plan(
    session: AsyncSession, plan_id: int, data: InstallmentPayoffRequest, actor: User
) -> InstallmentPlanRead:
    """Collapse every installment billed after the target month into one charge
    in the target month. Each person's share is preserved to the cent."""
    plan = await _get_plan(session, plan_id)
    if plan.status != InstallmentStatus.ACTIVE:
        raise Conflict(f"Plan is already {plan.status.value}")
    if (data.year is None) != (data.month is None):
        raise DomainError("year and month must be provided together")
    y, m = (data.year, data.month) if data.year and data.month else current_ym()
    target = ym_ord(y, m)

    future = [(e, ey, em) for e, ey, em in (await _plan_children(session, [plan.id])).get(plan.id, []) if ym_ord(ey, em) > target]
    if not future:
        raise Conflict(f"No installments left after {MONTH_NAMES[m]} {y}")

    per_user: defaultdict[int, int] = defaultdict(int)
    for e, _, _ in future:
        for s in e.splits:
            per_user[s.user_id] += to_cents(s.amount)
    numbers = [e.installment_number for e, _, _ in future if e.installment_number is not None]
    total = sum(per_user.values())

    period = await get_or_create_monthly_period(session, y, m)
    today = today_local()
    entry_date = today if (today.year, today.month) == (y, m) else clamp_day(y, m, plan.purchase_date.day)
    span = f"{min(numbers)}-{max(numbers)}" if numbers else "remaining"
    payoff = Expense(
        period_id=period.id,
        title=plan.title,
        amount=from_cents(total),
        date=entry_date,
        category=plan.category,
        type=TransactionType.EXPENSE,
        split_mode=SplitMode.EXACT,
        paid_by_id=plan.paid_by_id,
        notes=f"Early payoff of installments {span} of {plan.num_installments}",
        installment_plan_id=plan.id,
        installment_number=None,
        is_installment_payoff=True,
        created_by_id=actor.id,
        splits=[
            ExpenseSplit(user_id=u, amount=from_cents(c), input_value=from_cents(c))
            for u, c in sorted(per_user.items())
            if c > 0
        ],
    )
    session.add(payoff)
    for e, _, _ in future:
        await session.delete(e)
    plan.status = InstallmentStatus.PAID_OFF
    plan.closed_at = dt.datetime.now(dt.timezone.utc)
    await session.commit()
    return await get_installment_plan_read(session, plan_id)


async def cancel_installment_plan(session: AsyncSession, plan_id: int, scope: str) -> InstallmentPlanRead | None:
    """scope='remaining': delete installments after the current month, keep history.
    scope='all': delete the plan and every installment (as if it never happened)."""
    plan = await _get_plan(session, plan_id)
    children = (await _plan_children(session, [plan.id])).get(plan.id, [])

    if scope == "all":
        for e, _, _ in children:
            await session.delete(e)
        await session.delete(plan)
        await session.commit()
        return None

    cur = ym_ord(*current_ym())
    future = [e for e, y, m in children if ym_ord(y, m) > cur]
    if not future:
        raise Conflict("No future installments to cancel")
    for e in future:
        await session.delete(e)
    plan.status = InstallmentStatus.CANCELLED
    plan.closed_at = dt.datetime.now(dt.timezone.utc)
    await session.commit()
    return await get_installment_plan_read(session, plan_id)
