"use client";

import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ErrorState, LoadingBlock, PageHeader, Pill, SectionTitle } from "@/components/ui-kit";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Row {
  name: string;
  clashes: number;
  mean_gap_days: number;
  seating_risk_index: number;
  adjacent_pairs: number;
  runtime_s: number;
}

const COLORS: Record<string, string> = { ExamPilot: "var(--brand)", Random: "var(--bad)", "Greedy first-fit": "var(--warn)" };

const METRICS: { key: keyof Row; title: string; hint: string }[] = [
  { key: "clashes", title: "Student clashes", hint: "Students with two exams in one session. Zero is required." },
  { key: "mean_gap_days", title: "Mean gap between exams (days)", hint: "Higher is kinder to students." },
  { key: "seating_risk_index", title: "Seating risk index", hint: "100 equals random seating. Lower is better." },
  { key: "adjacent_pairs", title: "Same-course neighbours", hint: "Pairs of classmates sitting next to each other." },
];

const TABLE: { key: keyof Row; label: string; best: "min" | "max" | null }[] = [
  { key: "clashes", label: "Clashes", best: "min" },
  { key: "mean_gap_days", label: "Mean gap", best: "max" },
  { key: "seating_risk_index", label: "Risk", best: "min" },
  { key: "adjacent_pairs", label: "Neighbours", best: "min" },
  { key: "runtime_s", label: "Runtime", best: null },
];

export default function BenchmarkPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ["benchmark"], queryFn: () => api<{ rows: Row[] }>("/benchmark/run") });
  if (isLoading) return <LoadingBlock rows={5} />;
  if (error || !data) return <ErrorState error={error} />;
  const isBest = (column: (typeof TABLE)[number], row: Row) => {
    if (!column.best) return false;
    const values = data.rows.map((r) => Number(r[column.key]));
    return Number(row[column.key]) === (column.best === "min" ? Math.min(...values) : Math.max(...values));
  };
  return (
    <div>
      <PageHeader eyebrow="Insights" title="Benchmark" description="ExamPilot against a random timetable and a greedy first-fit baseline, on the same students, rooms and rules." />
      <div className="rise-1 mb-5 flex flex-wrap gap-4">
        {data.rows.map((row) => (
          <span key={row.name} className="flex items-center gap-2 text-[13px] font-medium">
            <span className="size-3 rounded-sm" style={{ background: COLORS[row.name] ?? "var(--chart-5)" }} />
            {row.name}
          </span>
        ))}
      </div>
      <div className="rise-1 grid gap-5 md:grid-cols-2">
        {METRICS.map((metric) => (
          <section key={metric.key} className="surface p-5">
            <SectionTitle title={metric.title} hint={metric.hint} />
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.rows} margin={{ top: 6, right: 4, bottom: 0, left: -12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: "var(--muted)" }} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 }} />
                  <Bar dataKey={metric.key} radius={[8, 8, 0, 0]} maxBarSize={64}>
                    {data.rows.map((row) => (
                      <Cell key={row.name} fill={COLORS[row.name] ?? "var(--chart-5)"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        ))}
      </div>
      <section className="surface rise-2 mt-5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Method</th>
                {TABLE.map((c) => (
                  <th key={c.key} className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.name} className="border-b last:border-0">
                  <td className="px-4 py-3.5 font-semibold">
                    <span className="mr-2.5 inline-block size-2.5 rounded-sm align-middle" style={{ background: COLORS[r.name] ?? "var(--chart-5)" }} />
                    {r.name} {r.name === "ExamPilot" && <Pill tone="brand">ours</Pill>}
                  </td>
                  {TABLE.map((c) => (
                    <td key={c.key} className="px-4 py-3.5 text-right tabular-nums">
                      <span className={cn("rounded-md px-1.5 py-0.5", isBest(c, r) && "bg-good/12 font-semibold text-good-text")}>
                        {String(r[c.key])}
                        {c.key === "runtime_s" ? "s" : ""}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t px-4 py-3 text-xs text-muted-foreground">ExamPilot&apos;s runtime is the optimiser solving four coupled problems; the baselines ignore most of them, which is why they are fast and poor.</p>
      </section>
    </div>
  );
}
