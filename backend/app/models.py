"""SQLAlchemy 2.0 (async) models.

All currency columns are NUMERIC(12, 2) and map to `decimal.Decimal` in Python.
Enums are stored as constrained VARCHARs (native_enum=False) so adding a new
category later is a code change, not a Postgres `ALTER TYPE` migration.
"""

from __future__ import annotations

import enum
import datetime as dt
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

Money = Numeric(12, 2)
SplitValue = Numeric(12, 4)  # raw user input: percentage, weight or exact amount


def _enum(cls: type[enum.Enum], name: str) -> Enum:
    return Enum(
        cls,
        name=name,
        native_enum=False,
        length=24,
        values_callable=lambda e: [m.value for m in e],
        validate_strings=True,
    )


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class PeriodKind(str, enum.Enum):
    MONTHLY = "monthly"
    EVENT = "event"  # custom ledger, e.g. "Vacation Cancún"


class TransactionType(str, enum.Enum):
    EXPENSE = "expense"
    INCOME = "income"  # money received (refund, shared bonus) split between beneficiaries
    TRANSFER = "transfer"  # settlement / reimbursement between the couple


class SplitMode(str, enum.Enum):
    EQUAL = "equal"
    EXACT = "exact"
    PERCENTAGE = "percentage"
    SHARES = "shares"


class Category(str, enum.Enum):
    GROCERIES = "groceries"
    DINING = "dining"
    BILLS = "bills"
    RENT = "rent"
    SHOPPING = "shopping"
    TRANSPORT = "transport"
    HEALTH = "health"
    ENTERTAINMENT = "entertainment"
    TRAVEL = "travel"
    SUBSCRIPTIONS = "subscriptions"
    HOME = "home"
    PETS = "pets"
    GIFTS = "gifts"
    EDUCATION = "education"
    SETTLEMENT = "settlement"
    OTHER = "other"


class InstallmentStatus(str, enum.Enum):
    ACTIVE = "active"
    PAID_OFF = "paid_off"  # remaining installments collapsed into one early payoff
    CANCELLED = "cancelled"  # remaining installments deleted


