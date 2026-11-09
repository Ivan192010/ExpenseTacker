import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { api } from "@/lib/api";
import type { ExpenseCreate, ExpenseUpdate, User } from "@/lib/types";
import { useLedger } from "@/store/ledger";
import { useSession } from "@/store/session";

export const qk = {
  users: ["users"] as const,
  periods: ["periods"] as const,
  month: (y: number, m: number) => ["period", "month", y, m] as const,
  period: (id: number) => ["period", id] as const,
  summary: (id: number) => ["summary", id] as const,
  expenses: (id: number) => ["expenses", id] as const,
  expense: (id: number) => ["expense", id] as const,
  installments: (closed: boolean) => ["installments", closed] as const,
  installment: (id: number) => ["installment", id] as const,
  devices: ["devices"] as const,
};

/** After any write, refresh everything money-related (small app, cheap). */
export function invalidateLedger(qc: QueryClient) {
  for (const key of ["period", "periods", "summary", "expenses", "expense", "installments", "installment"]) {
    qc.invalidateQueries({ queryKey: [key] });
  }
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export function useUsers() {
  return useQuery({ queryKey: qk.users, queryFn: api.users, staleTime: 5 * 60_000 });
}

/** The two people, from this phone's point of view. */
const NO_USERS: User[] = [];

export function usePeople() {
  const me = useSession((s) => s.user);
  const q = useUsers();
  const users = q.data ?? NO_USERS;
  const people = useMemo(() => {
    const byId = new Map<number, User>(users.map((u) => [u.id, u]));
    const partner = users.find((u) => u.id !== me?.id) ?? null;
    const label = (id: number) => (id === me?.id ? "You" : (byId.get(id)?.name ?? "?"));
    const color = (id: number) => byId.get(id)?.color ?? "#9CA3AF";
    return { users, me, partner, byId, label, color };
  }, [users, me]);
  return { ...people, isLoading: q.isLoading, error: q.error };
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

/** The ledger selected in the header (a month, created on demand, or an event). */
export function useActivePeriod() {
  const selection = useLedger((s) => s.selection);
  return useQuery({
    queryKey: selection.kind === "month" ? qk.month(selection.year, selection.month) : qk.period(selection.id),
    queryFn: () =>
      selection.kind === "month" ? api.openMonth(selection.year, selection.month) : api.period(selection.id),
  });
}

export function usePeriods() {
  return useQuery({ queryKey: qk.periods, queryFn: () => api.periods() });
}

export function useSummary(periodId: number | undefined) {
  return useQuery({
    queryKey: qk.summary(periodId ?? -1),
    queryFn: () => api.summary(periodId!),
    enabled: !!periodId,
  });
}

export function useExpenses(periodId: number | undefined) {
  return useQuery({
    queryKey: qk.expenses(periodId ?? -1),
    queryFn: () => api.expenses(periodId!),
    enabled: !!periodId,
  });
}

export function useSetIncome() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      periodId: number;
      userId: number;
      base_amount: string;
      extra_amount: string;
      note?: string | null;
      propagate_forward: boolean;
    }) => api.setIncome(v.periodId, v.userId, v),
    onSuccess: () => invalidateLedger(qc),
  });
}

export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createEvent,
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.periods }),
  });
}

export function useSettle() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: api.settle, onSuccess: () => invalidateLedger(qc) });
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export function useExpense(id: number | undefined) {
  return useQuery({ queryKey: qk.expense(id ?? -1), queryFn: () => api.expense(id!), enabled: !!id });
}

export function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: ExpenseCreate) => api.createExpense(body), onSuccess: () => invalidateLedger(qc) });
}

export function useUpdateExpense(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ExpenseUpdate) => api.updateExpense(id, body),
    onSuccess: () => invalidateLedger(qc),
  });
}

export function useDeleteExpense() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: api.deleteExpense, onSuccess: () => invalidateLedger(qc) });
}

// ---------------------------------------------------------------------------
// Installments
// ---------------------------------------------------------------------------

export function useInstallmentsHub(includeClosed: boolean) {
  return useQuery({ queryKey: qk.installments(includeClosed), queryFn: () => api.installments(includeClosed) });
}

export function useInstallmentPlan(id: number | undefined) {
  return useQuery({ queryKey: qk.installment(id ?? -1), queryFn: () => api.installment(id!), enabled: !!id });
}

export function usePlanActions(id: number) {
  const qc = useQueryClient();
  const onSuccess = () => invalidateLedger(qc);
  return {
    payOff: useMutation({ mutationFn: () => api.payOff(id), onSuccess }),
    cancelRemaining: useMutation({ mutationFn: () => api.cancelRemaining(id), onSuccess }),
    remove: useMutation({ mutationFn: () => api.deletePlan(id), onSuccess }),
    rename: useMutation({ mutationFn: (title: string) => api.updateInstallment(id, { title }), onSuccess }),
  };
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

export function useDevices() {
  return useQuery({ queryKey: qk.devices, queryFn: api.devices });
}

export function useRevokeDevice() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: api.revokeDevice, onSuccess: () => qc.invalidateQueries({ queryKey: qk.devices }) });
}
