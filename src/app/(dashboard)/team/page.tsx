"use client";

import { FormEvent, useEffect, useState } from "react";
import { Languages, LoaderCircle, Plus, Trash2, UserRound } from "lucide-react";
import { PageHeading } from "@/components/ui/page-heading";

type Employee = { id: string; name: string; slackId: string | null; isBilingual: boolean };

export default function TeamPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/team");
      if (!response.ok) throw new Error();
      setEmployees(await response.json());
    } catch { setError("Could not load the team. Check the database connection."); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    let active = true;
    fetch("/api/team").then((response) => {
      if (!response.ok) throw new Error();
      return response.json();
    }).then((data) => { if (active) setEmployees(data); })
      .catch(() => { if (active) setError("Could not load the team. Check the database connection."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function addEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    const target = event.currentTarget;
    const form = new FormData(target);
    const response = await fetch("/api/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name"), slackId: form.get("slackId"), isBilingual: form.get("isBilingual") === "on" }) });
    if (response.ok) { target.reset(); await load(); }
    else setError((await response.json()).error ?? "Could not add this employee.");
    setSaving(false);
  }

  async function archive(id: string) {
    if (!confirm("Remove this employee from the active team? Existing schedule history will be kept.")) return;
    await fetch(`/api/team/${id}`, { method: "DELETE" }); await load();
  }

  return <div className="mx-auto max-w-7xl">
    <PageHeading eyebrow="People" title="Team" description="One team directory shared by scheduling, daily tasks, and Slack." />
    <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
      <form onSubmit={addEmployee} className="h-fit rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">Add team member</h2><p className="mt-1 text-sm text-slate-500">Slack ID can be added now or later.</p>
        <label className="mt-6 block text-sm font-semibold text-slate-700">Full name<input required name="name" placeholder="e.g. Sarah Ahmed" className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3" /></label>
        <label className="mt-4 block text-sm font-semibold text-slate-700">Slack member ID<input name="slackId" placeholder="e.g. U012ABC34" className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3" /></label>
        <label className="mt-4 flex items-center gap-3 rounded-xl bg-slate-50 p-4 text-sm font-semibold text-slate-700"><input type="checkbox" name="isBilingual" className="h-4 w-4 accent-orange-500" /> Bilingual coverage</label>
        {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button disabled={saving} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 font-bold text-white"><Plus className="h-4 w-4" />{saving ? "Adding…" : "Add employee"}</button>
      </form>
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-5"><h2 className="font-bold text-slate-900">Active team</h2><p className="mt-1 text-sm text-slate-500">{employees.length} team member{employees.length === 1 ? "" : "s"}</p></div>
        {loading ? <div className="flex justify-center p-16"><LoaderCircle className="h-6 w-6 animate-spin text-orange-500" /></div> : employees.length === 0 ? <div className="p-16 text-center text-sm text-slate-500">Add your first team member to begin planning.</div> : <div className="divide-y divide-slate-100">{employees.map((employee) => <div key={employee.id} className="flex items-center gap-4 px-6 py-4"><div className="flex h-11 w-11 items-center justify-center rounded-full bg-orange-50 text-orange-600"><UserRound className="h-5 w-5" /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="font-bold text-slate-900">{employee.name}</p>{employee.isBilingual && <span title="Bilingual" className="rounded-full bg-blue-50 p-1 text-blue-600"><Languages className="h-3.5 w-3.5" /></span>}</div><p className="mt-1 text-sm text-slate-500">{employee.slackId || "Slack ID not added"}</p></div><button onClick={() => archive(employee.id)} title="Remove from active team" className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button></div>)}</div>}
      </section>
    </div>
  </div>;
}
