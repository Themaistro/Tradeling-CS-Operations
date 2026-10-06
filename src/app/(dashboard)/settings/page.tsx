"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  Bell,
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
} from "lucide-react";
import { PageHeading } from "@/components/ui/page-heading";

type Settings = {
  timezone: string;
  postTime: string;
  slackChannelId: string;
  slackMessageHeader: string;
  automationEnabled: boolean;
  maxConsecutiveDays: number;
  workingDays: string;
  weekStartsOn: number;
  defaultBreakMinutes: number;
  requireAcknowledgement: boolean;
  includeBreaksInSlack: boolean;
  includeNotesInSlack: boolean;
};
type Shift = {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  staffingRules: {
    dayOfWeek: number;
    minimumStaff: number;
    minimumBilingual: number;
    calls: number;
    chats: number;
    tickets: number;
  }[];
};
type Data = {
  settings: Settings;
  shifts: Shift[];
  taskCategories: { id: string; name: string; icon: string }[];
  slackConfigured: boolean;
};
type Tab = "general" | "shifts" | "tasks" | "slack" | "data";

const field =
  "mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 transition";

export default function SettingsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tab, setTab] = useState<Tab>("general");
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [coverageDay, setCoverageDay] = useState(0);

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
        minimumStaff: Number(values.get("staff")),
        minimumBilingual: Number(values.get("bilingual")),
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
    if (
      !confirm("Deactivate this shift? Existing schedule history will be kept.")
    )
      return;
    await fetch(`/api/shifts/${id}`, { method: "DELETE" });
    setNotice({ kind: "success", text: "Shift deactivated." });
    await load();
  }

  async function addCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    const form = event.currentTarget;
    const values = new FormData(form);
    const response = await fetch("/api/task-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: values.get("name"),
        icon: values.get("icon") || "📌",
      }),
    });
    setNotice({
      kind: response.ok ? "success" : "error",
      text: response.ok
        ? "Task category added."
        : (await response.json()).error,
    });
    if (response.ok) {
      form.reset();
      await load();
    }
    setSaving(false);
  }

  async function saveCoverage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const values = new FormData(event.currentTarget);
    const rules = data!.shifts.map((shift) => ({
      shiftId: shift.id,
      minimumStaff: Number(values.get(`${shift.id}-staff`)),
      minimumBilingual: Number(values.get(`${shift.id}-bilingual`)),
      calls: Number(values.get(`${shift.id}-calls`)),
      chats: Number(values.get(`${shift.id}-chats`)),
      tickets: Number(values.get(`${shift.id}-tickets`)),
    }));
    const response = await fetch("/api/staffing-rules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dayOfWeek: coverageDay, rules }),
    });
    setNotice({
      kind: response.ok ? "success" : "error",
      text: response.ok
        ? "Daily staffing rules saved."
        : "Could not save staffing rules.",
    });
    if (response.ok) await load();
    setSaving(false);
  }

  if (!data || !settings)
    return (
      <div className="flex min-h-64 items-center justify-center">
        <LoaderCircle className="h-6 w-6 animate-spin text-orange-500" />
      </div>
    );

  const tabs = [
    {
      id: "general" as const,
      label: "General",
      helper: "Working rules",
      icon: Settings2,
    },
    {
      id: "shifts" as const,
      label: "Shifts & coverage",
      helper: `${data.shifts.length} configured`,
      icon: Users,
    },
    {
      id: "tasks" as const,
      label: "Tasks & breaks",
      helper: `${data.taskCategories.length} categories`,
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
      <PageHeading
        eyebrow="Configuration"
        title="Settings"
        description="Manage your operating rules, team coverage, and Slack delivery from one place."
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatusCard
          icon={ShieldCheck}
          label="Application"
          value="Ready"
          tone="emerald"
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
          value={data.slackConfigured ? "Credentials ready" : "Setup required"}
          tone={data.slackConfigured ? "emerald" : "amber"}
        />
      </div>
      <div className="space-y-5">
        <aside className="grid rounded-2xl border border-slate-200 bg-white p-2 shadow-sm sm:grid-cols-2 xl:grid-cols-5">
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
          {notice && (
            <div
              className={`mx-6 mt-6 flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold ${notice.kind === "success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}
            >
              <CheckCircle2 className="h-4 w-4" />
              {notice.text}
            </div>
          )}

          {tab === "general" && (
            <div>
              <SectionHeader
                icon={Settings2}
                title="General settings"
                description="Set the calendar and workload rules used across the application."
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
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-700">
                    Active operating days
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Only selected days appear in daily operations and automatic
                    posting.
                  </p>
                  <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-7">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                      (d, i) => {
                        const active = settings.workingDays
                          .split(",")
                          .includes(String(i));
                        return (
                          <button
                            key={d}
                            onClick={() => {
                              const values = settings.workingDays
                                .split(",")
                                .filter(Boolean);
                              const next = active
                                ? values.filter((v) => v !== String(i))
                                : [...values, String(i)].sort();
                              setSettings({
                                ...settings,
                                workingDays: next.join(","),
                              });
                            }}
                            className={`rounded-xl border px-3 py-3 text-sm font-bold ${active ? "border-orange-500 bg-orange-50 text-orange-700" : "border-slate-200 text-slate-400"}`}
                          >
                            {d}
                          </button>
                        );
                      },
                    )}
                  </div>
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
                title="Shifts and coverage"
                description="Create the working periods and minimum staffing levels used by the schedule generator."
              />
              <div className="p-6">
                <div className="space-y-3">
                  {data.shifts.length ? (
                    data.shifts.map((shift) => (
                      <div
                        key={shift.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-4"
                      >
                        <div>
                          <p className="font-bold text-slate-900">
                            {shift.name}
                          </p>
                          <p className="mt-1 text-sm text-slate-500">
                            {shift.startTime}–{shift.endTime}
                          </p>
                        </div>
                        <div className="flex gap-2 text-xs font-semibold">
                          <span className="rounded-full bg-blue-50 px-3 py-1.5 text-blue-700">
                            {shift.staffingRules[0]?.minimumStaff ?? 0} minimum
                          </span>
                          <span className="rounded-full bg-violet-50 px-3 py-1.5 text-violet-700">
                            {shift.staffingRules[0]?.minimumBilingual ?? 0}{" "}
                            bilingual
                          </span>
                          <button
                            onClick={() => removeShift(shift.id)}
                            className="rounded-lg p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">
                      No shifts configured yet.
                    </p>
                  )}
                </div>
                {data.shifts.length > 0 && (
                  <form
                    onSubmit={saveCoverage}
                    className="mt-7 rounded-2xl border border-slate-200 p-5"
                  >
                    <h3 className="font-bold text-slate-900">
                      Daily staffing rules
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Set staffing and task coverage separately for each
                      weekday.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                        (day, index) => (
                          <button
                            type="button"
                            key={day}
                            onClick={() => setCoverageDay(index)}
                            className={`rounded-lg px-4 py-2 text-xs font-bold ${coverageDay === index ? "bg-orange-500 text-white" : "bg-slate-100 text-slate-600"}`}
                          >
                            {day}
                          </button>
                        ),
                      )}
                    </div>
                    <div className="mt-5 space-y-4">
                      {data.shifts.map((shift) => {
                        const rule = shift.staffingRules.find(
                          (item) => item.dayOfWeek === coverageDay,
                        );
                        return (
                          <div
                            key={`${shift.id}-${coverageDay}`}
                            className="rounded-xl bg-slate-50 p-4"
                          >
                            <p className="font-bold">{shift.name}</p>
                            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">
                              {[
                                [
                                  "staff",
                                  "Minimum staff",
                                  rule?.minimumStaff ?? 0,
                                ],
                                [
                                  "bilingual",
                                  "Bilingual",
                                  rule?.minimumBilingual ?? 0,
                                ],
                                ["calls", "Calls", rule?.calls ?? 0],
                                ["chats", "Chats", rule?.chats ?? 0],
                                ["tickets", "Tickets", rule?.tickets ?? 0],
                              ].map(([key, label, value]) => (
                                <label
                                  key={String(key)}
                                  className="text-xs font-bold text-slate-500"
                                >
                                  {label}
                                  <input
                                    name={`${shift.id}-${key}`}
                                    type="number"
                                    min="0"
                                    defaultValue={value}
                                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900"
                                  />
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <button
                      disabled={saving}
                      className="mt-4 rounded-xl bg-orange-500 px-5 py-3 text-sm font-bold text-white"
                    >
                      Save coverage rules
                    </button>
                  </form>
                )}
                <form
                  onSubmit={addShift}
                  className="mt-7 rounded-2xl border border-slate-200 bg-slate-50 p-5"
                >
                  <h3 className="font-bold text-slate-900">Add a shift</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Coverage requirements will initially apply to every day of
                    the week.
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
                    <Label title="Minimum staff">
                      <input
                        required
                        name="staff"
                        type="number"
                        min="0"
                        defaultValue="1"
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
                    <Label title="Minimum bilingual staff">
                      <input
                        required
                        name="bilingual"
                        type="number"
                        min="0"
                        defaultValue="0"
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
                title="Tasks and breaks"
                description="Control the task choices and default break settings used by daily operations."
              />
              <div className="grid gap-6 p-6 lg:grid-cols-[1.2fr_0.8fr]">
                <div>
                  <p className="text-sm font-bold text-slate-700">
                    Task categories
                  </p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {data.taskCategories.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center gap-3 rounded-xl border border-slate-200 p-4"
                      >
                        <span className="text-xl">{c.icon}</span>
                        <b className="text-sm">{c.name}</b>
                      </div>
                    ))}
                  </div>
                  <form
                    onSubmit={addCategory}
                    className="mt-4 flex gap-3 rounded-xl bg-slate-50 p-4"
                  >
                    <input
                      name="icon"
                      maxLength={8}
                      placeholder="📌"
                      className="w-16 rounded-xl border border-slate-200 px-3 text-center"
                    />
                    <input
                      required
                      name="name"
                      placeholder="New task category"
                      className="min-w-0 flex-1 rounded-xl border border-slate-200 px-4"
                    />
                    <button className="rounded-xl bg-slate-950 px-4 font-bold text-white">
                      <Plus className="h-4 w-4" />
                    </button>
                  </form>
                </div>
                <div>
                  <Label
                    title="Default break length"
                    helper="Suggested when a break is added to a daily assignment"
                  >
                    <div className="relative">
                      <input
                        type="number"
                        min="0"
                        max="240"
                        value={settings.defaultBreakMinutes}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            defaultBreakMinutes: Number(e.target.value),
                          })
                        }
                        className={field}
                      />
                      <span className="absolute bottom-3 right-4 text-xs text-slate-400">
                        minutes
                      </span>
                    </div>
                  </Label>
                  <label className="mt-5 flex gap-3 rounded-xl border border-slate-200 p-4">
                    <input
                      type="checkbox"
                      checked={settings.requireAcknowledgement}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          requireAcknowledgement: e.target.checked,
                        })
                      }
                      className="accent-orange-500"
                    />
                    <span className="text-sm font-bold">
                      Require Slack acknowledgement
                    </span>
                  </label>
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
                      ? "The host has supplied the bot and app tokens."
                      : "Your technical administrator must add the bot and app tokens to the hosting environment."}
                  </p>
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
