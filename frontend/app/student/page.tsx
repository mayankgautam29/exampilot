"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarPlus, FileDown, MapPin, QrCode } from "lucide-react";
import { useEffect, useState } from "react";
import { ChatPanel } from "@/components/chat-panel";
import { RegulationsQA } from "@/components/regulations-qa";
import { SeatGrid, type RoomShape } from "@/components/seat-grid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from "@/components/ui-kit";
import { api, download } from "@/lib/api";
import { shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Exam {
  course_id: string;
  course: string;
  slot_id: string;
  date: string;
  start: string;
  end: string;
  label: string;
  room_id: string;
  seat: string;
  row: number;
  col: number;
  token: string;
}

interface Mine {
  student: { id: string; name: string; dept: string; semester: number; section: string; extra_time_pct: number; needs_accessible: boolean };
  exams: Exam[];
}

interface SeatMap {
  room: RoomShape & { id: string };
  seat: { row: number; col: number };
  course_id: string;
}

function countdown(date: string, time: string, now: number): string {
  const diff = new Date(`${date}T${time}:00`).getTime() - now;
  if (diff <= 0) return "started";
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  return `${days}d ${hours}h ${minutes}m`;
}

export default function StudentPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ["me-exams"], queryFn: () => api<Mine>("/me/exams") });
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const slot = selected ?? data?.exams[0]?.slot_id;
  const seat = useQuery({ queryKey: ["me-seat", slot], queryFn: () => api<SeatMap>("/me/seat", { params: { slot } }), enabled: !!slot });
  if (isLoading) return <LoadingBlock rows={4} />;
  if (error || !data) return <ErrorState error={error} />;
  const { student } = data;
  return (
    <div>
      <PageHeader
        title={`Hello, ${student.name.split(" ")[0]}`}
        description={`${student.id} · ${student.dept} semester ${student.semester} section ${student.section}${student.extra_time_pct ? ` · ${student.extra_time_pct}% extra time` : ""}${student.needs_accessible ? " · accessible seating" : ""}`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => download(`/export/hallticket/${student.id}.pdf`, "hallticket.pdf")}><FileDown /> Hall ticket</Button>
            <Button variant="outline" size="sm" onClick={() => download("/export/calendar/me.ics", "exams.ics")}><CalendarPlus /> Add to calendar</Button>
          </>
        }
      />
      {!data.exams.length ? <EmptyState title="No exams scheduled yet" /> : (
        <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
          <div className="space-y-2">
            {data.exams.map((exam, index) => (
              <button key={exam.slot_id + exam.course_id} onClick={() => setSelected(exam.slot_id)} className={cn("flex w-full flex-wrap items-center gap-3 rounded-xl border p-3 text-left hover:bg-muted/50", slot === exam.slot_id && "border-primary bg-muted/50")}>
                <div className="min-w-24 text-center">
                  <div className="text-xs text-muted-foreground">{shortDate(exam.date)}</div>
                  <div className="text-lg font-semibold">{exam.start}</div>
                </div>
                <div className="flex-1">
                  <div className="font-medium">{exam.course_id} · {exam.course}</div>
                  <div className="flex items-center gap-1 text-sm text-muted-foreground"><MapPin className="size-3.5" /> Room {exam.room_id} · seat {exam.seat}</div>
                </div>
                {index === 0 && <Badge className="border-0 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">next · in {countdown(exam.date, exam.start, now)}</Badge>}
                <a href={`/verify/${exam.token}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-muted-foreground hover:text-foreground" aria-label="Verify ticket"><QrCode className="size-4" /></a>
              </button>
            ))}
          </div>
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle>Your seat</CardTitle><CardDescription>{seat.data ? `Room ${seat.data.room.id}, row ${seat.data.seat.row + 1}, column ${seat.data.seat.col + 1}` : "Select an exam"}</CardDescription></CardHeader>
              <CardContent>
                {seat.data && <SeatGrid room={seat.data.room} students={[{ row: seat.data.seat.row, col: seat.data.seat.col, student_id: student.id, course_id: seat.data.course_id }]} highlight={student.id} />}
                <p className="mt-2 text-xs text-muted-foreground">Other seats are hidden for privacy. Front of the room is at the top.</p>
              </CardContent>
            </Card>
            <ChatPanel title="Ask about your exams" description="This assistant can only see your own timetable and the regulations." suggestions={["When is my next exam and where do I sit?", "Can I use my mobile phone in the exam hall?", "When must I report to the room?"]} />
          </div>
        </div>
      )}
      <div className="mt-6 max-w-3xl">
        <h2 className="mb-2 font-semibold">Regulations</h2>
        <RegulationsQA compact />
      </div>
    </div>
  );
}
