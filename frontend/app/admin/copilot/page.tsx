"use client";

import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Activity, ArrowUp, BookOpen, CalendarClock, Check, CheckCircle2, Circle, CircleHelp, DoorClosed, Loader2, Mic, MicOff, Pin, ShieldCheck, ThumbsDown, Upload, UserPlus, UserX, Wrench, XCircle, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { DiffPanel } from "@/components/diff-panel";
import { LogoMark } from "@/components/logo";
import { EmptyState, PageHeader, Pill, SectionTitle } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { api, streamEvents } from "@/lib/api";
import { useCatalogue, usePublished } from "@/lib/hooks";
import type { AgentEvent, Alternative, ClarifyOption, Diff, JobEvent, PlanDetail, Proposal } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ChatMessage {
  id: number;
  role: "user" | "agent";
  text: string;
  clarify?: ClarifyOption[];
  alternatives?: Alternative[];
  explanations?: string[];
  baseOps?: Record<string, unknown>[];
}

interface ToolCard {
  name: string;
  args: Record<string, unknown>;
  rationale: string;
  summary?: string;
  latency?: number;
  error?: string | null;
  running: boolean;
}

interface Verify {
  valid: boolean;
  hard_count: number;
  kpis_match: boolean;
  health: number | null;
  clashes: number | null;
}

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

const SUGGESTIONS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: CalendarClock, title: "Move an exam", text: "move CSE301 to 2026-12-14 afternoon" },
  { icon: DoorClosed, title: "Block a room", text: "room G1 unavailable on 2026-12-08 afternoon" },
  { icon: UserX, title: "Faculty unavailable", text: "faculty F05 unavailable on 2026-12-09" },
  { icon: Pin, title: "Pin two courses", text: "pin CSE301 to 2026-12-08 morning and pin CSE302 to 2026-12-08 morning" },
  { icon: UserPlus, title: "Add students", text: "add 10 supplementary students to OE101 and regenerate seating" },
  { icon: CircleHelp, title: "Ambiguous request", text: "move math to 2026-12-08 morning" },
  { icon: BookOpen, title: "Ask a policy question", text: "Can students use calculators?" },
  { icon: Activity, title: "Plan status", text: "How is the plan doing?" },
];

