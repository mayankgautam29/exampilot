"use client";

import { Command } from "cmdk";
import { motion, useReducedMotion } from "framer-motion";
import { Activity, BarChart3, Bot, CalendarDays, ChevronRight, ClipboardCheck, FlaskConical, Gauge, LayoutGrid, LogOut, Mail, Menu, Moon, PanelLeftClose, PanelLeftOpen, ScrollText, Search, ShieldCheck, Siren, Sun, UserCheck, Users, X } from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Wordmark } from "@/components/logo";
import { Ticker } from "@/components/motion";
import { Pill, Spinner } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { useAiStatus, usePlans } from "@/lib/hooks";
import { homeFor, useAuth } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { PlanSummary, Role } from "@/lib/types";

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  badge?: "approvals";
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV: Record<Role, NavGroup[]> = {
  admin: [
    { title: "Overview", items: [{ href: "/admin", label: "Command Center", icon: Gauge }] },
    {
      title: "Plan",
      items: [
        { href: "/admin/copilot", label: "Copilot", icon: Bot },
        { href: "/admin/timetable", label: "Timetable", icon: CalendarDays },
        { href: "/admin/seating", label: "Seating Studio", icon: LayoutGrid },
        { href: "/admin/invigilation", label: "Invigilation", icon: UserCheck },
      ],
    },
    {
      title: "Simulate and respond",
      items: [
        { href: "/admin/scenarios", label: "Scenario Lab", icon: FlaskConical },
        { href: "/admin/disruptions", label: "Disruptions", icon: Siren },
      ],
    },
    {
      title: "Govern",
      items: [
        { href: "/admin/approvals", label: "Approvals", icon: ClipboardCheck, badge: "approvals" },
        { href: "/admin/regulations", label: "Regulations Q&A", icon: ScrollText },
        { href: "/admin/audit", label: "Audit trail", icon: ShieldCheck },
      ],
    },
    {
      title: "Insights",
      items: [
        { href: "/admin/benchmark", label: "Benchmark", icon: BarChart3 },
        { href: "/admin/outbox", label: "Outbox", icon: Mail },
      ],
    },
  ],
  faculty: [{ title: "Workspace", items: [{ href: "/faculty", label: "My duties", icon: UserCheck }] }],
  student: [{ title: "Workspace", items: [{ href: "/student", label: "My exams", icon: Users }] }],
};

const COLLAPSE_KEY = "exampilot-sidebar-collapsed";

function initials(email: string): string {
  return email.slice(0, 2).toUpperCase();
}

function AiBadge() {
  const { data } = useAiStatus();
  if (!data) return null;
  const tone = data.mode === "live" ? "good" : data.mode === "degraded" ? "warn" : "neutral";
  const used = Math.min(100, Math.round((100 * data.calls_today) / Math.max(1, data.daily_limit)));
  return (
    <div className="hidden items-center gap-2 lg:flex" title={data.model ?? "Deterministic offline mode"}>
      <Pill tone={tone} dot>
        <Activity className="size-3" /> AI {data.mode}
      </Pill>
      {data.mode !== "offline" && (
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground tabular-nums" title={`${data.calls_today} of ${data.daily_limit} daily calls used`}>
          <div className="h-2 w-14 overflow-hidden border-[1.5px] border-edge bg-card">
            <div className={cn("h-full", used > 90 ? "bg-bad" : used > 70 ? "bg-warn" : "bg-good")} style={{ width: `${used}%` }} />
          </div>
          {data.calls_today}/{data.daily_limit}
        </div>
      )}
    </div>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button variant="outline" size="icon" aria-label="Toggle theme" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
      <Sun className="hidden size-4 dark:block" />
      <Moon className="size-4 dark:hidden" />
    </Button>
  );
}

const GROUP_HEADING = "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.14em] [&_[cmdk-group-heading]]:text-muted-foreground";
const PALETTE_ITEM = "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium aria-selected:bg-marker aria-selected:text-ink";

