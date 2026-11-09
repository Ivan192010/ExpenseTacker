/**
 * Tricount-style Add / Edit entry form.
 *
 * Expense | Income | Transfer, "Paid by", "For whom" with Equal / Exact / % / Shares,
 * quick presets for proxy purchases ("bought with my card for my partner"), and the
 * Meses sin Intereses toggle that turns one purchase into N monthly installments.
 */
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import * as Haptics from "expo-haptics";
import { router, Stack } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";

import { useActivePeriod, useCreateExpense, useDeleteExpense, usePeople, useUpdateExpense } from "@/hooks/queries";
import { apiErrorMessage } from "@/lib/api";
import { CATEGORIES } from "@/lib/categories";
import { addMonths, defaultDateFor, fromISODate, prettyDate, toISODate, ymLabel, type YM } from "@/lib/dates";
import { allocate, formatMoney, fromCents, parseScaled, sanitizeDecimal, toCents } from "@/lib/money";
import type { Category, Expense, ExpenseCreate, ExpenseUpdate, SplitMode, TransactionType, User } from "@/lib/types";
import { useLedger } from "@/store/ledger";

import { Avatar, Button, Card, Chip, Field, Segmented, SectionTitle } from "./ui";

const INSTALLMENT_OPTIONS = [3, 6, 9, 12, 18, 24];
const SPLIT_MODES: { value: SplitMode; label: string }[] = [
  { value: "equal", label: "Equally" },
  { value: "exact", label: "Amounts" },
  { value: "percentage", label: "%" },
  { value: "shares", label: "Shares" },
];

interface Participant {
  checked: boolean;
  value: string;
}

function initialParticipants(users: User[], expense?: Expense): Record<number, Participant> {
  const out: Record<number, Participant> = {};
  for (const u of users) {
    const s = expense?.splits.find((x) => x.user_id === u.id);
    const value =
      !expense || !s
        ? ""
        : expense.split_mode === "exact"
          ? s.amount
          : (s.input_value ?? "").replace(/\.?0+$/, "");
    out[u.id] = { checked: expense ? !!s : true, value };
  }
  return out;
}

/** Shares per user in cents, or an error explaining what's wrong. */
function computeShares(
  amountCents: number,
  mode: SplitMode,
  active: { id: number; value: string }[],
): { shares: Map<number, number>; error: string | null } {
  const shares = new Map<number, number>();
  if (active.length === 0) return { shares, error: "Pick at least one person" };
  if (!(amountCents > 0)) return { shares, error: null };

  const put = (parts: number[]) => active.forEach((a, i) => shares.set(a.id, parts[i]));

  if (mode === "equal") {
    put(allocate(amountCents, active.map(() => 1n)));
    return { shares, error: null };
  }
  if (mode === "exact") {
    const parts = active.map((a) => toCents(a.value || "0"));
    put(parts.map((p) => (Number.isFinite(p) ? p : 0)));
    const diff = amountCents - parts.reduce((x, y) => x + (Number.isFinite(y) ? y : 0), 0);
    if (diff > 0) return { shares, error: `${formatMoney(diff)} left to assign` };
    if (diff < 0) return { shares, error: `${formatMoney(-diff)} more than the total` };
    return { shares, error: null };
  }
  const weights = active.map((a) => parseScaled(a.value || "0", 4) ?? 0n);
  const total = weights.reduce((x, y) => x + y, 0n);
  if (mode === "percentage" && total !== 1_000_000n) {
    put(allocate(amountCents, weights));
    return { shares, error: `Percentages add up to ${Number(total) / 10_000}%, not 100%` };
  }
  if (total === 0n) return { shares, error: "Give someone a share" };
  put(allocate(amountCents, weights));
  return { shares, error: null };
}

function cleanNumber(v: string): string {
  const s = v.replace(/\.$/, "");
  return s === "" ? "0" : s;
}

