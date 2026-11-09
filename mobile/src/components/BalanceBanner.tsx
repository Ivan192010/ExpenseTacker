import { Text, View } from "react-native";

import { usePeople } from "@/hooks/queries";
import { formatMoney } from "@/lib/money";
import type { Debt } from "@/lib/types";

/** "Partner owes You $X" / "You owe Partner $X" / "All settled up". */
export function debtSentence(debt: Debt | undefined, label: (id: number) => string): string {
  if (!debt) return "All settled up 🎉";
  const from = label(debt.from_user_id);
  const to = label(debt.to_user_id);
  return `${from} ${from === "You" ? "owe" : "owes"} ${to === "You" ? "you" : to} ${formatMoney(debt.amount)}`;
}

export function BalanceBanner({ debts }: { debts: Debt[] }) {
  const { me, label } = usePeople();
  const debt = debts[0];
  const iOwe = debt?.from_user_id === me?.id;
  return (
    <View className={`rounded-2xl px-4 py-3 ${!debt ? "bg-green-50" : iOwe ? "bg-red-50" : "bg-blue-50"}`}>
      <Text className={`text-base font-semibold ${!debt ? "text-positive" : iOwe ? "text-negative" : "text-brand-dark"}`}>
        {debtSentence(debt, label)}
      </Text>
    </View>
  );
}
