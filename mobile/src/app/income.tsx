import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Switch, Text, View } from "react-native";

import { Avatar, Button, Card, ErrorState, Field, Loading } from "@/components/ui";
import { useActivePeriod, usePeople, useSetIncome } from "@/hooks/queries";
import { apiErrorMessage } from "@/lib/api";
import { formatMoney, fromCents, sanitizeDecimal, toCents } from "@/lib/money";

interface Draft {
  base: string;
  extra: string;
  note: string;
}

export default function IncomeScreen() {
  const period = useActivePeriod();
  const { users, label, color } = usePeople();
  const setIncome = useSetIncome();
  const [drafts, setDrafts] = useState<Record<number, Draft> | null>(null);
  const [propagate, setPropagate] = useState(true);
  const [error, setError] = useState<string | null>(null);

  if (period.isLoading) return <Loading />;
  if (period.error || !period.data) return <ErrorState message={apiErrorMessage(period.error)} />;
  const p = period.data;
  if (p.kind !== "monthly") return <ErrorState message="Event ledgers don't have a monthly income." />;

  const current: Record<number, Draft> =
    drafts ??
    Object.fromEntries(
      users.map((u) => {
        const inc = p.incomes.find((i) => i.user_id === u.id);
        const clean = (v?: string) => (v && toCents(v) > 0 ? v : "");
        return [u.id, { base: clean(inc?.base_amount), extra: clean(inc?.extra_amount), note: inc?.note ?? "" }];
      }),
    );
  const edit = (id: number, patch: Partial<Draft>) => setDrafts({ ...current, [id]: { ...current[id], ...patch } });

  const save = async () => {
    setError(null);
    try {
      for (const u of users) {
        const d = current[u.id];
        await setIncome.mutateAsync({
          periodId: p.id,
          userId: u.id,
          base_amount: fromCents(toCents(d.base || "0")),
          extra_amount: fromCents(toCents(d.extra || "0")),
          note: d.note.trim() || null,
          propagate_forward: propagate,
        });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.back();
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1 bg-surface">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text className="mb-3 text-lg font-bold text-ink">{p.name}</Text>
        {users.map((u) => {
          const d = current[u.id];
          const inc = p.incomes.find((i) => i.user_id === u.id);
          const total = (toCents(d.base || "0") || 0) + (toCents(d.extra || "0") || 0);
          return (
            <Card key={u.id} className="mb-3">
              <View className="mb-3 flex-row items-center">
                <Avatar name={u.name} color={color(u.id)} size={28} />
                <Text className="ml-2 flex-1 text-base font-semibold text-ink">{label(u.id)}</Text>
                <Text className="text-base font-bold text-ink">{formatMoney(total)}</Text>
              </View>
              <View className="flex-row gap-3">
                <Field
                  label="Salary / base"
                  value={d.base}
                  onChangeText={(t) => edit(u.id, { base: sanitizeDecimal(t) })}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  className="flex-1"
                />
                <Field
                  label="Extra this month"
                  value={d.extra}
                  onChangeText={(t) => edit(u.id, { extra: sanitizeDecimal(t) })}
                  keyboardType="decimal-pad"
                  placeholder="Bonus, aguinaldo…"
                  className="flex-1"
                />
              </View>
              <Field
                label="Note"
                value={d.note}
                onChangeText={(t) => edit(u.id, { note: t })}
                placeholder="Optional"
                className="mt-3"
              />
              {inc?.is_carried_over ? (
                <Text className="mt-2 text-xs text-ink-muted">Carried over from the previous month.</Text>
              ) : null}
            </Card>
          );
        })}

        <Card>
          <View className="flex-row items-center justify-between">
            <View className="flex-1 pr-3">
              <Text className="text-sm font-semibold text-ink">Apply salary to following months</Text>
              <Text className="text-xs text-ink-muted">
                Updates later months that still use the carried-over value. Extras stay in this month only.
              </Text>
            </View>
            <Switch value={propagate} onValueChange={setPropagate} trackColor={{ true: "#4F6BED" }} />
          </View>
        </Card>

        {error ? <Text className="mt-3 text-sm text-negative">{error}</Text> : null}
        <Button title="Save income" className="mt-5" onPress={save} loading={setIncome.isPending} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
