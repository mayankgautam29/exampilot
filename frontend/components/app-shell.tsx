"use client";

import { Command } from "cmdk";
import { Activity, Archive, BarChart3, Bot, CalendarDays, ClipboardCheck, FlaskConical, Gauge, LayoutGrid, LogOut, Mail, Moon, ScrollText, Search, ShieldCheck, Sun, Siren, UserCheck, Users } from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui-kit";
import { useAiStatus } from "@/lib/hooks";
import { homeFor, useAuth } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/types";

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const NAV: Record<Role, NavItem[]> = {
  admin: [
    { href: "/admin", label: "Command Center", icon: Gauge },
    { href: "/admin/copilot", label: "Copilot", icon: Bot },
    { href: "/admin/timetable", label: "Timetable", icon: CalendarDays },
    { href: "/admin/seating", label: "Seating Studio", icon: LayoutGrid },
    { href: "/admin/invigilation", label: "Invigilation", icon: UserCheck },
    { href: "/admin/scenarios", label: "Scenario Lab", icon: FlaskConical },
    { href: "/admin/approvals", label: "Approvals", icon: ClipboardCheck },
    { href: "/admin/disruptions", label: "Disruptions", icon: Siren },
    { href: "/admin/regulations", label: "Regulations Q&A", icon: ScrollText },
    { href: "/admin/audit", label: "Audit", icon: ShieldCheck },
    { href: "/admin/benchmark", label: "Benchmark", icon: BarChart3 },
    { href: "/admin/outbox", label: "Outbox", icon: Mail },
  ],
  faculty: [{ href: "/faculty", label: "My duties", icon: UserCheck }],
  student: [{ href: "/student", label: "My exams", icon: Users }],
};

function AiBadge() {
  const { data } = useAiStatus();
  if (!data) return null;
  const tone = data.mode === "live" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : data.mode === "degraded" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-slate-500/15 text-slate-600 dark:text-slate-300";
  const used = Math.min(100, Math.round((100 * data.calls_today) / Math.max(1, data.daily_limit)));
  return (
    <div className="flex items-center gap-2">
      <Badge className={cn("border-0", tone)} title={data.model ?? "Deterministic offline mode"}>
        <Activity className="size-3" /> AI: {data.mode}
      </Badge>
      <div className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex" title={`${data.calls_today} of ${data.daily_limit} daily calls used`}>
        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
          <div className={cn("h-full", used > 90 ? "bg-red-500" : used > 70 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${used}%` }} />
        </div>
        {data.calls_today}/{data.daily_limit}
      </div>
    </div>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
      <Sun className="hidden size-4 dark:block" />
      <Moon className="size-4 dark:hidden" />
    </Button>
  );
}

function Palette({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-2 text-muted-foreground">
        <Search className="size-3.5" /> Search <kbd className="rounded border px-1 text-[10px]">⌘K</kbd>
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[15vh]" onClick={() => setOpen(false)}>
          <Command className="w-full max-w-md overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl" onClick={(e) => e.stopPropagation()} label="Command palette">
            <Command.Input autoFocus placeholder="Jump to a page…" className="w-full border-b bg-transparent px-4 py-3 text-sm outline-none" />
            <Command.List className="max-h-72 overflow-auto p-1">
              <Command.Empty className="p-4 text-center text-sm text-muted-foreground">No matches</Command.Empty>
              {items.map((item) => (
                <Command.Item
                  key={item.href}
                  value={item.label}
                  onSelect={() => {
                    setOpen(false);
                    router.push(item.href);
                  }}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm aria-selected:bg-muted"
                >
                  <item.icon className="size-4" /> {item.label}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </div>
      )}
    </>
  );
}

export function AppShell({ children, allow }: { children: ReactNode; allow: Role }) {
  const { user, loading, hydrate, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    else if (user.role !== allow) router.replace(homeFor(user.role));
  }, [loading, user, allow, router]);

  if (loading || !user || user.role !== allow) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Loading…" />
      </div>
    );
  }
  const items = NAV[user.role];
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r bg-sidebar p-3 md:flex">
        <Link href={homeFor(user.role)} className="mb-4 flex items-center gap-2 px-2 text-base font-semibold">
          <Archive className="size-5 text-emerald-500" /> ExamPilot
        </Link>
        <nav className="flex-1 space-y-0.5 overflow-auto">
          {items.map((item) => (
            <Link key={item.href} href={item.href} className={cn("flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground", pathname === item.href && "bg-muted font-medium text-foreground")}>
              <item.icon className="size-4" /> {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-2 border-t pt-3 text-xs text-muted-foreground">
          <div className="truncate font-medium text-foreground">{user.email}</div>
          <div className="capitalize">{user.role}</div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b bg-background/85 px-4 py-2 backdrop-blur">
          <div className="flex items-center gap-2 md:hidden">
            <Archive className="size-5 text-emerald-500" /> <span className="font-semibold">ExamPilot</span>
          </div>
          <div className="hidden md:block">
            <Palette items={items} />
          </div>
          <div className="flex items-center gap-2">
            <AiBadge />
            <ThemeToggle />
            <Button variant="ghost" size="icon" aria-label="Sign out" onClick={logout}>
              <LogOut className="size-4" />
            </Button>
          </div>
        </header>
        {user.role === "admin" && (
          <nav className="flex gap-1 overflow-x-auto border-b px-3 py-1.5 md:hidden">
            {items.map((item) => (
              <Link key={item.href} href={item.href} className={cn("shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground", pathname === item.href && "bg-muted text-foreground")}>
                {item.label}
              </Link>
            ))}
          </nav>
        )}
        <main className="flex-1 p-4 md:p-6">{children}</main>
        <footer className="border-t px-4 py-2 text-center text-xs text-muted-foreground">SYNTHETIC DATA — demonstration only. No real student, staff or institutional records are used.</footer>
      </div>
    </div>
  );
}
