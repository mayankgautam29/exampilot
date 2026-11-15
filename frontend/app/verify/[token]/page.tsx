"use client";

import { BadgeCheck, ShieldX } from "lucide-react";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { Wordmark } from "@/components/logo";
import { Spinner } from "@/components/ui-kit";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Ticket {
  valid: boolean;
  current?: boolean;
  roll_no?: string;
  course_id?: string;
  course?: string;
  date?: string;
  start?: string;
  end?: string;
  room?: string;
  seat?: string;
  reason: string;
}

export default function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { data, isLoading } = useQuery({ queryKey: ["verify", token], queryFn: () => api<Ticket>(`/verify/${encodeURIComponent(token)}`) });
  const rows = data?.valid
    ? [
        ["Course", `${data.course_id} · ${data.course}`],
        ["When", `${data.date}, ${data.start}–${data.end}`],
        ["Room", data.room],
        ["Seat", data.seat],
      ]
    : [];
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-deep p-5">
      <div className="hazard absolute inset-x-0 top-0 h-2" />
      <div className="rise relative w-full max-w-md">
        <div className="mb-6 flex justify-center text-deep-foreground">
          <Wordmark onDark />
        </div>
        <div className="overflow-hidden rounded-lg border-[1.5px] border-deep-foreground bg-card shadow-[6px_6px_0_var(--marker)]">
          <div className={cn("flex items-center gap-3 border-b-[1.5px] border-edge px-6 py-5 text-white", isLoading ? "bg-muted-foreground" : data?.valid ? "bg-good" : "bg-bad")}>
            {data?.valid ? <BadgeCheck className="size-8" /> : <ShieldX className="size-8" />}
            <div>
              <div className="text-xs font-mono font-semibold uppercase tracking-[0.14em] opacity-90">Hall ticket verification</div>
              <div className="font-display text-[26px] leading-tight">{isLoading ? "Checking signature…" : data?.valid ? `Valid ticket · roll ${data.roll_no}` : "Invalid ticket"}</div>
            </div>
          </div>
          <div className="space-y-4 p-6 text-sm">
            {isLoading && <Spinner label="Checking signature…" />}
            {data && !data.valid && <p className="text-bad">{data.reason}</p>}
            {data?.valid && (
              <>
                <dl className="hard-sm divide-y divide-border rounded-md">
                  {rows.map(([label, value]) => (
                    <div key={label} className="grid grid-cols-[100px_1fr] gap-3 px-4 py-3">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="font-medium">{value}</dd>
                    </div>
                  ))}
                </dl>
                {!data.current && <p className="rounded-xl bg-warn/12 px-4 py-3 text-warn-text">{data.reason}</p>}
              </>
            )}
            <p className="text-center text-xs text-muted-foreground">SYNTHETIC DATA · demonstration only</p>
          </div>
        </div>
      </div>
    </div>
  );
}
