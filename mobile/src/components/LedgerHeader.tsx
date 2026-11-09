import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { ymLabel } from "@/lib/dates";
import { useLedger } from "@/store/ledger";

/** ‹ November 2026 › — tap the title to pick another month or an event ledger. */
export function LedgerHeader() {
  const selection = useLedger((s) => s.selection);
  const shiftMonth = useLedger((s) => s.shiftMonth);
  const isMonth = selection.kind === "month";

  return (
    <View className="flex-row items-center">
      {isMonth ? (
        <Pressable hitSlop={10} onPress={() => shiftMonth(-1)} className="px-2">
          <Text className="text-2xl text-brand">‹</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={() => router.push("/ledgers")} className="flex-row items-center px-1">
        <Text className="text-lg font-bold text-ink">
          {isMonth ? ymLabel(selection) : `🏝️ ${selection.name}`}
        </Text>
        <Text className="ml-1 text-xs text-ink-muted">▾</Text>
      </Pressable>
      {isMonth ? (
        <Pressable hitSlop={10} onPress={() => shiftMonth(1)} className="px-2">
          <Text className="text-2xl text-brand">›</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
