import { ExpenseForm } from "@/components/ExpenseForm";
import { ErrorState, Loading } from "@/components/ui";
import { usePeople } from "@/hooks/queries";
import { apiErrorMessage } from "@/lib/api";

export default function NewExpenseScreen() {
  const { users, isLoading, error } = usePeople();
  if (isLoading) return <Loading />;
  if (error || users.length === 0) return <ErrorState message={error ? apiErrorMessage(error) : "No users found"} />;
  return <ExpenseForm />;
}
