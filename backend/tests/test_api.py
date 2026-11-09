import datetime as dt
from decimal import Decimal as D

import pytest

pytestmark = pytest.mark.asyncio

A, B = 1, 2


def expense(**kw):
    body = {
        "title": "Groceries",
        "amount": "100.00",
        "date": "2026-11-05",
        "category": "groceries",
        "paid_by_id": A,
        "split_mode": "equal",
        "splits": [{"user_id": A}, {"user_id": B}],
    }
    body.update(kw)
    return body


async def summary_for(client, year, month):
    period = (await client.post("/periods/monthly", json={"year": year, "month": month})).json()
    r = await client.get(f"/periods/{period['id']}/summary")
    assert r.status_code == 200, r.text
    s = r.json()
    return period, s, {u["user_id"]: u for u in s["users"]}


async def test_requires_auth(db):
    from httpx import ASGITransport, AsyncClient

    from app.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        assert (await c.get("/users")).status_code == 401
        bad = await c.post("/auth/login", json={"email": "a@test.dev", "password": "nope", "device_id": "dev-xyz-123"})
        assert bad.status_code == 401


async def test_proxy_purchase_partner_owes_payer(client):
    r = await client.post(
        "/expenses",
        json=expense(
            title="Partner's sneakers",
            amount="500.00",
            category="shopping",
            split_mode="percentage",
            splits=[{"user_id": A, "value": "0"}, {"user_id": B, "value": "100"}],
        ),
    )
    assert r.status_code == 201, r.text

    _, s, users = await summary_for(client, 2026, 11)
    assert D(users[A]["consumed"]) == 0
    assert D(users[B]["consumed"]) == D("500")
    assert D(users[A]["card_outflow"]) == D("500")
    assert D(users[B]["card_outflow"]) == 0
    assert s["debts"] == [
        {"from_user_id": B, "from_name": "Partner", "to_user_id": A, "to_name": "Ivan", "amount": "500.00"}
    ]


async def test_income_money_left_and_carry_over(client):
    nov, _, _ = await summary_for(client, 2026, 11)
    r = await client.put(f"/periods/{nov['id']}/incomes/{A}", json={"base_amount": "30000", "extra_amount": "5000"})
    assert r.status_code == 200, r.text
    await client.post("/expenses", json=expense(amount="1000.00"))

    _, s, users = await summary_for(client, 2026, 11)
    assert D(users[A]["total_income"]) == D("35000")
    assert D(users[A]["money_left"]) == D("34500")
    assert D(s["combined"]["consumed"]) == D("1000")

    # December inherits the base income (not the bonus)...
    dec, _, users = await summary_for(client, 2026, 12)
    assert D(users[A]["base_income"]) == D("30000") and D(users[A]["extra_income"]) == 0

    # ...and follows later edits of November until someone edits December itself.
    await client.put(f"/periods/{nov['id']}/incomes/{A}", json={"base_amount": "32000"})
    _, _, users = await summary_for(client, 2026, 12)
    assert D(users[A]["base_income"]) == D("32000")

    await client.put(f"/periods/{dec['id']}/incomes/{A}", json={"base_amount": "31000"})
    await client.put(f"/periods/{nov['id']}/incomes/{A}", json={"base_amount": "40000"})
    _, _, users = await summary_for(client, 2026, 12)
    assert D(users[A]["base_income"]) == D("31000")


