"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Plus, Rocket, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ComparisonRadar } from "@/components/charts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/ui-kit";
import { api, streamEvents } from "@/lib/api";
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

  return (
    <div>
      <PageHeader title="Scenario Lab" description="Branch the published plan into up to four what-ifs, describe each in plain words, solve them in parallel and compare." actions={<Button onClick={solveAll} disabled={busy || !published}>{busy ? <Loader2 className="animate-spin" /> : <Rocket />} Solve all</Button>} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {branches.map((branch) => (
          <Card key={branch.id} size="sm">
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                <Input value={branch.name} onChange={(e) => patch(branch.id, { name: e.target.value })} className="h-7 text-sm font-semibold" />
                <Button size="icon-xs" variant="ghost" aria-label="Remove branch" onClick={() => setBranches((all) => all.filter((b) => b.id !== branch.id))}><Trash2 /></Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Textarea value={branch.text} rows={4} onChange={(e) => patch(branch.id, { text: e.target.value })} placeholder="Describe the what-if" className="text-xs" />
              <div className={cn("flex items-center gap-1.5 text-xs", branch.state === "error" && "text-red-600")}>
                {branch.state === "solving" && <><Loader2 className="size-3.5 animate-spin" /> Solving…</>}
                {branch.state === "done" && <><CheckCircle2 className="size-3.5 text-emerald-500" /> Plan #{branch.planId}</>}
                {branch.state === "error" && <><XCircle className="size-3.5" /> {branch.message}</>}
              </div>
            </CardContent>
          </Card>
        ))}
        {branches.length < 4 && (
          <button className="flex min-h-40 flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-sm text-muted-foreground hover:bg-muted" onClick={() => setBranches((all) => [...all, { id: Date.now(), name: PRESETS[3].name, text: PRESETS[3].text, state: "idle" }])}>
            <Plus className="size-5" /> Add branch
          </button>
        )}
      </div>
      {rows.length > 0 && (
        <div className="mt-5 grid gap-4 xl:grid-cols-[1.3fr_1fr]">
          <Card>
            <CardHeader><CardTitle>Side-by-side</CardTitle><CardDescription>Lower is better for moves, students affected and risk.</CardDescription></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr><th className="p-1.5">Scenario</th><th>Courses moved</th><th>Students affected</th><th>Seating risk</th><th>Fairness</th><th>Rooms</th><th>Health</th><th /></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.plan_id} className="border-t">
                      <td className="p-1.5 font-medium">{r.label} {r.hard_violations > 0 && <Badge className="border-0 bg-red-500/15 text-red-700">{r.hard_violations} hard</Badge>}</td>
                      <td>{r.courses_moved}</td><td>{r.students_affected}</td><td>{r.seating_risk}</td><td>{r.fairness}</td><td>{r.rooms_total}</td><td>{r.health}</td>
                      <td><Button size="xs" onClick={() => adopt(r.plan_id)}>Adopt</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Radar</CardTitle><CardDescription>Outer is better on every axis.</CardDescription></CardHeader>
            <CardContent><ComparisonRadar series={series} /></CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
