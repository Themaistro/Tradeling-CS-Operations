"use client";

import { FormEvent, useEffect, useState } from "react";
import { Bell, CheckCircle2, Clock3, LoaderCircle, Plus, Settings2, ShieldCheck, Users } from "lucide-react";
import { PageHeading } from "@/components/ui/page-heading";

type Settings = { timezone: string; postTime: string; slackChannelId: string; automationEnabled: boolean; maxConsecutiveDays: number };
type Shift = { id: string; name: string; startTime: string; endTime: string; staffingRules: { minimumStaff: number; minimumBilingual: number }[] };
type Data = { settings: Settings; shifts: Shift[]; slackConfigured: boolean };
type Tab = "general" | "shifts" | "slack";

const field = "mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 transition";

export default function SettingsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tab, setTab] = useState<Tab>("general");
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    const response = await fetch("/api/settings");
    const next = await response.json();
    setData(next); setSettings(next.settings);
  }

  useEffect(() => { void fetch("/api/settings").then(r => r.json()).then(next => { setData(next); setSettings(next.settings); }); }, []);

  async function saveSettings() {
    if (!settings) return;
    setSaving(true); setNotice(null);
    const response = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
    setNotice({ kind: response.ok ? "success" : "error", text: response.ok ? "Your settings have been saved." : "The settings could not be saved. Please review the fields and try again." });
    setSaving(false);
  }

  async function addShift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setNotice(null);
    const form = event.currentTarget; const values = new FormData(form);
    const response = await fetch("/api/shifts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: values.get("name"), startTime: values.get("start"), endTime: values.get("end"), minimumStaff: Number(values.get("staff")), minimumBilingual: Number(values.get("bilingual")) }) });
    setNotice({ kind: response.ok ? "success" : "error", text: response.ok ? "The shift has been added." : (await response.json()).error });
    if (response.ok) { form.reset(); await load(); }
    setSaving(false);
  }

  if (!data || !settings) return <div className="flex min-h-64 items-center justify-center"><LoaderCircle className="h-6 w-6 animate-spin text-orange-500" /></div>;

  const tabs = [
    { id: "general" as const, label: "General", helper: "Working rules", icon: Settings2 },
    { id: "shifts" as const, label: "Shifts & coverage", helper: `${data.shifts.length} configured`, icon: Users },
    { id: "slack" as const, label: "Slack", helper: data.slackConfigured ? "Connected" : "Setup required", icon: Bell },
  ];

  return <div className="mx-auto max-w-7xl">
    <PageHeading eyebrow="Configuration" title="Settings" description="Manage your operating rules, team coverage, and Slack delivery from one place." />
    <div className="mb-6 grid gap-4 sm:grid-cols-3">
      <StatusCard icon={ShieldCheck} label="Application" value="Ready" tone="emerald" />
      <StatusCard icon={Clock3} label="Active shifts" value={`${data.shifts.length} configured`} tone="blue" />
      <StatusCard icon={Bell} label="Slack connection" value={data.slackConfigured ? "Credentials ready" : "Setup required"} tone={data.slackConfigured ? "emerald" : "amber"} />
    </div>
    <div className="space-y-5">
      <aside className="grid rounded-2xl border border-slate-200 bg-white p-2 shadow-sm sm:grid-cols-3">
        {tabs.map(({ id, label, helper, icon: Icon }) => <button key={id} onClick={() => { setTab(id); setNotice(null); }} className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition ${tab === id ? "bg-slate-950 text-white shadow-sm" : "text-slate-700 hover:bg-slate-50"}`}><span className={`flex h-9 w-9 items-center justify-center rounded-lg ${tab === id ? "bg-white/10 text-orange-400" : "bg-slate-100 text-slate-500"}`}><Icon className="h-4 w-4" /></span><span><span className="block text-sm font-bold">{label}</span><span className={`block text-xs ${tab === id ? "text-slate-400" : "text-slate-500"}`}>{helper}</span></span></button>)}
      </aside>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {notice && <div className={`mx-6 mt-6 flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold ${notice.kind === "success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}><CheckCircle2 className="h-4 w-4" />{notice.text}</div>}

        {tab === "general" && <div><SectionHeader icon={Settings2} title="General settings" description="Set the rules used when schedules are generated and daily operations are displayed." /><div className="grid gap-6 p-6 lg:grid-cols-[1fr_1fr_0.9fr]"><div className="rounded-2xl border border-slate-200 p-5"><Label title="Business timezone" helper="Used for schedules, breaks, and automated Slack posts"><select value={settings.timezone} onChange={e => setSettings({ ...settings, timezone: e.target.value })} className={field}><option>Asia/Dubai</option><option>UTC</option><option>Europe/London</option><option>Asia/Riyadh</option></select></Label></div><div className="rounded-2xl border border-slate-200 p-5"><Label title="Maximum consecutive workdays" helper="The generator avoids assigning an employee beyond this limit"><input type="number" min="1" max="7" value={settings.maxConsecutiveDays} onChange={e => setSettings({ ...settings, maxConsecutiveDays: Number(e.target.value) })} className={field} /></Label></div><div className="rounded-2xl bg-slate-950 p-5 text-white"><p className="text-sm font-bold">Schedule protection</p><p className="mt-2 text-sm leading-6 text-slate-400">Rule changes affect future schedule generation only. Existing approved schedules remain unchanged.</p><div className="mt-5 flex items-center gap-2 text-xs font-bold text-emerald-400"><CheckCircle2 className="h-4 w-4" /> History is protected</div></div></div><Footer saving={saving} onSave={saveSettings} /> </div>}

        {tab === "shifts" && <div><SectionHeader icon={Clock3} title="Shifts and coverage" description="Create the working periods and minimum staffing levels used by the schedule generator." /><div className="p-6"><div className="space-y-3">{data.shifts.length ? data.shifts.map(shift => <div key={shift.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-4"><div><p className="font-bold text-slate-900">{shift.name}</p><p className="mt-1 text-sm text-slate-500">{shift.startTime}–{shift.endTime}</p></div><div className="flex gap-2 text-xs font-semibold"><span className="rounded-full bg-blue-50 px-3 py-1.5 text-blue-700">{shift.staffingRules[0]?.minimumStaff ?? 0} minimum</span><span className="rounded-full bg-violet-50 px-3 py-1.5 text-violet-700">{shift.staffingRules[0]?.minimumBilingual ?? 0} bilingual</span></div></div>) : <p className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">No shifts configured yet.</p>}</div><form onSubmit={addShift} className="mt-7 rounded-2xl border border-slate-200 bg-slate-50 p-5"><h3 className="font-bold text-slate-900">Add a shift</h3><p className="mt-1 text-sm text-slate-500">Coverage requirements will initially apply to every day of the week.</p><div className="mt-4 grid gap-4 sm:grid-cols-2"><Label title="Shift name"><input required name="name" placeholder="e.g. Morning" className={field} /></Label><Label title="Minimum staff"><input required name="staff" type="number" min="0" defaultValue="1" className={field} /></Label><Label title="Start time"><input required name="start" type="time" className={field} /></Label><Label title="End time"><input required name="end" type="time" className={field} /></Label><Label title="Minimum bilingual staff"><input required name="bilingual" type="number" min="0" defaultValue="0" className={field} /></Label></div><button disabled={saving} className="mt-5 flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white"><Plus className="h-4 w-4" />{saving ? "Adding…" : "Add shift"}</button></form></div></div>}

        {tab === "slack" && <div><SectionHeader icon={Bell} title="Slack delivery" description="Choose where and when the approved daily roster will be posted." /><div className="space-y-6 p-6"><div className={`rounded-xl border p-4 ${data.slackConfigured ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}><p className={`text-sm font-bold ${data.slackConfigured ? "text-emerald-800" : "text-amber-900"}`}>{data.slackConfigured ? "Slack credentials are configured" : "Slack credentials are not configured"}</p><p className={`mt-1 text-sm leading-6 ${data.slackConfigured ? "text-emerald-700" : "text-amber-800"}`}>{data.slackConfigured ? "The host has supplied the required bot and app tokens." : "Your technical administrator must add the bot and app tokens to the hosting environment."}</p></div><div className="grid gap-5 sm:grid-cols-2"><Label title="Channel ID" helper="The channel where daily rosters are posted"><input value={settings.slackChannelId} onChange={e => setSettings({ ...settings, slackChannelId: e.target.value.trim() })} placeholder="C012ABC34" className={field} /></Label><Label title="Daily posting time" helper={`Uses ${settings.timezone}`}><input type="time" value={settings.postTime} onChange={e => setSettings({ ...settings, postTime: e.target.value })} className={field} /></Label></div><label className="flex items-start gap-3 rounded-xl border border-slate-200 p-4"><input type="checkbox" checked={settings.automationEnabled} onChange={e => setSettings({ ...settings, automationEnabled: e.target.checked })} className="mt-1 h-4 w-4 accent-orange-500" /><span><span className="block text-sm font-bold text-slate-900">Automatic daily posting</span><span className="mt-1 block text-sm text-slate-500">Post the approved roster at the selected time each day.</span></span></label></div><Footer saving={saving} onSave={saveSettings} /></div>}
      </section>
    </div>
  </div>;
}

function SectionHeader({ icon: Icon, title, description }: { icon: typeof Bell; title: string; description: string }) { return <header className="flex items-start gap-4 border-b border-slate-100 px-6 py-6"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600"><Icon className="h-5 w-5" /></span><div><h2 className="text-lg font-bold text-slate-950">{title}</h2><p className="mt-1 text-sm leading-6 text-slate-500">{description}</p></div></header>; }
function StatusCard({ icon: Icon, label, value, tone }: { icon: typeof Bell; label: string; value: string; tone: "emerald" | "blue" | "amber" }) { const colors = { emerald: "bg-emerald-50 text-emerald-600", blue: "bg-blue-50 text-blue-600", amber: "bg-amber-50 text-amber-600" }; return <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><span className={`flex h-11 w-11 items-center justify-center rounded-xl ${colors[tone]}`}><Icon className="h-5 w-5" /></span><div><p className="text-xs font-bold uppercase tracking-wider text-slate-400">{label}</p><p className="mt-1 text-sm font-bold text-slate-900">{value}</p></div></div>; }
function Label({ title, helper, children }: { title: string; helper?: string; children: React.ReactNode }) { return <label className="block text-sm font-bold text-slate-700">{title}{children}{helper && <span className="mt-2 block text-xs font-normal leading-5 text-slate-500">{helper}</span>}</label>; }
function Footer({ saving, onSave }: { saving: boolean; onSave: () => void }) { return <footer className="flex items-center justify-end border-t border-slate-100 bg-slate-50/70 px-6 py-4"><button disabled={saving} onClick={onSave} className="flex min-w-36 items-center justify-center gap-2 rounded-xl bg-orange-500 px-5 py-3 text-sm font-bold text-white hover:bg-orange-600">{saving && <LoaderCircle className="h-4 w-4 animate-spin" />}{saving ? "Saving…" : "Save changes"}</button></footer>; }
