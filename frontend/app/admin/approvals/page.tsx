"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Rocket, ShieldCheck, ShieldX, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { HealthRadar } from "@/components/charts";
import { DiffPanel } from "@/components/diff-panel";
import { Check, EmptyState, LoadingBlock, PageHeader, Pill, SectionTitle, StatusBadge } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
      <PageHeader eyebrow="Govern" title="Approvals" description="Every change to a published plan needs a human decision. Review the diff, the validator report and the briefing, then approve, reject with a reason, or publish." />
      {published && (
        <div className="rise mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-good/40 bg-good/8 px-5 py-4 text-sm">
          <CheckCircle2 className="size-5 text-good" />
          <span className="font-medium">
            Version {published.version} is published. {published.sent} notifications were queued for affected students and faculty.
          </span>
          <Link href="/admin/outbox" className="ml-auto font-semibold text-brand underline-offset-4 hover:underline">
            Open the outbox
          </Link>
        </div>
      )}
      {!inbox.data?.length ? (
        <EmptyState title="Inbox is empty" hint="Plans appear here once they are submitted for approval." />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="rise-1 space-y-2.5">
            <div className="eyebrow px-1">Waiting for a decision · {inbox.data.length}</div>
            {inbox.data.map((i) => (
              <button
                key={i.id}
                onClick={() => {
                  setSelectedId(i.id);
                  briefing.reset();
                }}
                className={cn("w-full rounded-2xl border bg-card p-4 text-left shadow-xs transition hover:border-brand/50 hover:shadow-card", item?.id === i.id && "border-brand ring-2 ring-brand/25")}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">
                    v{i.version} · {i.kind}
                  </span>
                  <StatusBadge status={i.status} />
                </div>
                <div className="mt-1.5 truncate text-xs text-muted-foreground">{i.label}</div>
                <div className="mt-2.5 flex gap-1.5">
                  <Pill tone="info">Health {i.health?.score}</Pill>
                  {i.hard_violations > 0 && <Pill tone="bad">{i.hard_violations} hard</Pill>}
                </div>
              </button>
            ))}
          </aside>

          {item && (
            <div className="min-w-0 space-y-5">
              <section className="surface rise-2 p-5 md:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-[26px] leading-none">Plan v{item.version}</h2>
                      <StatusBadge status={item.status} />
                      <Pill tone="neutral">{item.origin}</Pill>
                    </div>
                    <p className="mt-2 text-[13.5px] text-muted-foreground">{item.label}</p>
                  </div>
                  <Button variant="ghost" onClick={() => briefing.mutate(item.id)} disabled={briefing.isPending}>
                    <Sparkles /> {briefing.isPending ? "Writing…" : "Briefing"}
                  </Button>
                </div>

                <div className="mt-5 rounded-xl border bg-muted/40 p-4">
                  <div className="eyebrow mb-3 flex items-center gap-1.5">
                    <ShieldCheck className="size-3.5" /> Publish gates
                  </div>
                  <div className="space-y-2.5">
                    <Check ok={item.checklist.zero_hard_violations} label={item.checklist.zero_hard_violations ? "Validator found 0 hard violations" : `${item.hard_violations} hard violations block publication`} />
                    <Check ok={item.checklist.relaxed_rules_acknowledged} label={item.checklist.relaxed_rules_acknowledged ? "No exam rule was relaxed" : "A rule was relaxed (R-2.3) and needs explicit acknowledgement"} />
                    {item.hard.map((v) => (
                      <p key={v.message} className="pl-6 text-xs text-bad">
                        {v.code}: {v.message}
                      </p>
                    ))}
                  </div>
                </div>

                {briefing.data && (
                  <div className="mt-4 rounded-xl border bg-brand-soft/60 p-4 text-[13.5px] leading-relaxed">
                    {briefing.data.text}
                    <div className="mt-3">
                      <Pill tone={briefing.data.verified ? "good" : "bad"} dot>
                        {briefing.data.verified ? "Numbers verified against solver output" : "Numbers not verified"}
                      </Pill>
                    </div>
                  </div>
                )}

                <div className="mt-5 flex flex-wrap gap-2.5 border-t pt-5">
                  {item.status === "PENDING_APPROVAL" && (
                    <Button variant="brand" size="lg" onClick={() => act.mutate({ kind: "approve", plan: item })}>
                      <CheckCircle2 /> Approve
                    </Button>
                  )}
                  {item.status === "APPROVED" && (
                    <Button
                      variant="brand"
                      size="lg"
                      onClick={() => {
                        setTicks({ diff: false, notify: false });
                        setPublishing(true);
                      }}
                    >
                      <Rocket /> Publish…
                    </Button>
                  )}
                  {(item.status === "PENDING_APPROVAL" || item.status === "APPROVED") && (
                    <Button variant="outline" size="lg" onClick={() => setRejecting(true)}>
                      <ShieldX /> Reject
                    </Button>
                  )}
                </div>
              </section>

              <div className="rise-3 grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
                <section className="surface p-5">
                  <SectionTitle title="Changes compared with the published plan" />
                  {item.diff ? <DiffPanel diff={item.diff} slots={catalogue.data?.slots} /> : <p className="text-sm text-muted-foreground">No published plan to compare with.</p>}
                </section>
                <section className="surface p-5">
                  <SectionTitle title={`Health ${item.health?.score}`} hint="Blend of spread, utilisation, fairness, seating and stability." />
                  {item.health && <HealthRadar components={item.health.components} />}
                </section>
              </div>
            </div>
          )}
        </div>
      )}
      <Dialog open={rejecting} onOpenChange={setRejecting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject plan</DialogTitle>
            <DialogDescription>A reason is required and is recorded in the audit log.</DialogDescription>
          </DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this plan being rejected?" rows={3} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRejecting(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={!reason.trim() || act.isPending} onClick={() => item && act.mutate({ kind: "reject", plan: item })}>
              Reject
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={publishing} onOpenChange={setPublishing}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish checklist</DialogTitle>
            <DialogDescription>Publishing replaces the current plan and notifies everyone affected. The server re-runs the validator and refuses if any hard rule is broken.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3.5 text-sm">
            <div className="flex items-center gap-2.5">
              <Checkbox checked={item?.checklist.zero_hard_violations ?? false} disabled />
              <Label>Zero hard violations (checked by the validator)</Label>
            </div>
            <div className="flex items-center gap-2.5">
              <Checkbox checked={ticks.diff} onCheckedChange={(v) => setTicks((t) => ({ ...t, diff: v === true }))} />
              <Label>I reviewed the changes and the affected students</Label>
            </div>
            <div className="flex items-center gap-2.5">
              <Checkbox checked={ticks.notify} onCheckedChange={(v) => setTicks((t) => ({ ...t, notify: v === true }))} />
              <Label>I understand students and faculty will be notified{item?.checklist.relaxed_rules_acknowledged ? "" : " and a rule was relaxed"}</Label>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPublishing(false)}>
              Cancel
            </Button>
            <Button variant="brand" disabled={!ticks.diff || !ticks.notify || act.isPending} onClick={() => item && act.mutate({ kind: "publish", plan: item })}>
              <Rocket /> Publish now
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
