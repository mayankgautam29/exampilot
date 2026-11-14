"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarX, DoorClosed, Dices, Loader2, UserX } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, PageHeader } from "@/components/ui-kit";
import { api, streamEvents } from "@/lib/api";
import { useCatalogue, usePublished } from "@/lib/hooks";
import type { JobEvent } from "@/lib/types";

type Kind = "invigilator_absent" | "room_unavailable" | "date_blocked";

interface Outcome {
  plan_id: number;
  summary: string;
  replacements: { slot_id: string; room_id: string | null; from: string; to: string }[];
  students_affected: number;
  courses_moved: number;
}

interface DisruptionRow {
  id: number;
  kind: string;
  summary: string;
  status: string;
  plan_id: number | null;
}

interface Roster {
  faculty: { faculty_id: string; duties: { slot_id: string; room_id: string | null }[] }[];
}

const select = "h-9 w-full rounded-lg border bg-background px-2 text-sm";

export default function DisruptionsPage() {
  const { published } = usePublished();
  const catalogue = useCatalogue();
  const client = useQueryClient();
  const [kind, setKind] = useState<Kind | null>(null);
  const [form, setForm] = useState({ faculty_id: "", room_id: "", slot_id: "", date: "" });
  const [running, setRunning] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const history = useQuery({ queryKey: ["disruptions"], queryFn: () => api<DisruptionRow[]>("/disruptions") });
  const slots = catalogue.data?.slots.filter((s) => !s.blocked) ?? [];
  const dates = Array.from(new Set(slots.map((s) => s.date)));

  async function report(payload: Record<string, string>) {
    setKind(null);
    setOutcome(null);
    setRunning("Planning the hotfix…");
    try {
      const { job_id } = await api<{ job_id: string }>("/disruptions", { method: "POST", body: payload });
      let result: Outcome | undefined;
      let failure: string | undefined;
      await streamEvents<JobEvent>("/solve/stream", { params: { job_id } }, (event) => {
        if (event.type === "stage" && event.status === "running") setRunning(`Running ${event.stage}…`);
        if (event.type === "done") result = event as unknown as Outcome;
        if (event.type === "error") failure = event.message;
      });
      if (failure || !result) throw new Error(failure ?? "No hotfix was produced");
      setOutcome(result);
      client.invalidateQueries({ queryKey: ["disruptions"] });
      client.invalidateQueries({ queryKey: ["plans"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The disruption could not be absorbed");
    } finally {
      setRunning(null);
    }
  }

  async function chaos() {
    if (!published) return;
    const roster = await api<Roster>(`/plans/${published.id}/roster`);
    const picks = roster.faculty.flatMap((f) => f.duties.filter((d) => d.room_id).map((d) => ({ faculty_id: f.faculty_id, slot_id: d.slot_id })));
    const pick = picks[Math.floor(Math.random() * picks.length)];
    toast.info(`Chaos: ${pick.faculty_id} is absent in ${pick.slot_id}`);
    report({ kind: "invigilator_absent", ...pick });
  }

  const tiles: { kind: Kind; title: string; hint: string; icon: typeof UserX }[] = [
    { kind: "invigilator_absent", title: "Invigilator absent", hint: "A reliever is pulled in, fairness-aware", icon: UserX },
    { kind: "room_unavailable", title: "Room unavailable", hint: "Re-plan rooms, seats and invigilators for one session", icon: DoorClosed },
    { kind: "date_blocked", title: "Block a date", hint: "Exams on that day move with minimal disruption", icon: CalendarX },
  ];

  return (
    <div>
      <PageHeader title="Disruption Mode" description="Something went wrong after publication? Report it. ExamPilot builds a scoped hotfix plan that waits in the approval inbox. Nothing changes until you approve it." actions={<Button variant="outline" onClick={chaos} disabled={!!running}><Dices /> Simulate chaos</Button>} />
      <div className="grid gap-3 md:grid-cols-3">
        {tiles.map((tile) => (
          <button key={tile.kind} disabled={!!running} onClick={() => setKind(tile.kind)} className="rounded-xl border p-6 text-left transition hover:border-primary hover:bg-muted disabled:opacity-50">
            <tile.icon className="mb-3 size-8 text-red-500" />
            <div className="text-lg font-semibold">{tile.title}</div>
            <div className="text-sm text-muted-foreground">{tile.hint}</div>
          </button>
        ))}
      </div>
      {running && <div className="mt-4 flex items-center gap-2 rounded-lg border p-3 text-sm"><Loader2 className="size-4 animate-spin" /> {running}</div>}
      {outcome && (
        <Card className="mt-4 border-amber-500/40">
          <CardHeader>
            <CardTitle>Hotfix proposal #{outcome.plan_id} — waiting for approval</CardTitle>
            <CardDescription>{outcome.summary}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{outcome.students_affected} students affected</Badge>
              <Badge variant="secondary">{outcome.courses_moved} courses moved</Badge>
            </div>
            {outcome.replacements.map((r, i) => (
              <div key={i}>{r.slot_id} · {r.room_id ?? "reliever pool"}: <b>{r.from}</b> replaced by <b>{r.to}</b></div>
            ))}
            <Link href="/admin/approvals" className="inline-block pt-1 underline">Review in Approvals</Link>
          </CardContent>
        </Card>
      )}
      <Card className="mt-6">
        <CardHeader><CardTitle>History</CardTitle></CardHeader>
        <CardContent className="space-y-1.5">
          {!history.data?.length && <EmptyState title="No disruptions reported" />}
          {history.data?.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-1.5 text-sm">
              <Badge variant="outline">{d.kind.replace("_", " ")}</Badge>
              <span className="flex-1">{d.summary}</span>
              <Badge variant="secondary">{d.status}</Badge>
              {d.plan_id && <span className="text-muted-foreground">plan #{d.plan_id}</span>}
            </div>
          ))}
        </CardContent>
      </Card>
      <Dialog open={!!kind} onOpenChange={(open) => !open && setKind(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{tiles.find((t) => t.kind === kind)?.title}</DialogTitle><DialogDescription>Choose what happened. The hotfix is a proposal only.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            {kind === "invigilator_absent" && <select className={select} value={form.faculty_id} onChange={(e) => setForm({ ...form, faculty_id: e.target.value })}><option value="">Faculty member…</option>{catalogue.data?.faculty.map((f) => <option key={f.id} value={f.id}>{f.id} · {f.name}</option>)}</select>}
            {kind === "room_unavailable" && <select className={select} value={form.room_id} onChange={(e) => setForm({ ...form, room_id: e.target.value })}><option value="">Room…</option>{catalogue.data?.rooms.map((r) => <option key={r.id} value={r.id}>{r.id} ({r.seats} seats)</option>)}</select>}
            {kind !== "date_blocked" && <select className={select} value={form.slot_id} onChange={(e) => setForm({ ...form, slot_id: e.target.value })}><option value="">Session…</option>{slots.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>}
            {kind === "date_blocked" && <select className={select} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}><option value="">Date…</option>{dates.map((d) => <option key={d}>{d}</option>)}</select>}
            <div className="flex justify-end"><Button onClick={() => kind && report({ kind, ...Object.fromEntries(Object.entries(form).filter(([, v]) => v)) })}>Build hotfix</Button></div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
