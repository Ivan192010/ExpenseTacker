from __future__ import annotations

import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Depends, FastAPI, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import auth, services
from app.auth import CurrentAuth, CurrentUser
from app.config import get_settings
from app.database import get_session
from app.models import Device, MonthlyPeriod, PeriodKind
from app.schemas import (
    DeviceRead,
    EventLedgerCreate,
    ExpenseCreate,
    ExpenseCreateResponse,
    ExpenseRead,
    ExpenseUpdate,
    IncomeRead,
    IncomeUpdate,
    InstallmentHub,
    InstallmentPayoffRequest,
    InstallmentPlanRead,
    InstallmentPlanUpdate,
    LoginRequest,
    MonthlyPeriodCreate,
    PeriodDetail,
    PeriodRead,
    PeriodSummary,
    SettleRequest,
    SettleResponse,
    TokenResponse,
    UserRead,
)

Session = Annotated[AsyncSession, Depends(get_session)]

app = FastAPI(title="CoupleCount API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in get_settings().cors_origins.split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(services.DomainError)
async def _domain_error(_: Request, exc: services.DomainError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})


@app.get("/health", include_in_schema=False)
async def health() -> dict[str, str]:
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

auth_router = APIRouter(prefix="/auth", tags=["auth"])


@auth_router.post("/login", response_model=TokenResponse)
async def login(data: LoginRequest, session: Session) -> TokenResponse:
    return await auth.login(session, data)


@auth_router.get("/me", response_model=UserRead)
async def me(user: CurrentUser) -> UserRead:
    return UserRead.model_validate(user)


@auth_router.get("/devices", response_model=list[DeviceRead])
async def list_devices(ctx: CurrentAuth, session: Session) -> list[DeviceRead]:
    devices = await session.scalars(
        select(Device).where(Device.user_id == ctx.user.id).order_by(Device.created_at.desc())
    )
    return [
        DeviceRead.model_validate(d).model_copy(update={"is_current": d.id == ctx.device.id}) for d in devices
    ]


