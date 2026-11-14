"use client";

import { Loader2, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
    bottom.current?.scrollIntoView({ behavior: "smooth" });
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
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="max-h-72 min-h-24 space-y-2 overflow-y-auto">
          {messages.length === 0 && (
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full border px-2.5 py-1 text-xs hover:bg-muted">{s}</button>
              ))}
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={cn("max-w-[90%] rounded-xl px-3 py-2 text-sm", m.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted")}>
              {m.text || <Loader2 className="size-4 animate-spin" />}
            </div>
          ))}
          <div ref={bottom} />
        </div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask a question" disabled={running} />
          <Button type="submit" size="icon" disabled={running || !input.trim()} aria-label="Send"><Send /></Button>
        </form>
      </CardContent>
    </Card>
  );
}
