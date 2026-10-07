"use client";

import { useEffect, useState } from "react";
import { History, LoaderCircle, X } from "lucide-react";

type Entry = { employeeId: string; date: string; status: string; shiftId: string | null; workLocation: "OFFICE" | "WFH" };
type Data = {
  dates: string[];
  employees: { id: string; name: string; isBilingual: boolean }[];
  shifts: { id: string; name: string; startTime: string; endTime: string }[];
  categories: { id: string; name: string }[];
  entries: Entry[];
  rotations: { employeeId: string; taskCategoryId: string | null }[];
  saved: boolean;
  inherited: boolean;
};

const statuses = [
  ["WORKING", "W"], ["OFF", "OFF"], ["ANNUAL_LEAVE", "AL"], ["COMP_OFF", "CO"],
  ["PUBLIC_HOLIDAY", "PH"], ["SICK", "SL"], ["EMERGENCY_LEAVE", "EL"],
];

export function OpeningHistoryDialog({ year, month, onClose, onSaved }: { year: number; month: number; onClose: () => void; onSaved: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { void fetch(`/api/schedule/history?year=${year}&month=${month}`).then((response) => response.json()).then(setData); }, [year, month]);
  function updateEntry(employeeId: string, date: string, update: Partial<Entry>) {
    setData((current) => current ? { ...current, entries: current.entries.map((entry) => entry.employeeId === employeeId && entry.date === date ? { ...entry, ...update } : entry) } : current);
  }
  function updateEmployee(employeeId: string, update: Partial<Entry>) {
    setData((current) => current ? { ...current, entries: current.entries.map((entry) => entry.employeeId === employeeId ? { ...entry, ...update } : entry) } : current);
  }
  async function save() {
    if (!data) return;
    setSaving(true); setError("");
    const response = await fetch("/api/schedule/history", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ year, month, entries: data.entries, rotations: data.rotations }) });
    const body = await response.json();
    if (!response.ok) { setError(body.error ?? "The history could not be saved."); setSaving(false); return; }
    onSaved(); onClose();
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
    <div className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
      <header className="flex items-start justify-between border-b border-slate-200 p-6">
        <div className="flex gap-3"><span className="rounded-xl bg-orange-50 p-3 text-orange-600"><History className="h-5 w-5" /></span><div><h2 className="text-xl font-bold">Previous seven days</h2><p className="mt-1 text-sm text-slate-500">Confirm the handover before generating {new Date(Date.UTC(year, month - 1)).toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" })}. This is needed only for the first transition or when previous approved data is unavailable.</p></div></div>
        <button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X /></button>
      </header>
      {!data ? <div className="flex flex-1 items-center justify-center p-20"><LoaderCircle className="animate-spin text-orange-500" /></div> : <div className="flex-1 overflow-auto p-6">
        <div className={`mb-4 rounded-xl p-4 text-sm ${data.saved ? "bg-emerald-50 text-emerald-800" : data.inherited ? "bg-blue-50 text-blue-800" : "bg-amber-50 text-amber-800"}`}>
          <b>{data.saved ? "Opening history saved." : data.inherited ? "History prefilled from the last approved schedule." : "No approved history was found."}</b> Review the information below before saving.
        </div>
        <table className="min-w-[1150px] w-full border-collapse text-sm">
          <thead><tr className="bg-slate-950 text-white"><th className="sticky left-0 z-10 bg-slate-950 p-3 text-left">Agent</th><th className="p-3">Shift</th><th className="p-3">Current focus task</th>{data.dates.map((date) => <th key={date} className="min-w-24 p-3 text-center"><span className="block text-xs text-slate-300">{new Date(`${date}T12:00:00Z`).toLocaleDateString("en", { weekday: "short", timeZone: "UTC" })}</span>{new Date(`${date}T12:00:00Z`).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" })}</th>)}</tr></thead>
          <tbody>{data.employees.map((employee) => {
            const employeeEntries = data.entries.filter((entry) => entry.employeeId === employee.id);
            const shiftId = employeeEntries.find((entry) => entry.status === "WORKING")?.shiftId ?? data.shifts[0]?.id ?? "";
            const rotation = data.rotations.find((item) => item.employeeId === employee.id);
            return <tr key={employee.id} className="border-b border-slate-200"><th className="sticky left-0 bg-white p-3 text-left"><b>{employee.name}</b>{employee.isBilingual && <span className="ml-2 rounded bg-emerald-50 px-2 py-1 text-[10px] text-emerald-700">Arabic</span>}</th><td className="p-2"><select value={shiftId} onChange={(event) => updateEmployee(employee.id, { shiftId: event.target.value })} className="w-36 rounded-lg border border-slate-200 px-2 py-2 text-xs">{data.shifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.name}</option>)}</select></td><td className="p-2"><select value={rotation?.taskCategoryId ?? ""} onChange={(event) => setData((current) => current ? { ...current, rotations: current.rotations.map((item) => item.employeeId === employee.id ? { ...item, taskCategoryId: event.target.value || null } : item) } : current)} className="w-44 rounded-lg border border-slate-200 px-2 py-2 text-xs"><option value="">Not specified</option>{data.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></td>{data.dates.map((date) => { const entry = employeeEntries.find((item) => item.date === date)!; return <td key={date} className="p-2 text-center"><select value={entry.status} onChange={(event) => updateEntry(employee.id, date, { status: event.target.value, shiftId: event.target.value === "WORKING" ? entry.shiftId || shiftId : null })} className={`w-full rounded-lg border px-2 py-2 text-xs font-bold ${entry.status === "WORKING" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : entry.status === "OFF" ? "border-orange-200 bg-orange-50 text-orange-800" : "border-violet-200 bg-violet-50 text-violet-800"}`}>{statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>; })}</tr>;
          })}</tbody>
        </table>
        <p className="mt-4 text-xs text-slate-500">W = working, AL = annual leave, CO = comp off, PH = public holiday, SL = sick leave, EL = emergency leave. The selected shift applies to the employee’s working days.</p>
        {error && <p className="mt-4 rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</p>}
      </div>}
      <footer className="flex justify-end gap-3 border-t border-slate-200 p-5"><button onClick={onClose} className="rounded-xl border border-slate-200 px-5 py-3 font-bold text-slate-600">Cancel</button><button disabled={!data || saving} onClick={save} className="flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-3 font-bold text-white disabled:opacity-50">{saving && <LoaderCircle className="h-4 w-4 animate-spin" />}Save history</button></footer>
    </div>
  </div>;
}
