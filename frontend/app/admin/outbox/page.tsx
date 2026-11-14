"use client";

import { useQuery } from "@tanstack/react-query";
import { Mail, MessageCircle } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { EmptyState, LoadingBlock, PageHeader } from "@/components/ui-kit";
import { api } from "@/lib/api";

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
      <PageHeader title="Outbox" description="Mock email and WhatsApp messages generated when a plan or hotfix is published. Nothing is ever sent to a real person." actions={data && <Badge variant="outline">{data.total} messages</Badge>} />
      <div className="mb-3 flex flex-wrap gap-2">
        <select className="h-8 rounded-lg border bg-background px-2 text-sm" value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="">All channels</option><option value="email">Email</option><option value="whatsapp">WhatsApp</option>
        </select>
        <Input placeholder="Recipient" value={to} onChange={(e) => setTo(e.target.value)} className="max-w-56" />
      </div>
      {isLoading ? <LoadingBlock rows={5} /> : !data?.items.length ? <EmptyState title="Nothing has been sent yet" hint="Publish a plan to fan out notifications." /> : (
        <div className="space-y-1.5">
          {data.items.map((m) => (
            <button key={m.id} onClick={() => setOpen(open === m.id ? null : m.id)} className="w-full rounded-lg border p-3 text-left text-sm hover:bg-muted/50">
              <div className="flex items-center gap-2">
                {m.channel === "email" ? <Mail className="size-4" /> : <MessageCircle className="size-4 text-emerald-500" />}
                <span className="font-medium">{m.subject}</span>
                <span className="text-xs text-muted-foreground">to {m.to}</span>
                <Badge variant="outline" className="ml-auto">plan #{m.plan_id}</Badge>
              </div>
              {open === m.id && <pre className="mt-2 whitespace-pre-wrap rounded bg-muted p-2 text-xs">{m.body}</pre>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
