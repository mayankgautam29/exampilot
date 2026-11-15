"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Plus, Rocket, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ComparisonRadar } from "@/components/charts";
import { Pill, PageHeader, SectionTitle } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api, streamEvents } from "@/lib/api";
import { colorFor } from "@/lib/format";
import { usePublished } from "@/lib/hooks";
import type { JobEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Branch {
  id: number;
  name: string;
  text: string;
  state: "idle" | "solving" | "done" | "error";
  message?: string;
  planId?: number;
}

interface Row {
  plan_id: number;
  label: string;
  status: string;
  courses_moved: number;
  students_affected: number;
  seating_risk: number;
  fairness: number;
  rooms_total: number;
  health: number;
  hard_violations: number;
}

const PRESETS = [
  { name: "Room G1 floods", text: "room G1 unavailable on 2026-12-08 afternoon" },
  { name: "Five invigilators absent", text: "faculty F05 unavailable on 2026-12-09, faculty F06 unavailable on 2026-12-09, faculty F07 unavailable on 2026-12-09, faculty F08 unavailable on 2026-12-09, faculty F09 unavailable on 2026-12-09" },
  { name: "Late registrations", text: "add 25 supplementary students to OE101" },
  { name: "Fresh seating", text: "regenerate seating" },
];

const COLUMNS: { key: keyof Row; label: string; best: "min" | "max" }[] = [
  { key: "courses_moved", label: "Courses moved", best: "min" },
  { key: "students_affected", label: "Students affected", best: "min" },
  { key: "seating_risk", label: "Seating risk", best: "min" },
  { key: "fairness", label: "Fairness", best: "max" },
  { key: "rooms_total", label: "Rooms", best: "min" },
  { key: "health", label: "Health", best: "max" },
];

export default function ScenarioLab() {
  const { published } = usePublished();
  const client = useQueryClient();
  const [branches, setBranches] = useState<Branch[]>([{ id: 1, name: PRESETS[0].name, text: PRESETS[0].text, state: "idle" }, { id: 2, name: PRESETS[1].name, text: PRESETS[1].text, state: "idle" }, { id: 3, name: PRESETS[2].name, text: PRESETS[2].text, state: "idle" }]);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  const patch = (id: number, update: Partial<Branch>) => setBranches((all) => all.map((b) => (b.id === id ? { ...b, ...update } : b)));

  async function solve(branch: Branch): Promise<number | undefined> {
    patch(branch.id, { state: "solving", message: undefined });
    try {
      const { job_id } = await api<{ job_id: string }>("/scenarios", { method: "POST", body: { name: branch.name, text: branch.text, base_plan_id: published?.id } });
      let planId: number | undefined;
      let failure: string | undefined;
      await streamEvents<JobEvent>("/solve/stream", { params: { job_id } }, (event) => {
        if (event.type === "done") planId = event.plan_id;
        if (event.type === "error") failure = event.message;
      });
      if (failure || !planId) throw new Error(failure ?? "No plan was produced");
      patch(branch.id, { state: "done", planId });
      return planId;
    } catch (error) {
      patch(branch.id, { state: "error", message: error instanceof Error ? error.message : "Failed" });
      return undefined;
    }
  }

  async function solveAll() {
    if (!published) return;
    setBusy(true);
    setRows([]);
    const active = branches.filter((b) => b.text.trim());
    const ids = (await Promise.all(active.map(solve))).filter((id): id is number => id !== undefined);
    if (ids.length) setRows((await api<{ rows: Row[] }>("/scenarios/compare", { params: { ids: ids.join(",") } })).rows);
    setBusy(false);
  }

  async function adopt(planId: number) {
    try {
      await api(`/scenarios/${planId}/adopt`, { method: "POST" });
      toast.success("Adopted as a draft plan. Submit it from the Command Center.");
      client.invalidateQueries({ queryKey: ["plans"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not adopt");
    }
  }

  const maxRooms = Math.max(1, ...rows.map((r) => r.rooms_total));
  const minRooms = Math.min(...rows.map((r) => r.rooms_total), maxRooms);
  const series = rows.map((r) => ({
    name: r.label,
    values: { courses: Math.max(0, 100 - r.courses_moved * 5), students: Math.max(0, 100 - r.students_affected / 8), seating: Math.max(0, 100 - r.seating_risk), fairness: r.fairness, rooms: (100 * minRooms) / Math.max(1, r.rooms_total), health: r.health },
  }));
  const best = (column: (typeof COLUMNS)[number], row: Row) => {
    const values = rows.map((r) => Number(r[column.key]));
    const target = column.best === "min" ? Math.min(...values) : Math.max(...values);
    return rows.length > 1 && Number(row[column.key]) === target;
  };

  return (
    <div>
      <PageHeader
        eyebrow="Simulate and respond"
        title="Scenario Lab"
        description="Branch the published plan into up to four what-ifs, describe each in plain words, solve them in parallel and compare."
        actions={
          <Button variant="brand" size="lg" onClick={solveAll} disabled={busy || !published}>
            {busy ? <Loader2 className="animate-spin" /> : <Rocket />} Solve all
          </Button>
        }
      />
      <div className="rise-1 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {branches.map((branch, index) => (
          <div key={branch.id} className="surface flex flex-col overflow-hidden">
            <div className="h-1" style={{ background: colorFor(branch.name) }} />
            <div className="flex items-center gap-2 px-4 pt-4">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[11px] font-bold text-brand">{index + 1}</span>
              <input value={branch.name} onChange={(e) => patch(branch.id, { name: e.target.value })} aria-label="Scenario name" className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none focus:underline" />
              <Button size="icon-xs" variant="ghost" aria-label="Remove branch" onClick={() => setBranches((all) => all.filter((b) => b.id !== branch.id))}>
                <Trash2 />
              </Button>
            </div>
            <div className="flex flex-1 flex-col gap-2.5 p-4">
              <Textarea value={branch.text} rows={4} onChange={(e) => patch(branch.id, { text: e.target.value })} placeholder="Describe the what-if" className="flex-1 text-xs" />
              <div className={cn("flex min-h-5 items-center gap-1.5 text-xs font-medium", branch.state === "error" && "text-bad")}>
                {branch.state === "idle" && <span className="text-muted-foreground">Ready to solve</span>}
                {branch.state === "solving" && (
                  <>
                    <Loader2 className="size-3.5 animate-spin text-brand" /> Solving…
                  </>
                )}
                {branch.state === "done" && (
                  <>
                    <CheckCircle2 className="size-3.5 text-good" /> Plan #{branch.planId}
                  </>
                )}
                {branch.state === "error" && (
                  <>
                    <XCircle className="size-3.5" /> {branch.message}
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
        {branches.length < 4 && (
          <button className="flex min-h-48 flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed text-sm font-medium text-muted-foreground transition hover:border-brand/50 hover:bg-brand-soft hover:text-brand" onClick={() => setBranches((all) => [...all, { id: Date.now(), name: PRESETS[3].name, text: PRESETS[3].text, state: "idle" }])}>
            <Plus className="size-5" /> Add branch
          </button>
        )}
      </div>
      {rows.length > 0 && (
        <div className="rise-2 mt-6 grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <section className="surface p-5">
            <SectionTitle title="Side by side" hint="Best value in each column is highlighted. Lower is better for moves, students affected and risk." />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Scenario</th>
                    {COLUMNS.map((c) => (
                      <th key={c.key} className="px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {c.label}
                      </th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.plan_id} className="border-b last:border-0">
                      <td className="px-2 py-3 font-medium">
                        <span className="mr-2 inline-block size-2.5 rounded-sm align-middle" style={{ background: colorFor(r.label) }} />
                        {r.label} {r.hard_violations > 0 && <Pill tone="bad">{r.hard_violations} hard</Pill>}
                      </td>
                      {COLUMNS.map((c) => (
                        <td key={c.key} className="px-2 py-3 text-right tabular-nums">
                          <span className={cn("rounded-md px-1.5 py-0.5", best(c, r) && "bg-good/12 font-semibold text-good-text")}>{String(r[c.key])}</span>
                        </td>
                      ))}
                      <td className="px-2 py-3 text-right">
                        <Button size="sm" variant="brand" onClick={() => adopt(r.plan_id)}>
                          Adopt
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="surface p-5">
            <SectionTitle title="Radar" hint="Outer is better on every axis." />
            <ComparisonRadar series={series} />
          </section>
        </div>
      )}
    </div>
  );
}
