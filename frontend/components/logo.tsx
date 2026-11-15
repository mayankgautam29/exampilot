import { cn } from "@/lib/utils";

export function LogoMark({ className, onDark }: { className?: string; onDark?: boolean }) {
  return (
    <span className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-md border-[1.5px] bg-brand text-brand-foreground", onDark ? "border-deep-foreground shadow-[2px_2px_0_var(--marker)]" : "border-edge shadow-[2px_2px_0_var(--hard)]", className)} aria-hidden>
      <svg viewBox="0 0 32 32" className="size-full p-[19%]">
        <path d="M5 25 16 6l11 19" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="square" strokeLinejoin="miter" />
        <path d="M10.5 19.5h11" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="square" />
      </svg>
    </span>
  );
}

export function Wordmark({ className, onDark }: { className?: string; onDark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <LogoMark onDark={onDark} />
      <span className="font-display text-[26px] leading-none">
        Exam<span className={cn("italic", onDark ? "text-marker" : "text-brand")}>Pilot</span>
      </span>
    </span>
  );
}
