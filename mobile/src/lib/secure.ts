import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

const KEYS = {
  token: "cc.auth_token",
  user: "cc.auth_user", // includes user_id -> "Paid by" defaults to this person
  deviceId: "cc.device_id",
} as const;

export const secure = {
  getToken: () => SecureStore.getItemAsync(KEYS.token),
  getUserJSON: () => SecureStore.getItemAsync(KEYS.user),

  async saveSession(token: string, userJSON: string) {
    await SecureStore.setItemAsync(KEYS.token, token);
    await SecureStore.setItemAsync(KEYS.user, userJSON);
  },

  async clearSession() {
    await SecureStore.deleteItemAsync(KEYS.token);
    await SecureStore.deleteItemAsync(KEYS.user);
  },

  /** Stable per-install id used for server-side device binding. */
  async getOrCreateDeviceId(): Promise<string> {
    const existing = await SecureStore.getItemAsync(KEYS.deviceId);
    if (existing) return existing;
    const id = Crypto.randomUUID();
    await SecureStore.setItemAsync(KEYS.deviceId, id);
    return id;
  },
};
