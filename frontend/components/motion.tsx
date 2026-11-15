"use client";

import { animate, useInView, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function CountUp({ value, decimals = 0, duration = 1.2, className }: { value: number; decimals?: number; duration?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!inView || reduce) return;
    const controls = animate(0, value, { duration, ease: [0.22, 1, 0.36, 1], onUpdate: setShown });
    return () => controls.stop();
  }, [inView, reduce, value, duration]);
  const current = reduce ? value : shown;
  return (
    <span ref={ref} className={className}>
      {current.toFixed(decimals)}
    </span>
  );
}

const STAMP_TONE = {
  good: "border-good text-good-text",
  bad: "border-bad text-bad",
  warn: "border-warn text-warn-text",
  brand: "border-brand text-brand",
} as const;

export function Stamp({ children, tone = "good", className }: { children: ReactNode; tone?: keyof typeof STAMP_TONE; className?: string }) {
  return <span className={cn("stamp inline-block -rotate-6 rounded-sm border-2 px-2.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.18em]", STAMP_TONE[tone], className)}>{children}</span>;
}

export function Ticker({ items }: { items: string[] }) {
  const line = items.map((item, index) => (
    <span key={index} className="flex items-center gap-8 whitespace-nowrap">
      <span>{item}</span>
      <span className="text-marker">◆</span>
    </span>
  ));
  return (
    <div className="group relative flex overflow-hidden border-b-[1.5px] border-edge bg-deep py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-deep-foreground" aria-label="Live plan summary">
      <div className="flex shrink-0 animate-marquee gap-8 pr-8 group-hover:[animation-play-state:paused]" style={{ animation: "marquee 42s linear infinite" }}>
        {line}
        {line}
      </div>
    </div>
  );
}