function Palette({ groups, open, setOpen }: { groups: NavGroup[]; open: boolean; setOpen: (open: boolean) => void }) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const { logout } = useAuth();
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(!open);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, setOpen]);
  if (!open) return null;
  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/50 p-4 pt-[14vh]" onClick={() => setOpen(false)}>
      <Command className="rise hard-lg w-full max-w-lg overflow-hidden rounded-lg bg-popover text-popover-foreground" onClick={(e) => e.stopPropagation()} label="Command palette">
        <div className="flex items-center gap-2 border-b-[1.5px] border-edge px-4">
          <Search className="size-4 text-muted-foreground" />
          <Command.Input autoFocus placeholder="Jump to a page or run an action…" className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
          <kbd className="rounded-sm border-[1.5px] border-edge px-1.5 py-0.5 font-mono text-[10px]">esc</kbd>
        </div>
        <Command.List className="max-h-80 overflow-auto p-2">
          <Command.Empty className="p-6 text-center text-sm text-muted-foreground">Nothing matches that.</Command.Empty>
          {groups.map((group) => (
            <Command.Group key={group.title} heading={group.title} className={GROUP_HEADING}>
              {group.items.map((item) => (
                <Command.Item key={item.href} value={`${group.title} ${item.label}`} onSelect={() => go(item.href)} className={PALETTE_ITEM}>
                  <item.icon className="size-4" /> {item.label}
                </Command.Item>
              ))}
            </Command.Group>
          ))}
          <Command.Group heading="Actions" className={GROUP_HEADING}>
            <Command.Item
              value="toggle theme dark light"
              onSelect={() => {
                setTheme(resolvedTheme === "dark" ? "light" : "dark");
                setOpen(false);
              }}
              className={PALETTE_ITEM}
            >
              <Moon className="size-4" /> Toggle light or dark theme
            </Command.Item>
            <Command.Item value="sign out log out" onSelect={logout} className={PALETTE_ITEM}>
              <LogOut className="size-4" /> Sign out
            </Command.Item>
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}

