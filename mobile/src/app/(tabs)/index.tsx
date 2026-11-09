import { router, Tabs } from "expo-router";
import { useMemo } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";

import { BalanceBanner } from "@/components/BalanceBanner";
import { ExpenseRow } from "@/components/ExpenseRow";
import { LedgerHeader } from "@/components/LedgerHeader";
import { Avatar, Card, Empty, ErrorState, Loading, MoneyText, ProgressBar, SectionTitle } from "@/components/ui";
import { useActivePeriod, useExpenses, usePeople, useSummary } from "@/hooks/queries";
import { apiErrorMessage } from "@/lib/api";
import { prettyDate } from "@/lib/dates";
import { formatMoney, toSignedCents } from "@/lib/money";
import type { Expense, UserSummary } from "@/lib/types";

type Item = { kind: "date"; date: string } | { kind: "expense"; expense: Expense };

function UserCard({ s, color, title }: { s: UserSummary; color: string; title: string }) {
  const income = toSignedCents(s.total_income);
  const consumed = toSignedCents(s.consumed);
  const left = toSignedCents(s.money_left);
  return (
    <Card className="flex-1">
      <View className="mb-2 flex-row items-center">
        <Avatar name={s.name} color={color} size={24} />
        <Text className="ml-2 text-sm font-semibold text-ink">{title}</Text>
      </View>
      <Text className="text-xs text-ink-muted">Money left</Text>
      <MoneyText value={left} colored={left < 0} className="mb-2 text-xl font-bold text-ink" />
      <ProgressBar ratio={income > 0 ? consumed / income : consumed > 0 ? 1 : 0} color={left < 0 ? "#DC2626" : color} />
      <View className="mt-3 gap-1">
        <Row label="Income" value={s.total_income} />
        <Row label="Spent" value={s.consumed} />
        {toSignedCents(s.consumed_installments) > 0 ? <Row label="  of which MSI" value={s.consumed_installments} /> : null}
        <Row label="Card outflow" value={s.card_outflow} />
      </View>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between">
      <Text className="text-xs text-ink-muted">{label}</Text>
      <Text className="text-xs font-medium text-ink">{formatMoney(value)}</Text>
    </View>
  );
}

export default function MonthScreen() {
  const period = useActivePeriod();
  const periodId = period.data?.id;
  const summary = useSummary(periodId);
  const expenses = useExpenses(periodId);
  const { me, partner, label, color } = usePeople();

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    let last = "";
    for (const e of expenses.data ?? []) {
      if (e.date !== last) out.push({ kind: "date", date: (last = e.date) });
      out.push({ kind: "expense", expense: e });
    }
    return out;
  }, [expenses.data]);

  const header = <Tabs.Screen options={{ headerTitle: () => <LedgerHeader />, headerTitleAlign: "center" }} />;

  if (period.isLoading) return (<>{header}<Loading /></>);
  if (period.error) return (<>{header}<ErrorState message={apiErrorMessage(period.error)} onRetry={() => period.refetch()} /></>);

  const s = summary.data;
  const mine = s?.users.find((u) => u.user_id === me?.id);
  const theirs = s?.users.find((u) => u.user_id === partner?.id);
  const isMonthly = period.data?.kind === "monthly";
  const refreshing = summary.isRefetching || expenses.isRefetching;

  return (
    <View className="flex-1">
      {header}
      <FlatList
        data={items}
        keyExtractor={(it) => (it.kind === "date" ? `d-${it.date}` : `e-${it.expense.id}`)}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              summary.refetch();
              expenses.refetch();
            }}
          />
        }
        contentContainerStyle={{ paddingBottom: 96 }}
        ListHeaderComponent={
          <View className="px-4 pt-2">
            {s ? (
              <Pressable onPress={() => router.push("/balances")}>
                <BalanceBanner debts={s.debts} />
              </Pressable>
            ) : null}

            {mine && theirs ? (
              <View className="mt-3 flex-row gap-3">
                <UserCard s={mine} color={color(mine.user_id)} title="You" />
                <UserCard s={theirs} color={color(theirs.user_id)} title={label(theirs.user_id)} />
              </View>
            ) : null}

            {s && isMonthly ? (
              <Card className="mt-3">
                <View className="flex-row justify-between">
                  <View>
                    <Text className="text-xs text-ink-muted">Together: left this month</Text>
                    <MoneyText
                      value={s.combined.money_left}
                      colored={toSignedCents(s.combined.money_left) < 0}
                      className="text-lg font-bold text-ink"
                    />
                  </View>
                  <View className="items-end">
                    <Text className="text-xs text-ink-muted">Spent / Income</Text>
                    <Text className="text-sm font-medium text-ink">
                      {formatMoney(s.combined.consumed)} / {formatMoney(s.combined.total_income)}
                    </Text>
                  </View>
                </View>
                <Pressable onPress={() => router.push("/income")} className="mt-3">
                  <Text className="text-sm font-semibold text-brand">✏️ Edit monthly income</Text>
                </Pressable>
              </Card>
            ) : null}

            <SectionTitle>{s ? `${s.expense_count} entries` : "Entries"}</SectionTitle>
          </View>
        }
        renderItem={({ item }) =>
          item.kind === "date" ? (
            <Text className="px-5 pb-1 pt-3 text-xs font-semibold text-ink-muted">{prettyDate(item.date)}</Text>
          ) : (
            <ExpenseRow expense={item.expense} />
          )
        }
        ListEmptyComponent={
          expenses.isLoading ? undefined : (
            <Empty emoji="🧾" title="No entries yet" subtitle="Tap + to add the first expense of this ledger." />
          )
        }
      />

      <Pressable
        accessibilityLabel="Add entry"
        onPress={() => router.push("/expense/new")}
        style={{ elevation: 6 }}
        className="absolute bottom-6 right-5 h-16 w-16 items-center justify-center rounded-full bg-brand active:opacity-80"
      >
        <Text className="text-3xl font-light text-white">＋</Text>
      </Pressable>
    </View>
  );
}
