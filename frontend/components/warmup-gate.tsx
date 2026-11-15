"use client";

import { RefreshCcw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { LogoMark } from "@/components/logo";
import { API_URL } from "@/lib/api";
import { Button } from "@/components/ui/button";

type Phase = "checking" | "ready" | "failed";

export function WarmupGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const started = Date.now();
    async function poll(delay: number) {
      try {
        const response = await fetch(`${API_URL}/health/ready`);
        const body = (await response.json()) as { ready: boolean };
        if (body.ready) return !cancelled && setPhase("ready");
      } catch {}
      if (cancelled) return;
      if (Date.now() - started > 90000) return setPhase("failed");
      setTimeout(() => poll(Math.min(delay * 1.5, 5000)), delay);
    }
    poll(800);
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (phase === "ready") return <>{children}</>;
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-6 overflow-hidden bg-deep p-6 text-center text-deep-foreground">
      <div className="hazard absolute inset-x-0 top-0 h-2" />
      <div className="relative flex flex-col items-center gap-6">
        <div className={phase === "checking" ? "animate-bounce" : ""}>
          <LogoMark onDark className="size-16" />
        </div>
        {phase === "checking" ? (
          <>
            <h1 className="font-display text-[40px] leading-none">
              Waking up the <em className="text-marker">planner</em>…
            </h1>
            <p className="max-w-sm text-sm leading-relaxed text-deep-muted">The free hosting tier sleeps when idle and may take up to a minute to start. This page continues on its own.</p>
            <div className="h-2.5 w-56 overflow-hidden border-[1.5px] border-deep-foreground">
              <div className="h-full w-1/3 bg-marker" style={{ animation: "slide 1.4s ease-in-out infinite" }} />
            </div>
          </>
        ) : (
          <>
            <h1 className="font-display text-[40px] leading-none">The planner is not responding</h1>
            <p className="max-w-sm text-sm leading-relaxed text-deep-muted">Check that the API is running at {API_URL}, then try again.</p>
            <Button
              variant="secondary"
              onClick={() => {
                setPhase("checking");
                setAttempt((n) => n + 1);
              }}
            >
              <RefreshCcw /> Try again
            </Button>
          </>
        )}
      </div>
      <style>{`@keyframes slide{0%{transform:translateX(-120%)}100%{transform:translateX(420%)}}`}</style>
    </div>
  );
}