export default function CopilotPage() {
  const { published } = usePublished();
  const catalogue = useCatalogue();
  const client = useQueryClient();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<string>("");
  const [steps, setSteps] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [tools, setTools] = useState<ToolCard[]>([]);
  const [verify, setVerify] = useState<Verify | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [listening, setListening] = useState(false);
  const recognition = useRef<RecognitionLike | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const counter = useRef(0);

  useEffect(() => {
    if (messages.length) scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function resetRun() {
    setSteps([]);
    setProgress(0);
    setTools([]);
    setVerify(null);
    setProposal(null);
  }

  function patchAgent(update: (m: ChatMessage) => ChatMessage) {
    setMessages((all) => all.map((m, i) => (i === all.length - 1 && m.role === "agent" ? update(m) : m)));
  }

  function handle(event: AgentEvent) {
    if (event.type === "mode") setMode(String(event.mode));
    if (event.type === "plan") setSteps((event.steps as string[]) ?? []);
    if (event.type === "tool_call") setTools((t) => [...t, { name: String(event.name), args: (event.args as Record<string, unknown>) ?? {}, rationale: String(event.rationale ?? ""), running: true }]);
    if (event.type === "tool_result") {
      setProgress((p) => p + 1);
      setTools((all) => {
        const index = all.map((t) => t.running && t.name === event.name).lastIndexOf(true);
        return all.map((t, i) => (i === index ? { ...t, running: false, summary: String(event.summary ?? ""), latency: event.latency_ms as number, error: (event.error as string | null) ?? null } : t));
      });
    }
    if (event.type === "verify") setVerify(event as unknown as Verify);
    if (event.type === "info") toast.info(String(event.message));
    if (event.type === "clarify") patchAgent((m) => ({ ...m, clarify: event.options as ClarifyOption[] }));
    if (event.type === "answer_delta") patchAgent((m) => ({ ...m, text: m.text + String(event.text) }));
    if (event.type === "done") {
      setProgress(999);
      const diagnosis = event.diagnosis as { explanations?: string[] } | undefined;
      patchAgent((m) => ({ ...m, text: m.text || String(event.answer ?? ""), alternatives: event.alternatives as Alternative[], explanations: diagnosis?.explanations, baseOps: event.ops as Record<string, unknown>[] }));
      if (event.proposal) setProposal(event.proposal as Proposal);
      client.invalidateQueries({ queryKey: ["plans"] });
    }
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || running || !published) return;
    setInput("");
    resetRun();
    setRunning(true);
    counter.current += 2;
    setMessages((all) => [...all, { id: counter.current, role: "user", text: message }, { id: counter.current + 1, role: "agent", text: "" }]);
    try {
      await streamEvents<AgentEvent>("/agent/chat", { method: "POST", body: { message, plan_id: published.id } }, handle);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The agent run failed");
    } finally {
      setRunning(false);
    }
  }

  function toggleVoice() {
    const Ctor = (window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => RecognitionLike }).webkitSpeechRecognition;
    if (!Ctor) return toast.info("Voice input is not supported in this browser. Type your request instead.");
    if (listening) return recognition.current?.stop();
    const instance = new Ctor();
    instance.lang = "en-IN";
    instance.interimResults = false;
    instance.onresult = (event) => setInput(event.results[0][0].transcript);
    instance.onend = () => setListening(false);
    recognition.current = instance;
    setListening(true);
    instance.start();
  }

  async function tryAlternative(message: ChatMessage, option: Alternative) {
    if (!published) return;
    const ops = [...(message.baseOps ?? []), ...option.ops];
    const toastId = toast.loading(`Solving ${option.label}…`);
    try {
      const { job_id } = await api<{ job_id: string }>("/scenarios", { method: "POST", body: { name: option.title.slice(0, 60), ops, base_plan_id: published.id } });
      let planId: number | undefined;
      await streamEvents<JobEvent>("/solve/stream", { params: { job_id } }, (e) => {
        if (e.type === "done") planId = e.plan_id;
        if (e.type === "error") throw new Error(e.message);
      });
      if (!planId) throw new Error("No plan was produced");
      const [detail, diff] = await Promise.all([api<PlanDetail>(`/plans/${planId}`), api<Diff>(`/plans/${published.id}/diff/${planId}`)]);
      setProposal({ status: "ok", plan_id: planId, version: detail.version, hard_count: detail.hard_violations, hard_violations: [], soft_count: detail.soft_violations, relaxed: detail.relaxed, kpis: detail.kpis, health: detail.kpis.health!, diff });
      toast.success(`${option.label} is ready to review`, { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That option failed", { id: toastId });
    }
  }

  async function act(kind: "apply" | "discard" | "submit") {
    if (!proposal) return;
    try {
      if (kind === "discard") await api(`/agent/proposals/${proposal.plan_id}/discard`, { method: "POST" });
      else {
        if (kind === "apply" || kind === "submit") await api(`/agent/proposals/${proposal.plan_id}/apply`, { method: "POST" }).catch(() => undefined);
        if (kind === "submit") {
          const detail = await api<PlanDetail>(`/plans/${proposal.plan_id}`);
          await api(`/plans/${proposal.plan_id}/submit`, { method: "POST", headers: { "If-Match": String(detail.row_version) } });
        }
      }
      toast.success(kind === "apply" ? "Applied as a draft plan" : kind === "discard" ? "Proposal discarded" : "Submitted for approval");
      if (kind !== "apply") setProposal(null);
      client.invalidateQueries({ queryKey: ["plans"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed");
    }
  }

  const modeLabel = mode === "live" ? "Gemini live" : mode === "degraded" ? "Gemini degraded" : mode ? "Offline parser" : "";

  return (
    <div>
      <PageHeader
        eyebrow="Plan"
        title="Copilot"
        description="Describe a change in plain words, typed or spoken. The agent plans, calls tools, verifies with the independent validator and proposes. Only you can apply, submit or publish."
        actions={modeLabel && <Pill tone={mode === "live" ? "good" : mode === "degraded" ? "warn" : "neutral"} dot>{modeLabel}</Pill>}
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <section className="surface rise-1 flex h-[calc(100vh-15rem)] min-h-[520px] flex-col overflow-hidden">
          <header className="flex items-center gap-3 border-b px-5 py-3.5">
            <LogoMark className="size-8" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">Planning agent</div>
              <div className="text-xs text-muted-foreground">{published ? `Working on published plan v${published.version}` : "Waiting for a published plan"}</div>
            </div>
            {running && (
              <Pill tone="info">
                <Loader2 className="size-3 animate-spin" /> Working
              </Pill>
            )}
          </header>

          <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
            {messages.length === 0 && (
              <div className="mx-auto max-w-xl pt-2">
                <h2 className="font-display text-[26px] leading-tight">
                  What should we <span className="text-gradient">change</span> in the plan?
                </h2>
                <p className="mt-2 text-[13.5px] text-muted-foreground">Pick a starting point or type your own request below.</p>
                <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s.text} onClick={() => send(s.text)} disabled={!published} className="group rounded-xl border bg-card p-3.5 text-left shadow-xs transition hover:-translate-y-0.5 hover:border-brand/50 hover:shadow-card disabled:opacity-50">
                      <div className="flex items-center gap-2 text-[13px] font-semibold">
                        <span className="flex size-7 items-center justify-center rounded-lg bg-brand-soft text-brand">
                          <s.icon className="size-4" />
                        </span>
                        {s.title}
                      </div>
                      <div className="mt-2 line-clamp-2 text-xs leading-snug text-muted-foreground">“{s.text}”</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) => (
              <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cn("flex gap-3", m.role === "user" && "justify-end")}>
                {m.role === "agent" && <LogoMark className="mt-0.5 size-7 shrink-0" />}
                <div className={cn("max-w-[86%] rounded-2xl px-4 py-2.5 text-[13.5px] leading-relaxed", m.role === "user" ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-tl-md border bg-muted/60")}>
                  {m.text || (running && m.role === "agent" ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null)}
                  {m.explanations && m.explanations.length > 0 && (
                    <ul className="mt-2.5 space-y-1.5 border-t pt-2.5 text-xs">
                      {m.explanations.map((e) => (
                        <li key={e} className="flex gap-2">
                          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warn" />
                          {e}
                        </li>
                      ))}
                    </ul>
                  )}
                  {m.clarify && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {m.clarify.map((option) => (
                        <Button key={option.label} size="xs" variant="outline" onClick={() => send(option.reply)}>
                          {option.label}
                        </Button>
                      ))}
                    </div>
                  )}
                  {m.alternatives && m.alternatives.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <div className="eyebrow">Ranked alternatives</div>
                      {m.alternatives.map((option, index) => (
                        <div key={option.label} className="rounded-xl border bg-card p-3 text-xs shadow-xs">
                          <div className="flex items-start gap-2.5">
                            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[11px] font-bold text-brand">{index + 1}</span>
                            <div className="min-w-0 flex-1">
                              <div className="text-[13px] font-semibold">{option.title}</div>
                              <div className="mt-0.5 text-muted-foreground">
                                {option.courses_moved} courses move · {option.students_affected} students affected
                              </div>
                            </div>
                            <Button size="xs" variant="outline" onClick={() => tryAlternative(m, option)}>
                              Try this
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </div>

          <form
            className="border-t bg-card/60 p-3.5"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <div className="flex items-center gap-1.5 rounded-xl border bg-card px-2 py-1.5 shadow-xs transition focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/25">
              <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. move CSE301 to Tuesday afternoon" disabled={running} aria-label="Message the planning agent" className="h-9 min-w-0 flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground" />
              <Button type="button" variant={listening ? "destructive" : "ghost"} size="icon" onClick={toggleVoice} aria-label="Voice input">
                {listening ? <MicOff /> : <Mic />}
              </Button>
              <Button type="submit" variant="brand" size="icon" disabled={running || !input.trim()} aria-label="Send">
                <ArrowUp />
              </Button>
            </div>
            <p className="mt-2 px-1 text-[11px] text-muted-foreground">The agent has no approve or publish tool. Every change lands as a draft for you to review.</p>
          </form>
        </section>

        <div className="space-y-5">
          <section className="surface rise-2 p-5">
            <SectionTitle title="Agent run" hint="Plan checklist, tool calls with rationale, then the independent check." />
            {!steps.length && !tools.length && <EmptyState compact title="Nothing running" hint="Send a request to watch the agent work." />}
            {steps.length > 0 && (
              <ol className="relative space-y-3 pl-1">
                <span className="absolute bottom-2 left-[11px] top-2 w-px bg-border" />
                {steps.map((step, index) => {
                  const done = progress > index || progress === 999;
                  const active = running && progress === index;
                  return (
                    <li key={step} className="relative flex items-start gap-3 text-[13px]">
                      <span className="relative z-10 mt-px bg-card">{done ? <CheckCircle2 className="size-[18px] text-good" /> : active ? <Loader2 className="size-[18px] animate-spin text-brand" /> : <Circle className="size-[18px] text-muted-foreground/60" />}</span>
                      <span className={cn("leading-snug", !done && !active && "text-muted-foreground", active && "font-medium")}>{step}</span>
                    </li>
                  );
                })}
              </ol>
            )}
            {tools.length > 0 && (
              <div className="mt-4 space-y-2">
                {tools.map((tool, index) => (
                  <motion.div key={index} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} className="rounded-xl border bg-muted/40 p-3 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 font-mono text-[12px] font-semibold">
                        <Wrench className="size-3.5 text-brand" /> {tool.name}
                      </span>
                      {tool.running ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : <span className="tabular-nums text-muted-foreground">{tool.latency} ms</span>}
                    </div>
                    {tool.rationale && <div className="mt-1.5 text-muted-foreground">{tool.rationale}</div>}
                    <pre className="mt-2 max-h-24 overflow-auto rounded-lg bg-card p-2 font-mono text-[10.5px] ring-1 ring-border">{JSON.stringify(tool.args, null, 1)}</pre>
                    {tool.summary && <div className={cn("mt-2 font-medium", tool.error ? "text-bad" : "text-foreground")}>→ {tool.summary}</div>}
                  </motion.div>
                ))}
              </div>
            )}
            {verify && (
              <div className={cn("mt-4 flex items-start gap-3 rounded-xl border p-3.5", verify.valid ? "border-good/40 bg-good/8" : "border-bad/40 bg-bad/8")}>
                {verify.valid ? <ShieldCheck className="mt-0.5 size-5 shrink-0 text-good" /> : <XCircle className="mt-0.5 size-5 shrink-0 text-bad" />}
                <div>
                  <div className="text-sm font-semibold">Independent validator: {verify.valid ? "0 hard violations" : `${verify.hard_count} hard violations`}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Clashes {verify.clashes} · health {verify.health} · stored KPIs {verify.kpis_match ? "match" : "differ"}
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className="surface rise-3 p-5">
            <SectionTitle title="Proposal" hint="A sandbox copy. The published plan does not change until you approve and publish." />
            {!proposal ? (
              <EmptyState compact title="No proposal yet" hint="Ask for a change to see its impact here." />
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone="neutral">Plan #{proposal.plan_id}</Pill>
                  <Pill tone={proposal.hard_count ? "bad" : "good"} dot>
                    {proposal.hard_count} hard violations
                  </Pill>
                  <Pill tone="info">Health {proposal.health?.score}</Pill>
                  {proposal.relaxed && <Pill tone="warn">Rule relaxed</Pill>}
                </div>
                {proposal.diff ? <DiffPanel diff={proposal.diff} slots={catalogue.data?.slots} /> : <p className="text-sm text-muted-foreground">No difference from the base plan.</p>}
                <div className="flex flex-wrap gap-2 border-t pt-4">
                  <Button variant="brand" onClick={() => act("apply")}>
                    <Check /> Apply to draft
                  </Button>
                  <Button variant="default" onClick={() => act("submit")}>
                    <Upload /> Submit for approval
                  </Button>
                  <Button variant="outline" onClick={() => act("discard")}>
                    <ThumbsDown /> Discard
                  </Button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
