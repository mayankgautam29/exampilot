"use client";

import { AlertTriangle, CheckCircle2, Inbox, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { PlanStatus } from "@/lib/types";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatTile({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "good" | "bad" | "warn" }) {
  const toneClass = tone === "good" ? "text-emerald-600 dark:text-emerald-400" : tone === "bad" ? "text-red-600 dark:text-red-400" : tone === "warn" ? "text-amber-600 dark:text-amber-400" : "";
  return (
    <Card size="sm">
      <CardContent>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={cn("mt-1 text-2xl font-semibold tabular-nums", toneClass)}>{value}</div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

const STATUS_STYLE: Record<PlanStatus, string> = {
  DRAFT: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  PENDING_APPROVAL: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  APPROVED: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  PUBLISHED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  REJECTED: "bg-red-500/15 text-red-700 dark:text-red-300",
  SUPERSEDED: "bg-zinc-500/10 text-zinc-500",
};

export function StatusBadge({ status }: { status: PlanStatus }) {
  return <Badge className={cn("border-0 font-medium", STATUS_STYLE[status])}>{status.replace("_", " ")}</Badge>;
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-center text-muted-foreground">
      <Inbox className="size-6" />
      <div className="text-sm font-medium text-foreground">{title}</div>
      {hint && <div className="text-xs">{hint}</div>}
    </div>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-700 dark:text-red-300">
      <AlertTriangle className="size-4 shrink-0" />
      {error instanceof Error ? error.message : "Something went wrong"}
    </div>
  );
}

export function LoadingBlock({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </span>
  );
}

export function Check({ ok, label }: { ok: boolean; label: ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-500" />}
      <span>{label}</span>
    </div>
  );
}
