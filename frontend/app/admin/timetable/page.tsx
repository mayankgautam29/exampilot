"use client";

import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GripVertical, MousePointerClick, Pin, Sun, Sunset } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DiffPanel } from "@/components/diff-panel";
import { SolverConsole } from "@/components/solver-console";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ErrorState, LoadingBlock, NativeSelect, PageHeader, Pill } from "@/components/ui-kit";
import { api } from "@/lib/api";
import { DEPT_COLORS, shortDate } from "@/lib/format";
import { useCatalogue, usePlanDetail, usePlans } from "@/lib/hooks";
import type { Diff, ExamRow, PlanDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

interface MoveOption {
  slot_id: string;
  label: string;
  status: "green" | "amber" | "red";
  reason: string;
  students_affected: number;
  est_cost_delta: number;
}

interface Explanation {
  facts: string[];
  text: string;
  data: { alternatives: MoveOption[] };
}

const TINT = { green: "bg-good/12 ring-2 ring-good/60", amber: "bg-warn/12 ring-2 ring-warn/60", red: "bg-bad/10 ring-2 ring-bad/50" };

function CourseCard({ exam, flag, onOpen }: { exam: ExamRow; flag?: "consecutive" | "relaxed"; onOpen: (course: string) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: exam.course_id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onOpen(exam.course_id)}
      className={cn("group relative cursor-grab touch-none overflow-hidden rounded-lg border bg-card py-1.5 pl-3.5 pr-2 text-xs shadow-xs transition hover:-translate-y-px hover:shadow-card active:cursor-grabbing", isDragging && "opacity-30", flag === "consecutive" && "ring-1 ring-warn", flag === "relaxed" && "ring-2 ring-bad")}
      title={`${exam.name} · ${exam.size} students`}
    >
      <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: DEPT_COLORS[exam.dept] ?? "#5b6b85" }} />
      <div className="flex items-center justify-between gap-1.5">
        <span className="flex items-center gap-1 font-semibold">
          {exam.course_id}
          {exam.pinned && <Pin className="size-3 text-brand" />}
        </span>
        <span className="flex items-center gap-1 tabular-nums text-muted-foreground">
          {exam.size}
          <GripVertical className="size-3 opacity-0 transition group-hover:opacity-60" />
        </span>
      </div>
      <div className="truncate text-[10.5px] text-muted-foreground">{exam.name}</div>
    </div>
  );
}

function SlotCell({ id, option, count, students, children }: { id: string; option?: MoveOption; count: number; students: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} title={option?.reason} className={cn("min-h-28 space-y-1.5 rounded-xl border bg-muted/40 p-2 transition", option && TINT[option.status], isOver && "scale-[1.01] shadow-lift")}>
      {count > 0 && (
        <div className="flex items-center justify-between px-0.5 text-[10.5px] font-medium text-muted-foreground tabular-nums">
          <span>{count} exam{count > 1 ? "s" : ""}</span>
          <span>{students} students</span>
        </div>
      )}
      {children}
    </div>
  );
}

