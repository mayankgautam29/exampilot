import type { SlotInfo } from "./types";

export function shortDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });
}

export function slotLabel(slots: SlotInfo[] | undefined, id: string | null | undefined): string {
  if (!id) return "unscheduled";
  const slot = slots?.find((s) => s.id === id);
  return slot ? slot.label : id;
}

const PALETTE = ["#ef4444", "#f97316", "#eab308", "#84cc16", "#10b981", "#06b6d4", "#3b82f6", "#6366f1", "#a855f7", "#ec4899", "#64748b", "#14b8a6"];

export function colorFor(key: string): string {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

export const DEPT_COLORS: Record<string, string> = { CSE: "#3b82f6", ECE: "#a855f7", ME: "#f97316", CIV: "#10b981", MGT: "#eab308", DES: "#ec4899", OPEN: "#64748b" };

export function pct(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}
