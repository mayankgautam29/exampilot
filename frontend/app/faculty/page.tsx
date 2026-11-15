"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, FileDown, Repeat, Star } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ChatPanel } from "@/components/chat-panel";
import { SeatGrid, type RoomShape, type SeatStudent } from "@/components/seat-grid";
import { Check, EmptyState, ErrorState, LoadingBlock, PageHeader, Pill, SectionTitle, StatTile } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { api, download } from "@/lib/api";
import { shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Duty {
  slot_id: string;
  date: string;
  label: string;
  start: string;
  end: string;
  room_id: string | null;
  role: string;
  courses: string[];
}

interface Mine {
  plan_id: number;
  faculty: { id: string; name: string; dept: string; rank: number };
  duties: Duty[];
}

interface Chart {
  room: RoomShape & { id: string };
  optimised: { students: SeatStudent[]; risk: number };
}

interface SwapResult {
  id: number;
  precheck: { feasible: boolean; message: string; replacement: { to: string } | null; violations: { message: string }[] };
}

interface SwapRow {
  id: number;
  slot_id: string;
  status: string;
}

export default function FacultyPage() {
  const client = useQueryClient();
  const mine = useQuery({ queryKey: ["me-duties"], queryFn: () => api<Mine>("/me/duties") });
  const swaps = useQuery({ queryKey: ["swaps"], queryFn: () => api<SwapRow[]>("/swaps") });
  const [chosen, setChosen] = useState<Duty | null>(null);
  const [swapFor, setSwapFor] = useState<Duty | null>(null);
  const [reason, setReason] = useState("");
  const [outcome, setOutcome] = useState<SwapResult | null>(null);
  const chart = useQuery({ queryKey: ["chart", mine.data?.plan_id, chosen?.slot_id, chosen?.room_id], queryFn: () => api<Chart>(`/plans/${mine.data!.plan_id}/seating`, { params: { slot: chosen!.slot_id, room: chosen!.room_id! } }), enabled: !!chosen?.room_id && !!mine.data });
  const request = useMutation({
    mutationFn: (duty: Duty) => api<SwapResult>("/swaps", { method: "POST", body: { slot_id: duty.slot_id, reason } }),
    onSuccess: (result) => {
      setOutcome(result);
      client.invalidateQueries({ queryKey: ["swaps"] });
      toast.success("Swap request sent to the Controller");
    },
    onError: (error) => toast.error(error.message),
  });

  if (mine.isLoading) return <LoadingBlock rows={4} />;
  if (mine.error || !mine.data) return <ErrorState error={mine.error} />;
  const { faculty, duties } = mine.data;
  const roomDuties = duties.filter((d) => d.room_id);
  const chiefDuties = duties.filter((d) => d.role === "chief");
  return (
    <div>
      <PageHeader
        eyebrow="My duties"
        title={faculty.name}
        description={`${faculty.id} · ${faculty.dept} · rank ${faculty.rank}`}
        actions={
          <Button variant="outline" onClick={() => download("/export/calendar/me.ics", "duties.ics")}>
            <CalendarPlus /> Add to calendar
          </Button>
        }
      />
      <div className="rise-1 mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Total duties" value={duties.length} hint="across the exam period" />
        <StatTile label="Room duties" value={roomDuties.length} hint="invigilating a hall" />
        <StatTile label="Reliever slots" value={duties.length - roomDuties.length} hint="on standby" />
        <StatTile label="As chief" value={chiefDuties.length} hint="leading a room" />
      </div>
      {!duties.length ? (
        <EmptyState title="No duties assigned" hint="Duties appear here once the plan is published." />
      ) : (
        <div className="rise-2 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <section>
            <SectionTitle title="Your roster" hint="Select a room to see its seating chart." />
            <div className="space-y-2.5">
              {duties.map((duty) => (
                <div key={duty.slot_id} className={cn("flex flex-wrap items-center gap-3.5 rounded-2xl border bg-card p-3.5 text-sm shadow-xs transition", chosen?.slot_id === duty.slot_id && "border-brand ring-2 ring-brand/25")}>
                  <div className="flex w-16 shrink-0 flex-col items-center rounded-xl bg-muted py-2">
                    <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{shortDate(duty.date).split(" ")[0].replace(",", "")}</div>
                    <div className="text-lg font-semibold leading-tight tabular-nums">{duty.date.slice(8)}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {duty.room_id ? (
                        <button className="text-[14px] font-semibold underline-offset-4 hover:text-brand hover:underline" onClick={() => setChosen(duty)}>
                          Room {duty.room_id}
                        </button>
                      ) : (
                        <span className="text-[14px] font-semibold">Reliever pool</span>
                      )}
                      {duty.role === "chief" && (
                        <Pill tone="warn">
                          <Star className="size-3 fill-current" /> Chief
                        </Pill>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {duty.start}–{duty.end} · {duty.courses.join(", ") || "On standby"}
                    </div>
                  </div>
                  <div className="flex w-full gap-1.5 sm:w-auto">
                    {duty.room_id && (
                      <Button size="sm" variant="outline" onClick={() => download("/export/attendance.pdf", "attendance.pdf", { slot: duty.slot_id, room: duty.room_id })}>
                        <FileDown /> Attendance
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setSwapFor(duty);
                        setOutcome(null);
                        setReason("");
                      }}
                    >
                      <Repeat /> Swap
                    </Button>
                  </div>
                </div>
              ))}
              {swaps.data && swaps.data.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 pt-2 text-xs text-muted-foreground">
                  My swap requests:
                  {swaps.data.map((s) => (
                    <Pill key={s.id} tone={s.status === "PENDING" ? "warn" : s.status === "APPROVED" ? "good" : "neutral"} dot>
                      {s.slot_id} · {s.status.toLowerCase()}
                    </Pill>
                  ))}
                </div>
              )}
            </div>
          </section>
          <div className="space-y-5">
            <section className="surface p-5">
              <SectionTitle title={chosen?.room_id ? `Seating chart · room ${chosen.room_id}` : "Seating chart"} />
              {chart.data ? <SeatGrid room={chart.data.room} students={chart.data.optimised.students} /> : <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Choose one of your rooms to see who sits where.</p>}
            </section>
            <ChatPanel title="Ask about your duties" description="This assistant can only see your own duties and the regulations." suggestions={["What are my duties?", "How many relievers are kept per session?"]} />
          </div>
        </div>
      )}
      <Dialog open={!!swapFor} onOpenChange={(open) => !open && setSwapFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request a swap</DialogTitle>
            <DialogDescription>{swapFor?.label}. The validator checks that a replacement keeps every rule satisfied before the Controller decides.</DialogDescription>
          </DialogHeader>
          {outcome ? (
            <div className="space-y-3">
              <Check ok={outcome.precheck.feasible} label={outcome.precheck.message} />
              {outcome.precheck.replacement && <p className="text-sm">Proposed replacement: {outcome.precheck.replacement.to}</p>}
              {outcome.precheck.violations.map((v) => (
                <p key={v.message} className="text-xs text-bad">
                  {v.message}
                </p>
              ))}
              <div className="flex justify-end">
                <Button onClick={() => setSwapFor(null)}>Close</Button>
              </div>
            </div>
          ) : (
            <>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" rows={3} />
              <div className="flex justify-end">
                <Button variant="brand" disabled={request.isPending} onClick={() => swapFor && request.mutate(swapFor)}>
                  Send request
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
