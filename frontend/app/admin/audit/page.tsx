"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Download, ShieldCheck, ShieldX } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState, LoadingBlock, PageHeader } from "@/components/ui-kit";
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
        title="Audit trail"
        description="Every agent step, tool call, solver run, approval and export. Each row is hashed together with the one before it, so any edit breaks the chain."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => download("/audit/export", "audit.json", { format: "json" })}><Download /> JSON</Button>
            <Button variant="outline" size="sm" onClick={() => download("/audit/export", "audit.csv", { format: "csv" })}><Download /> CSV</Button>
            <Button size="sm" onClick={() => verify.mutate()} disabled={verify.isPending}><ShieldCheck /> Verify chain</Button>
          </>
        }
      />
      {verify.data && (
        <Card className={cn("mb-4", verify.data.valid ? "border-emerald-500/50 bg-emerald-500/5" : "border-red-500/60 bg-red-500/5")}>
          <CardContent className="flex items-center gap-3 text-sm">
            {verify.data.valid ? <ShieldCheck className="size-8 text-emerald-500" /> : <ShieldX className="size-8 text-red-500" />}
            <div>
              <div className="font-semibold">{verify.data.valid ? `Seal intact — ${verify.data.checked} entries verified` : `Chain broken at entry #${verify.data.broken_at}`}</div>
              {!verify.data.valid && <div className="text-muted-foreground">{verify.data.reason}</div>}
            </div>
          </CardContent>
        </Card>
      )}
      <div className="mb-3 flex flex-wrap gap-2">
        <select className="h-8 rounded-lg border bg-background px-2 text-sm" value={action} onChange={(e) => setAction(e.target.value)}>
          {GROUPS.map((g) => <option key={g} value={g}>{g ? `${g}.*` : "All actions"}</option>)}
        </select>
        <Input placeholder="Entity (plan:3)" value={entity} onChange={(e) => setEntity(e.target.value)} className="max-w-40" />
        <Input placeholder="Search reasoning" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-56" />
      </div>
      {rows.isLoading ? <LoadingBlock rows={6} /> : !rows.data?.length ? <EmptyState title="No entries match" /> : (
        <div className="space-y-1">
          {rows.data.map((row) => (
            <div key={row.id} className="rounded-lg border text-sm">
              <button className="flex w-full items-center gap-2 px-3 py-1.5 text-left" onClick={() => setOpen(open === row.id ? null : row.id)}>
                {open === row.id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                <span className="w-10 text-xs text-muted-foreground">#{row.id}</span>
                <Badge variant="outline">{row.action}</Badge>
                <span className="text-xs text-muted-foreground">{row.role}{row.actor_id ? ` #${row.actor_id}` : ""}</span>
                <span className="truncate text-xs">{row.entity}</span>
                <span className="ml-auto whitespace-nowrap text-xs text-muted-foreground">{new Date(row.ts).toLocaleTimeString()}</span>
              </button>
              {open === row.id && (
                <div className="space-y-2 border-t bg-muted/30 p-3 text-xs">
                  {row.reasoning && <p><b>Reasoning:</b> {row.reasoning}</p>}
                  <pre className="max-h-64 overflow-auto rounded bg-background p-2">{JSON.stringify(row.payload, null, 2)}</pre>
                  <p className="font-mono text-[10px] text-muted-foreground">hash {row.hash}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
