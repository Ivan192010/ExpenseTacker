export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:8000").replace(/\/+$/, "");
export const CURRENCY = process.env.EXPO_PUBLIC_CURRENCY ?? "MXN";
export const LOCALE = process.env.EXPO_PUBLIC_LOCALE ?? "es-MX";

/** Optional quick-pick profiles for the login screen ("Who is using this phone?"). */
export const PROFILES = [
  { key: "A", name: process.env.EXPO_PUBLIC_USER_A_NAME, email: process.env.EXPO_PUBLIC_USER_A_EMAIL },
  { key: "B", name: process.env.EXPO_PUBLIC_USER_B_NAME, email: process.env.EXPO_PUBLIC_USER_B_EMAIL },
].filter((p): p is { key: string; name: string; email: string } => !!p.name && !!p.email);
