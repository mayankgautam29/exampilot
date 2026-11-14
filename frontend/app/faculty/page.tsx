"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, FileDown, Repeat, Star } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ChatPanel } from "@/components/chat-panel";
import { SeatGrid, type RoomShape, type SeatStudent } from "@/components/seat-grid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Check, EmptyState, ErrorState, LoadingBlock, PageHeader } from "@/components/ui-kit";
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
  return (
    <div>
      <PageHeader title={faculty.name} description={`${faculty.id} · ${faculty.dept} · rank ${faculty.rank} · ${duties.filter((d) => d.room_id).length} room duties`} actions={<Button variant="outline" size="sm" onClick={() => download("/export/calendar/me.ics", "duties.ics")}><CalendarPlus /> Add to calendar</Button>} />
      {!duties.length ? <EmptyState title="No duties assigned" /> : (
        <div className="grid gap-4 xl:grid-cols-[1fr_1.1fr]">
          <div className="space-y-2">
            {duties.map((duty) => (
              <div key={duty.slot_id} className={cn("flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm", chosen?.slot_id === duty.slot_id && "border-primary bg-muted/50")}>
                <div className="min-w-20"><div className="text-xs text-muted-foreground">{shortDate(duty.date)}</div><div className="font-semibold">{duty.start}</div></div>
                <div className="flex-1">
                  {duty.room_id ? <button className="font-medium underline-offset-2 hover:underline" onClick={() => setChosen(duty)}>Room {duty.room_id}</button> : <span className="font-medium">Reliever pool</span>}
                  {duty.role === "chief" && <Badge variant="secondary" className="ml-2"><Star className="size-3" /> chief</Badge>}
                  <div className="text-xs text-muted-foreground">{duty.courses.join(", ") || "On standby"}</div>
                </div>
                {duty.room_id && <Button size="xs" variant="outline" onClick={() => download("/export/attendance.pdf", "attendance.pdf", { slot: duty.slot_id, room: duty.room_id })}><FileDown /> Attendance</Button>}
                <Button size="xs" variant="ghost" onClick={() => { setSwapFor(duty); setOutcome(null); setReason(""); }}><Repeat /> Request swap</Button>
              </div>
            ))}
            {swaps.data && swaps.data.length > 0 && (
              <div className="pt-2 text-xs text-muted-foreground">My swap requests: {swaps.data.map((s) => `${s.slot_id} (${s.status})`).join(", ")}</div>
            )}
          </div>
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle>{chosen?.room_id ? `Seating chart · room ${chosen.room_id}` : "Seating chart"}</CardTitle></CardHeader>
              <CardContent>
                {chart.data ? <SeatGrid room={chart.data.room} students={chart.data.optimised.students} /> : <p className="text-sm text-muted-foreground">Choose one of your rooms to see who sits where.</p>}
              </CardContent>
            </Card>
            <ChatPanel title="Ask about your duties" description="This assistant can only see your own duties and the regulations." suggestions={["What are my duties?", "How many relievers are kept per session?"]} />
          </div>
        </div>
      )}
      <Dialog open={!!swapFor} onOpenChange={(open) => !open && setSwapFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Request a swap</DialogTitle><DialogDescription>{swapFor?.label}. The validator checks that a replacement keeps every rule satisfied before the Controller decides.</DialogDescription></DialogHeader>
          {outcome ? (
            <div className="space-y-2">
              <Check ok={outcome.precheck.feasible} label={outcome.precheck.message} />
              {outcome.precheck.replacement && <p className="text-sm">Proposed replacement: {outcome.precheck.replacement.to}</p>}
              {outcome.precheck.violations.map((v) => <p key={v.message} className="text-xs text-red-600">{v.message}</p>)}
              <div className="flex justify-end"><Button onClick={() => setSwapFor(null)}>Close</Button></div>
            </div>
          ) : (
            <>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" rows={3} />
              <div className="flex justify-end"><Button disabled={request.isPending} onClick={() => swapFor && request.mutate(swapFor)}>Send request</Button></div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
