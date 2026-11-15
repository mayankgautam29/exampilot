"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Accessibility, FileDown, MousePointerClick, Shuffle, Sparkles, VolumeX } from "lucide-react";
import { useState } from "react";
import { SeatGrid, type RoomShape, type SeatStudent } from "@/components/seat-grid";
import { EmptyState, LoadingBlock, NativeSelect, PageHeader, Pill, SectionTitle } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api, download } from "@/lib/api";
import { useCatalogue, usePublished } from "@/lib/hooks";
import { cn } from "@/lib/utils";

interface RoomRow {
  room_id: string;
  students: number;
  seats: number;
  courses: Record<string, number>;
  risk: number | null;
  adjacent_pairs: number | null;
  accessible: boolean;
  quiet: boolean;
}

interface SeatingData {
  room: RoomShape & { id: string };
  optimised: { students: SeatStudent[]; risk: number; adjacent_pairs: number };
  random: { students: SeatStudent[]; risk: number };
  invigilators: { faculty_id: string; name: string; role: string }[];
}

interface SeatExplanation {
  facts: string[];
  text: string;
}

export default function SeatingStudio() {
  const { published } = usePublished();
  const catalogue = useCatalogue();
  const [slot, setSlot] = useState("2026-12-07-S1");
  const [picked, setPicked] = useState<string | null>(null);
  const [view, setView] = useState<"optimised" | "random">("optimised");
  const [hover, setHover] = useState<SeatStudent | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const planId = published?.id;
  const rooms = useQuery({ queryKey: ["rooms", planId, slot], queryFn: () => api<RoomRow[]>(`/plans/${planId}/rooms`, { params: { slot } }), enabled: !!planId });
  const room = picked ?? rooms.data?.[0]?.room_id ?? null;
  const seating = useQuery({ queryKey: ["seating", planId, slot, room], queryFn: () => api<SeatingData>(`/plans/${planId}/seating`, { params: { slot, room } }), enabled: !!planId && !!room });
  const explanation = useQuery({ queryKey: ["why-seat", planId, slot, why], queryFn: () => api<SeatExplanation>(`/plans/${planId}/explain/seat`, { params: { student: why!, slot } }), enabled: !!why && !!planId });
  const slots = catalogue.data?.slots.filter((s) => !s.blocked) ?? [];
  const data = seating.data;
  const shown = data ? data[view].students : [];
  const reduction = data ? Math.round(100 - data.optimised.risk) : 0;

  return (
    <div>
      <PageHeader
        eyebrow="Plan"
        title="Seating Studio"
        description="Same-course students are pushed apart by simulated annealing. Flip between a random seating and the optimised one and watch the risk index fall."
        actions={
          <NativeSelect
            aria-label="Exam session"
            value={slot}
            onChange={(e) => {
              setSlot(e.target.value);
              setPicked(null);
            }}
          >
            {slots.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </NativeSelect>
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="surface rise-1 h-fit p-4">
          <SectionTitle title="Rooms in use" hint="Risk index is lower for safer seating." />
          <div className="space-y-2">
            {rooms.isLoading && <LoadingBlock rows={5} />}
            {rooms.data?.map((r) => {
              const fill = Math.round((100 * r.students) / Math.max(1, r.seats));
              return (
                <button key={r.room_id} onClick={() => setPicked(r.room_id)} className={cn("w-full rounded-xl border bg-card p-3 text-left shadow-xs transition hover:border-brand/50 hover:shadow-card", room === r.room_id && "border-brand ring-2 ring-brand/25")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-sm font-semibold">
                      {r.room_id}
                      {r.accessible && <Accessibility className="size-3.5 text-info" aria-label="Accessible" />}
                      {r.quiet && <VolumeX className="size-3.5 text-muted-foreground" aria-label="Quiet room" />}
                    </span>
                    <Pill tone={r.risk !== null && r.risk <= 15 ? "good" : "neutral"}>risk {r.risk ?? "—"}</Pill>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-brand" style={{ width: `${fill}%` }} />
                    </div>
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {r.students}/{r.seats}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="space-y-4">
          {!room || !data ? (
            seating.isLoading ? <LoadingBlock rows={6} /> : <EmptyState title="Pick a room" hint="Choose a room on the left to see its seating plan." />
          ) : (
            <>
              <div className="surface rise-1 flex flex-wrap items-center gap-4 p-4">
                <div className="inline-flex rounded-xl bg-muted p-1 ring-1 ring-border" role="tablist" aria-label="Seating view">
                  <Button size="sm" role="tab" aria-selected={view === "random"} variant={view === "random" ? "outline" : "ghost"} onClick={() => setView("random")}>
                    <Shuffle /> Random
                  </Button>
                  <Button size="sm" role="tab" aria-selected={view === "optimised"} variant={view === "optimised" ? "outline" : "ghost"} onClick={() => setView("optimised")}>
                    <Sparkles /> Optimised
                  </Button>
                </div>
                <motion.div key={view} initial={{ scale: 0.96, opacity: 0.5 }} animate={{ scale: 1, opacity: 1 }} className="flex items-baseline gap-2">
                  <span className={cn("font-display text-[34px] leading-none tabular-nums", view === "optimised" ? "text-good-text" : "text-bad")}>{view === "optimised" ? data.optimised.risk : Math.round(data.random.risk)}</span>
                  <span className="text-xs text-muted-foreground">{view === "optimised" ? `risk index · ${reduction}% below random` : "risk index · random baseline"}</span>
                </motion.div>
                <Pill tone={data.optimised.adjacent_pairs === 0 ? "good" : "warn"}>{data.optimised.adjacent_pairs} same-course neighbours</Pill>
                <Button variant="outline" className="ml-auto" onClick={() => download("/export/seating.pdf", "seating.pdf", { plan_id: planId, slot, room: room ?? undefined })}>
                  <FileDown /> PDF
                </Button>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_250px]">
                <SeatGrid room={data.room} students={shown} showLines={view === "random"} onHover={setHover} onSelect={(s) => setWhy(s.student_id)} />
                <div className="space-y-4">
                  <div className="surface min-h-32 p-4 text-sm">
                    {hover ? (
                      <div className="space-y-1">
                        <div className="text-[15px] font-semibold">{hover.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">{hover.student_id}</div>
                        <div className="pt-1">
                          {hover.course_id} · section {hover.section}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Seat {hover.row + 1}-{hover.col + 1}
                          {hover.accessible ? " · accessible seat" : ""}
                          {hover.extra_time ? " · extra time" : ""}
                        </div>
                      </div>
                    ) : (
                      <p className="flex items-start gap-2 text-[13px] leading-relaxed text-muted-foreground">
                        <MousePointerClick className="mt-0.5 size-4 shrink-0" /> Hover a seat to see the student, click it to see why it was chosen.
                      </p>
                    )}
                  </div>
                  <div className="surface p-4 text-sm">
                    <div className="eyebrow mb-2">Invigilators</div>
                    <div className="space-y-1.5">
                      {data.invigilators.map((i) => (
                        <div key={i.faculty_id} className="flex items-center justify-between gap-2 text-[13px]">
                          {i.name} {i.role === "chief" && <Pill tone="brand">chief</Pill>}
                        </div>
                      ))}
                    </div>
                    <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">Red lines join same-course neighbours in the random view.</p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      <Sheet open={!!why} onOpenChange={(open) => !open && setWhy(null)}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Why this seat? {why}</SheetTitle>
            <SheetDescription>Computed from the plan, then phrased in plain words.</SheetDescription>
          </SheetHeader>
          <div className="space-y-2 px-4 text-sm">
            {explanation.isLoading && <LoadingBlock rows={3} />}
            {explanation.data && <p className="rounded-xl bg-brand-soft p-3.5 leading-relaxed">{explanation.data.text}</p>}
            {explanation.data?.facts.map((f, i) => (
              <p key={i} className="text-muted-foreground">
                {f}
              </p>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
