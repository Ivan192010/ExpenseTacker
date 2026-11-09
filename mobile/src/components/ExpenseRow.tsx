import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { usePeople } from "@/hooks/queries";
import { categoryInfo } from "@/lib/categories";
import { formatMoney } from "@/lib/money";
import type { Expense } from "@/lib/types";

export function ExpenseRow({ expense }: { expense: Expense }) {
  const { me, label } = usePeople();
  const cat = categoryInfo(expense.category);
  const myShare = expense.splits.find((s) => s.user_id === me?.id)?.amount;

  let subtitle: string;
  let right: string | null = null;
  if (expense.type === "transfer") {
    subtitle = `${label(expense.paid_by_id)} → ${label(expense.splits[0]?.user_id ?? 0)}`;
  } else {
    subtitle = `${expense.type === "income" ? "Received by" : "Paid by"} ${label(expense.paid_by_id)}`;
    right = myShare ? `${expense.type === "income" ? "yours" : "your share"} ${formatMoney(myShare)}` : "not involved";
  }

  return (
    <Pressable
      onPress={() => router.push(`/expense/${expense.id}`)}
      className="flex-row items-center bg-white px-4 py-3 active:bg-gray-50"
    >
      <View style={{ backgroundColor: cat.color }} className="mr-3 h-10 w-10 items-center justify-center rounded-full">
        <Text className="text-lg">{cat.emoji}</Text>
      </View>
      <View className="flex-1">
        <Text numberOfLines={1} className="text-base font-medium text-ink">
          {expense.title}
        </Text>
        <Text numberOfLines={1} className="text-xs text-ink-muted">
          {subtitle}
        </Text>
        {expense.installment_label ? (
          <View className="mt-1 self-start rounded-md bg-amber-100 px-1.5 py-0.5">
            <Text className="text-[11px] font-semibold text-amber-900">
              💳 {expense.is_installment_payoff ? "Early payoff" : `Installment ${expense.installment_number}`}
              {expense.is_installment_payoff ? "" : `/${expense.installment_label.match(/\/(\d+)/)?.[1] ?? "?"}`}
            </Text>
          </View>
        ) : null}
      </View>
      <View className="items-end">
        <Text
          className={`text-base font-semibold ${
            expense.type === "income" ? "text-positive" : expense.type === "transfer" ? "text-ink-muted" : "text-ink"
          }`}
        >
          {formatMoney(expense.amount)}
        </Text>
        {right ? <Text className="text-xs text-ink-muted">{right}</Text> : null}
      </View>
    </Pressable>
  );
}