export default function TimetablePage() {
  const plans = usePlans();
  const catalogue = useCatalogue();
  const client = useQueryClient();
  const [selected, setSelected] = useState<number | undefined>();
  const planId = selected ?? plans.data?.find((p) => p.status === "PUBLISHED")?.id;
  const detail = usePlanDetail(planId);
  const [dragging, setDragging] = useState<string | null>(null);
  const [options, setOptions] = useState<Record<string, MoveOption>>({});
  const [hover, setHover] = useState<MoveOption | null>(null);
  const [overlays, setOverlays] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const [pending, setPending] = useState<{ course: string; slot: string } | null>(null);
  const [job, setJob] = useState<string | null>(null);
  const [result, setResult] = useState<{ plan: PlanDetail; diff: Diff } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const explanation = useQuery({ queryKey: ["why-slot", planId, why], queryFn: () => api<Explanation>(`/plans/${planId}/explain/slot`, { params: { course: why! } }), enabled: !!why && !!planId });

  const slots = useMemo(() => catalogue.data?.slots.filter((s) => !s.blocked) ?? [], [catalogue.data]);
  const days = useMemo(() => Array.from(new Set(slots.map((s) => s.date))), [slots]);
  const flags = useMemo(() => {
    const map = new Map<string, "consecutive" | "relaxed">();
    if (!overlays) return map;
    detail.data?.violations.forEach((v) => {
      if (v.code === "S-CONSEC-DAYS" && v.entity_ids.length) v.entity_ids.forEach((id) => !map.has(id) && map.set(id, "consecutive"));
      if (v.code === "S-RELAXED-SAMEDAY") v.entity_ids.forEach((id) => map.set(id, "relaxed"));
    });
    return map;
  }, [detail.data, overlays]);

  async function onDragStart(event: DragStartEvent) {
    const course = String(event.active.id);
    setDragging(course);
    setHover(null);
    try {
      const rows = await api<MoveOption[]>(`/plans/${planId}/move-check`, { params: { course } });
      setOptions(Object.fromEntries(rows.map((r) => [r.slot_id, r])));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not check slots");
    }
  }

  function onDragEnd(event: DragEndEvent) {
    const course = String(event.active.id);
    const target = event.over ? String(event.over.id) : null;
    const option = target ? options[target] : undefined;
    setDragging(null);
    setOptions({});
    setHover(null);
    if (!target || !option) return;
    const current = detail.data?.exams.find((e) => e.course_id === course)?.slot_id;
    if (target === current) return;
    if (option.status === "red") return void toast.error(`Not possible: ${option.reason}`);
    setPending({ course, slot: target });
  }

  async function confirmPin() {
    if (!pending || !planId) return;
    try {
      const response = await api<{ job_id: string }>("/scenarios", { method: "POST", body: { name: `Pin ${pending.course}`, ops: [{ op: "pin_course", course_id: pending.course, slot_id: pending.slot }], base_plan_id: planId } });
      setJob(response.job_id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the proposal");
      setPending(null);
    }
  }

  async function finished(newId: number) {
    const [plan, diff] = await Promise.all([api<PlanDetail>(`/plans/${newId}`), api<Diff>(`/plans/${planId}/diff/${newId}`)]);
    setResult({ plan, diff });
    setJob(null);
  }

  async function resolve(kind: "apply" | "discard" | "submit") {
    if (!result) return;
    const id = result.plan.id;
    try {
      if (kind === "discard") await api(`/agent/proposals/${id}/discard`, { method: "POST" });
      else {
        await api(`/agent/proposals/${id}/apply`, { method: "POST" });
        if (kind === "submit") await api(`/plans/${id}/submit`, { method: "POST" });
      }
      toast.success(kind === "discard" ? "Proposal discarded" : kind === "submit" ? "Submitted for approval" : "Saved as a draft plan");
      client.invalidateQueries({ queryKey: ["plans"] });
      setResult(null);
      setPending(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed");
    }
  }

  if (plans.isLoading || catalogue.isLoading || detail.isLoading) return <LoadingBlock rows={6} />;
  if (detail.error) return <ErrorState error={detail.error} />;
  const exams = detail.data?.exams ?? [];
  const dragged = exams.find((e) => e.course_id === dragging);

  return (
    <div>
      <PageHeader
        eyebrow="Plan"
        title="Timetable"
        description="Drag a course onto another session. While you drag, each session tints green (free), amber (others must move) or red (impossible). Dropping creates a pin proposal in a sandbox."
        actions={
          <>
            <NativeSelect aria-label="Plan version" value={planId ?? ""} onChange={(e) => setSelected(Number(e.target.value))}>
              {plans.data?.filter((p) => p.status !== "SUPERSEDED").map((p) => (
                <option key={p.id} value={p.id}>v{p.version} · {p.status.replace("_", " ").toLowerCase()} · {p.label.slice(0, 30)}</option>
              ))}
            </NativeSelect>
            <Button variant={overlays ? "default" : "outline"} onClick={() => setOverlays((v) => !v)}>
              Conflict overlays
            </Button>
          </>
        }
      />
      <div className="surface rise-1 mb-4 flex min-h-12 flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 text-[13px]">
        {hover ? (
          <>
            <Pill tone={hover.status === "green" ? "good" : hover.status === "amber" ? "warn" : "bad"} dot>{hover.label}</Pill>
            <span className="font-medium">{hover.reason}</span>
            <span className="text-muted-foreground tabular-nums">{hover.students_affected} students affected · cost {hover.est_cost_delta >= 0 ? "+" : ""}{hover.est_cost_delta}</span>
          </>
        ) : dragging ? (
          <span className="flex items-center gap-2 text-muted-foreground"><MousePointerClick className="size-4" /> Checking every session for {dragging}…</span>
        ) : (
          <>
            <span className="eyebrow">Departments</span>
            {Object.entries(DEPT_COLORS).map(([dept, color]) => (
              <span key={dept} className="flex items-center gap-1.5 text-xs font-medium">
                <span className="size-2.5 rounded-sm" style={{ background: color }} />
                {dept}
              </span>
            ))}
            <span className="ml-auto hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
              <MousePointerClick className="size-3.5" /> Click a course to see why it sits here
            </span>
          </>
        )}
      </div>
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragOver={(e) => setHover(e.over ? (options[String(e.over.id)] ?? null) : null)}>
        <div className="overflow-x-auto pb-2">
          <div className="grid min-w-[700px] gap-2.5" style={{ gridTemplateColumns: "84px 1fr 1fr" }}>
            <div />
            <div className="flex items-center gap-2 px-1 text-xs font-semibold"><Sun className="size-4 text-warn" /> Morning <span className="font-normal text-muted-foreground">S1 · 09:30</span></div>
            <div className="flex items-center gap-2 px-1 text-xs font-semibold"><Sunset className="size-4 text-brand" /> Afternoon <span className="font-normal text-muted-foreground">S2 · 14:00</span></div>
            {days.map((day) => {
              const [weekday, ...rest] = shortDate(day).replace(",", "").split(" ");
              return (
                <div key={day} className="contents">
                  <div className="pt-2.5 pl-1">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{weekday}</div>
                    <div className="text-sm font-semibold">{rest.join(" ")}</div>
                  </div>
                  {["S1", "S2"].map((session) => {
                    const id = `${day}-${session}`;
                    const inSlot = exams.filter((e) => e.slot_id === id);
                    return (
                      <SlotCell key={id} id={id} option={options[id]} count={inSlot.length} students={inSlot.reduce((total, e) => total + e.size, 0)}>
                        {inSlot.map((exam) => (
                          <CourseCard key={exam.course_id} exam={exam} flag={flags.get(exam.course_id)} onOpen={setWhy} />
                        ))}
                      </SlotCell>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
        <DragOverlay>{dragged && <div className="rounded-lg border bg-card px-3 py-2 text-xs font-semibold shadow-lift ring-2 ring-brand/40">{dragged.course_id} · {dragged.name}</div>}</DragOverlay>
      </DndContext>

      <Dialog open={!!pending && !job && !result} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pin {pending?.course} to {pending?.slot}?</DialogTitle>
            <DialogDescription>The planner will re-solve with minimal disruption in a sandbox copy. Nothing is published.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPending(null)}>Cancel</Button>
            <Button variant="brand" onClick={confirmPin}>Create proposal</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!job} onOpenChange={() => undefined}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Re-planning</DialogTitle>
            <DialogDescription>Solving with stability so as few students as possible are affected.</DialogDescription>
          </DialogHeader>
          {job && <SolverConsole jobId={job} onDone={finished} />}
        </DialogContent>
      </Dialog>
      <Dialog open={!!result} onOpenChange={(open) => !open && setResult(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Proposal ready · plan #{result?.plan.id}</DialogTitle>
            <DialogDescription>{result?.plan.hard_violations ? `${result.plan.hard_violations} hard violations` : "0 hard violations"} · health {result?.plan.kpis.health?.score}</DialogDescription>
          </DialogHeader>
          {result && <DiffPanel diff={result.diff} slots={catalogue.data?.slots} />}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => resolve("discard")}>Discard</Button>
            <Button variant="outline" onClick={() => resolve("apply")}>Apply to draft</Button>
            <Button variant="brand" onClick={() => resolve("submit")}>Submit for approval</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Sheet open={!!why} onOpenChange={(open) => !open && setWhy(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Why this slot? {why}</SheetTitle>
            <SheetDescription>Facts computed from the conflict matrix, pins and costs.</SheetDescription>
          </SheetHeader>
          <div className="space-y-3 px-4 pb-6 text-sm">
            {explanation.isLoading && <LoadingBlock rows={4} />}
            {explanation.data?.facts.map((fact, i) => <p key={i}>{fact}</p>)}
            {explanation.data?.data.alternatives.length ? (
              <div className="space-y-1.5 border-t pt-3">
                <div className="font-medium">Top alternatives</div>
                {explanation.data.data.alternatives.map((a) => (
                  <div key={a.slot_id} className="rounded-lg border p-2 text-xs">
                    <span className="font-medium">{a.label}</span> · cost {a.est_cost_delta >= 0 ? "+" : ""}{a.est_cost_delta} · {a.students_affected} students
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
