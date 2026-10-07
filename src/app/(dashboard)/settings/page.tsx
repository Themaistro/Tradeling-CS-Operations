"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  Bell,
  AlertTriangle,
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Database,
  LoaderCircle,
  Plus,
  Settings2,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { PageHeading } from "@/components/ui/page-heading";

type Settings = {
  timezone: string;
  postTime: string;
  slackChannelId: string;
  slackMessageHeader: string;
  automationEnabled: boolean;
  maxConsecutiveDays: number;
  maxWeeklyDays: number;
  historyWindowDays: number;
  scheduleBuildCutoff: number;
  wfhDays: number[];
  lateShiftWfh: boolean;
  autoPrepareDailyPlans: boolean;
  weekStartsOn: number;
  mainBreakMinutes: number;
  shortBreakMinutes: number;
  breakGapMinutes: number;
  maxConcurrentMainBreaks: number;
  mainBreakAfterMinutes: number;
  shortBreakDelayMinutes: number;
  requireAcknowledgement: boolean;
  includeBreaksInSlack: boolean;
  includeNotesInSlack: boolean;
};
type Shift = {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
};
type Data = {
  settings: Settings;
  shifts: Shift[];
  slackConfigured: boolean;
  slackCredentials: { botTokenConfigured: boolean; appTokenConfigured: boolean };
  readiness: {
    employees: number;
    employeesWithSlack: number;
    employeesWithAccounts: number;
    accounts: number;
    operatingWindows: number;
    coverageRequirements: number;
    tasks: number;
    shifts: number;
    staffingRules: number;
    approvedSchedules: number;
    slackReady: boolean;
    ready: boolean;
  };
};
type Tab = "guide" | "general" | "shifts" | "tasks" | "slack" | "data";
type Confirmation = {
  title: string;
  message: string;
  confirmLabel: string;
  action: () => Promise<void>;
};

const field =
  "mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 transition";

