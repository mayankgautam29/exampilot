"use client";

import { Archive, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { homeFor, useAuth } from "@/lib/store";

const DEMO = [
  { label: "Administrator", email: "admin@jklu.demo" },
  { label: "Faculty", email: "faculty01@jklu.demo" },
  { label: "Student", email: "student001@jklu.demo" },
];

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("admin@jklu.demo");
  const [password, setPassword] = useState("Demo@1234");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const user = await login(email, password);
      router.replace(homeFor(user.role));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <div className="bg-amber-500/15 px-4 py-2 text-center text-xs font-medium text-amber-800 dark:text-amber-200">SYNTHETIC DATA — every student, teacher and room in this demo is invented.</div>
      <div className="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="mb-1 flex items-center gap-2 text-lg font-semibold">
              <Archive className="size-5 text-emerald-500" /> ExamPilot
            </div>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>Agentic exam planning with human approval and a tamper-evident audit trail.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={submit} className="space-y-3">
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" autoComplete="username" />
              <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password" autoComplete="current-password" />
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
              </Button>
            </form>
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="size-3.5" /> One-click demo accounts (password Demo@1234)
              </div>
              <div className="flex flex-wrap gap-2">
                {DEMO.map((account) => (
                  <Button key={account.email} variant="outline" size="sm" onClick={() => setEmail(account.email)}>
                    {account.label}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
