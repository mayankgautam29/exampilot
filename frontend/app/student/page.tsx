"use client";

import { useQuery } from "@tanstack/react-query";
import { Accessibility, CalendarPlus, Clock, DoorOpen, FileDown, QrCode, Armchair } from "lucide-react";
import { useEffect, useState } from "react";
import { ChatPanel } from "@/components/chat-panel";
import { RegulationsQA } from "@/components/regulations-qa";
import { SeatGrid, type RoomShape } from "@/components/seat-grid";
import { EmptyState, ErrorState, LoadingBlock, PageHeader, Pill, SectionTitle } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
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
  const seconds = Math.floor((diff % 60000) / 1000);
  return `${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
}

export default function StudentPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ["me-exams"], queryFn: () => api<Mine>("/me/exams") });
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const slot = selected ?? data?.exams[0]?.slot_id;
  const seat = useQuery({ queryKey: ["me-seat", slot], queryFn: () => api<SeatMap>("/me/seat", { params: { slot } }), enabled: !!slot });
  if (isLoading) return <LoadingBlock rows={4} />;
  if (error || !data) return <ErrorState error={error} />;
  const { student } = data;
  const next = data.exams[0];
  return (
    <div>
      <PageHeader
        eyebrow="My exams"
        title={`Hello, ${student.name.split(" ")[0]}`}
        description={`${student.id} · ${student.dept} semester ${student.semester} · section ${student.section}`}
        actions={
          <>
            <Button variant="outline" onClick={() => download(`/export/hallticket/${student.id}.pdf`, "hallticket.pdf")}>
              <FileDown /> Hall ticket
            </Button>
            <Button variant="outline" onClick={() => download("/export/calendar/me.ics", "exams.ics")}>
              <CalendarPlus /> Add to calendar
            </Button>
          </>
        }
      />
      {!data.exams.length ? (
        <EmptyState title="No exams scheduled yet" hint="Your timetable appears here once the Controller publishes it." />
      ) : (
        <>
          {next && (
            <section className="rise-1 relative mb-7 grid overflow-hidden rounded-lg border-[1.5px] border-edge bg-deep text-deep-foreground shadow-[6px_6px_0_var(--marker)] md:grid-cols-[1fr_auto]">
              <div className="hazard absolute inset-x-0 top-0 h-2" />
              <div className="relative p-6 pt-9 md:p-8 md:pt-10">
                <div className="eyebrow flex items-center gap-2 !text-deep-muted">
                  <span className="size-2 bg-brand" /> Next exam · boarding pass
                </div>
                <h2 className="font-display mt-3 text-[52px] leading-[1]">{next.course}</h2>
                <div className="mt-1.5 font-mono text-xs uppercase tracking-[0.14em] text-deep-muted">{next.course_id}</div>
                <div className="mt-6 grid max-w-lg grid-cols-3 gap-3">
                  {[
                    { icon: Clock, label: "When", value: `${shortDate(next.date)} · ${next.start}` },
                    { icon: DoorOpen, label: "Room", value: next.room_id },
                    { icon: Armchair, label: "Seat", value: next.seat },
                  ].map((item) => (
                    <div key={item.label} className="rounded-md border-[1.5px] border-deep-line px-3.5 py-3">
                      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-deep-muted">
                        <item.icon className="size-3.5" /> {item.label}
                      </div>
                      <div className="mt-1.5 text-[15px] font-semibold leading-tight">{item.value}</div>
                    </div>
                  ))}
                </div>
                {(student.extra_time_pct > 0 || student.needs_accessible) && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {student.extra_time_pct > 0 && <span className="rounded-sm border-[1.5px] border-marker px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-wider text-marker">{student.extra_time_pct}% extra time</span>}
                    {student.needs_accessible && (
                      <span className="flex items-center gap-1.5 rounded-sm border-[1.5px] border-marker px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-wider text-marker">
                        <Accessibility className="size-3.5" /> Accessible seating
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="relative flex flex-col justify-center border-t-2 border-dashed border-deep-line p-6 md:min-w-[300px] md:border-l-2 md:border-t-0 md:p-8">
                <span className="absolute -left-3 -top-3 hidden size-6 rounded-full bg-background md:block" />
                <span className="absolute -bottom-3 -left-3 hidden size-6 rounded-full bg-background md:block" />
                <div className="eyebrow !text-deep-muted">Starts in</div>
                <div className="font-display mt-1.5 text-[40px] leading-none tabular-nums text-marker">{countdown(next.date, next.start, now)}</div>
                <a href={`/verify/${next.token}`} target="_blank" rel="noreferrer" className="lift mt-5 inline-flex h-10 w-fit items-center gap-2 rounded-md border-[1.5px] border-deep-foreground bg-marker px-4 text-sm font-semibold text-ink shadow-[2px_2px_0_var(--deep-foreground)]">
                  <QrCode className="size-4" /> Verify my ticket
                </a>
              </div>
            </section>
          )}
<div className="rise-2 grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <section>
              <SectionTitle title="Your schedule" hint={`${data.exams.length} exams. Select one to see your seat.`} />
              <div className="space-y-2.5">
                {data.exams.map((exam, index) => (
                  <button key={exam.slot_id + exam.course_id} onClick={() => setSelected(exam.slot_id)} className={cn("flex w-full flex-wrap items-center gap-4 rounded-2xl border bg-card p-3.5 text-left shadow-xs transition hover:border-brand/50 hover:shadow-card", slot === exam.slot_id && "border-brand ring-2 ring-brand/25")}>
                    <div className="flex w-16 shrink-0 flex-col items-center rounded-xl bg-muted py-2">
                      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{shortDate(exam.date).split(" ")[0].replace(",", "")}</div>
                      <div className="text-lg font-semibold leading-tight tabular-nums">{exam.date.slice(8)}</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-semibold">
                        {exam.course_id} · {exam.course}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {exam.start}–{exam.end} · Room {exam.room_id} · seat {exam.seat}
                      </div>
                    </div>
                    {index === 0 && <Pill tone="good" dot>Next</Pill>}
                  </button>
                ))}
              </div>
            </section>
            <div className="space-y-5">
              <section className="surface p-5">
                <SectionTitle title="Your seat" hint={seat.data ? `Room ${seat.data.room.id}, row ${seat.data.seat.row + 1}, column ${seat.data.seat.col + 1}` : "Select an exam"} />
                {seat.data && <SeatGrid room={seat.data.room} students={[{ row: seat.data.seat.row, col: seat.data.seat.col, student_id: student.id, course_id: seat.data.course_id }]} highlight={student.id} />}
                <p className="mt-3 text-xs text-muted-foreground">Other seats are hidden for privacy. Front of the room is at the top.</p>
              </section>
              <ChatPanel title="Ask about your exams" description="This assistant can only see your own timetable and the regulations." suggestions={["When is my next exam and where do I sit?", "Can I use my mobile phone in the exam hall?", "When must I report to the room?"]} />
            </div>
          </div>
        </>
      )}
      <div className="rise-3 mt-8 max-w-3xl">
        <SectionTitle title="Regulations" hint="Ask any question about the examination rules. Answers cite the rule." />
        <RegulationsQA compact />
      </div>
    </div>
  );
}
