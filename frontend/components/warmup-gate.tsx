"use client";

import { Loader2, RefreshCcw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
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
    setPhase("checking");
    poll(800);
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (phase === "ready") return <>{children}</>;
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      {phase === "checking" ? (
        <>
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
          <h1 className="text-lg font-semibold">Waking up the planner…</h1>
          <p className="max-w-sm text-sm text-muted-foreground">The free hosting tier sleeps when idle and may take up to a minute to start. This page continues on its own.</p>
        </>
      ) : (
        <>
          <h1 className="text-lg font-semibold">The planner is not responding</h1>
          <p className="max-w-sm text-sm text-muted-foreground">Check that the API is running at {API_URL}, then try again.</p>
          <Button onClick={() => setAttempt((n) => n + 1)}>
            <RefreshCcw /> Try again
          </Button>
        </>
      )}
    </div>
  );
}
