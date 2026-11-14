"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Download, FileText, Play, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { HealthRadar } from "@/components/charts";
import { SolverConsole } from "@/components/solver-console";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check, EmptyState, ErrorState, LoadingBlock, PageHeader, StatTile, StatusBadge } from "@/components/ui-kit";
import { api, download } from "@/lib/api";
import { useAiStatus, usePlans } from "@/lib/hooks";
import type { PlanSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Proof {
  hard_count: number;
  soft_count: number;
  checks: { code: string; description: string; violations: number; passed: boolean }[];
  publishable: boolean;
}

interface Briefing {
  text: string;
  verified: boolean;
  mode: string;
}

const PIPELINE = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "PUBLISHED"] as const;

export default function CommandCenter() {
  const plans = usePlans();
  const ai = useAiStatus();
  const client = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const published = plans.data?.find((p) => p.status === "PUBLISHED");
  const proof = useQuery({ queryKey: ["proof", published?.id], queryFn: () => api<Proof>(`/plans/${published!.id}/validate`), enabled: !!published });
  const briefing = useMutation({ mutationFn: () => api<Briefing>(`/plans/${published!.id}/briefing`) });
  const generate = useMutation({
    mutationFn: () => api<{ job_id: string }>("/plans/generate", { method: "POST", body: { label: "Generated plan" } }),
    onSuccess: (result) => setJobId(result.job_id),
    onError: (error) => toast.error(error.message),
  });
  const rollback = useMutation({
    mutationFn: (plan: PlanSummary) => api(`/plans/${plan.id}/rollback`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Rollback created and sent to Approvals");
      client.invalidateQueries({ queryKey: ["plans"] });
    },
    onError: (error) => toast.error(error.message),
  });
  const submit = useMutation({
    mutationFn: (plan: PlanSummary) => api(`/plans/${plan.id}/submit`, { method: "POST", headers: { "If-Match": String(plan.row_version) } }),
    onSuccess: () => {
      toast.success("Submitted for approval");
      client.invalidateQueries({ queryKey: ["plans"] });
    },
    onError: (error) => toast.error(error.message),
  });

  if (plans.isLoading) return <LoadingBlock rows={6} />;
  if (plans.error) return <ErrorState error={plans.error} />;
  const counts = Object.fromEntries(PIPELINE.map((s) => [s, plans.data?.filter((p) => p.status === s).length ?? 0]));
  const kpis = published?.kpis;
  const pending = counts.PENDING_APPROVAL;
  const quotaLow = ai.data && ai.data.mode !== "offline" && ai.data.remaining_est < ai.data.daily_limit * 0.1;

  return (
    <div>
      <PageHeader
        title="Command Center"
        description="The published plan at a glance, the approval pipeline, and a live solver for new plans."
        actions={
          <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
            <Play /> Generate plan
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {kpis && kpis.hard_violations > 0 && <Alert tone="bad">The published plan has {kpis.hard_violations} hard violations</Alert>}
        {pending > 0 && (
          <Link href="/admin/approvals">
            <Alert tone="warn">
              {pending} plan{pending > 1 ? "s" : ""} waiting for approval <ArrowRight className="size-3" />
            </Alert>
          </Link>
        )}
        {quotaLow && <Alert tone="warn">AI quota is almost used up; the offline parser will take over</Alert>}
        {kpis?.relaxed_rules && <Alert tone="warn">The published plan relaxed the one-exam-per-day rule</Alert>}
      </div>

      {!published || !kpis ? (
        <EmptyState title="No published plan yet" hint="Generate a plan, submit it, approve it and publish it." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatTile label="Plan health" value={kpis.health?.score ?? "—"} tone={(kpis.health?.score ?? 0) >= 85 ? "good" : "warn"} hint={`v${published.version} published`} />
            <StatTile label="Hard violations" value={kpis.hard_violations} tone={kpis.hard_violations ? "bad" : "good"} hint={`${kpis.soft_violations} soft preferences unmet`} />
            <StatTile label="Student clashes" value={kpis.clashes} tone={kpis.clashes ? "bad" : "good"} hint={`${kpis.pct_students_one_exam_per_day}% sit one exam a day`} />
            <StatTile label="Seating risk" value={kpis.seating_risk_index} hint={`${kpis.seating_risk_reduction_pct}% better than random`} tone="good" />
            <StatTile label="Duty spread" value={`${kpis.duties_min}–${kpis.duties_max}`} hint={`Gini ${kpis.duty_gini}`} />
            <StatTile label="Scale" value={kpis.students} hint={`${kpis.courses} courses, ${kpis.rooms_total} room-sessions`} />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Plan health</CardTitle>
                <CardDescription>Blend of spread, utilisation, fairness, seating and stability</CardDescription>
              </CardHeader>
              <CardContent>{kpis.health && <HealthRadar components={kpis.health.components} />}</CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Approval pipeline</CardTitle>
                <CardDescription>Nothing reaches students until the Controller approves and publishes.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  {PIPELINE.map((status, index) => (
                    <div key={status} className="flex items-center gap-2">
                      <div className="rounded-lg border px-4 py-2 text-center">
                        <div className="text-2xl font-semibold tabular-nums">{counts[status]}</div>
                        <div className="text-xs text-muted-foreground">{status.replace("_", " ")}</div>
                      </div>
                      {index < PIPELINE.length - 1 && <ArrowRight className="size-4 text-muted-foreground" />}
                    </div>
                  ))}
                </div>
                <div className="space-y-1.5">
                  {plans.data?.slice(0, 8).map((plan) => (
                    <div key={plan.id} className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-1.5 text-sm">
                      <span className="font-medium">v{plan.version}</span>
                      <StatusBadge status={plan.status} />
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">{plan.label}</span>
                      <Badge variant="outline">{plan.kind}</Badge>
                      {plan.hard_violations > 0 && <Badge className="border-0 bg-red-500/15 text-red-700">{plan.hard_violations} hard</Badge>}
                      {plan.status === "SUPERSEDED" && plan.kind === "full" && (
                        <Button size="xs" variant="outline" onClick={() => rollback.mutate(plan)}>
                          Roll back to this
                        </Button>
                      )}
                      {(plan.status === "DRAFT" || plan.status === "REJECTED") && (
                        <Button size="xs" variant="outline" onClick={() => submit.mutate(plan)}>
                          Submit
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Proof panel</CardTitle>
                <CardDescription>The independent validator recomputes every rule from the plan data. No solver code is involved.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {proof.isLoading && <LoadingBlock rows={4} />}
                {proof.data?.checks.map((check) => (
                  <Check key={check.code} ok={check.passed} label={<><span className="font-mono text-xs text-muted-foreground">{check.code}</span> {check.description}{!check.passed && ` — ${check.violations} violations`}</>} />
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Executive briefing</CardTitle>
                <CardDescription>Prose written from the KPI numbers, then checked number by number.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {briefing.data ? (
                  <>
                    <p className="text-sm leading-relaxed">{briefing.data.text}</p>
                    <Badge className={cn("border-0", briefing.data.verified ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-red-500/15 text-red-700")}>
                      {briefing.data.verified ? "✓ numbers verified against solver output" : "numbers not verified"}
                    </Badge>
                    <Badge variant="outline" className="ml-2">{briefing.data.mode}</Badge>
                  </>
                ) : (
                  <Button variant="outline" onClick={() => briefing.mutate()} disabled={briefing.isPending}>
                    <Sparkles /> Write briefing
                  </Button>
                )}
                <div className="flex flex-wrap gap-2 border-t pt-3">
                  <Button size="sm" variant="outline" onClick={() => download("/export/timetable.pdf", "timetable.pdf")}>
                    <FileText /> Timetable PDF
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => download("/export/roster.pdf", "roster.pdf")}>
                    <FileText /> Roster PDF
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => download("/export/plan.xlsx", "plan.xlsx")}>
                    <Download /> Excel
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => download("/export/halltickets.zip", "halltickets.zip")}>
                    <Download /> Hall tickets
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <Dialog open={!!jobId} onOpenChange={(open) => !open && setJobId(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Live solver console</DialogTitle>
            <DialogDescription>Four stages run in order. The chart shows the solver improving its best plan against the proven lower bound.</DialogDescription>
          </DialogHeader>
          {jobId && <SolverConsole jobId={jobId} onDone={() => client.invalidateQueries({ queryKey: ["plans"] })} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Alert({ tone, children }: { tone: "bad" | "warn"; children: React.ReactNode }) {
  return (
    <div className={cn("flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm", tone === "bad" ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300" : "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200")}>
      <AlertTriangle className="size-4" />
      {children}
    </div>
  );
}
