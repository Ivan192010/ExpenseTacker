import { create } from "zustand";

import { secure } from "@/lib/secure";
import type { User } from "@/lib/types";

type Status = "loading" | "signedOut" | "signedIn";

interface SessionState {
  status: Status;
  token: string | null;
  user: User | null;
  deviceId: string | null;
  /** Fingerprint gate. The app starts locked whenever a stored session exists. */
  locked: boolean;
  hydrate: () => Promise<void>;
  signIn: (token: string, user: User) => Promise<void>;
  signOut: () => Promise<void>;
  lock: () => void;
  unlock: () => void;
}

export const useSession = create<SessionState>((set, get) => ({
  status: "loading",
  token: null,
  user: null,
  deviceId: null,
  locked: true,

  async hydrate() {
    const [token, userJSON, deviceId] = await Promise.all([
      secure.getToken(),
      secure.getUserJSON(),
      secure.getOrCreateDeviceId(),
    ]);
    let user: User | null = null;
    try {
      user = userJSON ? (JSON.parse(userJSON) as User) : null;
    } catch {
      user = null;
    }
    if (token && user) set({ status: "signedIn", token, user, deviceId, locked: true });
    else set({ status: "signedOut", token: null, user: null, deviceId, locked: false });
  },

  async signIn(token, user) {
    await secure.saveSession(token, JSON.stringify(user));
    // They just typed the password, so no fingerprint prompt right now.
    set({ status: "signedIn", token, user, locked: false });
  },

  async signOut() {
    if (get().status === "signedOut") return;
    await secure.clearSession();
    set({ status: "signedOut", token: null, user: null, locked: false });
  },

  lock: () => {
    if (get().status === "signedIn") set({ locked: true });
  },
  unlock: () => set({ locked: false }),
}));