function zonedParts(timestamp: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(timestamp);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function zonedWallTimeToEpoch(
  wallTime: { year: number; month: number; day: number; hour: number; minute: number },
  timezone: string,
) {
  const desired = Date.UTC(wallTime.year, wallTime.month - 1, wallTime.day, wallTime.hour, wallTime.minute);
  let estimate = desired;
  for (let index = 0; index < 2; index += 1) {
    const actual = zonedParts(estimate, timezone);
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    estimate += desired - represented;
  }
  return estimate;
}

function getNextPost(now: number, postTime: string, timezone: string) {
  const current = zonedParts(now, timezone);
  const [hour, minute] = postTime.split(":").map(Number);
  let next = zonedWallTimeToEpoch({ ...current, hour, minute }, timezone);
  if (next <= now) {
    const tomorrow = new Date(Date.UTC(current.year, current.month - 1, current.day + 1));
    next = zonedWallTimeToEpoch(
      {
        year: tomorrow.getUTCFullYear(),
        month: tomorrow.getUTCMonth() + 1,
        day: tomorrow.getUTCDate(),
        hour,
        minute,
      },
      timezone,
    );
  }
  return next;
}

function PostCountdown({ settings }: { settings: Settings }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (!settings.automationEnabled) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        <b className="text-slate-900">Automatic posting is off</b>
        <p className="mt-1">Turn it on and save the settings to schedule the next post.</p>
      </div>
    );
  }

  const next = getNextPost(now, settings.postTime, settings.timezone);
  const remaining = Math.max(0, Math.floor((next - now) / 1000));
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;
  const countdown = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  const nextLabel = new Intl.DateTimeFormat("en-AE", {
    timeZone: settings.timezone,
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(next);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-blue-600 shadow-sm">
          <Clock3 className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-bold text-slate-900">Next automatic post</p>
          <p className="mt-0.5 text-sm text-slate-600">{nextLabel} · {settings.timezone}</p>
        </div>
      </div>
      <div className="sm:text-right">
        <p className="font-mono text-2xl font-bold tracking-tight text-blue-700">{countdown}</p>
        <p className="text-xs font-semibold uppercase tracking-wider text-blue-500">hours · minutes · seconds</p>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tab, setTab] = useState<Tab>("guide");
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [testingSlack, setTestingSlack] = useState(false);
  const [botToken, setBotToken] = useState("");
  const [appToken, setAppToken] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [guideStep, setGuideStep] = useState<number | null>(null);

  async function load() {
    const response = await fetch("/api/settings");
    const next = await response.json();
    setData(next);
    setSettings(next.settings);
  }

  useEffect(() => {
    void fetch("/api/settings")
      .then((r) => r.json())
      .then((next) => {
        setData(next);
        setSettings(next.settings);
      });
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), notice.kind === "success" ? 4500 : 7000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function saveSettings() {
    if (!settings) return;
    setSaving(true);
    setNotice(null);
    const response = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    setNotice({
      kind: response.ok ? "success" : "error",
      text: response.ok
        ? "Your settings have been saved."
        : "The settings could not be saved. Please review the fields and try again.",
    });
    setSaving(false);
  }

  async function addShift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    const form = event.currentTarget;
    const values = new FormData(form);
    const response = await fetch("/api/shifts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: values.get("name"),
        startTime: values.get("start"),
        endTime: values.get("end"),
      }),
    });
    setNotice({
      kind: response.ok ? "success" : "error",
      text: response.ok
        ? "The shift has been added."
        : (await response.json()).error,
    });
    if (response.ok) {
      form.reset();
      await load();
    }
    setSaving(false);
  }

  async function removeShift(id: string) {
    const shift = data?.shifts.find((item) => item.id === id);
    setConfirmation({
      title: "Deactivate this shift?",
      message: `${shift?.name ?? "This shift"} will no longer be available for future schedules. Existing schedule history will be preserved.`,
      confirmLabel: "Deactivate shift",
      action: async () => {
        const response = await fetch(`/api/shifts/${id}`, { method: "DELETE" });
        const body = await response.json();
        setNotice({ kind: response.ok ? "success" : "error", text: response.ok ? `${shift?.name ?? "Shift"} has been deactivated.` : body.error });
        if (response.ok) await load();
      },
    });
  }

  async function updateShift(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    setSaving(true);
    const values = new FormData(event.currentTarget);
    const response = await fetch(`/api/shifts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: values.get("name"), startTime: values.get("startTime"), endTime: values.get("endTime") }) });
    const body = await response.json();
    setNotice({ kind: response.ok ? "success" : "error", text: response.ok ? "Shift details updated. Future schedules will use the new times." : body.error });
    if (response.ok) await load();
    setSaving(false);
  }

  async function testSlack() {
    setTestingSlack(true);
    const response = await fetch("/api/slack/status");
    const result = await response.json();
    setNotice({ kind: result.connected ? "success" : "error", text: result.connected ? `Connected to ${result.team} as ${result.user}.` : result.error || "Slack connection failed." });
    setTestingSlack(false);
  }

  async function saveSlackCredentials() {
    setSaving(true); setNotice(null);
    const response = await fetch("/api/settings/slack-credentials", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ botToken, appToken }) });
    const result = await response.json();
    setNotice({ kind: response.ok ? "success" : "error", text: response.ok ? `Slack credentials saved securely.${result.restartRequired ? " Restart the application once to activate Socket Mode acknowledgements." : ""}` : result.error || "Slack credentials could not be saved." });
    if (response.ok) { setBotToken(""); setAppToken(""); await load(); }
    setSaving(false);
  }

  async function removeSlackCredentials() {
    setConfirmation({
      title: "Remove saved Slack credentials?",
      message: "The encrypted tokens saved in this application will be removed. Tokens supplied by the hosting environment will remain active.",
      confirmLabel: "Remove credentials",
      action: async () => {
        setSaving(true);
        const response = await fetch("/api/settings/slack-credentials", { method: "DELETE" });
        setNotice({ kind: response.ok ? "success" : "error", text: response.ok ? "Saved Slack credentials were removed. Restart the application to stop the current Socket Mode connection." : "Saved Slack credentials could not be removed." });
        if (response.ok) await load();
        setSaving(false);
      },
    });
  }

  async function confirmAction() {
    if (!confirmation) return;
    setConfirming(true);
    try {
      await confirmation.action();
      setConfirmation(null);
    } finally {
      setConfirming(false);
    }
  }

  if (!data || !settings)
    return (
      <div className="flex min-h-64 items-center justify-center">
        <LoaderCircle className="h-6 w-6 animate-spin text-orange-500" />
      </div>
    );

  const tabs = [
    {
      id: "guide" as const,
      label: "Setup guide",
      helper: `${configurationProgress(data).complete} of ${configurationProgress(data).total} ready`,
      icon: BookOpenCheck,
    },
    {
      id: "general" as const,
      label: "Scheduling",
      helper: `Prepare on day ${settings.scheduleBuildCutoff}`,
      icon: Settings2,
    },
    {
      id: "shifts" as const,
      label: "Shifts",
      helper: `${data.shifts.length} configured`,
      icon: Users,
    },
    {
      id: "tasks" as const,
      label: "Breaks",
      helper: `${settings.mainBreakMinutes + settings.shortBreakMinutes} minutes`,
      icon: ClipboardList,
    },
    {
      id: "slack" as const,
      label: "Slack",
      helper: data.slackConfigured ? "Connected" : "Setup required",
      icon: Bell,
    },
    {
      id: "data" as const,
      label: "Data & security",
      helper: "Backup and access",
      icon: Database,
    },
  ];

  return (
    <div className="mx-auto max-w-7xl">
      {notice && <Toast notice={notice} onClose={() => setNotice(null)} />}
      {confirmation && (
        <ConfirmDialog
          confirmation={confirmation}
          confirming={confirming}
          onCancel={() => !confirming && setConfirmation(null)}
          onConfirm={confirmAction}
        />
      )}
      {guideStep !== null && (
        <GuideWalkthrough
          data={data}
          stepIndex={guideStep}
          setStepIndex={setGuideStep}
          setTab={setTab}
          onClose={() => setGuideStep(null)}
        />
      )}
      <PageHeading
        eyebrow="Configuration"
        title="Settings"
        description="Manage application preferences, shift definitions, breaks, Slack delivery, and security. Account rules are managed in Operations."
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatusCard
          icon={ShieldCheck}
          label="Application"
          value={data.readiness.ready ? "Core setup ready" : "Setup incomplete"}
          tone={data.readiness.ready ? "emerald" : "amber"}
        />
        <StatusCard
          icon={Clock3}
          label="Active shifts"
          value={`${data.shifts.length} configured`}
          tone="blue"
        />
        <StatusCard
          icon={Bell}
          label="Slack connection"
          value={data.slackConfigured && settings.slackChannelId ? "Ready to test" : "Setup required"}
          tone={data.slackConfigured ? "emerald" : "amber"}
        />
      </div>
      <div className="space-y-5">
        <aside className="grid rounded-2xl border border-slate-200 bg-white p-2 shadow-sm sm:grid-cols-2 xl:grid-cols-6">
          {tabs.map(({ id, label, helper, icon: Icon }) => (
            <button
              key={id}
              onClick={() => {
                setTab(id);
                setNotice(null);
              }}
              className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition ${tab === id ? "bg-slate-950 text-white shadow-sm" : "text-slate-700 hover:bg-slate-50"}`}
            >
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-lg ${tab === id ? "bg-white/10 text-orange-400" : "bg-slate-100 text-slate-500"}`}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span>
                <span className="block text-sm font-bold">{label}</span>
                <span
                  className={`block text-xs ${tab === id ? "text-slate-400" : "text-slate-500"}`}
                >
                  {helper}
                </span>
              </span>
            </button>
          ))}
        </aside>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {tab === "guide" && <ConfigurationGuide data={data} setTab={setTab} onStart={() => setGuideStep(0)} />}
          {tab === "general" && (
            <div>
              <SectionHeader
                icon={Settings2}
                title="Scheduling policy"
                description="Control how future rosters continue from history, allocate working days, and apply WFH rules."
              />
              <div className="space-y-6 p-6">
                <div className="grid gap-5 lg:grid-cols-3">
                  <Label
                    title="Business timezone"
                    helper="Used for schedules, breaks, and Slack posts"
                  >
                    <select
                      value={settings.timezone}
                      onChange={(e) =>
                        setSettings({ ...settings, timezone: e.target.value })
                      }
                      className={field}
                    >
                      <option>Asia/Dubai</option>
                      <option>UTC</option>
                      <option>Europe/London</option>
                      <option>Asia/Riyadh</option>
                    </select>
                  </Label>
                  <Label title="Week starts on">
                    <select
                      value={settings.weekStartsOn}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          weekStartsOn: Number(e.target.value),
                        })
                      }
                      className={field}
                    >
                      {[
                        "Sunday",
                        "Monday",
                        "Tuesday",
                        "Wednesday",
                        "Thursday",
                        "Friday",
                        "Saturday",
                      ].map((d, i) => (
                        <option key={d} value={i}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </Label>
                  <Label title="Maximum consecutive workdays">
                    <input
                      type="number"
                      min="1"
                      max="7"
                      value={settings.maxConsecutiveDays}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          maxConsecutiveDays: Number(e.target.value),
                        })
                      }
                      className={field}
                    />
                  </Label>
                  <Label title="Working days per week" helper="The normal weekly maximum for each agent">
                    <input type="number" min="1" max="7" value={settings.maxWeeklyDays} onChange={(e) => setSettings({ ...settings, maxWeeklyDays: Number(e.target.value) })} className={field} />
                  </Label>
                  <Label title="Previous-history window" helper="Days reviewed before the new schedule starts">
                    <input type="number" min="3" max="14" value={settings.historyWindowDays} onChange={(e) => setSettings({ ...settings, historyWindowDays: Number(e.target.value) })} className={field} />
                  </Label>
                  <Label title="Monthly preparation day" helper="Recommended day to begin preparing the next roster">
                    <input type="number" min="1" max="28" value={settings.scheduleBuildCutoff} onChange={(e) => setSettings({ ...settings, scheduleBuildCutoff: Number(e.target.value) })} className={field} />
                  </Label>
                </div>
                <div className="rounded-2xl border border-slate-200 p-5">
                  <h3 className="font-bold text-slate-900">Work-from-home policy</h3>
                  <p className="mt-1 text-sm text-slate-500">Generated schedules apply these defaults. Draft assignments can still be changed manually.</p>
                  <div className="mt-4 flex flex-wrap gap-2">{["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map((day,index)=><button type="button" key={day} onClick={()=>setSettings({...settings,wfhDays:settings.wfhDays.includes(index)?settings.wfhDays.filter((value)=>value!==index):[...settings.wfhDays,index]})} className={`rounded-lg border px-3 py-2 text-xs font-bold ${settings.wfhDays.includes(index)?"border-blue-500 bg-blue-50 text-blue-700":"border-slate-200 text-slate-500"}`}>{day.slice(0,3)}</button>)}</div>
                  <label className="mt-4 flex items-center gap-3 text-sm font-bold text-slate-700"><input type="checkbox" checked={settings.lateShiftWfh} onChange={(event)=>setSettings({...settings,lateShiftWfh:event.target.checked})} className="accent-orange-500" />Late shifts are WFH by default</label>
                </div>
                <Toggle label="Prepare daily tasks and breaks when a schedule is approved" checked={settings.autoPrepareDailyPlans} onChange={(value)=>setSettings({...settings,autoPrepareDailyPlans:value})} />
                <div className="rounded-xl border border-blue-100 bg-blue-50 p-5 text-sm text-blue-800">
                  <b>Operating days and service hours are managed in Operations.</b>
                  <p className="mt-1 text-blue-700">The schedule automatically follows the active account hours configured there.</p>
                </div>
                <div className="rounded-xl bg-slate-950 p-5 text-sm text-slate-300">
                  <b className="text-white">Schedule protection:</b> rule
                  changes affect future generation only. Approved schedule
                  history remains unchanged.
                </div>
              </div>
              <Footer saving={saving} onSave={saveSettings} />
            </div>
          )}

          {tab === "shifts" && (
            <div>
              <SectionHeader
                icon={Clock3}
                title="Shift definitions"
                description="Create the working periods agents can be assigned to. Staffing targets are managed in Operations."
              />
              <div className="p-6">
                <div className="space-y-3">
                  {data.shifts.length ? (
                    data.shifts.map((shift) => (
                      <form
                        key={shift.id}
                        onSubmit={(event) => updateShift(event, shift.id)}
                        className="grid gap-3 rounded-xl border border-slate-200 p-4 md:grid-cols-[1fr_130px_130px_auto] md:items-end"
                      >
                        <label className="text-xs font-bold text-slate-600">Shift name<input name="name" required minLength={2} defaultValue={shift.name} className={field} /></label>
                        <label className="text-xs font-bold text-slate-600">Start time<input name="startTime" required type="time" defaultValue={shift.startTime} className={field} /></label>
                        <label className="text-xs font-bold text-slate-600">End time<input name="endTime" required type="time" defaultValue={shift.endTime} className={field} /></label>
                        <div className="flex gap-2">
                          <button disabled={saving} className="rounded-lg bg-slate-950 px-4 py-3 text-xs font-bold text-white">Save</button>
                          <button
                            type="button"
                            aria-label={`Deactivate ${shift.name}`}
                            onClick={() => removeShift(shift.id)}
                            className="rounded-lg border border-slate-200 p-3 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </form>
                    ))
                  ) : (
                    <p className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">
                      No shifts configured yet.
                    </p>
                  )}
                </div>
                <form
                  onSubmit={addShift}
                  className="mt-7 rounded-2xl border border-slate-200 bg-slate-50 p-5"
                >
                  <h3 className="font-bold text-slate-900">Add a shift</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    After adding a shift, set its daily team capacity in Operations.
                  </p>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <Label title="Shift name">
                      <input
                        required
                        name="name"
                        placeholder="e.g. Morning"
                        className={field}
                      />
                    </Label>
                    <Label title="Start time">
                      <input
                        required
                        name="start"
                        type="time"
                        className={field}
                      />
                    </Label>
                    <Label title="End time">
                      <input
                        required
                        name="end"
                        type="time"
                        className={field}
                      />
                    </Label>
                  </div>
                  <button
                    disabled={saving}
                    className="mt-5 flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white"
                  >
                    <Plus className="h-4 w-4" />
                    {saving ? "Adding…" : "Add shift"}
                  </button>
                </form>
              </div>
            </div>
          )}

          {tab === "tasks" && (
            <div>
              <SectionHeader
                icon={ClipboardList}
                title="Break policy"
                description="Control break entitlement and coverage timing. Account tasks are managed in Operations."
              />
              <div className="p-6">
                <div className="max-w-3xl">
                  <p className="text-sm font-bold text-slate-700">Break entitlement and coverage</p>
                  <p className="mt-1 text-xs text-slate-500">Breaks are staggered automatically and require another active agent to cover live calls and chats.</p>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    {[
                      ["Main break", "mainBreakMinutes", settings.mainBreakMinutes],
                      ["Short break", "shortBreakMinutes", settings.shortBreakMinutes],
                      ["Gap between agents", "breakGapMinutes", settings.breakGapMinutes],
                      ["Agents per main-break slot", "maxConcurrentMainBreaks", settings.maxConcurrentMainBreaks],
                      ["Main break after shift start", "mainBreakAfterMinutes", settings.mainBreakAfterMinutes],
                      ["Short break after main break", "shortBreakDelayMinutes", settings.shortBreakDelayMinutes],
                    ].map(([label, key, value]) => (
                      <label key={String(key)} className="text-xs font-bold text-slate-600">{label}<div className="relative"><input type="number" min={key === "maxConcurrentMainBreaks" ? 1 : 0} max={key === "maxConcurrentMainBreaks" ? 10 : 600} value={Number(value)} onChange={(event)=>setSettings({...settings,[String(key)]:Number(event.target.value)})} className={field}/><span className="absolute bottom-3 right-4 text-xs text-slate-400">{key === "maxConcurrentMainBreaks" ? "agents" : "minutes"}</span></div></label>
                    ))}
                  </div>
                  <div className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800"><b>Total entitlement:</b> {settings.mainBreakMinutes + settings.shortBreakMinutes} minutes per working agent.</div>
                </div>
              </div>
              <Footer saving={saving} onSave={saveSettings} />
            </div>
          )}

          {tab === "slack" && (
            <div>
              <SectionHeader
                icon={Bell}
                title="Slack delivery"
                description="Choose where, when, and how the approved daily roster will be posted."
              />
              <div className="space-y-6 p-6">
                <div
                  className={`rounded-xl border p-4 ${data.slackConfigured ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}
                >
                  <p className="text-sm font-bold">
                    {data.slackConfigured
                      ? "Slack credentials are configured"
                      : "Slack credentials are not configured"}
                  </p>
                  <p className="mt-1 text-sm">
                    {data.slackConfigured
                      ? "The bot and app tokens are available. Use the connection test after saving the channel."
                      : "Add the bot and app tokens below, then test the connection."}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 p-5">
                  <h3 className="font-bold text-slate-900">Slack credentials</h3>
                  <p className="mt-1 text-sm text-slate-500">Saved tokens are encrypted and are never displayed again. Leave a field empty to keep its existing value.</p>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <Label title="Bot user token" helper={data.slackCredentials.botTokenConfigured ? "Saved · enter a new xoxb token only to replace it" : "Required · starts with xoxb-"}>
                      <input type="password" autoComplete="new-password" value={botToken} onChange={(event)=>setBotToken(event.target.value.trim())} placeholder={data.slackCredentials.botTokenConfigured ? "•••••••••••••••• saved" : "xoxb-…"} className={field} />
                    </Label>
                    <Label title="App-level token" helper={data.slackCredentials.appTokenConfigured ? "Saved · enter a new xapp token only to replace it" : "Required for Socket Mode · starts with xapp-"}>
                      <input type="password" autoComplete="new-password" value={appToken} onChange={(event)=>setAppToken(event.target.value.trim())} placeholder={data.slackCredentials.appTokenConfigured ? "•••••••••••••••• saved" : "xapp-…"} className={field} />
                    </Label>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-3"><button type="button" disabled={saving || (!botToken && !appToken)} onClick={saveSlackCredentials} className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white disabled:opacity-40">Save credentials</button>{(data.slackCredentials.botTokenConfigured||data.slackCredentials.appTokenConfigured)&&<button type="button" disabled={saving} onClick={removeSlackCredentials} className="rounded-xl border border-red-200 px-5 py-3 text-sm font-bold text-red-700">Remove saved credentials</button>}</div>
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Label title="Channel ID">
                    <input
                      value={settings.slackChannelId}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          slackChannelId: e.target.value.trim(),
                        })
                      }
                      placeholder="C012ABC34"
                      className={field}
                    />
                  </Label>
                  <Label title="Daily posting time">
                    <input
                      type="time"
                      value={settings.postTime}
                      onChange={(e) =>
                        setSettings({ ...settings, postTime: e.target.value })
                      }
                      className={field}
                    />
                  </Label>
                </div>
                <Label title="Message heading">
                  <input
                    value={settings.slackMessageHeader}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        slackMessageHeader: e.target.value,
                      })
                    }
                    className={field}
                  />
                </Label>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Toggle
                    label="Automatic posting"
                    checked={settings.automationEnabled}
                    onChange={(v) =>
                      setSettings({ ...settings, automationEnabled: v })
                    }
                  />
                  <Toggle
                    label="Include breaks"
                    checked={settings.includeBreaksInSlack}
                    onChange={(v) =>
                      setSettings({ ...settings, includeBreaksInSlack: v })
                    }
                  />
                  <Toggle
                    label="Include notes"
                    checked={settings.includeNotesInSlack}
                    onChange={(v) =>
                      setSettings({ ...settings, includeNotesInSlack: v })
                    }
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Toggle label="Require acknowledgement" checked={settings.requireAcknowledgement} onChange={(value)=>setSettings({...settings,requireAcknowledgement:value})} />
                  <button type="button" disabled={testingSlack} onClick={testSlack} className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 p-4 text-sm font-bold text-slate-700 hover:bg-slate-50">{testingSlack && <LoaderCircle className="h-4 w-4 animate-spin" />}{testingSlack ? "Testing connection…" : "Test Slack connection"}</button>
                </div>
                <PostCountdown settings={settings} />
                <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm leading-6 text-blue-800"><b>Automated workflow</b><p>Approving a schedule prepares task ownership and coverage-safe breaks for every working day. At the daily posting time, the system checks today’s plan again, prepares it if needed, and then posts it to Slack.</p></div>
              </div>
              <Footer saving={saving} onSave={saveSettings} />
            </div>
          )}
          {tab === "data" && (
            <div>
              <SectionHeader
                icon={Database}
                title="Data and security"
                description="Download a portable backup and review production access requirements."
              />
              <div className="grid gap-6 p-6 lg:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 p-5">
                  <h3 className="font-bold">Application backup</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Download employees, leave, shifts, rules, categories,
                    settings, schedules, and assignments as JSON.
                  </p>
                  <a
                    href="/api/export"
                    className="mt-5 inline-flex rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white"
                  >
                    Download backup
                  </a>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                  <h3 className="font-bold text-amber-900">
                    Administrator access
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-amber-800">
                    The administrator login, session secret, Slack tokens, and
                    database connection are controlled by the hosting
                    environment. Change the default credentials before team
                    testing.
                  </p>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Bell;
  title: string;
  description: string;
}) {
  return (
    <header className="flex items-start gap-4 border-b border-slate-100 px-6 py-6">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <h2 className="text-lg font-bold text-slate-950">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
      </div>
    </header>
  );
}
function StatusCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Bell;
  label: string;
  value: string;
  tone: "emerald" | "blue" | "amber";
}) {
  const colors = {
    emerald: "bg-emerald-50 text-emerald-600",
    blue: "bg-blue-50 text-blue-600",
    amber: "bg-amber-50 text-amber-600",
  };
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <span
        className={`flex h-11 w-11 items-center justify-center rounded-xl ${colors[tone]}`}
      >
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
          {label}
        </p>
        <p className="mt-1 text-sm font-bold text-slate-900">{value}</p>
      </div>
    </div>
  );
}

