import type { Category } from "./types";

export const CATEGORIES: { key: Category; label: string; emoji: string; color: string }[] = [
  { key: "groceries", label: "Groceries", emoji: "🛒", color: "#DCFCE7" },
  { key: "dining", label: "Dining", emoji: "🍽️", color: "#FFEDD5" },
  { key: "bills", label: "Bills", emoji: "💡", color: "#FEF9C3" },
  { key: "rent", label: "Rent", emoji: "🏠", color: "#E0E7FF" },
  { key: "shopping", label: "Shopping", emoji: "🛍️", color: "#FCE7F3" },
  { key: "transport", label: "Transport", emoji: "🚗", color: "#DBEAFE" },
  { key: "health", label: "Health", emoji: "💊", color: "#FEE2E2" },
  { key: "entertainment", label: "Fun", emoji: "🎬", color: "#F3E8FF" },
  { key: "travel", label: "Travel", emoji: "✈️", color: "#CFFAFE" },
  { key: "subscriptions", label: "Subscriptions", emoji: "🔁", color: "#E5E7EB" },
  { key: "home", label: "Home", emoji: "🛋️", color: "#FAE8FF" },
  { key: "pets", label: "Pets", emoji: "🐾", color: "#FEF3C7" },
  { key: "gifts", label: "Gifts", emoji: "🎁", color: "#FFE4E6" },
  { key: "education", label: "Education", emoji: "📚", color: "#E0F2FE" },
  { key: "other", label: "Other", emoji: "📦", color: "#F3F4F6" },
];

const SETTLEMENT = { key: "settlement" as Category, label: "Settlement", emoji: "🤝", color: "#D1FAE5" };

export function categoryInfo(key: Category) {
  return CATEGORIES.find((c) => c.key === key) ?? (key === "settlement" ? SETTLEMENT : CATEGORIES[CATEGORIES.length - 1]);
}