@auth_router.delete("/devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_device(device_id: int, ctx: CurrentAuth, session: Session) -> Response:
    device = await session.get(Device, device_id)
    if device is None or device.user_id != ctx.user.id:
        raise services.NotFound("Device not found")
    device.revoked_at = dt.datetime.now(dt.timezone.utc)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Everything below requires a valid token from a bound device.
api = APIRouter(dependencies=[Depends(auth.get_auth_context)])


@api.get("/users", response_model=list[UserRead], tags=["users"])
async def list_users(session: Session) -> list[UserRead]:
    return [UserRead.model_validate(u) for u in await services.list_users(session)]


# ---------------------------------------------------------------------------
# Periods / ledgers
# ---------------------------------------------------------------------------


async def _period_detail(session: AsyncSession, period: MonthlyPeriod) -> PeriodDetail:
    incomes = await services.get_incomes(session, period.id)
    return PeriodDetail(
        **PeriodRead.model_validate(period).model_dump(),
        incomes=[IncomeRead.model_validate(i) for i in incomes],
    )


@api.get("/periods", response_model=list[PeriodRead], tags=["periods"])
async def list_periods(session: Session, include_archived: bool = False) -> list[PeriodRead]:
    return [PeriodRead.model_validate(p) for p in await services.list_periods(session, include_archived)]


@api.get("/periods/current", response_model=PeriodDetail, tags=["periods"])
async def current_period(session: Session) -> PeriodDetail:
    """The ledger for this calendar month (created on first access)."""
    y, m = services.current_ym()
    period = await services.get_or_create_monthly_period(session, y, m)
    await session.commit()
    return await _period_detail(session, period)


@api.post("/periods/monthly", response_model=PeriodDetail, tags=["periods"])
async def open_month(data: MonthlyPeriodCreate, session: Session) -> PeriodDetail:
    """Get-or-create the ledger for a given month (idempotent)."""
    period = await services.get_or_create_monthly_period(session, data.year, data.month)
    await session.commit()
    return await _period_detail(session, period)


@api.post("/periods/events", response_model=PeriodRead, status_code=201, tags=["periods"])
async def create_event(data: EventLedgerCreate, session: Session) -> PeriodRead:
    return PeriodRead.model_validate(await services.create_event_ledger(session, data.name))


@api.get("/periods/{period_id}", response_model=PeriodDetail, tags=["periods"])
async def get_period(period_id: int, session: Session) -> PeriodDetail:
    return await _period_detail(session, await services.get_period(session, period_id))


@api.put("/periods/{period_id}/incomes/{user_id}", response_model=IncomeRead, tags=["periods"])
async def set_income(period_id: int, user_id: int, data: IncomeUpdate, session: Session) -> IncomeRead:
    return IncomeRead.model_validate(await services.update_income(session, period_id, user_id, data))


@api.get("/periods/{period_id}/expenses", response_model=list[ExpenseRead], tags=["expenses"])
async def period_expenses(period_id: int, session: Session) -> list[ExpenseRead]:
    return [ExpenseRead.model_validate(e) for e in await services.list_period_expenses(session, period_id)]


@api.get("/periods/{period_id}/summary", response_model=PeriodSummary, tags=["balances"])
async def period_summary(period_id: int, session: Session) -> PeriodSummary:
    return await services.compute_period_summary(session, period_id)


@api.post("/periods/{period_id}/settle", response_model=SettleResponse, tags=["balances"])
async def settle(period_id: int, data: SettleRequest, user: CurrentUser, session: Session) -> SettleResponse:
    transfers = await services.settle_period(session, period_id, data, user)
    return SettleResponse(
        transfers=[ExpenseRead.model_validate(t) for t in transfers],
        summary=await services.compute_period_summary(session, period_id),
    )


# ---------------------------------------------------------------------------
# Expenses
# ---------------------------------------------------------------------------


@api.post("/expenses", response_model=ExpenseCreateResponse, status_code=201, tags=["expenses"])
async def create_expense(data: ExpenseCreate, user: CurrentUser, session: Session) -> ExpenseCreateResponse:
    if data.period_id is not None:
        period = await services.get_period(session, data.period_id)
        if period.kind == PeriodKind.MONTHLY and (period.year, period.month) != (data.date.year, data.date.month):
            raise services.DomainError("The date must fall inside the selected month")
    expenses, plan = await services.create_expense(session, data, user)
    return ExpenseCreateResponse(
        expenses=[ExpenseRead.model_validate(e) for e in expenses],
        installment_plan=await services.get_installment_plan_read(session, plan.id) if plan else None,
    )


@api.get("/expenses/{expense_id}", response_model=ExpenseRead, tags=["expenses"])
async def get_expense(expense_id: int, session: Session) -> ExpenseRead:
    return ExpenseRead.model_validate(await services.get_expense(session, expense_id))


@api.patch("/expenses/{expense_id}", response_model=ExpenseRead, tags=["expenses"])
async def update_expense(expense_id: int, data: ExpenseUpdate, session: Session) -> ExpenseRead:
    return ExpenseRead.model_validate(await services.update_expense(session, expense_id, data))


@api.delete("/expenses/{expense_id}", status_code=204, tags=["expenses"])
async def delete_expense(expense_id: int, session: Session) -> Response:
    await services.delete_expense(session, expense_id)
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Installments hub
# ---------------------------------------------------------------------------


@api.get("/installments", response_model=InstallmentHub, tags=["installments"])
async def installments_hub(
    session: Session,
    include_closed: Annotated[bool, Query(description="Also list finished / paid-off / cancelled plans")] = False,
) -> InstallmentHub:
    return await services.installments_hub(session, include_closed)


@api.get("/installments/{plan_id}", response_model=InstallmentPlanRead, tags=["installments"])
async def get_plan(plan_id: int, session: Session) -> InstallmentPlanRead:
    return await services.get_installment_plan_read(session, plan_id, include_schedule=True)


@api.patch("/installments/{plan_id}", response_model=InstallmentPlanRead, tags=["installments"])
async def update_plan(plan_id: int, data: InstallmentPlanUpdate, session: Session) -> InstallmentPlanRead:
    return await services.update_installment_plan(session, plan_id, data)


@api.post("/installments/{plan_id}/payoff", response_model=InstallmentPlanRead, tags=["installments"])
async def pay_off_plan(
    plan_id: int, data: InstallmentPayoffRequest, user: CurrentUser, session: Session
) -> InstallmentPlanRead:
    return await services.pay_off_installment_plan(session, plan_id, data, user)


@api.post("/installments/{plan_id}/cancel", response_model=InstallmentPlanRead, tags=["installments"])
async def cancel_remaining(plan_id: int, session: Session) -> InstallmentPlanRead:
    """Delete installments after the current month; past months stay as history."""
    result = await services.cancel_installment_plan(session, plan_id, scope="remaining")
    assert result is not None
    return result


@api.delete("/installments/{plan_id}", status_code=204, tags=["installments"])
async def delete_plan(plan_id: int, session: Session) -> Response:
    """Delete the plan and ALL its installments, including past months."""
    await services.cancel_installment_plan(session, plan_id, scope="all")
    return Response(status_code=204)


app.include_router(auth_router)
app.include_router(api)
