import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { Button, Card, Field, Loading, SectionTitle } from "@/components/ui";
import { useCreateEvent, usePeriods } from "@/hooks/queries";
import { apiErrorMessage } from "@/lib/api";
import { useLedger } from "@/store/ledger";

export default function LedgersScreen() {
  const periods = usePeriods();
  const createEvent = useCreateEvent();
  const { selectMonth, selectEvent, goToCurrentMonth, selection } = useLedger();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const months = (periods.data ?? []).filter((p) => p.kind === "monthly");
  const events = (periods.data ?? []).filter((p) => p.kind === "event");

  const create = async () => {
    setError(null);
    try {
      const ev = await createEvent.mutateAsync(name.trim());
      selectEvent(ev.id, ev.name);
      router.back();
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const isSelected = (p: { id: number; kind: string; year: number | null; month: number | null }) =>
    p.kind === "event"
      ? selection.kind === "event" && selection.id === p.id
      : selection.kind === "month" && selection.year === p.year && selection.month === p.month;

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Button
        title="📅 Go to this month"
        variant="secondary"
        onPress={() => {
          goToCurrentMonth();
          router.back();
        }}
      />

      <SectionTitle>Trips & events</SectionTitle>
      <Card className="p-0">
        {events.length === 0 ? (
          <Text className="p-4 text-sm text-ink-muted">No custom ledgers yet.</Text>
        ) : (
          events.map((p, i) => (
            <Pressable
              key={p.id}
              onPress={() => {
                selectEvent(p.id, p.name);
                router.back();
              }}
              className={`flex-row justify-between px-4 py-3 ${i > 0 ? "border-t border-gray-100" : ""}`}
            >
              <Text className="text-base text-ink">🏝️ {p.name}</Text>
              {isSelected(p) ? <Text className="text-brand">✓</Text> : null}
            </Pressable>
          ))
        )}
      </Card>
      <View className="mt-3 flex-row items-end gap-2">
        <Field value={name} onChangeText={setName} placeholder="New ledger, e.g. Vacation Cancún" className="flex-1" />
        <Button title="Create" disabled={!name.trim()} loading={createEvent.isPending} onPress={create} />
      </View>
      {error ? <Text className="mt-2 text-sm text-negative">{error}</Text> : null}
      <Text className="mt-2 px-1 text-xs text-ink-muted">
        Event ledgers have their own balance and are separate from your monthly budget.
      </Text>

      <SectionTitle>Months</SectionTitle>
      {periods.isLoading ? (
        <Loading />
      ) : (
        <Card className="p-0">
          {months.map((p, i) => (
            <Pressable
              key={p.id}
              onPress={() => {
                selectMonth({ year: p.year!, month: p.month! });
                router.back();
              }}
              className={`flex-row justify-between px-4 py-3 ${i > 0 ? "border-t border-gray-100" : ""}`}
            >
              <Text className="text-base text-ink">{p.name}</Text>
              {isSelected(p) ? <Text className="text-brand">✓</Text> : null}
            </Pressable>
          ))}
        </Card>
      )}
    </ScrollView>
  );
}
