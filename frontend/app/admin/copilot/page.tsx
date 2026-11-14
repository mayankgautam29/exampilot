"use client";

import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Bot, Check, CheckCircle2, Circle, Loader2, Mic, MicOff, Send, ShieldCheck, ThumbsDown, Upload, Wrench, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { DiffPanel } from "@/components/diff-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState, PageHeader } from "@/components/ui-kit";
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

const SUGGESTIONS = [
  "move CSE301 to 2026-12-14 afternoon",
  "room G1 unavailable on 2026-12-08 afternoon",
  "faculty F05 unavailable on 2026-12-09",
  "move math to 2026-12-08 morning",
  "pin CSE301 to 2026-12-08 morning and pin CSE302 to 2026-12-08 morning",
  "add 10 supplementary students to OE101 and regenerate seating",
  "Can students use calculators?",
  "How is the plan doing?",
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
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
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

  return (
    <div>
      <PageHeader title="Copilot" description="Describe a change in plain words, typed or spoken. The agent plans, calls tools, verifies with the independent validator and proposes — only you can apply, submit or publish." actions={mode && <Badge variant="outline">{mode === "live" ? "Gemini live" : mode === "degraded" ? "Gemini degraded" : "Offline parser"}</Badge>} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.1fr)]">
        <Card className="flex h-[70vh] min-h-[480px] flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="size-4" /> Conversation
            </CardTitle>
            <CardDescription>{published ? `Working on published plan v${published.version}` : "Waiting for a published plan"}</CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
            <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              {messages.length === 0 && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Try one of these:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {SUGGESTIONS.map((s) => (
                      <button key={s} onClick={() => send(s)} className="rounded-full border px-2.5 py-1 text-left text-xs hover:bg-muted">
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((m) => (
                <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={cn("max-w-[92%] rounded-xl px-3 py-2 text-sm", m.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted")}>
                  {m.text || (running && m.role === "agent" ? <Loader2 className="size-4 animate-spin" /> : null)}
                  {m.explanations && m.explanations.length > 0 && (
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">
                      {m.explanations.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  )}
                  {m.clarify && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {m.clarify.map((option) => (
                        <Button key={option.label} size="xs" variant="outline" onClick={() => send(option.reply)}>
                          {option.label}
                        </Button>
                      ))}
                    </div>
                  )}
                  {m.alternatives && m.alternatives.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      {m.alternatives.map((option) => (
                        <div key={option.label} className="rounded-lg border bg-background p-2 text-xs">
                          <div className="font-medium">{option.label}: {option.title}</div>
                          <div className="text-muted-foreground">{option.courses_moved} courses move, {option.students_affected} students affected</div>
                          <Button size="xs" className="mt-1.5" variant="secondary" onClick={() => tryAlternative(m, option)}>
                            Try this option
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. move CSE301 to Tuesday afternoon" disabled={running} />
              <Button type="button" variant={listening ? "destructive" : "outline"} size="icon" onClick={toggleVoice} aria-label="Voice input">
                {listening ? <MicOff /> : <Mic />}
              </Button>
              <Button type="submit" size="icon" disabled={running || !input.trim()} aria-label="Send">
                <Send />
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wrench className="size-4" /> Agent run
            </CardTitle>
            <CardDescription>Plan checklist, tool calls with their rationale, then the independent check.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!steps.length && !tools.length && <EmptyState title="Nothing running" hint="Send a request to watch the agent work." />}
            {steps.length > 0 && (
              <ol className="space-y-1.5">
                {steps.map((step, index) => {
                  const done = progress > index || progress === 999;
                  const active = running && progress === index;
                  return (
                    <li key={step} className="flex items-start gap-2 text-sm">
                      {done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : active ? <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                      <span className={cn(!done && !active && "text-muted-foreground")}>{step}</span>
                    </li>
                  );
                })}
              </ol>
            )}
            {tools.map((tool, index) => (
              <motion.div key={index} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} className="rounded-lg border p-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-medium">{tool.name}</span>
                  {tool.running ? <Loader2 className="size-3.5 animate-spin" /> : <span className="text-muted-foreground">{tool.latency} ms</span>}
                </div>
                {tool.rationale && <div className="mt-1 italic text-muted-foreground">“{tool.rationale}”</div>}
                <pre className="mt-1.5 max-h-24 overflow-auto rounded bg-muted p-1.5 text-[10px]">{JSON.stringify(tool.args, null, 1)}</pre>
                {tool.summary && <div className={cn("mt-1.5", tool.error ? "text-red-600" : "text-foreground")}>→ {tool.summary}</div>}
              </motion.div>
            ))}
            {verify && (
              <div className={cn("flex items-start gap-2 rounded-lg border p-2.5 text-sm", verify.valid ? "border-emerald-500/40 bg-emerald-500/5" : "border-red-500/40 bg-red-500/5")}>
                {verify.valid ? <ShieldCheck className="mt-0.5 size-4 text-emerald-500" /> : <XCircle className="mt-0.5 size-4 text-red-500" />}
                <div>
                  <div className="font-medium">Independent validator: {verify.valid ? "0 hard violations" : `${verify.hard_count} hard violations`}</div>
                  <div className="text-xs text-muted-foreground">Clashes {verify.clashes} · health {verify.health} · stored KPIs {verify.kpis_match ? "match" : "differ"}</div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Proposal</CardTitle>
            <CardDescription>A sandbox copy. The published plan does not change until you approve and publish.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!proposal ? (
              <EmptyState title="No proposal yet" hint="Ask for a change to see the impact here." />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="outline">plan #{proposal.plan_id}</Badge>
                  <Badge className={cn("border-0", proposal.hard_count ? "bg-red-500/15 text-red-700" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300")}>{proposal.hard_count} hard violations</Badge>
                  <Badge variant="secondary">health {proposal.health?.score}</Badge>
                  {proposal.relaxed && <Badge className="border-0 bg-amber-500/15 text-amber-700">rule relaxed</Badge>}
                </div>
                {proposal.diff ? <DiffPanel diff={proposal.diff} slots={catalogue.data?.slots} /> : <p className="text-sm text-muted-foreground">No difference from the base plan.</p>}
                <div className="flex flex-wrap gap-2 border-t pt-3">
                  <Button size="sm" onClick={() => act("apply")}>
                    <Check /> Apply to draft
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => act("submit")}>
                    <Upload /> Submit for approval
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => act("discard")}>
                    <ThumbsDown /> Discard
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
