"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Rocket, ShieldX, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { HealthRadar } from "@/components/charts";
import { DiffPanel } from "@/components/diff-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Check, EmptyState, LoadingBlock, PageHeader, StatusBadge } from "@/components/ui-kit";
import { api } from "@/lib/api";
import { useCatalogue } from "@/lib/hooks";
import type { Diff, Health, PlanSummary, Violation } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Item extends PlanSummary {
  diff: Diff | null;
  hard: Violation[];
  health: Health;
  checklist: { zero_hard_violations: boolean; relaxed_rules_acknowledged: boolean; diff_reviewed: boolean };
}

interface Briefing {
  text: string;
  verified: boolean;
}

export default function ApprovalsPage() {
  const client = useQueryClient();
  const catalogue = useCatalogue();
  const inbox = useQuery({ queryKey: ["approvals"], queryFn: () => api<Item[]>("/approvals"), refetchInterval: 15000 });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [ticks, setTicks] = useState({ diff: false, notify: false });
  const [published, setPublished] = useState<{ sent: number; version: number } | null>(null);
  const item = inbox.data?.find((i) => i.id === selectedId) ?? inbox.data?.[0];
  const briefing = useMutation({ mutationFn: (id: number) => api<Briefing>(`/plans/${id}/briefing`) });

  const refresh = () => {
    client.invalidateQueries({ queryKey: ["approvals"] });
    client.invalidateQueries({ queryKey: ["plans"] });
  };
  const act = useMutation({
    mutationFn: ({ kind, plan }: { kind: "approve" | "reject" | "publish"; plan: Item }) =>
      api<PlanSummary & { notifications_sent?: number }>(`/plans/${plan.id}/${kind}`, { method: "POST", headers: { "If-Match": String(plan.row_version) }, body: kind === "reject" ? { reason } : undefined }),
    onSuccess: (result, vars) => {
      if (vars.kind === "publish") setPublished({ sent: result.notifications_sent ?? 0, version: result.version });
      else toast.success(vars.kind === "approve" ? "Approved" : "Rejected with reason recorded");
      setRejecting(false);
      setPublishing(false);
      setReason("");
      refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  if (inbox.isLoading) return <LoadingBlock rows={5} />;
  return (
    <div>
      <PageHeader title="Approvals" description="Every change to a published plan needs a human decision. Review the diff, the validator report and the briefing, then approve, reject with a reason, or publish." />
      {published && (
        <Card className="mb-4 border-emerald-500/40 bg-emerald-500/5">
          <CardContent className="flex flex-wrap items-center gap-3 text-sm">
            <CheckCircle2 className="size-5 text-emerald-500" />
            <span>Version {published.version} is published. {published.sent} notifications were queued for affected students and faculty.</span>
            <Link href="/admin/outbox" className="underline">Open the outbox</Link>
          </CardContent>
        </Card>
      )}
      {!inbox.data?.length ? (
        <EmptyState title="Inbox is empty" hint="Plans appear here once they are submitted for approval." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <div className="space-y-2">
            {inbox.data.map((i) => (
              <button key={i.id} onClick={() => { setSelectedId(i.id); briefing.reset(); }} className={cn("w-full rounded-xl border p-3 text-left text-sm hover:bg-muted", item?.id === i.id && "border-primary bg-muted")}>
                <div className="flex items-center justify-between">
                  <span className="font-medium">v{i.version} · {i.kind}</span>
                  <StatusBadge status={i.status} />
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">{i.label}</div>
                <div className="mt-1 flex gap-1.5 text-xs">
                  <Badge variant="secondary">health {i.health?.score}</Badge>
                  {i.hard_violations > 0 && <Badge className="border-0 bg-red-500/15 text-red-700">{i.hard_violations} hard</Badge>}
                </div>
              </button>
            ))}
          </div>
          {item && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    Plan v{item.version} <StatusBadge status={item.status} /> <Badge variant="outline">{item.origin}</Badge>
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">{item.label}</p>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Check ok={item.checklist.zero_hard_violations} label={item.checklist.zero_hard_violations ? "Validator found 0 hard violations" : `${item.hard_violations} hard violations block publication`} />
                  <Check ok={item.checklist.relaxed_rules_acknowledged} label={item.checklist.relaxed_rules_acknowledged ? "No exam rule was relaxed" : "A rule was relaxed (R-2.3) and needs explicit acknowledgement"} />
                  {item.hard.map((v) => <p key={v.message} className="pl-6 text-xs text-red-600">{v.code}: {v.message}</p>)}
                  <div className="flex flex-wrap gap-2 border-t pt-3">
                    {item.status === "PENDING_APPROVAL" && <Button onClick={() => act.mutate({ kind: "approve", plan: item })}><CheckCircle2 /> Approve</Button>}
                    {(item.status === "PENDING_APPROVAL" || item.status === "APPROVED") && <Button variant="outline" onClick={() => setRejecting(true)}><ShieldX /> Reject</Button>}
                    {item.status === "APPROVED" && <Button variant="secondary" onClick={() => { setTicks({ diff: false, notify: false }); setPublishing(true); }}><Rocket /> Publish…</Button>}
                    <Button variant="ghost" onClick={() => briefing.mutate(item.id)} disabled={briefing.isPending}><Sparkles /> Briefing</Button>
                  </div>
                  {briefing.data && (
                    <div className="rounded-lg bg-muted p-3 text-sm">
                      {briefing.data.text}
                      <div className="mt-2"><Badge className={cn("border-0", briefing.data.verified ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-red-500/15 text-red-700")}>{briefing.data.verified ? "✓ numbers verified against solver output" : "numbers not verified"}</Badge></div>
                    </div>
                  )}
                </CardContent>
              </Card>
              <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
                <Card>
                  <CardHeader><CardTitle>Changes compared with the published plan</CardTitle></CardHeader>
                  <CardContent>{item.diff ? <DiffPanel diff={item.diff} slots={catalogue.data?.slots} /> : <p className="text-sm text-muted-foreground">No published plan to compare with.</p>}</CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle>Health {item.health?.score}</CardTitle></CardHeader>
                  <CardContent>{item.health && <HealthRadar components={item.health.components} />}</CardContent>
                </Card>
              </div>
            </div>
          )}
        </div>
      )}
      <Dialog open={rejecting} onOpenChange={setRejecting}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject plan</DialogTitle><DialogDescription>A reason is required and is recorded in the audit log.</DialogDescription></DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this plan being rejected?" rows={3} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRejecting(false)}>Cancel</Button>
            <Button variant="destructive" disabled={!reason.trim() || act.isPending} onClick={() => item && act.mutate({ kind: "reject", plan: item })}>Reject</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={publishing} onOpenChange={setPublishing}>
        <DialogContent>
          <DialogHeader><DialogTitle>Publish checklist</DialogTitle><DialogDescription>Publishing replaces the current plan and notifies everyone affected. The server re-runs the validator and refuses if any hard rule is broken.</DialogDescription></DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2"><Checkbox checked={item?.checklist.zero_hard_violations ?? false} disabled /><Label>Zero hard violations (checked by the validator)</Label></div>
            <div className="flex items-center gap-2"><Checkbox checked={ticks.diff} onCheckedChange={(v) => setTicks((t) => ({ ...t, diff: v === true }))} /><Label>I reviewed the changes and the affected students</Label></div>
            <div className="flex items-center gap-2"><Checkbox checked={ticks.notify} onCheckedChange={(v) => setTicks((t) => ({ ...t, notify: v === true }))} /><Label>I understand students and faculty will be notified{item?.checklist.relaxed_rules_acknowledged ? "" : " and a rule was relaxed"}</Label></div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPublishing(false)}>Cancel</Button>
            <Button disabled={!ticks.diff || !ticks.notify || act.isPending} onClick={() => item && act.mutate({ kind: "publish", plan: item })}><Rocket /> Publish now</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
