"use client";

import { useMutation } from "@tanstack/react-query";
import { BookOpen, Send, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui-kit";
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
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); submit(question); }}>
        <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about the examination regulations" />
        <Button type="submit" disabled={ask.isPending}><Send /> Ask</Button>
      </form>
      {!compact && <div className="flex flex-wrap gap-1.5">{EXAMPLES.map((e) => <button key={e} onClick={() => submit(e)} className="rounded-full border px-2.5 py-1 text-xs hover:bg-muted">{e}</button>)}</div>}
      {ask.isPending && <Spinner label="Searching the regulations…" />}
      {history.map((entry, i) => (
        <Card key={i} className={cn(!entry.grounded && "border-amber-500/40")}>
          <CardContent className="space-y-2 text-sm">
            <div className="font-medium">{entry.question}</div>
            <div className="flex items-start gap-2">
              {entry.grounded ? <BookOpen className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />}
              <div>
                <p>{entry.answer}</p>
                {entry.note && <p className="mt-1 text-xs text-muted-foreground">{entry.note}</p>}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {entry.citations.map((c) => <Badge key={c} variant="secondary">{c}</Badge>)}
              <Badge variant="outline">{entry.grounded ? entry.mode : "refused: not in the regulations"}</Badge>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