function configurationSteps(data: Data) {
  const { readiness } = data;
  return [
    {
      number: 1,
      title: "Accounts and service hours",
      description: "Add every customer account, choose its working days, and define the hours that require coverage.",
      detail: `${readiness.accounts} active account${readiness.accounts === 1 ? "" : "s"} · ${readiness.operatingWindows} service window${readiness.operatingWindows === 1 ? "" : "s"}`,
      ready: readiness.accounts > 0 && readiness.operatingWindows > 0,
      href: "/operations",
      action: "Configure operations",
    },
    {
      number: 2,
      title: "Required coverage",
      description: "Set the minimum total and bilingual agents required for each account, day, and time period.",
      detail: `${readiness.coverageRequirements} coverage rule${readiness.coverageRequirements === 1 ? "" : "s"}`,
      ready: readiness.coverageRequirements > 0,
      href: "/operations",
      action: "Review coverage",
    },
    {
      number: 3,
      title: "Tasks and rotation rules",
      description: "Create account tasks and choose whether each one is assigned to everyone, rotated as focused ownership, or treated as supporting work.",
      detail: `${readiness.tasks} active task${readiness.tasks === 1 ? "" : "s"}`,
      ready: readiness.tasks > 0,
      href: "/operations",
      action: "Configure tasks",
    },
    {
      number: 4,
      title: "Team and eligibility",
      description: "Add agents, Slack member IDs, account eligibility, language coverage, preferred days off, and planned leave.",
      detail: `${readiness.employees} agents · ${readiness.employeesWithSlack} with Slack · ${readiness.employeesWithAccounts} account-ready`,
      ready: readiness.employees > 0 && readiness.employeesWithSlack === readiness.employees && readiness.employeesWithAccounts === readiness.employees,
      href: "/team",
      action: "Review team",
    },
    {
      number: 5,
      title: "Shifts and staffing",
      description: "Define shift times, then set the minimum staffing and bilingual requirement for every day.",
      detail: `${readiness.shifts} shifts · ${readiness.staffingRules} daily staffing rule${readiness.staffingRules === 1 ? "" : "s"}`,
      ready: readiness.shifts > 0 && readiness.staffingRules > 0,
      tab: "shifts" as Tab,
      action: "Configure shifts",
    },
    {
      number: 6,
      title: "Scheduling, WFH, and breaks",
      description: "Review working-day limits, consecutive days, history, WFH defaults, break lengths, spacing, and live-channel protection.",
      detail: "Operational defaults are available and can be changed",
      ready: true,
      tab: "general" as Tab,
      action: "Review policies",
    },
    {
      number: 7,
      title: "Slack delivery",
      description: "Save the Slack credentials and channel, choose the posting time, and test the connection.",
      detail: readiness.slackReady ? "Credentials and channel are ready" : "Slack setup is incomplete",
      ready: readiness.slackReady,
      tab: "slack" as Tab,
      action: "Configure Slack",
    },
    {
      number: 8,
      title: "Generate and approve a schedule",
      description: "Generate the month, review coverage warnings, make any adjustments, then approve it to prepare daily tasks and breaks.",
      detail: `${readiness.approvedSchedules} approved schedule${readiness.approvedSchedules === 1 ? "" : "s"}`,
      ready: readiness.approvedSchedules > 0,
      href: "/schedule",
      action: "Open schedule",
    },
  ];
}

