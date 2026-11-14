"use client";

import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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

export function SolverConsole({ jobId, onDone }: { jobId: string; onDone?: (planId: number) => void }) {
  const [stages, setStages] = useState<Record<string, string>>({});
  const [points, setPoints] = useState<Point[]>([]);
  const [solutions, setSolutions] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);
  const callback = useRef(onDone);
  callback.current = onDone;

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
    <div className="space-y-4">
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {STAGES.map((stage, index) => {
          const status = stages[stage.key];
          return (
            <li key={stage.key} className={cn("flex items-center gap-2 rounded-lg border p-2 text-sm", status === "running" && "border-emerald-500/60 bg-emerald-500/5", status === "infeasible" && "border-red-500/60")}>
              {status === "done" ? <CheckCircle2 className="size-4 text-emerald-500" /> : status === "running" ? <Loader2 className="size-4 animate-spin text-emerald-500" /> : status === "infeasible" ? <XCircle className="size-4 text-red-500" /> : <Circle className="size-4 text-muted-foreground" />}
              <span>
                {index + 1}. {stage.label}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="h-48 rounded-lg border p-2">
        {points.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="t" type="number" domain={[0, "dataMax"]} tick={{ fontSize: 11 }} unit="s" />
              <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} width={50} />
              <Tooltip />
              <Line type="stepAfter" dataKey="objective" stroke="#10b981" dot={false} strokeWidth={2} name="Objective" />
              <Line type="monotone" dataKey="bound" stroke="#6366f1" dot={false} strokeDasharray="4 3" name="Lower bound" />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Waiting for the solver's first solution…</div>
        )}
      </div>
      <div className="flex flex-wrap gap-4 text-sm tabular-nums">
        <span>Elapsed {elapsed.toFixed(1)}s</span>
        <span>Solutions {solutions}</span>
        {last && <span>Objective {Math.round(last.objective).toLocaleString()}</span>}
        {gap !== null && <span>Gap {gap.toFixed(1)}%</span>}
      </div>
      {outcome && (
        <div className={cn("flex items-center justify-between rounded-lg border p-3 text-sm", outcome.ok ? "border-emerald-500/40 bg-emerald-500/5" : "border-red-500/40 bg-red-500/5")}>
          {outcome.message}
          {!outcome.ok && <Button size="sm" variant="outline" onClick={() => window.location.reload()}>Dismiss</Button>}
        </div>
      )}
    </div>
  );
}