# ---------------------------------------------------------------------------
# Users & devices
# ---------------------------------------------------------------------------


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    email: Mapped[str] = mapped_column(String(255), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    color: Mapped[str] = mapped_column(String(16), default="#5B8DEF")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    devices: Mapped[list[Device]] = relationship(
        back_populates="user", cascade="all, delete-orphan", lazy="raise"
    )


class Device(Base):
    """A phone bound to a user. Every JWT carries the device row id; revoking the
    device instantly invalidates that phone's token."""

    __tablename__ = "devices"
    __table_args__ = (UniqueConstraint("user_id", "device_uid"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    device_uid: Mapped[str] = mapped_column(String(128))
    device_name: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_seen_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship(back_populates="devices", lazy="raise")


# ---------------------------------------------------------------------------
# Ledgers
# ---------------------------------------------------------------------------


class MonthlyPeriod(Base):
    """A ledger. Normally one per calendar month; `kind=event` is a free-form
    ledger (e.g. a vacation) with no year/month and no income pool."""

    __tablename__ = "monthly_periods"
    __table_args__ = (
        # NULLs are distinct in Postgres, so event ledgers never collide here.
        UniqueConstraint("year", "month"),
        CheckConstraint(
            "(kind = 'monthly' AND year IS NOT NULL AND month BETWEEN 1 AND 12)"
            " OR (kind = 'event' AND year IS NULL AND month IS NULL)",
            name="kind_matches_year_month",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[PeriodKind] = mapped_column(_enum(PeriodKind, "period_kind"), default=PeriodKind.MONTHLY)
    name: Mapped[str] = mapped_column(String(120))
    year: Mapped[int | None] = mapped_column(Integer)
    month: Mapped[int | None] = mapped_column(Integer)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class MonthlyIncome(Base):
    __tablename__ = "monthly_incomes"
    __table_args__ = (UniqueConstraint("period_id", "user_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    period_id: Mapped[int] = mapped_column(ForeignKey("monthly_periods.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    base_amount: Mapped[Decimal] = mapped_column(Money, default=Decimal("0.00"))
    extra_amount: Mapped[Decimal] = mapped_column(Money, default=Decimal("0.00"))  # bonuses, side gigs
    note: Mapped[str | None] = mapped_column(String(255))
    # True while the value was copied from the previous month and never edited.
    # Editing an earlier month can propagate forward to these rows.
    is_carried_over: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    @property
    def total(self) -> Decimal:
        return (self.base_amount or Decimal(0)) + (self.extra_amount or Decimal(0))


# ---------------------------------------------------------------------------
# Installments (Meses sin Intereses)
# ---------------------------------------------------------------------------


class InstallmentPlan(Base):
    __tablename__ = "installment_plans"
    __table_args__ = (
        CheckConstraint("num_installments BETWEEN 2 AND 48", name="num_installments_range"),
        CheckConstraint("total_amount > 0", name="total_positive"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(160))
    category: Mapped[Category] = mapped_column(_enum(Category, "category"), default=Category.OTHER)
    total_amount: Mapped[Decimal] = mapped_column(Money)
    num_installments: Mapped[int] = mapped_column(Integer)
    start_year: Mapped[int] = mapped_column(Integer)
    start_month: Mapped[int] = mapped_column(Integer)
    purchase_date: Mapped[dt.date] = mapped_column(Date)
    paid_by_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    split_mode: Mapped[SplitMode] = mapped_column(_enum(SplitMode, "split_mode"))
    # The split exactly as entered: [{"user_id": 1, "value": "50"}, ...]
    split_template: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    status: Mapped[InstallmentStatus] = mapped_column(
        _enum(InstallmentStatus, "installment_status"), default=InstallmentStatus.ACTIVE
    )
    notes: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    closed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))

    # Always queried explicitly; children are removed by ON DELETE CASCADE.
    expenses: Mapped[list[Expense]] = relationship(
        back_populates="installment_plan", lazy="raise", passive_deletes=True
    )


# ---------------------------------------------------------------------------
# Expenses & splits
# ---------------------------------------------------------------------------


class Expense(Base):
    """A transaction in a ledger.

    * EXPENSE:  `paid_by` paid the merchant; splits say who consumed it.
    * INCOME:   `paid_by` received the money; splits say who benefits.
    * TRANSFER: `paid_by` sent money to the single user in splits (settle up).
    """

    __tablename__ = "expenses"
    __table_args__ = (
        CheckConstraint("amount > 0", name="amount_positive"),
        Index("ix_expenses_period_date", "period_id", "date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    period_id: Mapped[int] = mapped_column(ForeignKey("monthly_periods.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(160))
    amount: Mapped[Decimal] = mapped_column(Money)
    date: Mapped[dt.date] = mapped_column(Date)
    category: Mapped[Category] = mapped_column(_enum(Category, "category"), default=Category.OTHER)
    type: Mapped[TransactionType] = mapped_column(
        _enum(TransactionType, "transaction_type"), default=TransactionType.EXPENSE
    )
    split_mode: Mapped[SplitMode] = mapped_column(_enum(SplitMode, "split_mode"), default=SplitMode.EQUAL)
    paid_by_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    notes: Mapped[str | None] = mapped_column(Text)

    installment_plan_id: Mapped[int | None] = mapped_column(
        ForeignKey("installment_plans.id", ondelete="CASCADE"), index=True
    )
    installment_number: Mapped[int | None] = mapped_column(Integer)  # 1-based; NULL for payoff rows
    is_installment_payoff: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    splits: Mapped[list[ExpenseSplit]] = relationship(
        back_populates="expense",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="ExpenseSplit.user_id",
    )
    installment_plan: Mapped[InstallmentPlan | None] = relationship(
        back_populates="expenses", lazy="selectin"
    )

    @property
    def installment_label(self) -> str | None:
        plan = self.installment_plan
        if plan is None:
            return None
        if self.is_installment_payoff:
            return f"Early payoff - {plan.title}"
        return f"Installment {self.installment_number}/{plan.num_installments} - {plan.title}"


class ExpenseSplit(Base):
    __tablename__ = "expense_splits"
    __table_args__ = (UniqueConstraint("expense_id", "user_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    expense_id: Mapped[int] = mapped_column(ForeignKey("expenses.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    amount: Mapped[Decimal] = mapped_column(Money)  # resolved share in currency, always sums to Expense.amount
    input_value: Mapped[Decimal | None] = mapped_column(SplitValue)  # what the user typed (%, weight, exact)

    expense: Mapped[Expense] = relationship(back_populates="splits", lazy="raise")
