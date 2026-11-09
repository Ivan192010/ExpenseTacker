import { useLocalSearchParams } from "expo-router";

import { ExpenseForm } from "@/components/ExpenseForm";
import { ErrorState, Loading } from "@/components/ui";
import { useExpense, usePeople } from "@/hooks/queries";
import { apiErrorMessage } from "@/lib/api";

export default function EditExpenseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const people = usePeople();
  const expense = useExpense(Number(id));

  if (people.isLoading || expense.isLoading) return <Loading />;
  const err = people.error ?? expense.error;
  if (err || !expense.data) return <ErrorState message={err ? apiErrorMessage(err) : "Entry not found"} />;
  // key: re-initialise the form state if a different entry is opened
  return <ExpenseForm key={expense.data.id} expense={expense.data} />;
}
