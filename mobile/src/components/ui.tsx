import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View, type TextInputProps } from "react-native";

import { formatMoney, toSignedCents } from "@/lib/money";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const BTN: Record<Variant, { box: string; text: string }> = {
  primary: { box: "bg-brand", text: "text-white" },
  secondary: { box: "bg-brand-light", text: "text-brand-dark" },
  danger: { box: "bg-red-50 border border-red-200", text: "text-negative" },
  ghost: { box: "bg-transparent", text: "text-brand" },
};

export function Button({
  title,
  onPress,
  variant = "primary",
  disabled,
  loading,
  className = "",
}: {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}) {
  const v = BTN[variant];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      className={`h-12 flex-row items-center justify-center rounded-xl px-4 active:opacity-70 ${v.box} ${
        disabled ? "opacity-40" : ""
      } ${className}`}
    >
      {loading ? (
        <ActivityIndicator color={variant === "primary" ? "#fff" : "#4F6BED"} />
      ) : (
        <Text className={`text-base font-semibold ${v.text}`}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <View className={`rounded-2xl bg-white p-4 ${className}`}>{children}</View>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View className="mb-2 mt-5 flex-row items-center justify-between px-1">
      <Text className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{children}</Text>
      {right}
    </View>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <View className={`flex-row rounded-xl bg-gray-100 p-1 ${disabled ? "opacity-50" : ""}`}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            disabled={disabled}
            onPress={() => onChange(o.value)}
            className={`flex-1 items-center rounded-lg py-2 ${active ? "bg-white shadow-sm" : ""}`}
          >
            <Text numberOfLines={1} className={`text-sm font-semibold ${active ? "text-ink" : "text-ink-muted"}`}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({
  label,
  active,
  onPress,
  disabled,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`mr-2 rounded-full border px-3 py-1.5 ${
        active ? "border-brand bg-brand-light" : "border-gray-200 bg-white"
      } ${disabled ? "opacity-50" : ""}`}
    >
      <Text className={`text-sm ${active ? "font-semibold text-brand-dark" : "text-ink"}`}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, className = "", ...props }: TextInputProps & { label?: string; className?: string }) {
  return (
    <View className={className}>
      {label ? <Text className="mb-1 text-xs font-medium text-ink-muted">{label}</Text> : null}
      <TextInput
        placeholderTextColor="#9CA3AF"
        className={`rounded-xl border border-gray-200 bg-white px-3 py-3 text-base text-ink ${
          props.editable === false ? "opacity-50" : ""
        }`}
        {...props}
      />
    </View>
  );
}

export function MoneyText({
  value,
  signed,
  className = "",
  colored,
}: {
  value: string | number | null | undefined;
  signed?: boolean;
  colored?: boolean;
  className?: string;
}) {
  const cents = typeof value === "number" ? value : toSignedCents(value);
  const tone = !colored || cents === 0 ? "" : cents > 0 ? "text-positive" : "text-negative";
  return <Text className={`${tone} ${className}`}>{formatMoney(cents, { signed })}</Text>;
}

export function Avatar({ name, color, size = 32 }: { name: string; color: string; size?: number }) {
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }}
      className="items-center justify-center"
    >
      <Text style={{ fontSize: size * 0.42 }} className="font-bold text-white">
        {name.slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

export function ProgressBar({ ratio, color = "#4F6BED" }: { ratio: number; color?: string }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0)) * 100;
  return (
    <View className="h-2 overflow-hidden rounded-full bg-gray-100">
      <View style={{ width: `${pct}%`, backgroundColor: color }} className="h-2 rounded-full" />
    </View>
  );
}

export function Loading() {
  return (
    <View className="flex-1 items-center justify-center bg-surface">
      <ActivityIndicator size="large" color="#4F6BED" />
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View className="flex-1 items-center justify-center bg-surface p-6">
      <Text className="mb-4 text-center text-base text-ink-muted">{message}</Text>
      {onRetry ? <Button title="Try again" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

export function Empty({ emoji, title, subtitle }: { emoji: string; title: string; subtitle?: string }) {
  return (
    <View className="items-center px-6 py-12">
      <Text className="mb-2 text-4xl">{emoji}</Text>
      <Text className="text-base font-semibold text-ink">{title}</Text>
      {subtitle ? <Text className="mt-1 text-center text-sm text-ink-muted">{subtitle}</Text> : null}
    </View>
  );
}