async def test_installments_generate_future_months(client, today):
    today(dt.date(2026, 11, 8))
    r = await client.post(
        "/expenses",
        json=expense(
            title="Dyson Airwrap",
            amount="12000.00",
            category="shopping",
            installment={"num_installments": 6},
        ),
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert len(body["expenses"]) == 6
    assert [e["amount"] for e in body["expenses"]] == ["2000.00"] * 6
    assert body["expenses"][1]["installment_label"] == "Installment 2/6 - Dyson Airwrap"
    assert body["expenses"][5]["date"] == "2027-04-05"
    plan = body["installment_plan"]
    assert plan["end_year"] == 2027 and plan["end_month"] == 4
    assert plan["installments_billed"] == 1 and D(plan["remaining_amount"]) == D("10000")

    _, s, users = await summary_for(client, 2027, 2)
    assert D(users[A]["consumed"]) == D("1000") and D(users[A]["consumed_installments"]) == D("1000")
    assert D(users[A]["card_outflow"]) == D("2000")
    assert s["debts"][0]["amount"] == "1000.00"

    hub = (await client.get("/installments")).json()
    assert D(hub["total_remaining_debt"]) == D("10000")
    assert D(hub["committed_next_month"]) == D("2000")
    assert {u["user_id"]: D(u["remaining"]) for u in hub["per_user"]} == {A: D("5000"), B: D("5000")}

    # Children of a plan are locked
    child_id = body["expenses"][2]["id"]
    assert (await client.patch(f"/expenses/{child_id}", json={"amount": "1.00"})).status_code == 409
    assert (await client.delete(f"/expenses/{child_id}")).status_code == 409
    assert (await client.patch(f"/expenses/{child_id}", json={"title": "Airwrap"})).status_code == 200


async def test_installment_proxy_split_and_payoff(client, today):
    today(dt.date(2026, 11, 8))
    r = await client.post(
        "/expenses",
        json=expense(
            title="Partner's phone",
            amount="1000.01",
            split_mode="percentage",
            splits=[{"user_id": B, "value": "100"}],
            installment={"num_installments": 3, "start_year": 2026, "start_month": 12},
        ),
    )
    assert r.status_code == 201, r.text
    plan_id = r.json()["installment_plan"]["id"]
    assert [e["amount"] for e in r.json()["expenses"]] == ["333.34", "333.34", "333.33"]

    r = await client.post(f"/installments/{plan_id}/payoff", json={"year": 2026, "month": 12})
    assert r.status_code == 200, r.text
    plan = (await client.get(f"/installments/{plan_id}")).json()
    assert plan["status"] == "paid_off"
    assert [(i["year"], i["month"], i["amount"], i["is_payoff"]) for i in plan["schedule"]] == [
        (2026, 12, "333.34", False),
        (2026, 12, "666.67", True),
    ]
    _, _, users = await summary_for(client, 2026, 12)
    assert D(users[B]["consumed"]) == D("1000.01") and D(users[A]["consumed"]) == 0
    _, s, _ = await summary_for(client, 2027, 1)
    assert s["expense_count"] == 0


async def test_cancel_and_delete_plan(client, today):
    today(dt.date(2026, 12, 1))
    r = await client.post(
        "/expenses", json=expense(amount="600", date="2026-11-20", installment={"num_installments": 6})
    )
    plan_id = r.json()["installment_plan"]["id"]
    r = await client.post(f"/installments/{plan_id}/cancel")
    assert r.status_code == 200, r.text
    assert r.json()["installments_billed"] == 2 and r.json()["installments_remaining"] == 0
    assert (await client.delete(f"/installments/{plan_id}")).status_code == 204
    _, s, _ = await summary_for(client, 2026, 11)
    assert s["expense_count"] == 0


async def test_settle_up_zeroes_balance_but_keeps_budgets(client):
    await client.post("/expenses", json=expense(amount="300.00"))
    await client.post("/expenses", json=expense(amount="50.00", paid_by_id=B))
    nov, s, users = await summary_for(client, 2026, 11)
    assert s["debts"][0]["from_user_id"] == B and s["debts"][0]["amount"] == "125.00"

    r = await client.post(f"/periods/{nov['id']}/settle", json={})
    assert r.status_code == 200, r.text
    after = r.json()["summary"]
    assert after["debts"] == []
    after_users = {u["user_id"]: u for u in after["users"]}
    for uid in (A, B):
        assert after_users[uid]["consumed"] == users[uid]["consumed"]
        assert after_users[uid]["net_balance"] == "0.00"
    assert (await client.post(f"/periods/{nov['id']}/settle", json={})).status_code == 409


async def test_income_transaction_and_transfer_validation(client):
    # Ivan receives a 200 refund for something both used
    r = await client.post("/expenses", json=expense(title="Refund", type="income", amount="200.00"))
    assert r.status_code == 201, r.text
    _, s, users = await summary_for(client, 2026, 11)
    assert D(users[B]["total_income"]) == D("100")
    assert s["debts"][0]["from_user_id"] == A and s["debts"][0]["amount"] == "100.00"

    bad = await client.post("/expenses", json=expense(type="transfer", splits=[{"user_id": A}]))
    assert bad.status_code == 422


async def test_update_expense_resplits_and_moves_month(client):
    e = (await client.post("/expenses", json=expense(amount="90.00"))).json()["expenses"][0]
    r = await client.patch(
        f"/expenses/{e['id']}",
        json={"split_mode": "shares", "splits": [{"user_id": A, "value": "2"}, {"user_id": B, "value": "1"}]},
    )
    assert r.status_code == 200, r.text
    assert {s["user_id"]: s["amount"] for s in r.json()["splits"]} == {A: "60.00", B: "30.00"}

    r = await client.patch(f"/expenses/{e['id']}", json={"amount": "120.00", "date": "2026-12-01"})
    assert r.status_code == 200, r.text
    assert {s["user_id"]: s["amount"] for s in r.json()["splits"]} == {A: "80.00", B: "40.00"}
    dec, _, _ = await summary_for(client, 2026, 12)
    assert r.json()["period_id"] == dec["id"]


async def test_device_binding(client):
    async def login(device):
        return await client.post(
            "/auth/login", json={"email": "a@test.dev", "password": "pw-a", "device_id": device}
        )

    assert (await login("device-a-0002")).status_code == 200
    assert (await login("device-a-0003")).status_code == 403  # limit is 2

    devices = (await client.get("/auth/devices")).json()
    other = next(d for d in devices if not d["is_current"])
    assert (await client.delete(f"/auth/devices/{other['id']}")).status_code == 204
    third = await login("device-a-0003")
    assert third.status_code == 200

    # A revoked device's token stops working immediately
    current = next(d for d in devices if d["is_current"])
    assert (await client.delete(f"/auth/devices/{current['id']}")).status_code == 204
    assert (await client.get("/users")).status_code == 401
