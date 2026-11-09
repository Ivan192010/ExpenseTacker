import axios, { AxiosError } from "axios";

import { useSession } from "@/store/session";

import { API_URL } from "./config";
import type {
  Device,
  Expense,
  ExpenseCreate,
  ExpenseCreateResponse,
  ExpenseUpdate,
  Income,
  InstallmentHub,
  InstallmentPlan,
  Period,
  PeriodDetail,
  PeriodSummary,
  SettleResponse,
  TokenResponse,
  User,
} from "./types";

export const http = axios.create({ baseURL: API_URL, timeout: 20_000 });

http.interceptors.request.use((config) => {
  const token = useSession.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

http.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    // Expired token or this phone was unlinked -> back to login.
    if (error.response?.status === 401 && !error.config?.url?.includes("/auth/login")) {
      await useSession.getState().signOut();
    }
    return Promise.reject(error);
  },
);

/** Human-readable message from FastAPI errors (string detail or 422 validation list). */
export function apiErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const detail = (err.response?.data as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail
        .map((d: { msg?: string }) => (d.msg ?? "Invalid value").replace(/^Value error, /, ""))
        .join("\n");
    }
    if (!err.response) return `Can't reach the server (${API_URL}). Check your connection.`;
    return `Request failed (${err.response.status})`;
  }
  return err instanceof Error ? err.message : "Something went wrong";
}

const data = <T,>(p: Promise<{ data: T }>) => p.then((r) => r.data);

export const api = {
  // auth
  login: (body: { email: string; password: string; device_id: string; device_name?: string | null }) =>
    data(http.post<TokenResponse>("/auth/login", body)),
  me: () => data(http.get<User>("/auth/me")),
  devices: () => data(http.get<Device[]>("/auth/devices")),
  revokeDevice: (id: number) => http.delete(`/auth/devices/${id}`),

  users: () => data(http.get<User[]>("/users")),

  // periods
  periods: (includeArchived = false) =>
    data(http.get<Period[]>("/periods", { params: { include_archived: includeArchived } })),
  openMonth: (year: number, month: number) => data(http.post<PeriodDetail>("/periods/monthly", { year, month })),
  period: (id: number) => data(http.get<PeriodDetail>(`/periods/${id}`)),
  createEvent: (name: string) => data(http.post<Period>("/periods/events", { name })),
  setIncome: (
    periodId: number,
    userId: number,
    body: { base_amount: string; extra_amount: string; note?: string | null; propagate_forward: boolean },
  ) => data(http.put<Income>(`/periods/${periodId}/incomes/${userId}`, body)),
  expenses: (periodId: number) => data(http.get<Expense[]>(`/periods/${periodId}/expenses`)),
  summary: (periodId: number) => data(http.get<PeriodSummary>(`/periods/${periodId}/summary`)),
  settle: (periodId: number) => data(http.post<SettleResponse>(`/periods/${periodId}/settle`, {})),

  // expenses
  createExpense: (body: ExpenseCreate) => data(http.post<ExpenseCreateResponse>("/expenses", body)),
  expense: (id: number) => data(http.get<Expense>(`/expenses/${id}`)),
  updateExpense: (id: number, body: ExpenseUpdate) => data(http.patch<Expense>(`/expenses/${id}`, body)),
  deleteExpense: (id: number) => http.delete(`/expenses/${id}`),

  // installments
  installments: (includeClosed: boolean) =>
    data(http.get<InstallmentHub>("/installments", { params: { include_closed: includeClosed } })),
  installment: (id: number) => data(http.get<InstallmentPlan>(`/installments/${id}`)),
  updateInstallment: (id: number, body: { title?: string; notes?: string | null }) =>
    data(http.patch<InstallmentPlan>(`/installments/${id}`, body)),
  payOff: (id: number, ym?: { year: number; month: number }) =>
    data(http.post<InstallmentPlan>(`/installments/${id}/payoff`, ym ?? {})),
  cancelRemaining: (id: number) => data(http.post<InstallmentPlan>(`/installments/${id}/cancel`)),
  deletePlan: (id: number) => http.delete(`/installments/${id}`),
};
