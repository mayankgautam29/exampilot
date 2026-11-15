"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CalendarCheck, Download, FileText, History, LayoutGrid, Play, ShieldCheck, Sparkles, Users, Armchair, UserCheck, Check as CheckIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Stamp } from "@/components/motion";
import { SolverConsole } from "@/components/solver-console";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, Check, EmptyState, ErrorState, HealthGauge, LoadingBlock, PageHeader, Pill, SectionTitle, StatTile, StatusBadge } from "@/components/ui-kit";
import { api, download } from "@/lib/api";
import { useAiStatus, usePlans } from "@/lib/hooks";
import type { PlanStatus, PlanSummary } from "@/lib/types";
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

const PIPELINE: { status: PlanStatus; label: string }[] = [
  { status: "DRAFT", label: "Draft" },
  { status: "PENDING_APPROVAL", label: "In review" },
  { status: "APPROVED", label: "Approved" },
  { status: "PUBLISHED", label: "Published" },
];

const HEALTH_LABELS: Record<string, string> = { spread: "Exam spread", utilisation: "Room utilisation", fairness: "Duty fairness", seating: "Seating separation", stability: "Stability" };

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
  const counts = Object.fromEntries(PIPELINE.map((s) => [s.status, plans.data?.filter((p) => p.status === s.status).length ?? 0]));
  const kpis = published?.kpis;
  const pending = counts.PENDING_APPROVAL;
  const quotaLow = ai.data && ai.data.mode !== "offline" && ai.data.remaining_est < ai.data.daily_limit * 0.1;
  const passed = proof.data?.checks.filter((c) => c.passed).length ?? 0;
  const total = proof.data?.checks.length ?? 0;

  return (
    <div>
      <PageHeader
        eyebrow="Mission control"
        title="Command Center"
        description="The live plan, its proof of correctness, and the approval pipeline, in one view."
        actions={
          <Button variant="brand" size="lg" onClick={() => generate.mutate()} disabled={generate.isPending}>
            <Play /> Generate plan
          </Button>
        }
      />

      {(pending > 0 || quotaLow || kpis?.relaxed_rules || (kpis && kpis.hard_violations > 0)) && (
        <div className="rise-1 mb-5 flex flex-wrap gap-2">
          {kpis && kpis.hard_violations > 0 && <Alert tone="bad">The published plan has {kpis.hard_violations} hard violations</Alert>}
          {pending > 0 && (
            <Link href="/admin/approvals">
              <Alert tone="warn">
                {pending} plan{pending > 1 ? "s" : ""} waiting for your approval <ArrowRight className="size-3.5" />
              </Alert>
            </Link>
          )}
          {quotaLow && <Alert tone="warn">AI quota is almost used up; the offline parser will take over</Alert>}
          {kpis?.relaxed_rules && <Alert tone="warn">The published plan relaxed the one-exam-per-day rule</Alert>}
        </div>
      )}

      {!published || !kpis ? (
        <EmptyState
          title="No published plan yet"
          hint="Generate a plan, submit it for review, approve it and publish it. Students see nothing until then."
          action={
            <Button variant="brand" onClick={() => generate.mutate()} disabled={generate.isPending}>
              <Play /> Generate the first plan
            </Button>
          }
        />
      ) : (
        <>
          <section className="surface rise-1 relative overflow-hidden">
            <div className="absolute right-5 top-5 hidden md:block"><Stamp tone="good">published · live</Stamp></div>
            <div className="relative grid gap-8 p-6 md:p-8 lg:grid-cols-[auto_1fr] lg:items-center xl:grid-cols-[auto_1fr_minmax(260px,320px)]">
              <div className="flex justify-center">
                <HealthGauge score={kpis.health?.score ?? 0} />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone="good" dot>
                    Live for students
                  </Pill>
                  <Pill tone="neutral">Version {published.version}</Pill>
                  {kpis.hard_violations === 0 && (
                    <Pill tone="good">
                      <ShieldCheck className="size-3" /> Zero hard violations
                    </Pill>
                  )}
                </div>
                <h2 className="font-display mt-3 text-[32px] leading-[1.1]">
                  {kpis.students} students, {kpis.courses} courses,
                  <br />
                  <span className="text-gradient">no clashes in the schedule.</span>
                </h2>
                <p className="mt-3 max-w-xl text-[13.5px] leading-relaxed text-muted-foreground">
                  {kpis.pct_students_one_exam_per_day}% of students sit at most one exam a day, the seating plan is {kpis.seating_risk_reduction_pct}% better than random, and invigilation duties are spread between {kpis.duties_min} and {kpis.duties_max} per person.
                </p>
              </div>
              <div className="space-y-3.5 lg:col-span-2 xl:col-span-1">
                {Object.entries(kpis.health?.components ?? {}).map(([key, value]) => (
                  <div key={key}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{HEALTH_LABELS[key] ?? key}</span>
                      <span className="font-semibold tabular-nums">{Math.round(value)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className={cn("h-full rounded-full transition-all duration-700", value >= 85 ? "bg-good" : value >= 70 ? "bg-warn" : "bg-bad")} style={{ width: `${Math.max(4, value)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <div className="rise-2 mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatTile icon={ShieldCheck} label="Violations" value={kpis.hard_violations} tone={kpis.hard_violations ? "bad" : "good"} hint={`${kpis.soft_violations} soft preferences unmet`} />
            <StatTile icon={CalendarCheck} label="Clashes" value={kpis.clashes} tone={kpis.clashes ? "bad" : "good"} hint={`Mean gap ${kpis.mean_gap_days.toFixed(1)} days between exams`} />
            <StatTile icon={Armchair} label="Seating risk" value={kpis.seating_risk_index} tone="good" hint={`${kpis.seating_risk_reduction_pct}% better than random`} />
            <StatTile icon={UserCheck} label="Duty spread" value={`${kpis.duties_min}–${kpis.duties_max}`} hint={`Fairness Gini ${kpis.duty_gini}`} />
            <StatTile icon={LayoutGrid} label="Utilisation" value={`${Math.round(kpis.seat_utilisation_pct)}%`} hint={`${kpis.rooms_total} room-sessions in use`} />
            <StatTile icon={Users} label="Cohort" value={kpis.students} hint={`${kpis.courses} courses scheduled`} />
          </div>

          <div className="rise-3 mt-6 grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-5">
            <div className="surface p-5 xl:col-span-3">
              <SectionTitle title="Approval pipeline" hint="Nothing reaches students until the Controller approves and publishes." />
              <div className="relative mb-5 grid grid-cols-4 gap-2">
                <div className="absolute inset-x-[12.5%] top-4 h-px bg-border" />
                {PIPELINE.map((step) => {
                  const count = counts[step.status];
                  const live = count > 0;
                  return (
                    <div key={step.status} className="relative flex flex-col items-center text-center">
                      <div className={cn("z-10 flex size-8 items-center justify-center rounded-full border-2 text-xs font-bold tabular-nums transition", live ? "border-brand bg-brand text-brand-foreground" : "border-border bg-card text-muted-foreground")}>{count}</div>
                      <div className={cn("mt-2 text-xs", live ? "font-semibold" : "text-muted-foreground")}>{step.label}</div>
                    </div>
                  );
                })}
              </div>
              <div className="divide-y rounded-xl border">
                {plans.data?.slice(0, 7).map((plan) => (
                  <div key={plan.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-2.5 text-[13px]">
                    <span className="w-8 font-mono text-xs font-semibold text-muted-foreground">v{plan.version}</span>
                    <StatusBadge status={plan.status} />
                    <span className="min-w-0 flex-1 truncate">{plan.label}</span>
                    <Pill tone="neutral">{plan.kind}</Pill>
                    {plan.hard_violations > 0 && <Pill tone="bad">{plan.hard_violations} hard</Pill>}
                    {plan.status === "SUPERSEDED" && plan.kind === "full" && (
                      <Button size="xs" variant="outline" onClick={() => rollback.mutate(plan)}>
                        <History /> Roll back
                      </Button>
                    )}
                    {(plan.status === "DRAFT" || plan.status === "REJECTED") && (
                      <Button size="xs" variant="outline" onClick={() => submit.mutate(plan)}>
                        Submit for review
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="surface flex flex-col p-5 xl:col-span-2">
              <SectionTitle
                title="Proof panel"
                hint="Every rule recomputed from raw plan data. No solver code involved."
                action={
                  total > 0 && (
                    <Pill tone={passed === total ? "good" : "bad"}>
                      <CheckIcon className="size-3" /> {passed}/{total} passed
                    </Pill>
                  )
                }
              />
              {total > 0 && (
                <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className={cn("h-full rounded-full transition-all duration-700", passed === total ? "bg-good" : "bg-bad")} style={{ width: `${(100 * passed) / total}%` }} />
                </div>
              )}
              <div className="max-h-[300px] flex-1 space-y-2.5 overflow-y-auto pr-1">
                {proof.isLoading && <LoadingBlock rows={4} />}
                {proof.data?.checks.map((check) => (
                  <Check key={check.code} ok={check.passed} label={<><span className="mr-1 font-mono text-[11px] text-muted-foreground">{check.code}</span> {check.description}{!check.passed && ` · ${check.violations} violations`}</>} />
                ))}
              </div>
            </div>
          </div>

          <div className="rise-4 mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-5">
            <div className="surface p-5 xl:col-span-3">
              <SectionTitle title="Executive briefing" hint="Prose written from the KPI numbers, then verified number by number." />
              {briefing.data ? (
                <div className="space-y-3">
                  <p className="text-[14px] leading-relaxed">{briefing.data.text}</p>
                  <div className="flex gap-2">
                    <Pill tone={briefing.data.verified ? "good" : "bad"} dot>
                      {briefing.data.verified ? "Numbers verified against solver output" : "Numbers not verified"}
                    </Pill>
                    <Pill tone="neutral">{briefing.data.mode}</Pill>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 rounded-xl border border-dashed p-4">
                  <Sparkles className="size-5 text-brand" />
                  <p className="flex-1 text-[13px] text-muted-foreground">Generate a short, fact-checked summary for the Controller.</p>
                  <Button variant="outline" onClick={() => briefing.mutate()} disabled={briefing.isPending}>
                    {briefing.isPending ? "Writing…" : "Write briefing"}
                  </Button>
                </div>
              )}
            </div>
            <div className="surface p-5 xl:col-span-2">
              <SectionTitle title="Exports" hint="Download the published plan." />
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="justify-start" onClick={() => download("/export/timetable.pdf", "timetable.pdf")}>
                  <FileText /> Timetable PDF
                </Button>
                <Button variant="outline" className="justify-start" onClick={() => download("/export/roster.pdf", "roster.pdf")}>
                  <FileText /> Roster PDF
                </Button>
                <Button variant="outline" className="justify-start" onClick={() => download("/export/plan.xlsx", "plan.xlsx")}>
                  <Download /> Excel
                </Button>
                <Button variant="outline" className="justify-start" onClick={() => download("/export/halltickets.zip", "halltickets.zip")}>
                  <Download /> Hall tickets
                </Button>
              </div>
            </div>
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
