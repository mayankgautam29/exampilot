"use client";

import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState, LoadingBlock, PageHeader } from "@/components/ui-kit";
import { api } from "@/lib/api";

interface Row {
  name: string;
  clashes: number;
  mean_gap_days: number;
  seating_risk_index: number;
  adjacent_pairs: number;
  runtime_s: number;
}

const COLORS: Record<string, string> = { ExamPilot: "#10b981", Random: "#ef4444", "Greedy first-fit": "#f59e0b" };

const METRICS: { key: keyof Row; title: string; hint: string }[] = [
  { key: "clashes", title: "Student clashes", hint: "Students with two exams in one session. Zero is required." },
  { key: "mean_gap_days", title: "Mean gap between a student's exams (days)", hint: "Higher is kinder to students." },
  { key: "seating_risk_index", title: "Seating risk index", hint: "100 equals random seating. Lower is better." },
  { key: "adjacent_pairs", title: "Same-course neighbours", hint: "Pairs of classmates sitting next to each other." },
];

export default function BenchmarkPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ["benchmark"], queryFn: () => api<{ rows: Row[] }>("/benchmark/run") });
  if (isLoading) return <LoadingBlock rows={5} />;
  if (error || !data) return <ErrorState error={error} />;
  return (
    <div>
      <PageHeader title="Benchmark" description="ExamPilot against a random timetable and a greedy first-fit baseline, on the same students, rooms and rules." />
      <div className="grid gap-4 md:grid-cols-2">
        {METRICS.map((metric) => (
          <Card key={metric.key}>
            <CardHeader><CardTitle>{metric.title}</CardTitle><CardDescription>{metric.hint}</CardDescription></CardHeader>
            <CardContent className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.rows}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey={metric.key} radius={[4, 4, 0, 0]}>
                    {data.rows.map((row) => <Cell key={row.name} fill={COLORS[row.name] ?? "#64748b"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="mt-4">
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="p-2">Method</th><th>Clashes</th><th>Mean gap</th><th>Risk</th><th>Neighbours</th><th>Runtime</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.name} className="border-t"><td className="p-2 font-medium">{r.name}</td><td>{r.clashes}</td><td>{r.mean_gap_days}</td><td>{r.seating_risk_index}</td><td>{r.adjacent_pairs}</td><td>{r.runtime_s}s</td></tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">ExamPilot's runtime is the optimiser solving four coupled problems; the baselines ignore most of them, which is why they are fast and poor.</p>
        </CardContent>
      </Card>
    </div>
  );
}
