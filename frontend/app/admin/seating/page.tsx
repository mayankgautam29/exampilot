"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { FileDown, Shuffle, Sparkles } from "lucide-react";
import { useState } from "react";
import { SeatGrid, type RoomShape, type SeatStudent } from "@/components/seat-grid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { EmptyState, LoadingBlock, PageHeader } from "@/components/ui-kit";
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
  const [room, setRoom] = useState<string | null>(null);
  const [view, setView] = useState<"optimised" | "random">("optimised");
  const [hover, setHover] = useState<SeatStudent | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const planId = published?.id;
  const rooms = useQuery({ queryKey: ["rooms", planId, slot], queryFn: () => api<RoomRow[]>(`/plans/${planId}/rooms`, { params: { slot } }), enabled: !!planId });
  const seating = useQuery({ queryKey: ["seating", planId, slot, room], queryFn: () => api<SeatingData>(`/plans/${planId}/seating`, { params: { slot, room } }), enabled: !!planId && !!room });
  const explanation = useQuery({ queryKey: ["why-seat", planId, slot, why], queryFn: () => api<SeatExplanation>(`/plans/${planId}/explain/seat`, { params: { student: why!, slot } }), enabled: !!why && !!planId });
  const slots = catalogue.data?.slots.filter((s) => !s.blocked) ?? [];
  const data = seating.data;
  const shown = data ? data[view].students : [];
  const reduction = data ? Math.round(100 - data.optimised.risk) : 0;

  return (
    <div>
      <PageHeader
        title="Seating Studio"
        description="Same-course students are pushed apart by simulated annealing. Flip between a random seating and the optimised one and watch the risk index fall."
        actions={
          <select className="h-8 rounded-lg border bg-background px-2 text-sm" value={slot} onChange={(e) => { setSlot(e.target.value); setRoom(null); }}>
            {slots.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Rooms in use</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {rooms.isLoading && <LoadingBlock rows={5} />}
            {rooms.data?.map((r) => (
              <button key={r.room_id} onClick={() => setRoom(r.room_id)} className={cn("flex w-full items-center justify-between rounded-lg border px-2.5 py-1.5 text-left text-sm hover:bg-muted", room === r.room_id && "border-primary bg-muted")}>
                <span>
                  <span className="font-medium">{r.room_id}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{r.students}/{r.seats}</span>
                </span>
                <span className="flex gap-1">
                  {r.accessible && <Badge variant="outline">♿</Badge>}
                  {r.quiet && <Badge variant="outline">quiet</Badge>}
                  <Badge variant="secondary">{r.risk ?? "—"}</Badge>
                </span>
              </button>
            ))}
          </CardContent>
        </Card>
        <div className="space-y-3">
          {!room || !data ? (
            seating.isLoading ? <LoadingBlock rows={6} /> : <EmptyState title="Pick a room" hint="Choose a room on the left to see its seating plan." />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex rounded-lg border p-0.5">
                  <Button size="sm" variant={view === "random" ? "secondary" : "ghost"} onClick={() => setView("random")}>
                    <Shuffle /> Random
                  </Button>
                  <Button size="sm" variant={view === "optimised" ? "secondary" : "ghost"} onClick={() => setView("optimised")}>
                    <Sparkles /> Optimised
                  </Button>
                </div>
                <motion.div key={view} initial={{ scale: 0.95, opacity: 0.5 }} animate={{ scale: 1, opacity: 1 }} className={cn("rounded-lg px-3 py-1.5 text-sm font-medium", view === "optimised" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-red-500/15 text-red-700 dark:text-red-300")}>
                  {view === "optimised" ? `Risk vs random: ${data.optimised.risk} (−${reduction}%)` : `Random seating: risk ${Math.round(data.random.risk)} (baseline)`}
                </motion.div>
                <Badge variant="outline">{data.optimised.adjacent_pairs} same-course neighbours in the optimised plan</Badge>
                <Button size="sm" variant="outline" className="ml-auto" onClick={() => download("/export/seating.pdf", "seating.pdf", { plan_id: planId, slot, room: room ?? undefined })}>
                  <FileDown /> PDF
                </Button>
              </div>
              <div className="grid gap-3 xl:grid-cols-[1fr_240px]">
                <SeatGrid room={data.room} students={shown} showLines={view === "random"} onHover={setHover} onSelect={(s) => setWhy(s.student_id)} />
                <div className="space-y-3">
                  <Card size="sm">
                    <CardContent className="min-h-28 text-sm">
                      {hover ? (
                        <div className="space-y-1">
                          <div className="font-medium">{hover.name}</div>
                          <div className="font-mono text-xs">{hover.student_id}</div>
                          <div>{hover.course_id} · section {hover.section}</div>
                          <div className="text-xs text-muted-foreground">Seat {hover.row + 1}-{hover.col + 1}{hover.accessible ? " · accessible seat" : ""}{hover.extra_time ? " · extra time" : ""}</div>
                        </div>
                      ) : (
                        <p className="text-muted-foreground">Hover a seat for the student, click it to see why it was chosen.</p>
                      )}
                    </CardContent>
                  </Card>
                  <Card size="sm">
                    <CardContent className="space-y-1 text-xs">
                      <div className="font-medium">Invigilators</div>
                      {data.invigilators.map((i) => (
                        <div key={i.faculty_id}>{i.name} {i.role === "chief" && <Badge variant="secondary">chief</Badge>}</div>
                      ))}
                      <div className="pt-1 text-muted-foreground">Red lines join same-course neighbours in the random view.</div>
                    </CardContent>
                  </Card>
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
            {explanation.data && <p className="rounded-lg bg-muted p-3">{explanation.data.text}</p>}
            {explanation.data?.facts.map((f, i) => <p key={i} className="text-muted-foreground">{f}</p>)}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