function configurationProgress(data: Data) {
  const steps = configurationSteps(data);
  return { complete: steps.filter((step) => step.ready).length, total: steps.length };
}

function ConfigurationGuide({ data, setTab, onStart }: { data: Data; setTab: (tab: Tab) => void; onStart: () => void }) {
  const steps = configurationSteps(data);
  const progress = configurationProgress(data);
  const percentage = Math.round((progress.complete / progress.total) * 100);

  return (
    <div>
      <SectionHeader icon={BookOpenCheck} title="Configuration guide" description="Follow these steps in order to prepare the operation, generate reliable schedules, and automate daily Slack delivery." />
      <div className="space-y-7 p-6">
        <div className="rounded-2xl bg-slate-950 p-6 text-white">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-400">Setup progress</p>
              <h3 className="mt-2 text-2xl font-bold">{progress.complete} of {progress.total} steps ready</h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">The guide checks the live configuration. Return here whenever accounts, staffing, or team details change.</p>
            </div>
            <div className="flex items-center gap-4"><p className="text-4xl font-bold text-white">{percentage}%</p><button type="button" onClick={onStart} className="rounded-xl bg-orange-500 px-5 py-3 text-sm font-bold text-white hover:bg-orange-600">Start guided setup</button></div>
          </div>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-orange-500 transition-all" style={{ width: `${percentage}%` }} /></div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {steps.map((step) => (
            <article key={step.number} className={`rounded-2xl border p-5 ${step.ready ? "border-emerald-200 bg-emerald-50/40" : "border-amber-200 bg-amber-50/50"}`}>
              <div className="flex items-start gap-4">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${step.ready ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{step.ready ? <CheckCircle2 className="h-5 w-5" /> : step.number}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-bold text-slate-950">{step.title}</h3>
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${step.ready ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{step.ready ? "Ready" : "Needs attention"}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{step.description}</p>
                  <p className="mt-3 text-xs font-semibold text-slate-500">{step.detail}</p>
                  {step.href ? (
                    <a href={step.href} className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-blue-700 hover:text-blue-900">{step.action}<ArrowRight className="h-4 w-4" /></a>
                  ) : (
                    <button type="button" onClick={() => step.tab && setTab(step.tab)} className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-blue-700 hover:text-blue-900">{step.action}<ArrowRight className="h-4 w-4" /></button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>

        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
          <h3 className="font-bold text-blue-950">Designed to change with the operation</h3>
          <p className="mt-2 text-sm leading-6 text-blue-800">Customer accounts, working days, service hours, coverage levels, shifts, staffing, team eligibility, task ownership, rotation order, WFH rules, breaks, leave, and Slack delivery are all managed through the application. The engine reads these values whenever it generates a new schedule.</p>
          <p className="mt-2 text-sm leading-6 text-blue-700">System safeguards—such as preventing invalid times, protecting live coverage during breaks, and keeping approved history—remain built in so configuration changes cannot silently damage the operation.</p>
        </div>
      </div>
    </div>
  );
}

function GuideWalkthrough({
  data,
  stepIndex,
  setStepIndex,
  setTab,
  onClose,
}: {
  data: Data;
  stepIndex: number;
  setStepIndex: (step: number) => void;
  setTab: (tab: Tab) => void;
  onClose: () => void;
}) {
  const steps = configurationSteps(data);
  const step = steps[stepIndex];
  const last = stepIndex === steps.length - 1;
  const openSettingsSection = () => {
    if ("tab" in step && step.tab) {
      setTab(step.tab);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-5 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="guide-step-title">
      <div className="w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl shadow-slate-950/30">
        <div className="bg-slate-950 p-6 text-white">
          <div className="flex items-start justify-between gap-4">
            <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-400">Guided setup · Step {stepIndex + 1} of {steps.length}</p><h2 id="guide-step-title" className="mt-3 text-2xl font-bold">{step.title}</h2></div>
            <button type="button" onClick={onClose} aria-label="Close guided setup" className="rounded-xl bg-white/10 p-2 text-slate-300 hover:bg-white/20 hover:text-white"><X className="h-5 w-5" /></button>
          </div>
          <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-orange-500" style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }} /></div>
        </div>
        <div className="p-7">
          <div className={`flex items-center gap-3 rounded-xl p-4 ${step.ready ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
            {step.ready ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
            <div><p className="text-sm font-bold">{step.ready ? "This step is ready" : "This step needs attention"}</p><p className="mt-0.5 text-xs">{step.detail}</p></div>
          </div>
          <p className="mt-6 text-base leading-7 text-slate-700">{step.description}</p>
          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">What to do</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">Open the linked configuration area, review the current values, and save any required changes. Return to the Setup guide to continue or restart this walkthrough at any time.</p>
            {step.href ? <a href={step.href} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white">{step.action}<ArrowRight className="h-4 w-4" /></a> : <button type="button" onClick={openSettingsSection} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white">{step.action}<ArrowRight className="h-4 w-4" /></button>}
          </div>
          <div className="mt-7 flex items-center justify-between gap-3">
            <button type="button" disabled={stepIndex === 0} onClick={() => setStepIndex(stepIndex - 1)} className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-700 disabled:opacity-40">Back</button>
            <button type="button" onClick={() => last ? onClose() : setStepIndex(stepIndex + 1)} className="rounded-xl bg-orange-500 px-6 py-3 text-sm font-bold text-white hover:bg-orange-600">{last ? "Finish walkthrough" : "Next step"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Toast({
  notice,
  onClose,
}: {
  notice: { kind: "success" | "error"; text: string };
  onClose: () => void;
}) {
  const success = notice.kind === "success";
  return (
    <div className="fixed right-5 top-5 z-50 w-[calc(100%-2.5rem)] max-w-md animate-[fadeIn_.2s_ease-out]">
      <div className={`flex items-start gap-3 rounded-2xl border bg-white p-4 shadow-2xl shadow-slate-900/15 ${success ? "border-emerald-200" : "border-red-200"}`} role="status" aria-live="polite">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${success ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"}`}>
          {success ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="text-sm font-bold text-slate-950">{success ? "Changes saved" : "Something needs attention"}</p>
          <p className="mt-1 text-sm leading-5 text-slate-600">{notice.text}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Dismiss notification" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function ConfirmDialog({
  confirmation,
  confirming,
  onCancel,
  onConfirm,
}: {
  confirmation: Confirmation;
  confirming: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-5 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="confirmation-title">
      <div className="w-full max-w-md rounded-3xl border border-white/50 bg-white p-6 shadow-2xl shadow-slate-950/25">
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-red-600">
            <AlertTriangle className="h-6 w-6" />
          </span>
          <div>
            <h2 id="confirmation-title" className="text-xl font-bold text-slate-950">{confirmation.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{confirmation.message}</p>
          </div>
        </div>
        <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" disabled={confirming} onClick={onCancel} className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
          <button type="button" disabled={confirming} onClick={onConfirm} className="flex min-w-40 items-center justify-center gap-2 rounded-xl bg-red-600 px-5 py-3 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60">
            {confirming && <LoaderCircle className="h-4 w-4 animate-spin" />}
            {confirming ? "Working…" : confirmation.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function Label({
  title,
  helper,
  children,
}: {
  title: string;
  helper?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm font-bold text-slate-700">
      {title}
      {children}
      {helper && (
        <span className="mt-2 block text-xs font-normal leading-5 text-slate-500">
          {helper}
        </span>
      )}
    </label>
  );
}
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 rounded-xl border border-slate-200 p-4 text-sm font-bold">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-orange-500"
      />
      {label}
    </label>
  );
}
function Footer({ saving, onSave }: { saving: boolean; onSave: () => void }) {
  return (
    <footer className="flex items-center justify-end border-t border-slate-100 bg-slate-50/70 px-6 py-4">
      <button
        disabled={saving}
        onClick={onSave}
        className="flex min-w-36 items-center justify-center gap-2 rounded-xl bg-orange-500 px-5 py-3 text-sm font-bold text-white hover:bg-orange-600"
      >
        {saving && <LoaderCircle className="h-4 w-4 animate-spin" />}
        {saving ? "Saving…" : "Save changes"}
      </button>
    </footer>
  );
}
