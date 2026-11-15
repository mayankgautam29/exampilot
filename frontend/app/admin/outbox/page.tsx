"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Mail, MessageCircle, Search } from "lucide-react";
import { useState } from "react";
import { EmptyState, LoadingBlock, NativeSelect, PageHeader, Pill } from "@/components/ui-kit";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Message {
  id: number;
  plan_id: number;
  channel: string;
  to: string;
  subject: string;
  body: string;
  created_at: string;
}

export default function OutboxPage() {
  const [channel, setChannel] = useState("");
  const [to, setTo] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["outbox", channel, to], queryFn: () => api<{ total: number; items: Message[] }>("/outbox", { params: { channel, to, limit: 100 } }), refetchInterval: 15000 });
  return (
    <div>
      <PageHeader eyebrow="Insights" title="Outbox" description="Mock email and WhatsApp messages generated when a plan or hotfix is published. Nothing is ever sent to a real person." actions={data && <Pill tone="info">{data.total} messages</Pill>} />
      <div className="surface rise-1 mb-4 flex flex-wrap items-center gap-2.5 p-3.5">
        <NativeSelect aria-label="Channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="">All channels</option>
          <option value="email">Email</option>
          <option value="whatsapp">WhatsApp</option>
        </NativeSelect>
        <div className="relative min-w-52 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input placeholder="Recipient" aria-label="Recipient" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-sm shadow-xs outline-none transition focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30" />
        </div>
      </div>
      {isLoading ? (
        <LoadingBlock rows={5} />
      ) : !data?.items.length ? (
        <EmptyState title="Nothing has been sent yet" hint="Publish a plan to fan out notifications to students and faculty." />
      ) : (
        <div className="surface rise-2 divide-y overflow-hidden">
          {data.items.map((m) => (
            <div key={m.id}>
              <button onClick={() => setOpen(open === m.id ? null : m.id)} aria-expanded={open === m.id} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-muted/50">
                <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", m.channel === "email" ? "bg-info/12 text-info" : "bg-good/12 text-good-text")}>{m.channel === "email" ? <Mail className="size-4" /> : <MessageCircle className="size-4" />}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-semibold">{m.subject}</div>
                  <div className="text-xs text-muted-foreground">to {m.to}</div>
                </div>
                <Pill tone="neutral">plan #{m.plan_id}</Pill>
                <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open === m.id && "rotate-90")} />
              </button>
              {open === m.id && <pre className="whitespace-pre-wrap border-t bg-muted/30 px-5 py-4 font-sans text-[13px] leading-relaxed">{m.body}</pre>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
