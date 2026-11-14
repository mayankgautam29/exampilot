"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { EmptyState, LoadingBlock, PageHeader } from "@/components/ui-kit";
import { api } from "@/lib/api";
import { usePublished } from "@/lib/hooks";
import { cn } from "@/lib/utils";

interface RosterRow {
  faculty_id: string;
  name: string;
  dept: string;
  rank: number;
  total: number;
  max: number;
  duties: { slot_id: string; room_id: string | null; role: string }[];
}

interface Roster {
  faculty: RosterRow[];
  slots: { id: string; label: string }[];
  relievers: Record<string, string[]>;
  gini: number;
  min: number;
  max: number;
}

interface Swap {
  id: number;
  faculty_id: string;
  slot_id: string;
  reason: string;
  status: string;
  precheck: { feasible: boolean; message: string; replacement: { to: string } | null };
}

export default function InvigilationPage() {
  const { published } = usePublished();
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [dept, setDept] = useState("all");
  const [why, setWhy] = useState<{ faculty: string; slot: string } | null>(null);
  const planId = published?.id;
  const roster = useQuery({ queryKey: ["roster", planId], queryFn: () => api<Roster>(`/plans/${planId}/roster`), enabled: !!planId });
  const swaps = useQuery({ queryKey: ["swaps"], queryFn: () => api<Swap[]>("/swaps") });
  const explanation = useQuery({ queryKey: ["why-duty", planId, why], queryFn: () => api<{ text: string; facts: string[] }>(`/plans/${planId}/explain/duty`, { params: { faculty: why!.faculty, slot: why!.slot } }), enabled: !!why && !!planId });
  const decide = useMutation({
    mutationFn: ({ id, action }: { id: number; action: "approve" | "reject" }) => api(`/swaps/${id}/${action}`, { method: "POST" }),
    onSuccess: (_, vars) => {
      toast.success(vars.action === "approve" ? "Swap approved: a hotfix plan is waiting in Approvals" : "Swap rejected");
      client.invalidateQueries({ queryKey: ["swaps"] });
    },
    onError: (error) => toast.error(error.message),
  });
  const depts = useMemo(() => Array.from(new Set(roster.data?.faculty.map((f) => f.dept) ?? [])), [roster.data]);
  const rows = roster.data?.faculty.filter((f) => (dept === "all" || f.dept === dept) && (f.name + f.faculty_id).toLowerCase().includes(search.toLowerCase())) ?? [];

  if (roster.isLoading) return <LoadingBlock rows={6} />;
  if (!roster.data) return <EmptyState title="No roster available" />;
  const pendingSwaps = swaps.data?.filter((s) => s.status === "PENDING") ?? [];

  return (
    <div>
      <PageHeader title="Invigilation" description="Who watches which room. Chiefs are marked with a star, relievers are held back per session. Click a cell to see why that person was chosen." actions={<Badge variant="outline">Gini {roster.data.gini} · duties {roster.data.min}–{roster.data.max}</Badge>} />
      <div className="mb-3 flex flex-wrap gap-2">
        <Input placeholder="Search faculty" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-56" />
        <select className="h-8 rounded-lg border bg-background px-2 text-sm" value={dept} onChange={(e) => setDept(e.target.value)}>
          <option value="all">All departments</option>
          {depts.map((d) => <option key={d}>{d}</option>)}
        </select>
      </div>
      <div className="overflow-auto rounded-lg border">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 bg-muted">
            <tr>
              <th className="sticky left-0 z-10 bg-muted p-2 text-left">Faculty</th>
              <th className="p-2 text-left">Load</th>
              {roster.data.slots.map((s) => (
                <th key={s.id} className="whitespace-nowrap p-1 font-normal text-muted-foreground">{s.label.replace(" ", " ")}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.faculty_id} className="border-t">
                <td className="sticky left-0 z-10 whitespace-nowrap bg-background p-2">
                  <div className="font-medium">{f.name}</div>
                  <div className="text-muted-foreground">{f.faculty_id} · {f.dept} · rank {f.rank}</div>
                </td>
                <td className="p-2">
                  <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"><div className="h-full bg-emerald-500" style={{ width: `${(100 * f.total) / f.max}%` }} /></div>
                  <div className="mt-0.5 text-muted-foreground">{f.total}/{f.max}</div>
                </td>
                {roster.data.slots.map((s) => {
                  const duty = f.duties.find((d) => d.slot_id === s.id);
                  return (
                    <td key={s.id} className="p-0.5 text-center">
                      {duty ? (
                        <button onClick={() => setWhy({ faculty: f.faculty_id, slot: s.id })} className={cn("w-full rounded px-1 py-1", duty.room_id ? "bg-sky-500/15 hover:bg-sky-500/30" : "bg-amber-500/15 hover:bg-amber-500/30")}>
                          {duty.room_id ?? "R"}{duty.role === "chief" && <Star className="ml-0.5 inline size-2.5 fill-amber-500 text-amber-500" />}
                        </button>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">R = reliever pool (held back to replace anyone who falls ill). Each session keeps {Object.values(roster.data.relievers)[0]?.length ?? 2} relievers.</p>
      <Card className="mt-4">
        <CardHeader><CardTitle>Swap requests ({pendingSwaps.length} pending)</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {!swaps.data?.length && <p className="text-sm text-muted-foreground">Faculty can request a swap from their own page. Each request is pre-checked by the validator.</p>}
          {swaps.data?.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2 text-sm">
              <span className="font-medium">{s.faculty_id}</span> wants out of <span>{s.slot_id}</span>
              <Badge variant="outline">{s.status}</Badge>
              <span className="text-muted-foreground">{s.precheck.message}{s.precheck.replacement ? ` (${s.precheck.replacement.to})` : ""}</span>
              {s.reason && <span className="italic text-muted-foreground">“{s.reason}”</span>}
              {s.status === "PENDING" && (
                <span className="ml-auto flex gap-2">
                  <Button size="xs" onClick={() => decide.mutate({ id: s.id, action: "approve" })}>Approve</Button>
                  <Button size="xs" variant="outline" onClick={() => decide.mutate({ id: s.id, action: "reject" })}>Reject</Button>
                </span>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
      <Sheet open={!!why} onOpenChange={(open) => !open && setWhy(null)}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Why this person?</SheetTitle>
            <SheetDescription>{why?.faculty} · {why?.slot}</SheetDescription>
          </SheetHeader>
          <div className="space-y-2 px-4 text-sm">
            {explanation.isLoading && <LoadingBlock rows={3} />}
            {explanation.data && <p className="rounded-lg bg-muted p-3">{explanation.data.text}</p>}
            {explanation.data?.facts.map((f, i) => <p key={i} className="text-muted-foreground">{f}</p>)}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
