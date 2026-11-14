"use client";

import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Legend, Tooltip } from "recharts";
import { colorFor } from "@/lib/format";

const LABELS: Record<string, string> = { spread: "Exam spread", utilisation: "Utilisation", fairness: "Fairness", seating: "Seating", stability: "Stability" };

export function HealthRadar({ components }: { components: Record<string, number> }) {
  const data = Object.entries(components).map(([key, value]) => ({ axis: LABELS[key] ?? key, value }));
  return (
    <ResponsiveContainer width="100%" height={230}>
      <RadarChart data={data} outerRadius="72%">
        <PolarGrid />
        <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11 }} />
        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
        <Radar dataKey="value" stroke="#10b981" fill="#10b981" fillOpacity={0.3} />
        <Tooltip />
      </RadarChart>
    </ResponsiveContainer>
  );
}

export interface RadarSeries {
  name: string;
  values: Record<string, number>;
}

export function ComparisonRadar({ series }: { series: RadarSeries[] }) {
  const axes = ["courses", "students", "seating", "fairness", "rooms", "health"];
  const data = axes.map((axis) => ({ axis, ...Object.fromEntries(series.map((s) => [s.name, s.values[axis] ?? 0])) }));
  return (
    <ResponsiveContainer width="100%" height={300}>
      <RadarChart data={data} outerRadius="70%">
        <PolarGrid />
        <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11 }} />
        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
        {series.map((s) => (
          <Radar key={s.name} name={s.name} dataKey={s.name} stroke={colorFor(s.name)} fill={colorFor(s.name)} fillOpacity={0.15} />
        ))}
        <Legend />
        <Tooltip />
      </RadarChart>
    </ResponsiveContainer>
  );
}
