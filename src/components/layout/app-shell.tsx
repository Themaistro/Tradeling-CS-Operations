"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  LogOut,
  Send,
  Settings,
  Sparkles,
  Building2,
  Users,
} from "lucide-react";
import { AppFeedbackHost, showAppNotification } from "@/components/ui/app-feedback";

const navigation = [
  { href: "/overview", label: "Overview", icon: BarChart3 },
  { href: "/team", label: "Team", icon: Users },
  { href: "/operations", label: "Operations", icon: Building2 },
  { href: "/schedule", label: "Schedule", icon: CalendarDays },
  { href: "/tasks", label: "Daily Tasks", icon: ClipboardList },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [identity, setIdentity] = useState({ organizationName: "Tradeling", workspaceName: "Customer Service Operations" });
  const [posting, setPosting] = useState(false);
  const [setupReady, setSetupReady] = useState<boolean | null>(null);
  const [preview, setPreview] = useState<{ blocks: { type: string; text?: { text: string } }[]; mentions: Record<string,string> } | null>(null);
  async function previewToday() {
    try {
      const response = await fetch("/api/slack/post", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preview: true }) });
      const body = await response.json();
      if (response.ok) setPreview(body); else showAppNotification({ kind: "error", message: body.error || "Preview could not be prepared." });
    } catch { showAppNotification({ kind: "error", message: "Preview could not be loaded. Check your connection." }); }
  }

  useEffect(() => {
    const loadIdentity = () => fetch("/api/settings")
      .then((response) => {
        if (response.status === 401) {
          // A fresh navigation also clears any cached protected route content.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.assign("/login");
        }
        return response.ok ? response.json() : null;
      })
      .then((data) => {
        if (data?.settings?.organizationName && data?.settings?.workspaceName) {
          setIdentity({ organizationName: data.settings.organizationName, workspaceName: data.settings.workspaceName });
        }
        if (data?.readiness) setSetupReady(Boolean(data.readiness.ready));
      })
      .catch(() => undefined);
    void loadIdentity();
    window.addEventListener("cs-identity-updated", loadIdentity);
    return () => window.removeEventListener("cs-identity-updated", loadIdentity);
  }, [pathname]);

  async function signOut() {
    await fetch("/api/auth", { method: "DELETE" });
    router.replace("/login");
    router.refresh();
  }

  async function postTodayToSlack(resend = false) {
    if (posting) return;
    setPosting(true);
    try {
    const response = await fetch("/api/slack/post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // The server determines "today" using the timezone configured in Settings.
      body: JSON.stringify({ resend }),
    });
    const result = await response.json();
    if (result.code === "ALREADY_POSTED") {
      setPosting(false);
      const { requestAppConfirmation } = await import("@/components/ui/app-feedback");
      if (await requestAppConfirmation({ title: "Resend today's briefing?", message: "The briefing has already been posted. Resending sends another channel post and personal briefings.", confirmLabel: "Resend briefing" })) await postTodayToSlack(true);
      return;
    }
    const directMessages = result.directMessages;
    const deliverySummary = directMessages
      ? ` ${directMessages.sent} personal briefing${directMessages.sent === 1 ? " was" : "s were"} delivered.${directMessages.failed || directMessages.skipped ? ` ${directMessages.failed + directMessages.skipped} could not be delivered; check those agents’ Slack member IDs and the bot’s im:write permission.` : ""}`
      : "";
    showAppNotification({
      kind: response.ok ? "success" : "error",
      message: response.ok
        ? `Today’s team briefing was posted to Slack.${deliverySummary}`
        : result.error || "Slack posting failed.",
    });
    } catch { showAppNotification({ kind: "error", message: "Posting could not be confirmed. Check posting history before retrying." }); }
    finally { setPosting(false); }
  }

  return (
    <div className="min-h-screen bg-[#f4f6fb] text-slate-950">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 border-r border-slate-200/80 bg-[#111827] text-white lg:flex lg:flex-col">
        <div className="border-b border-white/10 px-7 py-7">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-400 to-orange-600 shadow-lg shadow-orange-950/30">
            <Sparkles className="h-5 w-5" />
          </div>
          <p className="text-lg font-bold tracking-tight">CS Operations</p>
          <p className="mt-1 text-xs text-slate-400">
            Scheduling and daily workflow
          </p>
        </div>

        <nav className="flex-1 space-y-1.5 px-4 py-6">
          {navigation.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition ${active ? "bg-white text-slate-950 shadow-sm" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}
              >
                <Icon
                  className={`h-4.5 w-4.5 ${active ? "text-orange-500" : ""}`}
                />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-4">
          <button
            onClick={signOut}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-slate-400 transition hover:bg-white/5 hover:text-white"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>

      <AppFeedbackHost />
      {preview && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-5"><div role="dialog" aria-modal="true" aria-label="Briefing preview" className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-6 shadow-2xl"><div className="mb-5 flex justify-between gap-3"><div><h2 className="text-xl font-bold">Today’s briefing preview</h2><p className="mt-1 text-sm text-slate-500">Review the saved plan. No Slack messages are sent by this preview.</p></div><button onClick={()=>setPreview(null)} className="rounded-lg border px-3 py-2 text-sm font-bold">Close</button></div>{preview.blocks.map((block,index)=>block.type === "divider" ? <hr key={index} className="my-5"/> : block.text ? <p key={index} className={`my-3 whitespace-pre-wrap text-sm leading-6 ${block.type === "header" ? "text-lg font-bold" : ""}`}>{block.text.text.replace(/<@([^>]+)>/g,(_,id)=>`@${preview.mentions[id] || id}`).replace(/[*_]/g,"")}</p> : null)}</div></div>}
      <div className="lg:pl-72">
        <header className="sticky top-0 z-20 flex h-18 items-center justify-between border-b border-slate-200/80 bg-white/90 px-5 backdrop-blur-xl md:px-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-500">
              {identity.organizationName}
            </p>
            <p className="text-sm font-semibold text-slate-700">
              {identity.workspaceName}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {pathname === "/tasks" && <button onClick={()=>void previewToday()} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold">Preview briefing</button>}
            {pathname === "/tasks" && (
              <button
                onClick={() => void postTodayToSlack()}
                disabled={posting}
                className="flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-2 text-xs font-bold text-white"
              >
                <Send className="h-3.5 w-3.5" /> Post today to Slack
              </button>
            )}
            <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-slate-50 px-3 py-2">
              <span className={`h-2 w-2 rounded-full ${setupReady ? "bg-emerald-500" : "bg-amber-500"}`} />
              <span className="text-xs font-semibold text-slate-600">
                {setupReady === null ? "Checking setup" : setupReady ? "Setup ready" : "Setup needs review"}
              </span>
            </div>
          </div>
        </header>
        <main className="px-5 py-7 md:px-8 md:py-9">{children}</main>
      </div>
    </div>
  );
}
