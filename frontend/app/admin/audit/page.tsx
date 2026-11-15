"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronRight, Download, Link2, Search, ShieldCheck, ShieldX } from "lucide-react";
import { useState } from "react";
import { EmptyState, LoadingBlock, NativeSelect, PageHeader } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { api, download } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Row {
  id: number;
  ts: string;
  actor_id: number | null;
  role: string;
  action: string;
  entity: string;
  payload: Record<string, unknown>;
  reasoning: string;
  hash: string;
}

interface Seal {
  valid: boolean;
  checked: number;
  broken_at: number | null;
  reason: string;
}

const GROUPS = ["", "agent", "plan", "solver", "auth", "disruption", "swap", "export", "scenario"];

const DOT: Record<string, string> = { agent: "bg-brand", plan: "bg-good", solver: "bg-chart-3", auth: "bg-muted-foreground", disruption: "bg-bad", swap: "bg-warn", export: "bg-chart-2", scenario: "bg-chart-4" };

const field = "h-9 rounded-lg border border-input bg-card px-3 text-sm shadow-xs outline-none transition focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30";

export default function AuditPage() {
  const [action, setAction] = useState("");
  const [entity, setEntity] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const rows = useQuery({ queryKey: ["audit", action, entity, q], queryFn: () => api<Row[]>("/audit", { params: { action, entity, q, limit: 150 } }), refetchInterval: 20000 });
  const verify = useMutation({ mutationFn: () => api<Seal>("/audit/verify", {}) });

  return (
    <div>
      <PageHeader
        eyebrow="Govern"
        title="Audit trail"
        description="Every agent step, tool call, solver run, approval and export. Each row is hashed together with the one before it, so any edit breaks the chain."
        actions={
          <>
            <Button variant="outline" onClick={() => download("/audit/export", "audit.json", { format: "json" })}>
              <Download /> JSON
            </Button>
            <Button variant="outline" onClick={() => download("/audit/export", "audit.csv", { format: "csv" })}>
              <Download /> CSV
            </Button>
            <Button variant="brand" onClick={() => verify.mutate()} disabled={verify.isPending}>
              <ShieldCheck /> {verify.isPending ? "Verifying…" : "Verify chain"}
            </Button>
          </>
        }
      />
      {verify.data && (
        <div className={cn("rise mb-5 flex items-center gap-4 rounded-2xl border px-5 py-4", verify.data.valid ? "border-good/45 bg-good/8" : "border-bad/55 bg-bad/8")}>
          <span className={cn("flex size-12 shrink-0 items-center justify-center rounded-2xl text-white", verify.data.valid ? "bg-good" : "bg-bad")}>{verify.data.valid ? <ShieldCheck className="size-6" /> : <ShieldX className="size-6" />}</span>
          <div>
            <div className="text-[15px] font-semibold">{verify.data.valid ? `Seal intact: ${verify.data.checked} entries verified` : `Chain broken at entry #${verify.data.broken_at}`}</div>
            <div className="mt-0.5 text-[13px] text-muted-foreground">{verify.data.valid ? "Every hash links to the one before it. Nothing has been edited or removed." : verify.data.reason}</div>
          </div>
        </div>
      )}
      <div className="surface rise-1 mb-4 flex flex-wrap items-center gap-2.5 p-3.5">
        <NativeSelect aria-label="Action group" value={action} onChange={(e) => setAction(e.target.value)}>
          {GROUPS.map((g) => (
            <option key={g} value={g}>
              {g ? `${g}.*` : "All actions"}
            </option>
          ))}
        </NativeSelect>
        <input placeholder="Entity (plan:3)" aria-label="Entity" value={entity} onChange={(e) => setEntity(e.target.value)} className={cn(field, "w-40")} />
        <div className="relative min-w-52 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input placeholder="Search reasoning" aria-label="Search reasoning" value={q} onChange={(e) => setQ(e.target.value)} className={cn(field, "w-full pl-9")} />
        </div>
        {rows.data && <span className="ml-auto text-xs tabular-nums text-muted-foreground">{rows.data.length} entries shown</span>}
      </div>
      {rows.isLoading ? (
        <LoadingBlock rows={6} />
      ) : !rows.data?.length ? (
        <EmptyState title="No entries match" hint="Try clearing a filter." />
      ) : (
        <div className="surface rise-2 divide-y overflow-hidden">
          {rows.data.map((row) => {
            const group = row.action.split(".")[0];
            return (
              <div key={row.id}>
                <button className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-muted/50" onClick={() => setOpen(open === row.id ? null : row.id)} aria-expanded={open === row.id}>
                  <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open === row.id && "rotate-90")} />
                  <span className={cn("size-2 shrink-0 rounded-full", DOT[group] ?? "bg-muted-foreground")} />
                  <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">#{row.id}</span>
                  <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 font-mono text-[11.5px] font-medium">{row.action}</span>
                  <span className="hidden shrink-0 text-xs capitalize text-muted-foreground sm:inline">
                    {row.role}
                    {row.actor_id ? ` #${row.actor_id}` : ""}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px]">{row.entity}</span>
                  <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">{new Date(row.ts).toLocaleTimeString()}</span>
                </button>
                {open === row.id && (
                  <div className="space-y-3 border-t bg-muted/30 px-4 py-4 text-xs">
                    {row.reasoning && (
                      <p className="text-[13px] leading-relaxed">
                        <span className="font-semibold">Reasoning:</span> {row.reasoning}
                      </p>
                    )}
                    <pre className="max-h-64 overflow-auto rounded-xl bg-card p-3 font-mono text-[11px] ring-1 ring-border">{JSON.stringify(row.payload, null, 2)}</pre>
                    <p className="flex items-center gap-1.5 break-all font-mono text-[10.5px] text-muted-foreground">
                      <Link2 className="size-3 shrink-0" /> {row.hash}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
