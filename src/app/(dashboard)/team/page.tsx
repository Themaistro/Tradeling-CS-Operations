"use client";
import { FormEvent, useEffect, useState } from "react";
import {
  CalendarOff,
  Archive,
  Languages,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { PageHeading } from "@/components/ui/page-heading";
type Shift = { id: string; name: string };
type Leave = {
  date: string;
  type: "PTO" | "ANNUAL_LEAVE" | "EMERGENCY_LEAVE" | "COMP_OFF" | "PUBLIC_HOLIDAY" | "SICK" | "UNPAID" | "OTHER" | "UNPAID_LEAVE" | "OTHER_LEAVE";
  note: string | null;
};
type Employee = {
  id: string;
  name: string;
  slackId: string | null;
  isBilingual: boolean;
  preferredShiftId: string | null;
  preferredShift: Shift | null;
  dayOffPreferences: { dayOfWeek: number }[];
  timeOff: Leave[];
};
const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const leaveLabels: Record<Leave["type"], string> = {
  PTO: "Annual leave",
  ANNUAL_LEAVE: "Annual leave",
  EMERGENCY_LEAVE: "Emergency leave",
  COMP_OFF: "Comp off",
  PUBLIC_HOLIDAY: "Public holiday",
  SICK: "Sick leave",
  UNPAID: "Unpaid leave",
  OTHER: "Other leave",
  UNPAID_LEAVE: "Unpaid leave",
  OTHER_LEAVE: "Other leave",
};
export default function TeamPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [archivedEmployees, setArchivedEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [selected, setSelected] = useState<Employee | null>(null);
  const [pendingPermanentDelete, setPendingPermanentDelete] = useState<Employee | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  async function load() {
    const [e, archived, s] = await Promise.all([
      fetch("/api/team").then((r) => r.json()),
      fetch("/api/team?status=archived").then((r) => r.json()),
      fetch("/api/settings").then((r) => r.json()),
    ]);
    setEmployees(e);
    setArchivedEmployees(archived);
    setShifts(s.shifts);
    setLoading(false);
  }
  useEffect(() => {
    void Promise.all([
      fetch("/api/team").then((r) => r.json()),
      fetch("/api/team?status=archived").then((r) => r.json()),
      fetch("/api/settings").then((r) => r.json()),
    ]).then(([e, archived, s]) => {
      setEmployees(e);
      setArchivedEmployees(archived);
      setShifts(s.shifts);
      setLoading(false);
    });
  }, []);
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      f = new FormData(form);
    const r = await fetch("/api/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: f.get("name"),
        slackId: f.get("slackId"),
        isBilingual: f.get("bilingual") === "on",
      }),
    });
    setMessage(r.ok ? "Team member added." : (await r.json()).error);
    if (r.ok) {
      form.reset();
      await load();
    }
  }
  async function archive(id: string) {
    if (
      !confirm(
        "Remove this employee from the active team? Schedule history will be kept.",
      )
    )
      return;
    await fetch(`/api/team/${id}`, { method: "DELETE" });
    setSelected(null);
    await load();
  }
  async function restore(id: string) {
    const response = await fetch(`/api/team/${id}`, { method: "PUT" });
    const body = await response.json();
    setMessage(response.ok ? "Employee restored to the active team." : body.error || "The employee could not be restored.");
    if (response.ok) await load();
  }
  async function permanentlyDelete() {
    if (!pendingPermanentDelete) return;
    setDeleting(true);
    const response = await fetch(`/api/team/${pendingPermanentDelete.id}?permanent=true`, { method: "DELETE" });
    const body = await response.json();
    setDeleting(false);
    if (!response.ok) {
      setMessage(body.error || "The archived employee could not be deleted.");
      return;
    }
    setMessage(`${pendingPermanentDelete.name} was permanently deleted.`);
    setPendingPermanentDelete(null);
    await load();
  }
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="People and availability"
        title="Team"
        description="Manage the employee information used by schedules, daily tasks, leave, and Slack."
      />
      {message && (
        <p className="mb-5 rounded-xl bg-blue-50 p-4 text-sm font-semibold text-blue-700">
          {message}
        </p>
      )}
      <div className="grid gap-6 xl:grid-cols-[340px_1fr]">
        <form
          onSubmit={add}
          className="h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <h2 className="font-bold">Add team member</h2>
          <input
            required
            name="name"
            placeholder="Full name"
            className="mt-4 w-full rounded-xl border border-slate-200 px-4 py-3"
          />
          <input
            name="slackId"
            placeholder="Slack member ID"
            className="mt-3 w-full rounded-xl border border-slate-200 px-4 py-3"
          />
          <label className="mt-3 flex gap-3 rounded-xl bg-slate-50 p-4 text-sm font-bold">
            <input
              name="bilingual"
              type="checkbox"
              className="accent-orange-500"
            />
            Bilingual coverage
          </label>
          <button className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 py-3 font-bold text-white">
            <Plus className="h-4 w-4" />
            Add employee
          </button>
        </form>
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          {loading ? (
            <div className="flex justify-center p-16">
              <LoaderCircle className="animate-spin text-orange-500" />
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {employees.map((employee) => (
                <div key={employee.id} className="flex items-center gap-4 p-5">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-orange-50 text-orange-600">
                    <UserRound className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <b>{employee.name}</b>
                      {employee.isBilingual && (
                        <Languages className="h-4 w-4 text-blue-600" />
                      )}
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {employee.preferredShift?.name || "Any shift"} ·{" "}
                      {employee.slackId || "No Slack ID"} ·{" "}
                      {employee.timeOff.length} leave day(s)
                    </p>
                  </div>
                  <button
                    aria-label={`Edit ${employee.name}`}
                    onClick={() => setSelected(employee)}
                    className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    aria-label={`Archive ${employee.name}`}
                    onClick={() => archive(employee.id)}
                    className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Archive className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      <details className="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600"><Archive className="h-5 w-5" /></span><div><h2 className="font-bold text-slate-950">Archived agents</h2><p className="mt-1 text-sm text-slate-500">Restore former employees while keeping their previous schedule history.</p></div></div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{archivedEmployees.length}</span>
        </summary>
        <div className="border-t border-slate-100 p-5">
          {archivedEmployees.length ? <div className="grid gap-3 md:grid-cols-2">{archivedEmployees.map((employee) => <div key={employee.id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-4"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500"><UserRound className="h-5 w-5" /></span><div className="min-w-0 flex-1"><p className="font-bold text-slate-900">{employee.name}</p><p className="truncate text-xs text-slate-500">{employee.slackId || "No Slack ID"} · History preserved</p></div><div className="flex items-center gap-2"><button type="button" onClick={() => void restore(employee.id)} className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100"><RotateCcw className="h-4 w-4" />Restore</button><button type="button" aria-label={`Permanently delete ${employee.name}`} onClick={() => setPendingPermanentDelete(employee)} className="rounded-lg border border-red-200 p-2 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button></div></div>)}</div> : <p className="rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-500">No archived agents.</p>}
        </div>
      </details>
      {pendingPermanentDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="permanent-delete-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-red-600"><Trash2 className="h-5 w-5" /></span>
            <h2 id="permanent-delete-title" className="mt-4 text-xl font-bold text-slate-950">Permanently delete {pendingPermanentDelete.name}?</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">This removes the archived profile and all schedule, task, break, leave, and rotation history linked to it. This action cannot be undone.</p>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" disabled={deleting} onClick={() => setPendingPermanentDelete(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" disabled={deleting} onClick={() => void permanentlyDelete()} className="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60">{deleting && <LoaderCircle className="h-4 w-4 animate-spin" />}{deleting ? "Deleting…" : "Delete permanently"}</button>
            </div>
          </div>
        </div>
      )}
      {selected && (
        <EmployeeEditor
          employee={selected}
          shifts={shifts}
          onClose={() => setSelected(null)}
          onSaved={async () => {
            setSelected(null);
            setMessage("Employee availability updated.");
            await load();
          }}
        />
      )}
    </div>
  );
}
function EmployeeEditor({
  employee,
  shifts,
  onClose,
  onSaved,
}: {
  employee: Employee;
  shifts: Shift[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [daysOff, setDaysOff] = useState(
    employee.dayOffPreferences.map((d) => d.dayOfWeek),
  );
  const [leave, setLeave] = useState<Leave[]>(
    employee.timeOff.map((l) => ({ ...l, date: l.date.slice(0, 10) })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const f = new FormData(e.currentTarget);
    const r = await fetch(`/api/team/${employee.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: f.get("name"),
        slackId: f.get("slackId") || null,
        isBilingual: f.get("bilingual") === "on",
        preferredShiftId: f.get("shift") || null,
        daysOff,
        timeOff: leave,
      }),
    });
    const body = await r.json();
    if (r.ok) await onSaved();
    else setError(body.error || "The employee could not be saved.");
    setSaving(false);
  }
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40">
      <form
        onSubmit={save}
        className="h-full w-full max-w-xl overflow-y-auto bg-white p-7 shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold">Employee availability</h2>
            <p className="mt-1 text-sm text-slate-500">
              Used by schedule generation and daily operations.
            </p>
          </div>
          <button type="button" onClick={onClose}>
            <X />
          </button>
        </div>
        <label className="mt-6 block text-sm font-bold">
          Full name
          <input
            name="name"
            defaultValue={employee.name}
            className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3"
          />
        </label>
        <label className="mt-4 block text-sm font-bold">
          Slack ID
          <input
            name="slackId"
            defaultValue={employee.slackId || ""}
            className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3"
          />
          <span className="mt-2 block text-xs font-normal text-slate-500">Use the member ID from the agent’s Slack profile. Each ID can belong to only one active employee.</span>
        </label>
        <label className="mt-4 block text-sm font-bold">
          Preferred shift
          <select
            name="shift"
            defaultValue={employee.preferredShiftId || ""}
            className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3"
          >
            <option value="">Any shift</option>
            {shifts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-4 flex gap-3 rounded-xl bg-blue-50 p-4 text-sm font-bold">
          <input
            name="bilingual"
            type="checkbox"
            defaultChecked={employee.isBilingual}
          />
          Bilingual employee
        </label>
        <div className="mt-6">
          <p className="text-sm font-bold">Preferred days off</p>
          <div className="mt-3 grid grid-cols-7 gap-2">
            {days.map((d, i) => (
              <button
                type="button"
                key={d}
                onClick={() =>
                  setDaysOff((v) =>
                    v.includes(i) ? v.filter((x) => x !== i) : [...v, i],
                  )
                }
                className={`rounded-lg border py-2 text-xs font-bold ${daysOff.includes(i) ? "border-orange-500 bg-orange-50 text-orange-700" : "border-slate-200 text-slate-500"}`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-7">
          <div className="flex items-center gap-2">
            <CalendarOff className="h-4 w-4 text-orange-500" />
            <div>
              <p className="text-sm font-bold">Leave and planned exceptions</p>
              <p className="mt-1 text-xs text-slate-500">Add annual leave, comp off, and public holidays before generating the roster. Emergency leave updates an existing schedule immediately.</p>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {leave.map((l, i) => (
              <div
                key={`${l.date}-${i}`}
                className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm"
              >
                <b>{l.date}</b>
                <span>{leaveLabels[l.type]}</span>
                <button
                  type="button"
                  onClick={() => setLeave((v) => v.filter((_, x) => x !== i))}
                  className="ml-auto"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-500">Start date
              <input id="leave-date" type="date" className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-3 text-sm text-slate-900" />
            </label>
            <label className="text-xs font-semibold text-slate-500">End date <span className="font-normal">(optional)</span>
              <input id="leave-end-date" type="date" className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-3 text-sm text-slate-900" />
            </label>
            <select
              id="leave-type"
              className="rounded-xl border border-slate-200 px-3 py-3 text-sm sm:col-span-2"
            >
              <option value="ANNUAL_LEAVE">Annual leave</option>
              <option value="EMERGENCY_LEAVE">Emergency leave</option>
              <option value="COMP_OFF">Comp off</option>
              <option value="PUBLIC_HOLIDAY">Public holiday</option>
              <option value="SICK">Sick leave</option>
              <option value="UNPAID_LEAVE">Unpaid leave</option>
              <option value="OTHER_LEAVE">Other leave</option>
            </select>
            <button
              type="button"
              onClick={() => {
                const start = (
                  document.getElementById("leave-date") as HTMLInputElement
                ).value;
                const end = (document.getElementById("leave-end-date") as HTMLInputElement).value || start;
                const type = (
                  document.getElementById("leave-type") as HTMLSelectElement
                ).value as Leave["type"];
                if (!start || end < start) return;
                const dates: Leave[] = [];
                const cursor = new Date(`${start}T00:00:00.000Z`);
                const last = new Date(`${end}T00:00:00.000Z`);
                while (cursor <= last) {
                  const date = cursor.toISOString().slice(0, 10);
                  if (!leave.some((item) => item.date === date)) dates.push({ date, type, note: null });
                  cursor.setUTCDate(cursor.getUTCDate() + 1);
                }
                setLeave((value) => [...value, ...dates].sort((left, right) => left.date.localeCompare(right.date)));
              }}
              className="flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white sm:col-span-2"
            >
              <Plus className="h-4 w-4" /> Add leave dates
            </button>
          </div>
        </div>
        {error && <p role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</p>}
        <button disabled={saving} className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 py-3 font-bold text-white disabled:opacity-60">
          {saving && <LoaderCircle className="h-4 w-4 animate-spin" />}
          {saving ? "Saving employee…" : "Save employee"}
        </button>
      </form>
    </div>
  );
}
