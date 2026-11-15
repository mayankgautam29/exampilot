"use client";

import { AlertTriangle, CheckCircle2, Inbox, Loader2 } from "lucide-react";
import { useEffect, useState, type ComponentType, type ReactNode, type SelectHTMLAttributes } from "react";
import { CountUp } from "@/components/motion";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { PlanStatus } from "@/lib/types";

export type Tone = "good" | "bad" | "warn" | "info" | "neutral" | "brand";

const TONE_TEXT: Record<Tone, string> = {
  good: "text-good-text",
  bad: "text-bad",
  warn: "text-warn-text",
  info: "text-info",
  brand: "text-brand",
  neutral: "text-foreground",
};

const TONE_PILL: Record<Tone, string> = {
  good: "border-good bg-good/12 text-good-text",
  bad: "border-bad bg-bad/10 text-bad",
  warn: "border-warn bg-warn/15 text-warn-text",
  info: "border-info bg-info/10 text-info",
  brand: "border-brand bg-brand-soft text-brand",
  neutral: "border-border bg-muted text-muted-foreground",
};

const TONE_DOT: Record<Tone, string> = {
  good: "bg-good",
  bad: "bg-bad",
  warn: "bg-warn",
  info: "bg-info",
  brand: "bg-brand",
  neutral: "bg-muted-foreground/60",
};

