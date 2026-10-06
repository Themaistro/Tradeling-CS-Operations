"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, CalendarDays, ClipboardList, LogOut, Settings, Sparkles, Users } from "lucide-react";

const navigation = [
  { href: "/overview", label: "Overview", icon: BarChart3 },
  { href: "/schedule", label: "Schedule", icon: CalendarDays },
  { href: "/tasks", label: "Daily Tasks", icon: ClipboardList },
  { href: "/team", label: "Team", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await fetch("/api/auth", { method: "DELETE" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-[#f4f6fb] text-slate-950">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 border-r border-slate-200/80 bg-[#111827] text-white lg:flex lg:flex-col">
        <div className="border-b border-white/10 px-7 py-7">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-400 to-orange-600 shadow-lg shadow-orange-950/30">
            <Sparkles className="h-5 w-5" />
          </div>
          <p className="text-lg font-bold tracking-tight">CS Operations</p>
          <p className="mt-1 text-xs text-slate-400">Scheduling and daily workflow</p>
        </div>

        <nav className="flex-1 space-y-1.5 px-4 py-6">
          {navigation.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link key={href} href={href} className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition ${active ? "bg-white text-slate-950 shadow-sm" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}>
                <Icon className={`h-4.5 w-4.5 ${active ? "text-orange-500" : ""}`} />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-4">
          <button onClick={signOut} className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-slate-400 transition hover:bg-white/5 hover:text-white">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-20 flex h-18 items-center justify-between border-b border-slate-200/80 bg-white/90 px-5 backdrop-blur-xl md:px-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-500">Tradeling</p>
            <p className="text-sm font-semibold text-slate-700">Customer Service Operations</p>
          </div>
          <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-slate-50 px-3 py-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="text-xs font-semibold text-slate-600">System ready</span>
          </div>
        </header>
        <main className="px-5 py-7 md:px-8 md:py-9">{children}</main>
      </div>
    </div>
  );
}
