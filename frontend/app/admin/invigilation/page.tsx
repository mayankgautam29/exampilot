"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Star } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { EmptyState, LoadingBlock, NativeSelect, PageHeader, Pill, SectionTitle, StatTile } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
  const relieverCount = Object.values(roster.data.relievers)[0]?.length ?? 2;

  return (
    <div>
      <PageHeader eyebrow="Plan" title="Invigilation" description="Who watches which room. Chiefs are marked with a star, relievers are held back per session. Click a cell to see why that person was chosen." />
      <div className="rise-1 mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Faculty" value={roster.data.faculty.length} hint="on the roster" />
        <StatTile label="Duties each" value={`${roster.data.min}–${roster.data.max}`} tone="good" hint="spread between most and least" />
        <StatTile label="Fairness Gini" value={roster.data.gini} tone={roster.data.gini <= 0.1 ? "good" : "warn"} hint="0 means perfectly even" />
        <StatTile label="Relievers" value={relieverCount} hint="held back every session" />
      </div>

      <div className="surface rise-2 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2.5 border-b p-3.5">
          <div className="relative min-w-56 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input placeholder="Search faculty" aria-label="Search faculty" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-sm shadow-xs outline-none transition focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30" />
          </div>
          <NativeSelect aria-label="Department" value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="all">All departments</option>
            {depts.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </NativeSelect>
          <div className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-info/40" /> Room</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-warn/50" /> Reliever (R)</span>
            <span className="flex items-center gap-1"><Star className="size-3 fill-warn text-warn" /> Chief</span>
          </div>
        </div>
        <div className="max-h-[560px] overflow-auto">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 z-20 bg-muted/90 backdrop-blur">
              <tr>
                <th className="sticky left-0 z-30 bg-muted px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Faculty</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Load</th>
                {roster.data.slots.map((s) => (
                  <th key={s.id} className="whitespace-nowrap px-1 py-2.5 text-[10.5px] font-medium text-muted-foreground">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.faculty_id} className="border-t transition-colors hover:bg-muted/40">
                  <td className="sticky left-0 z-10 whitespace-nowrap border-r bg-card px-3 py-2">
                    <div className="text-[13px] font-semibold">{f.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {f.faculty_id} · {f.dept} · rank {f.rank}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-brand" style={{ width: `${(100 * f.total) / f.max}%` }} />
                    </div>
                    <div className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                      {f.total}/{f.max}
                    </div>
                  </td>
                  {roster.data.slots.map((s) => {
                    const duty = f.duties.find((d) => d.slot_id === s.id);
                    return (
                      <td key={s.id} className="p-0.5 text-center">
                        {duty ? (
                          <button onClick={() => setWhy({ faculty: f.faculty_id, slot: s.id })} className={cn("w-full min-w-9 rounded-md px-1.5 py-1.5 text-[11px] font-semibold transition", duty.room_id ? "bg-info/15 text-info hover:bg-info/30" : "bg-warn/20 text-warn-text hover:bg-warn/35")}>
                            {duty.room_id ?? "R"}
                            {duty.role === "chief" && <Star className="ml-0.5 inline size-2.5 fill-warn text-warn" />}
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
      </div>
      <p className="mt-2.5 text-xs text-muted-foreground">R = reliever pool, held back to replace anyone who falls ill. Each session keeps {relieverCount} relievers.</p>

      <section className="surface rise-3 mt-6 p-5">
        <SectionTitle title="Swap requests" hint="Faculty can request a swap from their own page. Each request is pre-checked by the validator." action={<Pill tone={pendingSwaps.length ? "warn" : "neutral"}>{pendingSwaps.length} pending</Pill>} />
        {!swaps.data?.length && <EmptyState compact title="No swap requests" hint="Requests from faculty appear here." />}
        <div className="space-y-2">
          {swaps.data?.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-2.5 rounded-xl border p-3 text-[13px]">
              <span className="font-semibold">{s.faculty_id}</span> wants out of <span className="font-mono text-xs">{s.slot_id}</span>
              <Pill tone={s.status === "PENDING" ? "warn" : s.status === "APPROVED" ? "good" : "neutral"} dot>
                {s.status.toLowerCase()}
              </Pill>
              <span className="text-muted-foreground">
                {s.precheck.message}
                {s.precheck.replacement ? ` (${s.precheck.replacement.to})` : ""}
              </span>
              {s.reason && <span className="text-muted-foreground">“{s.reason}”</span>}
              {s.status === "PENDING" && (
                <span className="ml-auto flex gap-2">
                  <Button size="sm" variant="brand" onClick={() => decide.mutate({ id: s.id, action: "approve" })}>
                    Approve
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => decide.mutate({ id: s.id, action: "reject" })}>
                    Reject
                  </Button>
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      <Sheet open={!!why} onOpenChange={(open) => !open && setWhy(null)}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Why this person?</SheetTitle>
            <SheetDescription>
              {why?.faculty} · {why?.slot}
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-2 px-4 text-sm">
            {explanation.isLoading && <LoadingBlock rows={3} />}
            {explanation.data && <p className="rounded-xl bg-brand-soft p-3.5 leading-relaxed">{explanation.data.text}</p>}
            {explanation.data?.facts.map((f, i) => (
              <p key={i} className="text-muted-foreground">
                {f}
              </p>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
