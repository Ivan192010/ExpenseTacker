import { router } from "expo-router";
import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, Switch, Text, View } from "react-native";

import { Card, Empty, ErrorState, Loading, ProgressBar, SectionTitle } from "@/components/ui";
import { useInstallmentsHub, usePeople } from "@/hooks/queries";
import { apiErrorMessage } from "@/lib/api";
import { categoryInfo } from "@/lib/categories";
import { addMonths, ymLabel } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { InstallmentPlan } from "@/lib/types";

function PlanCard({ plan }: { plan: InstallmentPlan }) {
  const { label } = usePeople();
  const cat = categoryInfo(plan.category);
  const done = plan.installments_remaining === 0;
  const statusText =
    plan.status === "paid_off" ? "Paid off early" : plan.status === "cancelled" ? "Cancelled" : done ? "Finished" : null;
  return (
    <Pressable onPress={() => router.push(`/installments/${plan.id}`)} className="mb-3 active:opacity-80">
      <Card>
        <View className="flex-row items-center">
          <Text className="mr-2 text-2xl">{cat.emoji}</Text>
          <View className="flex-1">
            <Text numberOfLines={1} className="text-base font-semibold text-ink">
              {plan.title}
            </Text>
            <Text className="text-xs text-ink-muted">
              {formatMoney(plan.total_amount)} · {plan.num_installments} months · {label(plan.paid_by_id)}'s card
            </Text>
          </View>
          {statusText ? (
            <View className="rounded-md bg-gray-100 px-2 py-0.5">
              <Text className="text-[11px] font-semibold text-ink-muted">{statusText}</Text>
            </View>
          ) : null}
        </View>
        <View className="mt-3">
          <ProgressBar ratio={plan.installments_billed / Math.max(1, plan.installments_billed + plan.installments_remaining)} />
        </View>
        <View className="mt-2 flex-row justify-between">
          <Text className="text-xs text-ink-muted">
            {plan.installments_billed}/{plan.installments_billed + plan.installments_remaining} billed · ends{" "}
            {ymLabel({ year: plan.end_year, month: plan.end_month }, true)}
          </Text>
          <Text className="text-xs font-semibold text-ink">{formatMoney(plan.remaining_amount)} left</Text>
        </View>
      </Card>
    </Pressable>
  );
}

export default function InstallmentsScreen() {
  const [showClosed, setShowClosed] = useState(false);
  const hub = useInstallmentsHub(showClosed);
  const { label } = usePeople();

  if (hub.isLoading) return <Loading />;
  if (hub.error || !hub.data) return <ErrorState message={apiErrorMessage(hub.error)} onRetry={() => hub.refetch()} />;
  const h = hub.data;
  const next = addMonths({ year: h.as_of_year, month: h.as_of_month }, 1);

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={hub.isRefetching} onRefresh={() => void hub.refetch()} />}
    >
      <View className="flex-row gap-3">
        <Card className="flex-1">
          <Text className="text-xs text-ink-muted">Remaining debt</Text>
          <Text className="text-xl font-bold text-ink">{formatMoney(h.total_remaining_debt)}</Text>
          <Text className="text-[11px] text-ink-faint">after {ymLabel({ year: h.as_of_year, month: h.as_of_month }, true)}</Text>
        </Card>
        <Card className="flex-1">
          <Text className="text-xs text-ink-muted">Committed next month</Text>
          <Text className="text-xl font-bold text-ink">{formatMoney(h.committed_next_month)}</Text>
          <Text className="text-[11px] text-ink-faint">{ymLabel(next, true)}</Text>
        </Card>
      </View>

      <Card className="mt-3">
        {h.per_user.map((u, i) => (
          <View key={u.user_id} className={`flex-row justify-between ${i > 0 ? "mt-2" : ""}`}>
            <Text className="text-sm text-ink">{label(u.user_id)}</Text>
            <Text className="text-sm text-ink-muted">
              {formatMoney(u.next_month)} next month · {formatMoney(u.remaining)} total
            </Text>
          </View>
        ))}
      </Card>

      <SectionTitle
        right={
          <View className="flex-row items-center">
            <Text className="mr-2 text-xs text-ink-muted">Show finished</Text>
            <Switch value={showClosed} onValueChange={setShowClosed} trackColor={{ true: "#4F6BED" }} />
          </View>
        }
      >
        Plans
      </SectionTitle>

      {h.plans.length === 0 ? (
        <Empty
          emoji="💳"
          title="No active installment plans"
          subtitle={'Add an expense and turn on "Pay in installments" to spread it over several months.'}
        />
      ) : (
        h.plans.map((p) => <PlanCard key={p.id} plan={p} />)
      )}
    </ScrollView>
  );
}
