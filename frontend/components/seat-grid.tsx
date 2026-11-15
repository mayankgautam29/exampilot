"use client";

import { motion } from "framer-motion";
import { Accessibility } from "lucide-react";
import { colorFor } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface SeatStudent {
  row: number;
  col: number;
  student_id: string;
  name?: string;
  course_id: string;
  section?: string;
  accessible?: boolean;
  extra_time?: boolean;
}

export interface RoomShape {
  rows: number;
  cols: number;
  blocked_seats: number[][];
  aisle_cols: number[];
}

const CELL = 44;

function shift(room: RoomShape, col: number): number {
  return room.aisle_cols.filter((a) => a < col).length;
}

export function SeatGrid({ room, students, highlight, showLines, onHover, onSelect }: { room: RoomShape; students: SeatStudent[]; highlight?: string; showLines?: boolean; onHover?: (student: SeatStudent | null) => void; onSelect?: (student: SeatStudent) => void }) {
  const width = (room.cols + room.aisle_cols.length) * CELL;
  const height = room.rows * CELL;
  const position = (row: number, col: number) => ({ x: (col + shift(room, col)) * CELL, y: row * CELL });
  const courses = Array.from(new Set(students.map((s) => s.course_id))).sort();
  const lines: { key: string; x1: number; y1: number; x2: number; y2: number }[] = [];
  if (showLines) {
    for (let i = 0; i < students.length; i++) {
      for (let j = i + 1; j < students.length; j++) {
        const a = students[i];
        const b = students[j];
        if (a.course_id !== b.course_id) continue;
        const pa = position(a.row, a.col);
        const pb = position(b.row, b.col);
        if (Math.max(Math.abs(pa.x - pb.x), Math.abs(pa.y - pb.y)) <= CELL * 1.05) lines.push({ key: `${a.student_id}-${b.student_id}`, x1: pa.x + CELL / 2, y1: pa.y + CELL / 2, x2: pb.x + CELL / 2, y2: pb.y + CELL / 2 });
      }
    }
  }
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-card">
      <div className="overflow-auto">
        <div className="mx-auto" style={{ width: Math.max(width, 280) }}>
          <div className="mb-4 flex items-center justify-center gap-2 rounded-lg bg-primary/90 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-primary-foreground">Front of hall · invigilator desk</div>
          <div className="relative mx-auto" style={{ width, height }}>
            {Array.from({ length: room.rows }).flatMap((_, r) =>
              Array.from({ length: room.cols }).map((__, c) => {
                const blocked = room.blocked_seats.some(([br, bc]) => br === r && bc === c);
                const { x, y } = position(r, c);
                return <div key={`${r}-${c}`} className={cn("absolute rounded-lg", blocked ? "bg-muted-foreground/25" : "border border-dashed bg-muted/50")} style={{ left: x + 2, top: y + 2, width: CELL - 4, height: CELL - 4 }} title={blocked ? "Blocked seat" : `Seat ${r + 1}-${c + 1}`} />;
              }),
            )}
            {students.map((s) => {
              const { x, y } = position(s.row, s.col);
              return (
                <motion.button
                  key={s.student_id}
                  type="button"
                  initial={false}
                  animate={{ x: x + 2, y: y + 2 }}
                  transition={{ type: "spring", stiffness: 140, damping: 18 }}
                  onMouseEnter={() => onHover?.(s)}
                  onMouseLeave={() => onHover?.(null)}
                  onClick={() => onSelect?.(s)}
                  className={cn("absolute left-0 top-0 flex flex-col items-center justify-center rounded-lg text-[9px] font-semibold text-white shadow-sm transition-shadow hover:shadow-lift focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", highlight === s.student_id && "ring-4 ring-primary")}
                  style={{ width: CELL - 4, height: CELL - 4, background: colorFor(s.course_id) }}
                >
                  <span>{s.course_id}</span>
                  <span className="opacity-80">{s.student_id.slice(-3)}</span>
                  {s.accessible && <Accessibility className="absolute -right-1.5 -top-1.5 size-4 rounded-full bg-white p-0.5 text-info shadow" />}
                </motion.button>
              );
            })}
            {showLines && (
              <svg className="pointer-events-none absolute inset-0" width={width} height={height}>
                {lines.map((l) => (
                  <line key={l.key} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="var(--bad)" strokeWidth={2.5} strokeLinecap="round" />
                ))}
              </svg>
            )}
          </div>
        </div>
      </div>
      {courses.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 border-t pt-3">
          {courses.map((course) => (
            <span key={course} className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <span className="size-2.5 rounded-sm" style={{ background: colorFor(course) }} />
              {course}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
