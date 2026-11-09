"""Pydantic v2 request/response schemas.

Every currency field is `Decimal` with at most 2 decimal places. In JSON
responses Pydantic serialises Decimal as a *string* (e.g. "1250.50") so the
mobile client never loses precision; parse with a decimal library or keep as
string for display.
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models import (
    Category,
    InstallmentStatus,
    PeriodKind,
    SplitMode,
    TransactionType,
)

PositiveMoney = Annotated[Decimal, Field(gt=0, max_digits=12, decimal_places=2)]
NonNegMoney = Annotated[Decimal, Field(ge=0, max_digits=12, decimal_places=2)]
SplitValueIn = Annotated[Decimal, Field(ge=0, max_digits=12, decimal_places=4)]
Year = Annotated[int, Field(ge=2000, le=2100)]
Month = Annotated[int, Field(ge=1, le=12)]


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Auth & users
# ---------------------------------------------------------------------------


class UserRead(ORMModel):
    id: int
    name: str
    email: str
    color: str


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=1, max_length=255)
    # Random UUID generated once by the app and kept in SecureStore.
    device_id: str = Field(min_length=8, max_length=128)
    device_name: str | None = Field(default=None, max_length=120)

    @field_validator("email")
    @classmethod
    def _lower(cls, v: str) -> str:
        return v.strip().lower()


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: dt.datetime
    user: UserRead


class DeviceRead(ORMModel):
    id: int
    device_name: str | None
    created_at: dt.datetime
    last_seen_at: dt.datetime | None
    revoked_at: dt.datetime | None
    is_current: bool = False


# ---------------------------------------------------------------------------
# Periods / ledgers & income
# ---------------------------------------------------------------------------


class PeriodRead(ORMModel):
    id: int
    kind: PeriodKind
    name: str
    year: int | None
    month: int | None
    is_archived: bool


class MonthlyPeriodCreate(BaseModel):
    year: Year
    month: Month


class EventLedgerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class IncomeRead(ORMModel):
    user_id: int
    base_amount: Decimal
    extra_amount: Decimal
    total: Decimal
    note: str | None
    is_carried_over: bool


class IncomeUpdate(BaseModel):
    base_amount: NonNegMoney
    extra_amount: NonNegMoney = Decimal("0.00")
    note: str | None = Field(default=None, max_length=255)
    # Also update later months whose income was carried over and never edited.
    propagate_forward: bool = True


class PeriodDetail(PeriodRead):
    incomes: list[IncomeRead] = []


# ---------------------------------------------------------------------------
# Expenses
# ---------------------------------------------------------------------------


class SplitInput(BaseModel):
    """One "For whom" row.

    `value` meaning depends on split_mode:
      equal      -> ignored (just tick the user)
      exact      -> currency amount
      percentage -> 0..100
      shares     -> weight (e.g. 1, 2, 0.5)
    """

    user_id: int
    value: SplitValueIn | None = None


class InstallmentInput(BaseModel):
    num_installments: int = Field(ge=2, le=48)
    start_year: Year | None = None
    start_month: Month | None = None

    @model_validator(mode="after")
    def _both_or_neither(self) -> InstallmentInput:
        if (self.start_year is None) != (self.start_month is None):
            raise ValueError("start_year and start_month must be provided together")
        return self


def _validate_split_inputs(mode: SplitMode, splits: list[SplitInput]) -> None:
    ids = [s.user_id for s in splits]
    if len(ids) != len(set(ids)):
        raise ValueError("Each user may appear only once in splits")
    if mode != SplitMode.EQUAL and any(s.value is None for s in splits):
        raise ValueError(f"split_mode '{mode.value}' requires a value for every split row")
    if mode == SplitMode.PERCENTAGE and sum(s.value for s in splits) != Decimal(100):  # type: ignore[misc]
        raise ValueError("Percentages must add up to exactly 100")
    if mode == SplitMode.EXACT and any(s.value != s.value.quantize(Decimal("0.01")) for s in splits):  # type: ignore[union-attr]
        raise ValueError("Exact split amounts may have at most 2 decimal places")


class ExpenseCreate(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    # For installments this is the TOTAL purchase amount.
    amount: PositiveMoney
    date: dt.date
    category: Category = Category.OTHER
    type: TransactionType = TransactionType.EXPENSE
    paid_by_id: int
    # Optional: defaults to the monthly period that contains `date`.
    period_id: int | None = None
    split_mode: SplitMode = SplitMode.EQUAL
    splits: list[SplitInput] = Field(min_length=1)
    notes: str | None = Field(default=None, max_length=2000)
    installment: InstallmentInput | None = None

    @model_validator(mode="after")
    def _check(self) -> ExpenseCreate:
        _validate_split_inputs(self.split_mode, self.splits)
        if self.type == TransactionType.TRANSFER:
            if len(self.splits) != 1 or self.splits[0].user_id == self.paid_by_id:
                raise ValueError("A transfer needs exactly one recipient different from the sender")
            if self.installment is not None:
                raise ValueError("Transfers cannot be installments")
        if self.installment is not None and self.type != TransactionType.EXPENSE:
            raise ValueError("Only expenses can be paid in installments")
        if self.installment is not None and self.period_id is not None:
            raise ValueError("Use installment.start_year/start_month instead of period_id for installments")
        return self


class ExpenseUpdate(BaseModel):
    """Partial update. Installment children only accept title/category/notes;
    change the plan (pay off / cancel) for anything else."""

    title: str | None = Field(default=None, min_length=1, max_length=160)
    amount: PositiveMoney | None = None
    date: dt.date | None = None
    category: Category | None = None
    paid_by_id: int | None = None
    period_id: int | None = None
    split_mode: SplitMode | None = None
    splits: list[SplitInput] | None = Field(default=None, min_length=1)
    notes: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def _check(self) -> ExpenseUpdate:
        if (self.split_mode is None) != (self.splits is None):
            raise ValueError("split_mode and splits must be updated together")
        if self.split_mode is not None and self.splits is not None:
            _validate_split_inputs(self.split_mode, self.splits)
        return self


class SplitRead(ORMModel):
    user_id: int
    amount: Decimal
    input_value: Decimal | None


class ExpenseRead(ORMModel):
    id: int
    period_id: int
    title: str
    amount: Decimal
    date: dt.date
    category: Category
    type: TransactionType
    split_mode: SplitMode
    paid_by_id: int
    notes: str | None
    installment_plan_id: int | None
    installment_number: int | None
    is_installment_payoff: bool
    installment_label: str | None  # e.g. "Installment 2/6 - Dyson Airwrap"
    splits: list[SplitRead]
    created_by_id: int | None
    created_at: dt.datetime


# ---------------------------------------------------------------------------
# Installments
# ---------------------------------------------------------------------------


class UserAmount(BaseModel):
    user_id: int
    amount: Decimal


class InstallmentScheduleItem(BaseModel):
    expense_id: int
    installment_number: int | None
    is_payoff: bool
    period_id: int
    year: int
    month: int
    amount: Decimal
    is_billed: bool  # month <= current month
    splits: list[UserAmount]


class InstallmentPlanRead(ORMModel):
    id: int
    title: str
    category: Category
    total_amount: Decimal
    num_installments: int
    start_year: int
    start_month: int
    end_year: int
    end_month: int
    purchase_date: dt.date
    paid_by_id: int
    split_mode: SplitMode
    status: InstallmentStatus
    notes: str | None
    created_at: dt.datetime
    # Progress, relative to the current month in APP_TIMEZONE
    installments_billed: int
    installments_remaining: int
    billed_amount: Decimal
    remaining_amount: Decimal
    next_month_amount: Decimal
    remaining_by_user: list[UserAmount]
    schedule: list[InstallmentScheduleItem] | None = None


class InstallmentPlanUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    category: Category | None = None
    notes: str | None = Field(default=None, max_length=2000)


class InstallmentPayoffRequest(BaseModel):
    """Collapse every installment after (year, month) into a single charge in
    that month. Defaults to the current month."""

    year: Year | None = None
    month: Month | None = None


class InstallmentUserTotals(BaseModel):
    user_id: int
    remaining: Decimal
    next_month: Decimal


class InstallmentHub(BaseModel):
    as_of_year: int
    as_of_month: int
    total_remaining_debt: Decimal  # everything billed after the current month
    committed_next_month: Decimal
    per_user: list[InstallmentUserTotals]
    plans: list[InstallmentPlanRead]


class ExpenseCreateResponse(BaseModel):
    """Single expense -> one item. Installment -> N child expenses + the plan."""

    expenses: list[ExpenseRead]
    installment_plan: InstallmentPlanRead | None = None


# ---------------------------------------------------------------------------
# Summary & settlement
# ---------------------------------------------------------------------------


class UserSummary(BaseModel):
    user_id: int
    name: str
    base_income: Decimal
    extra_income: Decimal
    income_transactions: Decimal  # this user's share of INCOME-type entries
    total_income: Decimal
    consumed: Decimal  # this user's share of expenses (budget usage)
    consumed_installments: Decimal  # part of `consumed` coming from MSI plans
    money_left: Decimal  # total_income - consumed
    card_outflow: Decimal  # what this user actually paid to merchants
    transfers_sent: Decimal
    transfers_received: Decimal
    net_balance: Decimal  # >0: is owed money, <0: owes money


class CombinedSummary(BaseModel):
    total_income: Decimal
    consumed: Decimal
    money_left: Decimal
    card_outflow: Decimal


class Debt(BaseModel):
    from_user_id: int
    from_name: str
    to_user_id: int
    to_name: str
    amount: Decimal


class CategoryTotal(BaseModel):
    category: Category
    amount: Decimal


class PeriodSummary(BaseModel):
    period: PeriodRead
    users: list[UserSummary]
    combined: CombinedSummary
    debts: list[Debt]  # empty when settled
    by_category: list[CategoryTotal]
    expense_count: int


class SettleRequest(BaseModel):
    date: dt.date | None = None
    notes: str | None = Field(default=None, max_length=2000)


class SettleResponse(BaseModel):
    transfers: list[ExpenseRead]
    summary: PeriodSummary
