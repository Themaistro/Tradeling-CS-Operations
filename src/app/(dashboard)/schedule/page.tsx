"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, LoaderCircle, LockOpen } from "lucide-react";
import { PageHeading } from "@/components/ui/page-heading";
type Period = {
  status: string;
  warnings?: { date: string; shiftId: string; severity: string; code: string; message: string }[];
  assignments: {
    id: string;
    date: string;
    status: string;
    employee: { name: string };
    shift: { id: string; name: string } | null;
  }[];
} | null;
type Shift = { id: string; name: string; startTime: string; endTime: string };
export default function SchedulePage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [period, setPeriod] = useState<Period>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [shifts, setShifts] = useState<Shift[]>([]);
  const load = () =>
    fetch(`/api/schedule?year=${year}&month=${month}`)
      .then((r) => r.json())
      .then(setPeriod);
  useEffect(() => {
    void fetch(`/api/schedule?year=${year}&month=${month}`)
      .then((r) => r.json())
      .then(setPeriod);
  }, [year, month]);
  useEffect(() => {
    void fetch("/api/shifts").then((response) => response.json()).then(setShifts);
  }, []);
  async function generate() {
    setLoading(true);
    const r = await fetch("/api/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year, month }),
    });
    const body = await r.json();
    setMessage(
      r.ok
        ? `Schedule generated${body.warnings?.length ? ` with ${body.warnings.length} coverage warning(s)` : " successfully"}.`
        : body.error,
    );
    await load();
    setLoading(false);
  }
  async function approve(overrideCoverage = false) {
    setLoading(true);
    const r = await fetch("/api/schedule", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year, month, status: "APPROVED", overrideCoverage }),
    });
    const body = await r.json();
    if (!r.ok && body.code === "COVERAGE_BLOCKED") {
      setLoading(false);
      if (confirm(`${body.shortages.length} coverage issue(s) remain. Approve with an explicit coverage exception?`)) await approve(true);
      return;
    }
    setMessage(r.ok ? "Schedule approved. The roster is now available in Daily Tasks." : body.error ?? "Could not approve the schedule.");
    await load();
    setLoading(false);
  }
  async function publish() {
    setLoading(true);
    const response = await fetch("/api/schedule", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ year, month, status: "PUBLISHED" }) });
    const body = await response.json();
    setMessage(response.ok ? "Schedule published. Reopen it whenever you need to make changes or generate a replacement." : body.error ?? "Could not publish the schedule.");
    await load();
    setLoading(false);
  }
  async function reopen() {
    setLoading(true);
    const response = await fetch("/api/schedule", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year, month, status: "DRAFT" }),
    });
    const body = await response.json();
    setMessage(response.ok ? "Schedule reopened for changes. Review and approve it again when ready." : body.error ?? "Could not reopen the schedule.");
    await load();
    setLoading(false);
  }
  async function editAssignment(id: string, status: string, shiftId?: string | null) {
    const response = await fetch("/api/schedule/assignment", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, shiftId: status === "WORKING" ? shiftId : null }),
    });
    setMessage(
      response.ok
        ? "Assignment updated. Coverage checks have been refreshed."
        : (await response.json()).error,
    );
    await load();
  }
  const working =
    period?.assignments.filter((a) => a.status === "WORKING") ?? [];
  const grouped = Object.groupBy(period?.assignments ?? [], (a) => a.date.slice(0, 10));
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="Workforce planning"
        title="Schedule Generator"
        description="Generate, review, and approve the monthly roster before using it in daily operations."
      />
      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-[minmax(180px,1fr)_140px_auto] md:items-end">
        <label className="text-sm font-semibold">
          Month
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="mt-2 block w-full rounded-xl border border-slate-200 px-4 py-3"
          >
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i} value={i + 1}>
                {new Date(2020, i).toLocaleString("en", { month: "long" })}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          Year
          <input
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            type="number"
            className="mt-2 block w-28 rounded-xl border border-slate-200 px-4 py-3"
          />
        </label>
        {(!period || period.status === "DRAFT") && <button
          disabled={loading}
          onClick={generate}
          className="flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-3 font-bold text-white"
        >
          {loading ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <CalendarDays className="h-4 w-4" />
          )}
          {period?.status === "DRAFT" ? "Regenerate draft" : "Generate schedule"}
        </button>}
        </div>
        <div className="mt-4 flex flex-wrap gap-3 border-t border-slate-100 pt-4">
        {period?.status === "DRAFT" && (
          <button
            disabled={loading}
            onClick={() => void approve()}
            className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 font-bold text-white"
          >
            <CheckCircle2 className="h-4 w-4" />
            Approve schedule
          </button>
        )}
        {period?.status === "APPROVED" && (
          <>
            <button disabled={loading} onClick={reopen} className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-5 py-3 font-bold text-amber-800"><LockOpen className="h-4 w-4" />Reopen for changes</button>
            <button disabled={loading} onClick={publish} className="flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-3 font-bold text-white"><CheckCircle2 className="h-4 w-4" />Publish and lock</button>
          </>
        )}
        {period?.status === "PUBLISHED" && (
          <button disabled={loading} onClick={reopen} className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-5 py-3 font-bold text-amber-800"><LockOpen className="h-4 w-4" />Reopen for changes</button>
        )}
        {period && <span className={`inline-flex items-center rounded-xl px-4 py-3 text-xs font-bold ${period.status === "PUBLISHED" ? "bg-emerald-50 text-emerald-700" : period.status === "APPROVED" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"}`}>Status: {period.status}</span>}
        </div>
      </div>
      {message && (
        <p className="mb-5 rounded-xl bg-blue-50 p-4 text-sm font-semibold text-blue-700">
          {message}
        </p>
      )}
      {!period ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-14 text-center text-slate-500">
          No schedule exists for this month yet.
        </div>
      ) : (
        <div>
          <p className="mb-4 text-sm font-semibold text-slate-500">
            {working.length} working assignments in this monthly roster
          </p>
          {!!period.warnings?.length && (
            <section className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <div className="flex items-center gap-2 font-bold text-amber-900">
                <AlertTriangle className="h-5 w-5" />
                Coverage review required · {period.warnings.length} issue{period.warnings.length === 1 ? "" : "s"}
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {period.warnings.slice(0, 12).map((warning, index) => (
                  <div key={`${warning.date}-${warning.shiftId}-${warning.code}-${index}`} className="rounded-xl bg-white px-4 py-3 text-sm text-amber-900">
                    <b>{new Date(`${warning.date}T12:00:00`).toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" })}</b>
                    <span className="ml-2">{warning.message}</span>
                  </div>
                ))}
              </div>
              {period.warnings.length > 12 && <p className="mt-3 text-xs font-semibold text-amber-800">Showing the first 12 issues. Adjust staffing rules or assignments and refresh the schedule to review the remainder.</p>}
            </section>
          )}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Object.entries(grouped).map(([date, items]) => (
              <article
                key={date}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <h2 className="font-bold">
                  {new Date(`${date}T12:00:00`).toLocaleDateString("en", {
                    weekday: "long",
                    month: "short",
                    day: "numeric",
                  })}
                </h2>
                <div className="mt-4 space-y-2">
                  {items?.map((a) => (
                    <div
                      key={a.id}
                      className="grid grid-cols-[minmax(0,1fr)_110px] gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <b className="block truncate">{a.employee.name}</b>
                        {a.status === "WORKING" && period.status === "DRAFT" ? (
                          <select
                            aria-label={`Shift for ${a.employee.name}`}
                            value={a.shift?.id ?? ""}
                            onChange={(event) => void editAssignment(a.id, "WORKING", event.target.value)}
                            className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs"
                          >
                            {shifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.name} · {shift.startTime}–{shift.endTime}</option>)}
                          </select>
                        ) : <span className="text-xs text-slate-500">{a.shift?.name ?? a.status}</span>}
                      </div>
                      {period.status === "DRAFT" ? (
                        <select
                          aria-label={`Status for ${a.employee.name}`}
                          value={a.status}
                          onChange={(event) => void editAssignment(a.id, event.target.value, event.target.value === "WORKING" ? shifts[0]?.id : null)}
                          className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold"
                        >
                          <option value="WORKING">Working</option>
                          <option value="OFF">Off</option>
                          <option value="PTO">PTO</option>
                          <option value="SICK">Sick</option>
                        </select>
                      ) : <span className="text-right text-xs font-bold text-slate-500">{a.status}</span>}
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
