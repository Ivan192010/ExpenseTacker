from decimal import Decimal as D

import pytest

from app.models import SplitMode
from app.schemas import SplitInput
from app.services import DomainError, allocate_cents, resolve_splits, schedule_installments


def amounts(resolved):
    return {r.user_id: r.cents for r in resolved}


def test_equal_split_odd_cent_never_lost():
    r = resolve_splits(D("100.01"), SplitMode.EQUAL, [SplitInput(user_id=2), SplitInput(user_id=1)])
    assert amounts(r) == {1: 5001, 2: 5000}


def test_percentage_split():
    r = resolve_splits(
        D("100.00"),
        SplitMode.PERCENTAGE,
        [SplitInput(user_id=1, value=D("33.33")), SplitInput(user_id=2, value=D("66.67"))],
    )
    assert amounts(r) == {1: 3333, 2: 6667}


def test_proxy_purchase_drops_zero_share():
    r = resolve_splits(
        D("500"), SplitMode.PERCENTAGE, [SplitInput(user_id=1, value=D("0")), SplitInput(user_id=2, value=D("100"))]
    )
    assert amounts(r) == {2: 50000}


def test_shares_split():
    r = resolve_splits(
        D("90"), SplitMode.SHARES, [SplitInput(user_id=1, value=D("2")), SplitInput(user_id=2, value=D("1"))]
    )
    assert amounts(r) == {1: 6000, 2: 3000}


def test_exact_split_must_match_total():
    with pytest.raises(DomainError):
        resolve_splits(
            D("100"), SplitMode.EXACT, [SplitInput(user_id=1, value=D("60")), SplitInput(user_id=2, value=D("30"))]
        )


def test_allocate_always_sums():
    for total in (1, 2, 99, 100, 101, 1_000_003):
        for weights in ([1, 1, 1], [D("33.3"), D("33.3"), D("33.4")], [7, 0, 3]):
            parts = allocate_cents(total, weights)
            assert sum(parts) == total
            assert all(p >= 0 for p in parts)
    assert allocate_cents(10, [7, 0, 3])[1] == 0


@pytest.mark.parametrize(
    "total,n,users",
    [(1_200_000, 6, {1: 600_000, 2: 600_000}), (100_001, 3, {1: 70_001, 2: 30_000}), (999, 12, {1: 1, 2: 998})],
)
def test_installment_schedule_rows_and_columns_exact(total, n, users):
    sched = schedule_installments(total, n, users)
    assert len(sched) == n
    month_totals = [sum(m.values()) for m in sched]
    assert sum(month_totals) == total
    assert max(month_totals) - min(month_totals) <= 1
    for u, t in users.items():
        assert sum(m.get(u, 0) for m in sched) == t
