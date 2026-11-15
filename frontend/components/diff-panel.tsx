"use client";

import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { shortDate } from "@/lib/format";
import type { Diff, SlotInfo } from "@/lib/types";

function slotText(slots: SlotInfo[] | undefined, id: string | null): string {
  const slot = slots?.find((s) => s.id === id);
  return slot ? `${shortDate(slot.date)} ${slot.session}` : (id ?? "—");
}

export function MiniCalendar({ diff, slots }: { diff: Diff; slots: SlotInfo[] }) {
  const days = Array.from(new Set(slots.filter((s) => !s.blocked).map((s) => s.date)));
  const moves = diff.courses_moved;
  if (!moves.length) return null;
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[480px] gap-px rounded-lg border bg-border text-[11px]" style={{ gridTemplateColumns: `60px repeat(${days.length}, 1fr)` }}>
        <div className="bg-muted p-1" />
        {days.map((day) => (
          <div key={day} className="bg-muted p-1 text-center font-medium">
            {shortDate(day).slice(0, 6)}
          </div>
        ))}
        {["S1", "S2"].map((session) => (
          <div key={session} className="contents">
            <div className="bg-muted p-1 font-medium">{session}</div>
            {days.map((day) => {
              const id = `${day}-${session}`;
              const leaving = moves.filter((m) => m.from === id);
              const arriving = moves.filter((m) => m.to === id);
              return (
                <div key={id} className="min-h-9 space-y-0.5 bg-background p-1">
                  {leaving.map((m) => (
                    <div key={m.course_id} className="rounded bg-bad/15 px-1 text-bad line-through">
                      {m.course_id}
                    </div>
                  ))}
                  {arriving.map((m) => (
                    <div key={m.course_id} className="rounded bg-good/15 px-1 text-good-text">
                      {m.course_id}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function DiffPanel({ diff, slots }: { diff: Diff; slots?: SlotInfo[] }) {
  const deltas = Object.entries(diff.kpi_deltas).filter(([key, value]) => value !== 0 && ["seating_risk_index", "mean_gap_days", "duty_gini", "rooms_total", "duties_max", "duties_min"].includes(key));
  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Fact label="Courses moved" value={diff.courses_moved.length} />
        <Fact label="Students affected" value={diff.students_affected.count} />
        <Fact label="Room changes" value={diff.rooms_changed} />
        <Fact label="Invigilators changed" value={diff.invigilators_changed.count} />
        <Fact label="Seats changed" value={diff.seats_changed} />
      </div>
      {diff.courses_moved.length > 0 && (
        <ul className="space-y-1">
          {diff.courses_moved.slice(0, 10).map((m) => (
            <li key={m.course_id} className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline">{m.course_id}</Badge>
              <span className="text-muted-foreground">{slotText(slots, m.from)}</span>
              <ArrowRight className="size-3" />
              <span>{slotText(slots, m.to)}</span>
              <span className="text-xs text-muted-foreground">({m.students} students)</span>
            </li>
          ))}
        </ul>
      )}
      {diff.invigilators_changed.replacements.length > 0 && (
        <ul className="space-y-1">
          {diff.invigilators_changed.replacements.slice(0, 8).map((r, i) => (
            <li key={i} className="text-muted-foreground">
              {slotText(slots, r.slot_id)} {r.room_id ?? "reliever pool"}: <span className="text-foreground">{r.from}</span> → <span className="text-foreground">{r.to}</span>
            </li>
          ))}
        </ul>
      )}
      {deltas.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {deltas.map(([key, value]) => (
            <Badge key={key} variant="secondary">
              {key.replaceAll("_", " ")} {value > 0 ? "+" : ""}
              {value}
            </Badge>
          ))}
        </div>
      )}
      {slots && <MiniCalendar diff={diff} slots={slots} />}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-muted/40 p-3">
      <div className="text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