export function ExpenseForm({ expense }: { expense?: Expense }) {
  const { users, me, partner, label, color } = usePeople();
  const selection = useLedger((s) => s.selection);
  const { data: period } = useActivePeriod();
  const create = useCreateExpense();
  const update = useUpdateExpense(expense?.id ?? 0);
  const del = useDeleteExpense();

  const isEdit = !!expense;
  const lockedInstallment = !!expense?.installment_plan_id;
  const monthYM: YM | null = selection.kind === "month" ? { year: selection.year, month: selection.month } : null;

  const [type, setType] = useState<TransactionType>(expense?.type ?? "expense");
  const [title, setTitle] = useState(expense?.title ?? "");
  const [amountText, setAmountText] = useState(expense?.amount ?? "");
  const [date, setDate] = useState<Date>(expense ? fromISODate(expense.date) : defaultDateFor(monthYM));
  const [category, setCategory] = useState<Category>(expense?.category ?? "groceries");
  const [paidBy, setPaidBy] = useState<number>(expense?.paid_by_id ?? me?.id ?? users[0]?.id);
  const [mode, setMode] = useState<SplitMode>(expense?.split_mode ?? "equal");
  const [participants, setParticipants] = useState(() => initialParticipants(users, expense));
  const [transferTo, setTransferTo] = useState<number | undefined>(
    expense?.type === "transfer" ? expense.splits[0]?.user_id : partner?.id,
  );
  const [notes, setNotes] = useState(expense?.notes ?? "");

  const [isInstallment, setIsInstallment] = useState(false);
  const [numInstallments, setNumInstallments] = useState(6);
  const [customN, setCustomN] = useState("");
  const [startOverride, setStartOverride] = useState<YM | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startYM: YM = startOverride ?? { year: date.getFullYear(), month: date.getMonth() + 1 };
  const canInstallment = !isEdit && type === "expense" && selection.kind === "month";
  const installmentOn = canInstallment && isInstallment;
  const n = customN ? Number(customN) : numInstallments;

  const amountCents = toCents(amountText);
  const sortedUsers = useMemo(() => [...users].sort((a, b) => a.id - b.id), [users]);
  const active = sortedUsers
    .filter((u) => participants[u.id]?.checked)
    .map((u) => ({ id: u.id, value: participants[u.id].value }));
  const { shares, error: splitError } =
    type === "transfer"
      ? { shares: new Map<number, number>(), error: transferTo && transferTo !== paidBy ? null : "Pick who receives it" }
      : computeShares(amountCents, mode, active);

  const problems = [
    !title.trim() && "Add a title",
    !(amountCents > 0) && "Enter an amount",
    splitError,
    installmentOn && !(n >= 2 && n <= 48) && "Installments must be between 2 and 48",
  ].filter(Boolean) as string[];
  const canSave = lockedInstallment ? !!title.trim() : problems.length === 0;
  const saving = create.isPending || update.isPending;

  // ---- actions -------------------------------------------------------------

  const setParticipant = (id: number, patch: Partial<Participant>) =>
    setParticipants((p) => ({ ...p, [id]: { ...p[id], ...patch } }));

  const preset = (only: number | "both") => {
    setMode("equal");
    setParticipants(
      Object.fromEntries(sortedUsers.map((u) => [u.id, { checked: only === "both" || u.id === only, value: "" }])),
    );
  };

  const openDatePicker = () =>
    DateTimePickerAndroid.open({
      value: date,
      mode: "date",
      onChange: (event, picked) => {
        if (event.type === "set" && picked) setDate(picked);
      },
    });

  const save = async () => {
    setError(null);
    try {
      if (isEdit && expense) {
        const body: ExpenseUpdate = lockedInstallment
          ? { title: title.trim(), category, notes: notes.trim() || null }
          : {
              title: title.trim(),
              amount: fromCents(amountCents),
              date: toISODate(date),
              category: type === "transfer" ? "settlement" : category,
              paid_by_id: paidBy,
              split_mode: type === "transfer" ? "equal" : mode,
              splits: buildSplits(),
              notes: notes.trim() || null,
            };
        await update.mutateAsync(body);
      } else {
        const body: ExpenseCreate = {
          title: title.trim(),
          amount: fromCents(amountCents),
          date: toISODate(date),
          category: type === "transfer" ? "settlement" : category,
          type,
          paid_by_id: paidBy,
          period_id: selection.kind === "event" ? selection.id : null,
          split_mode: type === "transfer" ? "equal" : mode,
          splits: buildSplits(),
          notes: notes.trim() || null,
          installment: installmentOn
            ? { num_installments: n, start_year: startYM.year, start_month: startYM.month }
            : null,
        };
        await create.mutateAsync(body);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.back();
    } catch (e) {
      setError(apiErrorMessage(e));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }
  };

  function buildSplits() {
    if (type === "transfer") return [{ user_id: transferTo! }];
    return active.map((a) => ({
      user_id: a.id,
      value: mode === "equal" ? null : mode === "exact" ? fromCents(toCents(cleanNumber(a.value))) : cleanNumber(a.value),
    }));
  }

  const confirmDelete = () =>
    Alert.alert("Delete entry?", `"${expense?.title}" will be removed from this ledger.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await del.mutateAsync(expense!.id);
            router.back();
          } catch (e) {
            Alert.alert("Couldn't delete", apiErrorMessage(e));
          }
        },
      },
    ]);

  // ---- labels ---------------------------------------------------------------

  const paidByLabel = type === "income" ? "Received by" : type === "transfer" ? "From" : "Paid by";
  const forWhomLabel = type === "income" ? "Belongs to" : "For whom";
  const ledgerName = selection.kind === "event" ? selection.name : period?.name;
  const monthlyParts = installmentOn && amountCents > 0 && n >= 2 ? allocate(amountCents, Array(n).fill(1n)) : [];

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1 bg-surface">
      <Stack.Screen
        options={{
          title: isEdit ? "Edit entry" : "New entry",
          headerRight: () => (
            <Pressable onPress={save} disabled={!canSave || saving} hitSlop={12}>
              <Text className={`text-base font-bold ${canSave && !saving ? "text-brand" : "text-ink-faint"}`}>
                {saving ? "Saving…" : "Save"}
              </Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        {lockedInstallment ? (
          <Card className="mb-4 bg-amber-50">
            <Text className="text-sm text-amber-900">
              {expense?.installment_label}. Only the title, category and notes can change here. Open the plan to pay
              it off early or cancel the remaining months.
            </Text>
            <Button
              title="Open installment plan"
              variant="ghost"
              className="mt-1 h-9 self-start px-0"
              onPress={() => router.push(`/installments/${expense!.installment_plan_id}`)}
            />
          </Card>
        ) : null}

        <Segmented
          disabled={isEdit}
          value={type}
          onChange={(t) => {
            setType(t);
            if (t === "transfer" && !title) setTitle("Transfer");
          }}
          options={[
            { value: "expense", label: "Expense" },
            { value: "income", label: "Income" },
            { value: "transfer", label: "Transfer" },
          ]}
        />

        {/* Amount */}
        <View className="mt-5 items-center">
          <TextInput
            value={amountText}
            onChangeText={(t) => setAmountText(sanitizeDecimal(t))}
            editable={!lockedInstallment}
            placeholder="0.00"
            placeholderTextColor="#C7CBD6"
            keyboardType="decimal-pad"
            className="min-w-[60%] text-center text-5xl font-bold text-ink"
          />
          <Text className="mt-1 text-xs text-ink-muted">
            {installmentOn ? "Total purchase amount" : ledgerName ? `in ${ledgerName}` : ""}
          </Text>
        </View>

        <Field
          label="Title"
          value={title}
          onChangeText={setTitle}
          placeholder={type === "income" ? "e.g. Refund, bonus" : "e.g. Walmart, Netflix, Dyson Airwrap"}
          className="mt-5"
        />

        {/* Date */}
        <SectionTitle>Date</SectionTitle>
        {Platform.OS === "android" ? (
          <Pressable
            disabled={lockedInstallment}
            onPress={openDatePicker}
            className={`rounded-xl border border-gray-200 bg-white px-3 py-3 ${lockedInstallment ? "opacity-50" : ""}`}
          >
            <Text className="text-base text-ink">📅 {prettyDate(toISODate(date))}</Text>
          </Pressable>
        ) : (
          <DateTimePicker
            value={date}
            mode="date"
            display="compact"
            disabled={lockedInstallment}
            onChange={(_, d) => d && setDate(d)}
          />
        )}

        {/* Category */}
        {type !== "transfer" ? (
          <>
            <SectionTitle>Category</SectionTitle>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {CATEGORIES.map((c) => (
                <Chip
                  key={c.key}
                  label={`${c.emoji} ${c.label}`}
                  active={category === c.key}
                  onPress={() => setCategory(c.key)}
                />
              ))}
            </ScrollView>
          </>
        ) : null}

        {/* Paid by */}
        <SectionTitle>{paidByLabel}</SectionTitle>
        <Segmented
          disabled={lockedInstallment}
          value={paidBy}
          onChange={setPaidBy}
          options={sortedUsers.map((u) => ({ value: u.id, label: label(u.id) }))}
        />

        {/* For whom / To */}
        {type === "transfer" ? (
          <>
            <SectionTitle>To</SectionTitle>
            <Segmented
              disabled={lockedInstallment}
              value={transferTo ?? -1}
              onChange={setTransferTo}
              options={sortedUsers.filter((u) => u.id !== paidBy).map((u) => ({ value: u.id, label: label(u.id) }))}
            />
            <Text className="mt-2 px-1 text-xs text-ink-muted">
              Transfers only change who owes whom. They don't count as spending.
            </Text>
          </>
        ) : (
          <>
            <SectionTitle>{forWhomLabel}</SectionTitle>
            {!lockedInstallment ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-3">
                <Chip label="➗ 50/50" onPress={() => preset("both")} />
                {partner ? <Chip label={`🎁 All for ${partner.name}`} onPress={() => preset(partner.id)} /> : null}
                {me ? <Chip label="🙋 All for me" onPress={() => preset(me.id)} /> : null}
              </ScrollView>
            ) : null}
            <Segmented disabled={lockedInstallment} value={mode} onChange={setMode} options={SPLIT_MODES} />
            <Card className="mt-3 p-0">
              {sortedUsers.map((u, i) => {
                const p = participants[u.id];
                const share = shares.get(u.id);
                return (
                  <Pressable
                    key={u.id}
                    disabled={lockedInstallment}
                    onPress={() => setParticipant(u.id, { checked: !p.checked })}
                    className={`flex-row items-center px-4 py-3 ${i > 0 ? "border-t border-gray-100" : ""}`}
                  >
                    <View
                      className={`mr-3 h-6 w-6 items-center justify-center rounded-md border-2 ${
                        p.checked ? "border-brand bg-brand" : "border-gray-300"
                      }`}
                    >
                      {p.checked ? <Text className="text-xs font-bold text-white">✓</Text> : null}
                    </View>
                    <Avatar name={u.name} color={color(u.id)} size={28} />
                    <Text className="ml-2 flex-1 text-base text-ink">{label(u.id)}</Text>
                    {p.checked && mode !== "equal" ? (
                      <View className="mr-3 w-24 flex-row items-center rounded-lg border border-gray-200 px-2">
                        <TextInput
                          value={p.value}
                          editable={!lockedInstallment}
                          onChangeText={(t) => setParticipant(u.id, { value: sanitizeDecimal(t, mode === "exact" ? 2 : 4) })}
                          keyboardType="decimal-pad"
                          placeholder="0"
                          className="flex-1 py-1.5 text-right text-base text-ink"
                        />
                        <Text className="ml-1 text-sm text-ink-muted">
                          {mode === "percentage" ? "%" : mode === "shares" ? "×" : "$"}
                        </Text>
                      </View>
                    ) : null}
                    <Text className={`w-24 text-right text-base ${p.checked ? "text-ink" : "text-ink-faint"}`}>
                      {p.checked && share != null ? formatMoney(share) : "—"}
                    </Text>
                  </Pressable>
                );
              })}
            </Card>
            {splitError && amountCents > 0 ? (
              <Text className="mt-2 px-1 text-sm text-negative">{splitError}</Text>
            ) : paidBy && active.length === 1 && active[0].id !== paidBy ? (
              <Text className="mt-2 px-1 text-xs text-ink-muted">
                {label(paidBy)} paid, {label(active[0].id)} owes the full amount. It counts toward{" "}
                {active[0].id === me?.id ? "your" : `${label(active[0].id)}'s`} budget only.
              </Text>
            ) : null}
          </>
        )}

        {/* Installments (Meses sin Intereses) */}
        {canInstallment ? (
          <>
            <SectionTitle>Meses sin intereses</SectionTitle>
            <Card>
              <View className="flex-row items-center justify-between">
                <View className="flex-1 pr-3">
                  <Text className="text-base font-semibold text-ink">Pay in installments</Text>
                  <Text className="text-xs text-ink-muted">Creates one charge per month in each future month.</Text>
                </View>
                <Switch value={isInstallment} onValueChange={setIsInstallment} trackColor={{ true: "#4F6BED" }} />
              </View>

              {isInstallment ? (
                <View className="mt-4">
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {INSTALLMENT_OPTIONS.map((k) => (
                      <Chip
                        key={k}
                        label={`${k} months`}
                        active={!customN && numInstallments === k}
                        onPress={() => {
                          setCustomN("");
                          setNumInstallments(k);
                        }}
                      />
                    ))}
                  </ScrollView>
                  <Field
                    label="Or custom number of months"
                    value={customN}
                    onChangeText={(t) => setCustomN(t.replace(/\D/g, "").slice(0, 2))}
                    keyboardType="number-pad"
                    placeholder="e.g. 10"
                    className="mt-3"
                  />

                  <Text className="mb-1 mt-3 text-xs font-medium text-ink-muted">First installment</Text>
                  <View className="flex-row items-center justify-between rounded-xl border border-gray-200 bg-white px-2 py-2">
                    <Pressable hitSlop={8} onPress={() => setStartOverride(addMonths(startYM, -1))} className="px-3">
                      <Text className="text-xl text-brand">‹</Text>
                    </Pressable>
                    <Text className="text-base font-semibold text-ink">{ymLabel(startYM)}</Text>
                    <Pressable hitSlop={8} onPress={() => setStartOverride(addMonths(startYM, 1))} className="px-3">
                      <Text className="text-xl text-brand">›</Text>
                    </Pressable>
                  </View>

                  {monthlyParts.length > 0 ? (
                    <View className="mt-3 rounded-xl bg-brand-light p-3">
                      <Text className="text-sm font-semibold text-brand-dark">
                        {n} × {formatMoney(monthlyParts[0])}
                        {monthlyParts[0] !== monthlyParts[n - 1] ? ` (last ${formatMoney(monthlyParts[n - 1])})` : ""}
                      </Text>
                      <Text className="text-xs text-brand-dark">
                        {ymLabel(startYM, true)} → {ymLabel(addMonths(startYM, n - 1), true)}
                      </Text>
                      {[...shares.entries()].map(([uid, cents]) => (
                        <Text key={uid} className="mt-1 text-xs text-brand-dark">
                          {label(uid)}: ~{formatMoney(allocate(cents, Array(n).fill(1n))[0])} / month
                        </Text>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}
            </Card>
          </>
        ) : null}

        <Field
          label="Notes"
          value={notes}
          onChangeText={setNotes}
          placeholder="Optional"
          multiline
          className="mt-5"
        />

        {error ? <Text className="mt-4 text-sm text-negative">{error}</Text> : null}
        {!canSave && !lockedInstallment && problems.length > 0 && amountCents > 0 && !splitError ? (
          <Text className="mt-4 text-sm text-ink-muted">{problems[0]}</Text>
        ) : null}

        <Button title={isEdit ? "Save changes" : "Add entry"} className="mt-6" onPress={save} disabled={!canSave} loading={saving} />
        {isEdit && !lockedInstallment ? (
          <Button title="Delete entry" variant="danger" className="mt-3" onPress={confirmDelete} loading={del.isPending} />
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
