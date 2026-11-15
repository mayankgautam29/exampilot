"use client";

import { ArrowUp, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { LogoMark } from "@/components/logo";
import { SectionTitle } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { streamEvents } from "@/lib/api";
import type { AgentEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Message {
  role: "user" | "agent";
  text: string;
}

export function ChatPanel({ title, description, suggestions }: { title: string; description: string; suggestions: string[] }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messages.length) bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || running) return;
    setInput("");
    setRunning(true);
    setMessages((all) => [...all, { role: "user", text: message }, { role: "agent", text: "" }]);
    try {
      await streamEvents<AgentEvent>("/me/chat", { method: "POST", body: { message } }, (event) => {
        if (event.type === "answer_delta") setMessages((all) => all.map((m, i) => (i === all.length - 1 ? { ...m, text: m.text + String(event.text) } : m)));
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The assistant is unavailable");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="surface p-5">
      <div className="flex items-start gap-3">
        <LogoMark className="size-8 shrink-0" />
        <SectionTitle title={title} hint={description} />
      </div>
      <div className="mt-4 max-h-72 min-h-20 space-y-3 overflow-y-auto">
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button key={s} onClick={() => send(s)} className="rounded-full border bg-card px-3 py-1.5 text-left text-xs shadow-xs transition hover:border-brand/50 hover:bg-brand-soft">
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={cn("max-w-[90%] rounded-2xl px-4 py-2.5 text-[13.5px] leading-relaxed", m.role === "user" ? "ml-auto rounded-br-md bg-primary text-primary-foreground" : "rounded-tl-md border bg-muted/60")}>
            {m.text || <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <form
        className="mt-3 flex items-center gap-1.5 rounded-xl border bg-card px-2 py-1.5 shadow-xs transition focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/25"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask a question" disabled={running} aria-label="Ask a question" className="h-9 min-w-0 flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground" />
        <Button type="submit" variant="brand" size="icon" disabled={running || !input.trim()} aria-label="Send">
          <ArrowUp />
        </Button>
      </form>
    </section>
  );
}