export function Pill({ tone = "neutral", dot, children, className, title }: { tone?: Tone; dot?: boolean; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex h-[22px] items-center gap-1.5 rounded-sm border-[1.5px] px-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] whitespace-nowrap", TONE_PILL[tone], className)}>
      {dot && <span className={cn("size-1.5", TONE_DOT[tone])} />}
      {children}
    </span>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: string; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="rise mb-7 flex flex-wrap items-end justify-between gap-4 border-b-[1.5px] border-edge pb-5">
      <div className="min-w-0">
        {eyebrow && (
          <div className="eyebrow mb-2.5 flex items-center gap-2">
            <span className="size-2 bg-brand" /> {eyebrow}
          </div>
        )}
        <h1 className="font-display text-[42px] leading-[1.02]">
          <span className="marker-hl px-0.5">{title}</span>
        </h1>
        {description && <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="mb-3.5 flex items-end justify-between gap-3">
      <div>
        <h2 className="font-display text-[22px] leading-tight">{title}</h2>
        {hint && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

function AnimatedValue({ value }: { value: ReactNode }) {
  if (typeof value === "number") return <CountUp value={value} decimals={Number.isInteger(value) ? 0 : 1} />;
  if (typeof value === "string") {
    const match = value.match(/^(\d+(?:\.\d+)?)(%?)$/);
    if (match) {
      const decimals = match[1].includes(".") ? match[1].split(".")[1].length : 0;
      return (
        <>
          <CountUp value={Number(match[1])} decimals={decimals} />
          {match[2]}
        </>
      );
    }
  }
  return <>{value}</>;
}

export function StatTile({ label, value, hint, tone, icon: Icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "good" | "bad" | "warn"; icon?: ComponentType<{ className?: string }> }) {
  return (
    <div className="surface lift relative overflow-hidden p-4 pl-5">
      <span className={cn("absolute inset-y-0 left-0 w-1.5", tone ? TONE_DOT[tone] : "bg-border")} />
      <div className="flex items-center justify-between gap-2">
        <div className="eyebrow">{label}</div>
        {Icon && <Icon className="size-4 text-muted-foreground/70" />}
      </div>
      <div className={cn("mt-2 font-display text-[44px] leading-none tabular-nums", tone && TONE_TEXT[tone])}>
        <AnimatedValue value={value} />
      </div>
      {hint && <div className="mt-2.5 text-xs leading-snug text-muted-foreground">{hint}</div>}
    </div>
  );
}

const STATUS_TONE: Record<PlanStatus, Tone> = {
  DRAFT: "neutral",
  PENDING_APPROVAL: "warn",
  APPROVED: "info",
  PUBLISHED: "good",
  REJECTED: "bad",
  SUPERSEDED: "neutral",
};

export function StatusBadge({ status }: { status: PlanStatus }) {
  return (
    <Pill tone={STATUS_TONE[status]} dot>
      {status.replace("_", " ").toLowerCase()}
    </Pill>
  );
}

export function EmptyState({ title, hint, action, compact }: { title: string; hint?: string; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={cn("flex flex-col items-center rounded-lg border-[1.5px] border-dashed border-edge/60 bg-card px-6 text-center", compact ? "gap-1.5 py-6" : "gap-3 py-14")}>
      <div className={cn("hard-sm flex items-center justify-center rounded-md bg-marker text-ink", compact ? "size-9" : "size-12")}>
        <Inbox className={compact ? "size-4" : "size-5"} />
      </div>
      <div className={cn("font-display", compact ? "text-lg" : "text-2xl")}>{title}</div>
      {hint && <div className="max-w-sm text-[13px] text-muted-foreground">{hint}</div>}
      {action}
    </div>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  return (
    <div className="hard-sm flex items-center gap-2.5 rounded-md border-bad bg-bad/10 p-4 text-sm font-medium text-bad" style={{ boxShadow: "3px 3px 0 var(--bad)" }}>
      <AlertTriangle className="size-4 shrink-0" />
      {error instanceof Error ? error.message : "Something went wrong"}
    </div>
  );
}

export function LoadingBlock({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-11 w-full rounded-md" />
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
    <div className="flex items-start gap-2.5 text-[13px] leading-snug">
      {ok ? <CheckCircle2 className="mt-px size-4 shrink-0 text-good-text" /> : <AlertTriangle className="mt-px size-4 shrink-0 text-bad" />}
      <span>{label}</span>
    </div>
  );
}

export function Alert({ tone, children }: { tone: "bad" | "warn" | "info"; children: ReactNode }) {
  const style = tone === "bad" ? "border-bad bg-bad/10 text-bad" : tone === "warn" ? "border-warn bg-marker/30 text-ink" : "border-info bg-info/10 text-info";
  const shadow = tone === "bad" ? "var(--bad)" : tone === "warn" ? "var(--warn)" : "var(--info)";
  return (
    <div className={cn("flex items-center gap-2 rounded-md border-[1.5px] px-3.5 py-2 text-[13px] font-semibold", style)} style={{ boxShadow: `3px 3px 0 ${shadow}` }}>
      <AlertTriangle className="size-4 shrink-0" />
      {children}
    </div>
  );
}

export function HealthGauge({ score, size = 176, label = "Plan health" }: { score: number; size?: number; label?: string }) {
  const stroke = 14;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const arc = circumference * 0.75;
  const value = Math.max(0, Math.min(100, score));
  const tone = value >= 85 ? "var(--good)" : value >= 70 ? "var(--warn)" : "var(--bad)";
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(value));
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-[225deg]">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--border)" strokeWidth={stroke} strokeDasharray={`${arc} ${circumference}`} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={tone} strokeWidth={stroke} strokeDasharray={`${(arc * shown) / 100} ${circumference}`} style={{ transition: "stroke-dasharray 1.4s cubic-bezier(0.22,1,0.36,1)" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pt-1">
        <div className="font-display text-[54px] leading-none tabular-nums">
          <CountUp value={value} decimals={value % 1 ? 1 : 0} duration={1.4} />
        </div>
        <div className="eyebrow mt-1">{label}</div>
      </div>
    </div>
  );
}

export function NativeSelect({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn("h-9 max-w-full rounded-md border-[1.5px] border-input bg-card px-3 pr-8 text-sm font-medium outline-none transition-[box-shadow] focus-visible:shadow-[3px_3px_0_var(--marker)]", className)} {...props} />;
}