function SidebarNav({ groups, pathname, pending, collapsed, onNavigate }: { groups: NavGroup[]; pathname: string; pending: number; collapsed?: boolean; onNavigate?: () => void }) {
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main">
      {groups.map((group, index) => (
        <div key={group.title} className={cn(index > 0 && (collapsed ? "mt-3 border-t border-sidebar-border pt-3" : "mt-6"))}>
          {!collapsed && <div className="mb-2 px-3 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-sidebar-muted">{group.title}</div>}
          <div className="space-y-1">
            {group.items.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  title={collapsed ? item.label : undefined}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex h-10 items-center gap-3 rounded-md border-[1.5px] border-transparent px-3 text-[14px] font-medium text-sidebar-foreground/75 transition-all duration-150 hover:translate-x-0.5 hover:bg-white/8 hover:text-sidebar-foreground",
                    collapsed && "justify-center px-0 hover:translate-x-0",
                    active && "border-sidebar-foreground bg-sidebar-accent font-semibold text-sidebar-accent-foreground shadow-[3px_3px_0_var(--marker)] hover:translate-x-0 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                >
                  <item.icon className={cn("size-[18px] shrink-0 transition-colors", active ? "text-brand" : "text-sidebar-muted group-hover:text-sidebar-primary")} />
                  {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                  {item.badge === "approvals" && pending > 0 && (collapsed ? <span className="absolute right-1.5 top-1.5 size-2.5 bg-marker" /> : <span className="flex h-5 min-w-5 items-center justify-center rounded-sm bg-sidebar-primary px-1.5 font-mono text-[11px] font-semibold text-sidebar-primary-foreground">{pending}</span>)}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function LiveCard({ published }: { published: PlanSummary }) {
  return (
    <Link href="/admin" className="mx-3 mb-3 block rounded-md border-[1.5px] border-dashed border-sidebar-border p-3 transition hover:border-sidebar-primary">
      <div className="flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-sidebar-muted">
        <span className="pulse-dot size-2 rounded-full bg-good" /> Live plan
      </div>
      <div className="mt-1.5 flex items-baseline justify-between">
        <span className="text-[22px] font-bold leading-none tabular-nums text-sidebar-foreground">v{published.version}</span>
        <span className="font-mono text-[11px] text-sidebar-muted">health {published.kpis.health?.score ?? "—"}</span>
      </div>
    </Link>
  );
}

function UserCard({ email, role, onLogout, collapsed }: { email: string; role: Role; onLogout: () => void; collapsed?: boolean }) {
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-2 border-t border-sidebar-border p-3">
        <div className="flex size-8 items-center justify-center rounded-sm bg-sidebar-primary font-mono text-[11px] font-semibold text-sidebar-primary-foreground" title={email}>
          {initials(email)}
        </div>
        <button onClick={onLogout} aria-label="Sign out" className="rounded-md p-1.5 text-sidebar-muted transition hover:bg-white/10 hover:text-sidebar-foreground">
          <LogOut className="size-4" />
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2.5 border-t border-sidebar-border p-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-sidebar-primary font-mono text-[12px] font-semibold text-sidebar-primary-foreground">{initials(email)}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-sidebar-foreground">{email}</div>
        <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-sidebar-muted">{role}</div>
      </div>
      <button onClick={onLogout} aria-label="Sign out" className="rounded-md p-1.5 text-sidebar-muted transition hover:bg-white/10 hover:text-sidebar-foreground">
        <LogOut className="size-4" />
      </button>
    </div>
  );
}

export function AppShell({ children, allow }: { children: ReactNode; allow: Role }) {
  const { user, loading, hydrate, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const plans = usePlans(undefined, user?.role === "admin");

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
      } catch {}
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    else if (user.role !== allow) router.replace(homeFor(user.role));
  }, [loading, user, allow, router]);

  function toggleCollapsed() {
    setCollapsed((value) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, value ? "0" : "1");
      } catch {}
      return !value;
    });
  }

  if (loading || !user || user.role !== allow) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Loading…" />
      </div>
    );
  }
  const groups = NAV[user.role];
  const flat = groups.flatMap((group) => group.items.map((item) => ({ ...item, group: group.title })));
  const current = flat.find((item) => item.href === pathname);
  const pending = plans.data?.filter((p) => p.status === "PENDING_APPROVAL").length ?? 0;
  const published = plans.data?.find((p) => p.status === "PUBLISHED");
  const kpis = published?.kpis;
  const ticker = kpis
    ? [`Published v${published.version}`, `Health ${kpis.health?.score ?? "n/a"}`, `${kpis.hard_violations} hard violations`, `${kpis.students} students`, `${kpis.courses} courses`, `Seating risk ${kpis.seating_risk_index}`, `Duty spread ${kpis.duties_min}-${kpis.duties_max}`, `${pending} awaiting approval`, "Nothing is published without a human"]
    : null;

  return (
    <div className="flex min-h-screen">
      <aside className={cn("sticky top-0 hidden h-screen shrink-0 flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-200 md:flex", collapsed ? "w-[72px]" : "w-[272px]")}>
        <Link href={homeFor(user.role)} className={cn("flex h-16 shrink-0 items-center border-b border-sidebar-border", collapsed ? "justify-center" : "px-5")} aria-label="ExamPilot home">
          {collapsed ? <Wordmark onDark className="[&>span:last-child]:hidden" /> : <Wordmark onDark />}
        </Link>
        <SidebarNav groups={groups} pathname={pathname} pending={pending} collapsed={collapsed} />
        {published && user.role === "admin" && !collapsed && <LiveCard published={published} />}
        <UserCard email={user.email} role={user.role} onLogout={logout} collapsed={collapsed} />
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-ink/60" onClick={() => setDrawerOpen(false)} />
          <aside className="rise absolute inset-y-0 left-0 flex w-72 flex-col bg-sidebar text-sidebar-foreground shadow-[6px_0_0_var(--hard)]">
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-sidebar-border px-5">
              <Wordmark onDark />
              <button onClick={() => setDrawerOpen(false)} aria-label="Close menu" className="rounded-md p-1.5 text-sidebar-muted hover:bg-white/10">
                <X className="size-5" />
              </button>
            </div>
            <SidebarNav groups={groups} pathname={pathname} pending={pending} onNavigate={() => setDrawerOpen(false)} />
            <UserCard email={user.email} role={user.role} onLogout={logout} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2.5 border-b-[1.5px] border-edge bg-background/95 px-4 backdrop-blur md:px-6">
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu" onClick={() => setDrawerOpen(true)}>
            <Menu className="size-5" />
          </Button>
          <Button variant="ghost" size="icon" className="hidden md:inline-flex" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={toggleCollapsed}>
            {collapsed ? <PanelLeftOpen className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}
          </Button>
          <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground sm:flex">
            <span className="hidden lg:inline">{current?.group ?? "Workspace"}</span>
            <ChevronRight className="hidden size-3 lg:block" />
            <span className="truncate whitespace-nowrap font-semibold text-foreground">{current?.label ?? "Overview"}</span>
          </nav>
          <div className="flex-1" />
          <button onClick={() => setPaletteOpen(true)} className="lift hard-sm hidden h-9 w-60 items-center gap-2 rounded-md bg-card px-3 text-sm text-muted-foreground sm:flex" aria-label="Search">
            <Search className="size-4" />
            <span className="flex-1 text-left">Search or jump to…</span>
            <kbd className="rounded-sm border border-edge/60 px-1.5 font-mono text-[10px] text-foreground">Ctrl K</kbd>
          </button>
          <Button variant="outline" size="icon" className="sm:hidden" aria-label="Search" onClick={() => setPaletteOpen(true)}>
            <Search className="size-4" />
          </Button>
          <AiBadge />
          <ThemeToggle />
        </header>
        {ticker && user.role === "admin" && <Ticker items={ticker} />}
        <Palette groups={groups} open={paletteOpen} setOpen={setPaletteOpen} />
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-7 md:px-8">
          <motion.div key={pathname} initial={reduce ? false : { opacity: 0.4, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}>
            {children}
          </motion.div>
        </main>
        <footer className="border-t-[1.5px] border-edge px-4 py-3 text-center font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground md:px-8">
          <span className="font-semibold text-foreground">Synthetic data</span> · demonstration only · no real student, staff or institutional records
        </footer>
      </div>
    </div>
  );
}
