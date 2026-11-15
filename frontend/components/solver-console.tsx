"use client";

import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { streamEvents } from "@/lib/api";
import type { JobEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

const STAGES = [
  { key: "timetable", label: "Timetable" },
  { key: "venues", label: "Venues" },
  { key: "invigilation", label: "Invigilation" },
  { key: "seating", label: "Seating" },
];

interface Point {
  t: number;
  objective: number;
  bound: number;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-muted/40 px-3.5 py-2.5">
      <div className="eyebrow">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export function SolverConsole({ jobId, onDone }: { jobId: string; onDone?: (planId: number) => void }) {
  const [stages, setStages] = useState<Record<string, string>>({});
  const [points, setPoints] = useState<Point[]>([]);
  const [solutions, setSolutions] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);
  const callback = useRef(onDone);
  useEffect(() => {
    callback.current = onDone;
  });

  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setElapsed((Date.now() - started) / 1000), 200);
    const controller = new AbortController();
    streamEvents<JobEvent>(
      "/solve/stream",
      { params: { job_id: jobId } },
      (event) => {
        if (event.type === "stage" && event.stage) setStages((s) => ({ ...s, [event.stage as string]: event.status as string }));
        if (event.type === "progress" && event.objective !== undefined) {
          setSolutions(event.solutions ?? 0);
          setPoints((p) => [...p, { t: event.t ?? 0, objective: event.objective as number, bound: event.bound as number }]);
        }
        if (event.type === "done") {
          setOutcome({ ok: true, message: `Plan ${event.plan_id} created` });
          if (event.plan_id) callback.current?.(event.plan_id);
          clearInterval(timer);
        }
        if (event.type === "error") {
          setOutcome({ ok: false, message: event.message ?? "Failed" });
          clearInterval(timer);
        }
      },
      controller.signal,
    ).catch(() => undefined);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [jobId]);

  const last = points[points.length - 1];
  const gap = last && last.objective ? Math.max(0, ((last.objective - last.bound) / Math.abs(last.objective)) * 100) : null;
  return (
    <div className="space-y-5">
      <ol className="relative grid grid-cols-4 gap-2">
        <span className="absolute inset-x-[12.5%] top-[15px] h-px bg-border" />
        {STAGES.map((stage) => {
          const status = stages[stage.key];
          return (
            <li key={stage.key} className="relative flex flex-col items-center gap-1.5 text-center">
              <span className={cn("z-10 flex size-[30px] items-center justify-center rounded-full border-2 bg-card transition", status === "done" && "border-good bg-good text-white", status === "running" && "border-brand", status === "infeasible" && "border-bad", !status && "border-border")}>
                {status === "done" ? <CheckCircle2 className="size-4" /> : status === "running" ? <Loader2 className="size-4 animate-spin text-brand" /> : status === "infeasible" ? <XCircle className="size-4 text-bad" /> : <Circle className="size-3.5 text-muted-foreground/50" />}
              </span>
              <span className={cn("text-xs", status ? "font-semibold" : "text-muted-foreground")}>{stage.label}</span>
            </li>
          );
        })}
      </ol>
      <div className="h-52 rounded-xl border bg-card p-3">
        {points.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="objective-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="var(--brand)" stopOpacity="0.28" />
                  <stop offset="1" stopColor="var(--brand)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="t" type="number" domain={[0, "dataMax"]} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} unit="s" axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} domain={["auto", "auto"]} width={52} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 }} />
              <Area type="stepAfter" dataKey="objective" stroke="var(--brand)" strokeWidth={2.5} fill="url(#objective-fill)" name="Best plan" dot={false} />
              <Line type="monotone" dataKey="bound" stroke="var(--chart-2)" dot={false} strokeDasharray="4 3" strokeWidth={2} name="Proven lower bound" />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Waiting for the solver&apos;s first solution…
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Metric label="Elapsed" value={`${elapsed.toFixed(1)}s`} />
        <Metric label="Solutions" value={String(solutions)} />
        <Metric label="Objective" value={last ? Math.round(last.objective).toLocaleString() : "—"} />
        <Metric label="Gap" value={gap !== null ? `${gap.toFixed(1)}%` : "—"} />
      </div>
      {outcome && (
        <div className={cn("flex items-center justify-between rounded-xl border p-3.5 text-sm font-medium", outcome.ok ? "border-good/40 bg-good/8" : "border-bad/40 bg-bad/8")}>
          <span className="flex items-center gap-2">
            {outcome.ok ? <CheckCircle2 className="size-4 text-good" /> : <XCircle className="size-4 text-bad" />}
            {outcome.message}
          </span>
          {!outcome.ok && (
            <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
              Dismiss
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
