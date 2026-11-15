"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Eye, EyeOff, GraduationCap, LockKeyhole, ShieldCheck, UserCog, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ComponentType } from "react";
import { toast } from "sonner";
import { Wordmark } from "@/components/logo";
import { Stamp } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { homeFor, useAuth } from "@/lib/store";
import { cn } from "@/lib/utils";

const DEMO: { label: string; hint: string; email: string; icon: ComponentType<{ className?: string }> }[] = [
  { label: "Controller", hint: "Plan, approve, publish", email: "admin@jklu.demo", icon: UserCog },
  { label: "Faculty", hint: "Duties and calendar", email: "faculty01@jklu.demo", icon: Users },
  { label: "Student", hint: "Exams and seat", email: "student001@jklu.demo", icon: GraduationCap },
];

const PROOF = [
  { value: "0", label: "hard rule violations" },
  { value: "3.3", label: "seating risk index" },
  { value: "100%", label: "audit chain verified" },
];

const COLUMNS = 12;
const ROWS = 5;
const CLASHES = [4, 9, 15, 22, 26, 33, 38, 41, 47, 55];
const HOLD_TICKS = 6;
const SLOT_COLORS = ["var(--teal)", "var(--marker)", "#e8e0cc", "#6f93d8"];

function ClashGrid() {
  const reduce = useReducedMotion();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setTick((n) => (n >= CLASHES.length + HOLD_TICKS ? 0 : n + 1)), 520);
    return () => clearInterval(id);
  }, [reduce]);
  const resolved = reduce ? CLASHES.length : Math.min(tick, CLASHES.length);
  const remaining = CLASHES.length - resolved;
  return (
    <div className="mt-8" role="img" aria-label="Animation: scheduling clashes are resolved one by one until none remain">
      <div className="mb-3 flex items-end justify-between">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-deep-muted">Live solve · 84 courses</div>
        <div className="flex items-center gap-3">
          {remaining === 0 && <Stamp tone="good" className="!border-[#5fd49a] !text-[#5fd49a]">cleared</Stamp>}
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-deep-muted">
            clashes <span className={cn("ml-1 font-display text-[34px] leading-none tabular-nums", remaining === 0 ? "text-[#5fd49a]" : "text-[#ff6a45]")}>{String(remaining).padStart(2, "0")}</span>
          </div>
        </div>
      </div>
      <div className="grid gap-[5px] rounded-md border-[1.5px] border-deep-foreground/70 p-2.5 shadow-[4px_4px_0_var(--marker)]" style={{ gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))` }}>
        {Array.from({ length: COLUMNS * ROWS }).map((_, index) => {
          const clashOrder = CLASHES.indexOf(index);
          const clashing = clashOrder >= 0 && clashOrder >= resolved;
          const justResolved = clashOrder >= 0 && clashOrder === resolved - 1;
          const color = clashing ? "var(--brand)" : SLOT_COLORS[(index * 7 + Math.floor(index / COLUMNS)) % SLOT_COLORS.length];
          return (
            <motion.div
              key={`${index}-${clashing}`}
              initial={justResolved ? { scale: 0.4, rotate: -12 } : false}
              animate={clashing ? { scale: [1, 1.12, 1] } : { scale: 1, rotate: 0 }}
              transition={clashing ? { duration: 1.1, repeat: Infinity, delay: (clashOrder % 4) * 0.12 } : { type: "spring", stiffness: 420, damping: 14 }}
              className="aspect-square rounded-[2px]"
              style={{ background: color, opacity: clashing ? 1 : justResolved ? 1 : 0.82 }}
            />
          );
        })}
      </div>
    </div>
  );
}

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("admin@jklu.demo");
  const [password, setPassword] = useState("Demo@1234");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const user = await login(email, password);
      router.replace(homeFor(user.role));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.12fr_1fr]">
      <section className="relative hidden overflow-hidden bg-deep text-deep-foreground lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "linear-gradient(var(--deep-foreground) 1px, transparent 1px), linear-gradient(90deg, var(--deep-foreground) 1px, transparent 1px)", backgroundSize: "36px 36px" }} />
        <div className="relative">
          <Wordmark onDark />
        </div>
        <div className="relative">
          <div className="eyebrow mb-5 flex items-center gap-2 !text-deep-muted">
            <span className="size-2 bg-brand" /> Agentic examination planning
          </div>
          <h1 className="font-display text-[58px] leading-[0.98]">
            Every exam clash,
            <br />
            <em className="text-marker underline decoration-brand decoration-[3px] underline-offset-[7px]">resolved</em>{" "}
            before anyone sees it.
          </h1>
          <p className="mt-6 max-w-lg text-[15.5px] leading-relaxed text-deep-muted">Timetable, rooms, invigilators and seats planned together, proven by an independent validator, and published only after a human says yes.</p>
          <ClashGrid />
          <div className="mt-6 grid max-w-xl grid-cols-3 gap-3">
            {PROOF.map((item, index) => (
              <motion.div key={item.label} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 + index * 0.1, duration: 0.5 }} className="rounded-md border-[1.5px] border-deep-line p-3.5">
                <div className="font-display text-[38px] leading-none">{item.value}</div>
                <div className="mt-1.5 font-mono text-[10px] uppercase leading-snug tracking-[0.1em] text-deep-muted">{item.label}</div>
              </motion.div>
            ))}
          </div>
        </div>
        <div className="relative flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-deep-muted">
          <ShieldCheck className="size-4 text-marker" /> Role-based access on every endpoint · hash-chained audit log · no AI approval path
        </div>
      </section>

      <section className="flex flex-col">
        <div className="hazard h-2" />
        <div className="border-b-[1.5px] border-edge bg-marker px-4 py-2 text-center font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink">Synthetic data · every student, teacher and room here is invented</div>
        <div className="flex flex-1 items-center justify-center px-6 py-10">
          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} className="hard-lg w-full max-w-[440px] rounded-lg bg-card p-7">
            <div className="mb-7 lg:hidden">
              <Wordmark />
            </div>
            <div className="eyebrow mb-2 flex items-center gap-2">
              <span className="size-2 bg-brand" /> Welcome back
            </div>
            <h2 className="font-display text-[44px] leading-[1.02]">
              Sign in to the <em className="text-brand">deck</em>
            </h2>
            <p className="mt-3 text-sm text-muted-foreground">Choose a demo role or enter your own credentials.</p>

            <div className="mt-6 grid grid-cols-3 gap-2.5" role="radiogroup" aria-label="Demo role">
              {DEMO.map((account) => {
                const active = email === account.email;
                return (
                  <button
                    key={account.email}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => {
                      setEmail(account.email);
                      setPassword("Demo@1234");
                    }}
                    className={cn("lift hard-sm rounded-md p-3 text-left", active ? "bg-marker text-ink" : "bg-card")}
                  >
                    <account.icon className="size-5" />
                    <div className="mt-2 text-[13px] font-semibold">{account.label}</div>
                    <div className={cn("mt-0.5 text-[11px] leading-tight", active ? "text-ink/75" : "text-muted-foreground")}>{account.hint}</div>
                  </button>
                );
              })}
            </div>

            <form onSubmit={submit} className="mt-6 space-y-4">
              <label className="block">
                <span className="eyebrow mb-1.5 block">Email</span>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" className="h-11" />
              </label>
              <label className="block">
                <span className="eyebrow mb-1.5 block">Password</span>
                <div className="relative">
                  <Input value={password} onChange={(e) => setPassword(e.target.value)} type={visible ? "text" : "password"} autoComplete="current-password" className="h-11 pr-10" />
                  <button type="button" onClick={() => setVisible((v) => !v)} aria-label={visible ? "Hide password" : "Show password"} className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground">
                    {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </label>
              <Button type="submit" variant="brand" size="lg" className="h-12 w-full text-[15px]" disabled={busy}>
                {busy ? "Signing in…" : "Sign in"} {!busy && <ArrowRight />}
              </Button>
            </form>
            <p className="mt-5 flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground">
              <LockKeyhole className="size-3.5" /> All demo accounts use the password Demo@1234
            </p>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
