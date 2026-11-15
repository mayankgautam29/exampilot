"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CalendarX, Dices, DoorClosed, Loader2, UserX } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState, NativeSelect, PageHeader, Pill, SectionTitle } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
    { kind: "invigilator_absent", title: "Invigilator absent", hint: "A reliever is pulled in, fairness-aware.", icon: UserX },
    { kind: "room_unavailable", title: "Room unavailable", hint: "Re-plan rooms, seats and invigilators for one session.", icon: DoorClosed },
    { kind: "date_blocked", title: "Block a date", hint: "Exams on that day move with minimal disruption.", icon: CalendarX },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Simulate and respond"
        title="Disruption Mode"
        description="Something went wrong after publication? Report it. ExamPilot builds a scoped hotfix plan that waits in the approval inbox. Nothing changes until you approve it."
        actions={
          <Button variant="outline" size="lg" onClick={chaos} disabled={!!running}>
            <Dices /> Simulate chaos
          </Button>
        }
      />
      <div className="rise-1 grid gap-4 md:grid-cols-3">
        {tiles.map((tile) => (
          <button key={tile.kind} disabled={!!running} onClick={() => setKind(tile.kind)} className="surface group relative overflow-hidden p-6 text-left transition hover:-translate-y-0.5 hover:shadow-lift disabled:opacity-50">
            <div className="absolute -right-8 -top-8 size-28 rounded-full bg-bad/8 transition group-hover:scale-125" />
            <span className="relative flex size-12 items-center justify-center rounded-2xl bg-bad/12 text-bad">
              <tile.icon className="size-6" />
            </span>
            <div className="relative mt-4 text-[17px] font-semibold tracking-tight">{tile.title}</div>
            <div className="relative mt-1 text-[13px] leading-relaxed text-muted-foreground">{tile.hint}</div>
            <div className="relative mt-4 flex items-center gap-1 text-xs font-semibold text-brand">
              Report <ArrowRight className="size-3.5 transition group-hover:translate-x-1" />
            </div>
          </button>
        ))}
      </div>
      {running && (
        <div className="rise mt-5 flex items-center gap-3 rounded-2xl border border-brand/30 bg-brand-soft px-5 py-4 text-sm font-medium">
          <Loader2 className="size-4 animate-spin text-brand" /> {running}
        </div>
      )}
      {outcome && (
        <section className="surface rise mt-5 border-warn/40 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">Hotfix proposal #{outcome.plan_id}</h2>
            <Pill tone="warn" dot>
              Waiting for approval
            </Pill>
          </div>
          <p className="mt-1.5 text-[13.5px] text-muted-foreground">{outcome.summary}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Pill tone="info">{outcome.students_affected} students affected</Pill>
            <Pill tone="info">{outcome.courses_moved} courses moved</Pill>
          </div>
          <div className="mt-3 space-y-1.5 text-[13px]">
            {outcome.replacements.map((r, i) => (
              <div key={i} className="rounded-lg bg-muted/50 px-3 py-2">
                <span className="font-mono text-xs">{r.slot_id}</span> · {r.room_id ?? "reliever pool"}: <b>{r.from}</b> replaced by <b>{r.to}</b>
              </div>
            ))}
          </div>
          <Link href="/admin/approvals" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">
            Review in Approvals <ArrowRight className="size-4" />
          </Link>
        </section>
      )}
      <section className="surface rise-2 mt-6 p-5">
        <SectionTitle title="History" hint="Every reported disruption and its hotfix." />
        {!history.data?.length && <EmptyState compact title="No disruptions reported" hint="Reported issues will be listed here." />}
        <div className="space-y-2">
          {history.data?.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border px-4 py-3 text-[13px]">
              <Pill tone="bad">{d.kind.replaceAll("_", " ")}</Pill>
              <span className="min-w-0 flex-1">{d.summary}</span>
              <Pill tone={d.status.toLowerCase().includes("approv") ? "good" : "neutral"} dot>
                {d.status.toLowerCase()}
              </Pill>
              {d.plan_id && <span className="font-mono text-xs text-muted-foreground">plan #{d.plan_id}</span>}
            </div>
          ))}
        </div>
      </section>
      <Dialog open={!!kind} onOpenChange={(open) => !open && setKind(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tiles.find((t) => t.kind === kind)?.title}</DialogTitle>
            <DialogDescription>Choose what happened. The hotfix is a proposal only.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {kind === "invigilator_absent" && (
              <NativeSelect className="w-full" aria-label="Faculty member" value={form.faculty_id} onChange={(e) => setForm({ ...form, faculty_id: e.target.value })}>
                <option value="">Faculty member…</option>
                {catalogue.data?.faculty.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.id} · {f.name}
                  </option>
                ))}
              </NativeSelect>
            )}
            {kind === "room_unavailable" && (
              <NativeSelect className="w-full" aria-label="Room" value={form.room_id} onChange={(e) => setForm({ ...form, room_id: e.target.value })}>
                <option value="">Room…</option>
                {catalogue.data?.rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.id} ({r.seats} seats)
                  </option>
                ))}
              </NativeSelect>
            )}
            {kind !== "date_blocked" && (
              <NativeSelect className="w-full" aria-label="Session" value={form.slot_id} onChange={(e) => setForm({ ...form, slot_id: e.target.value })}>
                <option value="">Session…</option>
                {slots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </NativeSelect>
            )}
            {kind === "date_blocked" && (
              <NativeSelect className="w-full" aria-label="Date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}>
                <option value="">Date…</option>
                {dates.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </NativeSelect>
            )}
            <div className="flex justify-end">
              <Button variant="brand" onClick={() => kind && report({ kind, ...Object.fromEntries(Object.entries(form).filter(([, v]) => v)) })}>
                Build hotfix
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
