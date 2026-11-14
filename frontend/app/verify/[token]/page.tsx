"use client";

import { BadgeCheck, ShieldX } from "lucide-react";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui-kit";
import { api } from "@/lib/api";

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
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {data?.valid ? <BadgeCheck className="size-6 text-emerald-500" /> : <ShieldX className="size-6 text-red-500" />}
            Hall ticket verification
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {isLoading && <Spinner label="Checking signature…" />}
          {data && !data.valid && <p className="text-red-600 dark:text-red-400">Invalid ticket. {data.reason}</p>}
          {data?.valid && (
            <>
              <p className="font-medium text-emerald-600 dark:text-emerald-400">Valid ticket for roll {data.roll_no}</p>
              <dl className="grid grid-cols-[110px_1fr] gap-y-1">
                <dt className="text-muted-foreground">Course</dt>
                <dd>{data.course_id} — {data.course}</dd>
                <dt className="text-muted-foreground">When</dt>
                <dd>{data.date}, {data.start}–{data.end}</dd>
                <dt className="text-muted-foreground">Room</dt>
                <dd>{data.room}</dd>
                <dt className="text-muted-foreground">Seat</dt>
                <dd>{data.seat}</dd>
              </dl>
              {!data.current && <p className="text-amber-600">{data.reason}</p>}
            </>
          )}
          <p className="pt-2 text-xs text-muted-foreground">SYNTHETIC DATA — demonstration only.</p>
        </CardContent>
      </Card>
    </div>
  );
}
