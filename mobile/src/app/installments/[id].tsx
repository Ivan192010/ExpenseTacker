import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";

import { Button, Card, ErrorState, Field, Loading, SectionTitle } from "@/components/ui";
import { useInstallmentPlan, usePeople, usePlanActions } from "@/hooks/queries";
import { apiErrorMessage } from "@/lib/api";
import { categoryInfo } from "@/lib/categories";
import { currentYM, ymLabel } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

export default function InstallmentPlanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const planId = Number(id);
  const q = useInstallmentPlan(planId);
  const actions = usePlanActions(planId);
  const { label } = usePeople();
  const [title, setTitle] = useState<string | null>(null);

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState message={apiErrorMessage(q.error)} onRetry={() => q.refetch()} />;
  const plan = q.data;
  const cat = categoryInfo(plan.category);
  const active = plan.status === "active" && plan.installments_remaining > 0;

  const run = (fn: () => Promise<unknown>, after?: () => void) => async () => {
    try {
      await fn();
      after?.();
    } catch (e) {
      Alert.alert("Something went wrong", apiErrorMessage(e));
    }
  };

  const confirmPayOff = () =>
    Alert.alert(
      "Pay off early?",
      `The ${plan.installments_remaining} remaining installments (${formatMoney(plan.remaining_amount)}) move into ${ymLabel(
        currentYM(),
      )} as one charge. Each person's share stays the same.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Pay off", onPress: run(() => actions.payOff.mutateAsync()) },
      ],
    );

  const confirmCancel = () =>
    Alert.alert(
      "Cancel remaining installments?",
      "Future months are removed (e.g. the purchase was returned). Months already billed stay in your history.",
      [
        { text: "Keep", style: "cancel" },
        { text: "Cancel remaining", style: "destructive", onPress: run(() => actions.cancelRemaining.mutateAsync()) },
      ],
    );

  const confirmDelete = () =>
    Alert.alert("Delete entire plan?", "Every installment, including past months, will be deleted.", [
      { text: "Keep", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: run(() => actions.remove.mutateAsync(), () => router.back()) },
    ]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Stack.Screen options={{ title: plan.title }} />

      <Card>
        <Text className="text-3xl">{cat.emoji}</Text>
        <Text className="mt-1 text-xl font-bold text-ink">{plan.title}</Text>
        <Text className="text-sm text-ink-muted">
          {formatMoney(plan.total_amount)} on {label(plan.paid_by_id)}'s card · {plan.num_installments} months
        </Text>
        <View className="mt-4 flex-row justify-between">
          <Stat label="Billed" value={formatMoney(plan.billed_amount)} />
          <Stat label="Remaining" value={formatMoney(plan.remaining_amount)} />
          <Stat label="Next month" value={formatMoney(plan.next_month_amount)} />
        </View>
        {plan.remaining_by_user.length > 0 ? (
          <Text className="mt-3 text-xs text-ink-muted">
            Still to pay: {plan.remaining_by_user.map((u) => `${label(u.user_id)} ${formatMoney(u.amount)}`).join(" · ")}
          </Text>
        ) : null}
      </Card>

      <SectionTitle>Schedule</SectionTitle>
      <Card className="p-0">
        {(plan.schedule ?? []).map((item, i) => (
          <View
            key={item.expense_id}
            className={`flex-row items-center px-4 py-3 ${i > 0 ? "border-t border-gray-100" : ""}`}
          >
            <Text className="mr-3 w-5 text-base">{item.is_billed ? "✅" : "⏳"}</Text>
            <View className="flex-1">
              <Text className="text-sm font-medium text-ink">
                {item.is_payoff ? "Early payoff" : `Installment ${item.installment_number}/${plan.num_installments}`}
              </Text>
              <Text className="text-xs text-ink-muted">
                {ymLabel({ year: item.year, month: item.month })} ·{" "}
                {item.splits.map((s) => `${label(s.user_id)} ${formatMoney(s.amount)}`).join(", ")}
              </Text>
            </View>
            <Text className="text-sm font-semibold text-ink">{formatMoney(item.amount)}</Text>
          </View>
        ))}
      </Card>

      <SectionTitle>Rename</SectionTitle>
      <View className="flex-row items-end gap-2">
        <Field value={title ?? plan.title} onChangeText={setTitle} className="flex-1" />
        <Button
          title="Save"
          variant="secondary"
          disabled={!title || title.trim() === plan.title}
          loading={actions.rename.isPending}
          onPress={run(() => actions.rename.mutateAsync(title!.trim()), () => setTitle(null))}
        />
      </View>

      <SectionTitle>Actions</SectionTitle>
      {active ? (
        <>
          <Button title="Pay off early" onPress={confirmPayOff} loading={actions.payOff.isPending} />
          <Button
            title="Cancel remaining installments"
            variant="secondary"
            className="mt-3"
            onPress={confirmCancel}
            loading={actions.cancelRemaining.isPending}
          />
        </>
      ) : null}
      <Button title="Delete plan" variant="danger" className="mt-3" onPress={confirmDelete} loading={actions.remove.isPending} />
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text className="text-xs text-ink-muted">{label}</Text>
      <Text className="text-base font-semibold text-ink">{value}</Text>
    </View>
  );
}
