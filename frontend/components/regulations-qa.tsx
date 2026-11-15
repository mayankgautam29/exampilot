"use client";

import { useMutation } from "@tanstack/react-query";
import { ArrowUp, BookOpen, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Pill, Spinner } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Answer {
  answer: string;
  note?: string;
  citations: string[];
  grounded: boolean;
  mode: string;
}

interface Entry extends Answer {
  question: string;
}

const EXAMPLES = ["How many exams can a student take in one day?", "Can I use my mobile phone in the exam hall?", "When must students report to the room?", "What is the exam fee?", "How do I apply for revaluation?"];

export function RegulationsQA({ compact }: { compact?: boolean }) {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<Entry[]>([]);
  const ask = useMutation({
    mutationFn: (q: string) => api<Answer>("/agent/regulations/ask", { method: "POST", body: { question: q } }),
    onSuccess: (data, q) => setHistory((h) => [{ ...data, question: q }, ...h]),
  });
  const submit = (q: string) => {
    if (q.trim()) ask.mutate(q.trim());
    setQuestion("");
  };
  return (
    <div className="space-y-4">
      <form
        className="flex items-center gap-1.5 rounded-xl border bg-card px-2 py-1.5 shadow-xs transition focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/25"
        onSubmit={(e) => {
          e.preventDefault();
          submit(question);
        }}
      >
        <BookOpen className="ml-2 size-4 shrink-0 text-muted-foreground" />
        <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about the examination regulations" aria-label="Question" className="h-9 min-w-0 flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground" />
        <Button type="submit" variant="brand" size="icon" disabled={ask.isPending || !question.trim()} aria-label="Ask">
          <ArrowUp />
        </Button>
      </form>
      {!compact && history.length === 0 && (
        <div>
          <div className="eyebrow mb-2">Try asking</div>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((e) => (
              <button key={e} onClick={() => submit(e)} className="rounded-full border bg-card px-3.5 py-1.5 text-left text-[13px] shadow-xs transition hover:border-brand/50 hover:bg-brand-soft">
                {e}
              </button>
            ))}
          </div>
        </div>
      )}
      {ask.isPending && <Spinner label="Searching the regulations…" />}
      {history.map((entry, i) => (
        <article key={i} className={cn("surface rise overflow-hidden", !entry.grounded && "border-warn/50")}>
          <div className="border-b bg-muted/40 px-5 py-3 text-[13.5px] font-semibold">{entry.question}</div>
          <div className="space-y-3 p-5 text-sm">
            <div className="flex items-start gap-3">
              <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg", entry.grounded ? "bg-good/12 text-good-text" : "bg-warn/15 text-warn-text")}>{entry.grounded ? <BookOpen className="size-4" /> : <ShieldAlert className="size-4" />}</span>
              <div>
                <p className="leading-relaxed">{entry.answer}</p>
                {entry.note && <p className="mt-1.5 text-xs text-muted-foreground">{entry.note}</p>}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 pl-10">
              {entry.citations.map((c) => (
                <Pill key={c} tone="brand">
                  {c}
                </Pill>
              ))}
              <Pill tone={entry.grounded ? "neutral" : "warn"}>{entry.grounded ? entry.mode : "refused: not in the regulations"}</Pill>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
