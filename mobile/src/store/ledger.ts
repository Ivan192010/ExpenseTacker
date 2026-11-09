import { create } from "zustand";

import { addMonths, currentYM, type YM } from "@/lib/dates";

/** Which ledger the Month / Balances tabs are showing. */
export type LedgerSelection = ({ kind: "month" } & YM) | { kind: "event"; id: number; name: string };

interface LedgerState {
  selection: LedgerSelection;
  selectMonth: (ym: YM) => void;
  shiftMonth: (k: number) => void;
  selectEvent: (id: number, name: string) => void;
  goToCurrentMonth: () => void;
}

export const useLedger = create<LedgerState>((set, get) => ({
  selection: { kind: "month", ...currentYM() },
  selectMonth: (ym) => set({ selection: { kind: "month", ...ym } }),
  shiftMonth: (k) => {
    const s = get().selection;
    const base = s.kind === "month" ? s : currentYM();
    set({ selection: { kind: "month", ...addMonths(base, k) } });
  },
  selectEvent: (id, name) => set({ selection: { kind: "event", id, name } }),
  goToCurrentMonth: () => set({ selection: { kind: "month", ...currentYM() } }),
}));
