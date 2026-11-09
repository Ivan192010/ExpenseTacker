// Mirrors backend/app/schemas.py. Money fields arrive as decimal strings ("1250.50").

export type Money = string;
export type PeriodKind = "monthly" | "event";
export type TransactionType = "expense" | "income" | "transfer";
export type SplitMode = "equal" | "exact" | "percentage" | "shares";
export type InstallmentStatus = "active" | "paid_off" | "cancelled";
export type Category =
  | "groceries" | "dining" | "bills" | "rent" | "shopping" | "transport" | "health" | "entertainment"
  | "travel" | "subscriptions" | "home" | "pets" | "gifts" | "education" | "settlement" | "other";

export interface User {
  id: number;
  name: string;
  email: string;
  color: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_at: string;
  user: User;
}

export interface Device {
  id: number;
  device_name: string | null;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
  is_current: boolean;
}

export interface Period {
  id: number;
  kind: PeriodKind;
  name: string;
  year: number | null;
  month: number | null;
  is_archived: boolean;
}

export interface Income {
  user_id: number;
  base_amount: Money;
  extra_amount: Money;
  total: Money;
  note: string | null;
  is_carried_over: boolean;
}

export interface PeriodDetail extends Period {
  incomes: Income[];
}

export interface SplitInput {
  user_id: number;
  value?: string | null;
}

export interface ExpenseCreate {
  title: string;
  amount: Money;
  date: string; // YYYY-MM-DD
  category: Category;
  type: TransactionType;
  paid_by_id: number;
  period_id?: number | null;
  split_mode: SplitMode;
  splits: SplitInput[];
  notes?: string | null;
  installment?: { num_installments: number; start_year?: number; start_month?: number } | null;
}

export type ExpenseUpdate = Partial<
  Pick<ExpenseCreate, "title" | "amount" | "date" | "category" | "paid_by_id" | "split_mode" | "splits" | "notes">
> & { period_id?: number };

export interface Split {
  user_id: number;
  amount: Money;
  input_value: Money | null;
}

export interface Expense {
  id: number;
  period_id: number;
  title: string;
  amount: Money;
  date: string;
  category: Category;
  type: TransactionType;
  split_mode: SplitMode;
  paid_by_id: number;
  notes: string | null;
  installment_plan_id: number | null;
  installment_number: number | null;
  is_installment_payoff: boolean;
  installment_label: string | null;
  splits: Split[];
  created_by_id: number | null;
  created_at: string;
}

export interface UserAmount {
  user_id: number;
  amount: Money;
}

export interface InstallmentScheduleItem {
  expense_id: number;
  installment_number: number | null;
  is_payoff: boolean;
  period_id: number;
  year: number;
  month: number;
  amount: Money;
  is_billed: boolean;
  splits: UserAmount[];
}

export interface InstallmentPlan {
  id: number;
  title: string;
  category: Category;
  total_amount: Money;
  num_installments: number;
  start_year: number;
  start_month: number;
  end_year: number;
  end_month: number;
  purchase_date: string;
  paid_by_id: number;
  split_mode: SplitMode;
  status: InstallmentStatus;
  notes: string | null;
  created_at: string;
  installments_billed: number;
  installments_remaining: number;
  billed_amount: Money;
  remaining_amount: Money;
  next_month_amount: Money;
  remaining_by_user: UserAmount[];
  schedule: InstallmentScheduleItem[] | null;
}

export interface InstallmentHub {
  as_of_year: number;
  as_of_month: number;
  total_remaining_debt: Money;
  committed_next_month: Money;
  per_user: { user_id: number; remaining: Money; next_month: Money }[];
  plans: InstallmentPlan[];
}

export interface ExpenseCreateResponse {
  expenses: Expense[];
  installment_plan: InstallmentPlan | null;
}

export interface UserSummary {
  user_id: number;
  name: string;
  base_income: Money;
  extra_income: Money;
  income_transactions: Money;
  total_income: Money;
  consumed: Money;
  consumed_installments: Money;
  money_left: Money;
  card_outflow: Money;
  transfers_sent: Money;
  transfers_received: Money;
  net_balance: Money;
}

export interface Debt {
  from_user_id: number;
  from_name: string;
  to_user_id: number;
  to_name: string;
  amount: Money;
}

export interface PeriodSummary {
  period: Period;
  users: UserSummary[];
  combined: { total_income: Money; consumed: Money; money_left: Money; card_outflow: Money };
  debts: Debt[];
  by_category: { category: Category; amount: Money }[];
  expense_count: number;
}

export interface SettleResponse {
  transfers: Expense[];
  summary: PeriodSummary;
}
