import type { SlotInfo } from "./types";

export function shortDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });
}

export function slotLabel(slots: SlotInfo[] | undefined, id: string | null | undefined): string {
  if (!id) return "unscheduled";
  const slot = slots?.find((s) => s.id === id);
  return slot ? slot.label : id;
}

const PALETTE = ["#d9411e", "#0f6b5c", "#2a55b5", "#6a3fa0", "#8f5200", "#1f7a4d", "#b02e6b", "#4b5563", "#0b7285", "#9c3d0f", "#5a6b1f", "#7a4a2e"];

export function colorFor(key: string): string {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

export const DEPT_COLORS: Record<string, string> = { CSE: "#2a55b5", ECE: "#6a3fa0", ME: "#d9411e", CIV: "#0f6b5c", MGT: "#c98a00", DES: "#b02e6b", OPEN: "#6b6455" };

export function pct(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}
