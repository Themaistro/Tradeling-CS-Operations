"use client";
import { FormEvent, useEffect, useState } from "react";
import {
  CalendarOff,
  Languages,
  LoaderCircle,
  Pencil,
  Plus,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { PageHeading } from "@/components/ui/page-heading";
type Shift = { id: string; name: string };
type Leave = {
  date: string;
  type: "PTO" | "SICK" | "UNPAID" | "OTHER";
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
export default function TeamPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [selected, setSelected] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  async function load() {
    const [e, s] = await Promise.all([
      fetch("/api/team").then((r) => r.json()),
      fetch("/api/settings").then((r) => r.json()),
    ]);
    setEmployees(e);
    setShifts(s.shifts);
    setLoading(false);
  }
  useEffect(() => {
    void Promise.all([
      fetch("/api/team").then((r) => r.json()),
      fetch("/api/settings").then((r) => r.json()),
    ]).then(([e, s]) => {
      setEmployees(e);
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
                    onClick={() => setSelected(employee)}
                    className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => archive(employee.id)}
                    className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
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
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
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
    if (r.ok) await onSaved();
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
            <p className="text-sm font-bold">PTO and leave</p>
          </div>
          <div className="mt-3 space-y-2">
            {leave.map((l, i) => (
              <div
                key={`${l.date}-${i}`}
                className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm"
              >
                <b>{l.date}</b>
                <span>{l.type}</span>
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
          <div className="mt-3 grid grid-cols-[1fr_110px_auto] gap-2">
            <input
              id="leave-date"
              type="date"
              className="rounded-xl border border-slate-200 px-3"
            />
            <select
              id="leave-type"
              className="rounded-xl border border-slate-200 px-2"
            >
              <option>PTO</option>
              <option>SICK</option>
              <option>UNPAID</option>
              <option>OTHER</option>
            </select>
            <button
              type="button"
              onClick={() => {
                const date = (
                  document.getElementById("leave-date") as HTMLInputElement
                ).value;
                const type = (
                  document.getElementById("leave-type") as HTMLSelectElement
                ).value as Leave["type"];
                if (date && !leave.some((l) => l.date === date))
                  setLeave((v) => [...v, { date, type, note: null }]);
              }}
              className="rounded-xl bg-slate-950 px-4 py-3 text-white"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
        <button className="mt-8 w-full rounded-xl bg-orange-500 py-3 font-bold text-white">
          Save employee
        </button>
      </form>
    </div>
  );
}
