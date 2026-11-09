import * as Haptics from "expo-haptics";
import { Tabs } from "expo-router";
import { Alert, RefreshControl, ScrollView, Text, View } from "react-native";

import { debtSentence } from "@/components/BalanceBanner";
import { LedgerHeader } from "@/components/LedgerHeader";
import { Avatar, Button, Card, ErrorState, Loading, MoneyText, SectionTitle } from "@/components/ui";
import { useActivePeriod, usePeople, useSettle, useSummary } from "@/hooks/queries";
import { apiErrorMessage } from "@/lib/api";
import { categoryInfo } from "@/lib/categories";
import { formatMoney, toSignedCents } from "@/lib/money";

export default function BalancesScreen() {
  const period = useActivePeriod();
  const summary = useSummary(period.data?.id);
  const settle = useSettle();
  const { label, color, me } = usePeople();

  const header = <Tabs.Screen options={{ headerTitle: () => <LedgerHeader />, headerTitleAlign: "center" }} />;
  if (period.isLoading || summary.isLoading) return (<>{header}<Loading /></>);
  const err = period.error ?? summary.error;
  if (err || !summary.data) return (<>{header}<ErrorState message={apiErrorMessage(err)} onRetry={() => summary.refetch()} /></>);

  const s = summary.data;
  const debt = s.debts[0];
  const maxAbs = Math.max(1, ...s.users.map((u) => Math.abs(toSignedCents(u.net_balance))));

  const confirmSettle = () => {
    if (!debt) return;
    Alert.alert(
      "Settle up?",
      `This records a transfer of ${formatMoney(debt.amount)} from ${label(debt.from_user_id)} to ${label(
        debt.to_user_id,
      )}. Spending totals stay the same.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Mark as paid",
          onPress: async () => {
            try {
              await settle.mutateAsync(s.period.id);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            } catch (e) {
              Alert.alert("Couldn't settle", apiErrorMessage(e));
            }
          },
        },
      ],
    );
  };

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={summary.isRefetching} onRefresh={() => void summary.refetch()} />}
    >
      {header}

      {/* Tricount-style balance bars: green to the right = is owed, red to the left = owes */}
      <Card>
        {s.users.map((u, i) => {
          const cents = toSignedCents(u.net_balance);
          const pct = (Math.abs(cents) / maxAbs) * 50;
          return (
            <View key={u.user_id} className={i > 0 ? "mt-4" : ""}>
              <View className="mb-1 flex-row items-center justify-between">
                <View className="flex-row items-center">
                  <Avatar name={u.name} color={color(u.user_id)} size={22} />
                  <Text className="ml-2 text-sm font-medium text-ink">{label(u.user_id)}</Text>
                </View>
                <MoneyText value={cents} signed colored className="text-sm font-semibold" />
              </View>
              <View className="h-6 flex-row overflow-hidden rounded-md bg-gray-100">
                <View className="flex-1 flex-row justify-end">
                  {cents < 0 ? <View style={{ width: `${pct * 2}%` }} className="h-6 rounded-l-md bg-red-400" /> : null}
                </View>
                <View className="w-px bg-gray-300" />
                <View className="flex-1 flex-row">
                  {cents > 0 ? <View style={{ width: `${pct * 2}%` }} className="h-6 rounded-r-md bg-green-400" /> : null}
                </View>
              </View>
            </View>
          );
        })}
      </Card>

      <SectionTitle>How to balance</SectionTitle>
      <Card>
        <Text
          className={`text-lg font-bold ${
            !debt ? "text-positive" : debt.from_user_id === me?.id ? "text-negative" : "text-brand-dark"
          }`}
        >
          {debtSentence(debt, label)}
        </Text>
        {debt ? (
          <>
            <Text className="mt-1 text-sm text-ink-muted">
              After paying, tap below. It creates a transfer entry so the balance goes to zero without changing
              anyone's spending.
            </Text>
            <Button title="Settle up / Mark as paid" className="mt-4" onPress={confirmSettle} loading={settle.isPending} />
          </>
        ) : null}
      </Card>

      <SectionTitle>Who paid vs. who consumed</SectionTitle>
      <Card>
        {s.users.map((u, i) => (
          <View key={u.user_id} className={`flex-row justify-between ${i > 0 ? "mt-2" : ""}`}>
            <Text className="text-sm text-ink">{label(u.user_id)}</Text>
            <Text className="text-sm text-ink-muted">
              paid {formatMoney(u.card_outflow)} · used {formatMoney(u.consumed)}
            </Text>
          </View>
        ))}
        {s.users.some((u) => toSignedCents(u.transfers_sent) > 0) ? (
          <Text className="mt-3 text-xs text-ink-muted">
            Transfers:{" "}
            {s.users
              .filter((u) => toSignedCents(u.transfers_sent) > 0)
              .map((u) => `${label(u.user_id)} sent ${formatMoney(u.transfers_sent)}`)
              .join(", ")}
          </Text>
        ) : null}
      </Card>

      {s.by_category.length > 0 ? (
        <>
          <SectionTitle>Spending by category</SectionTitle>
          <Card>
            {s.by_category.map((c, i) => {
              const info = categoryInfo(c.category);
              return (
                <View key={c.category} className={`flex-row justify-between ${i > 0 ? "mt-2" : ""}`}>
                  <Text className="text-sm text-ink">
                    {info.emoji} {info.label}
                  </Text>
                  <Text className="text-sm font-medium text-ink">{formatMoney(c.amount)}</Text>
                </View>
              );
            })}
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}
