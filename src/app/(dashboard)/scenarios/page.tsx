"use client";
/* eslint-disable react-hooks/set-state-in-effect */
import { FormEvent, useEffect, useState } from "react";
import { CheckCircle2, Plus, Trash2, TriangleAlert } from "lucide-react";
import { PageHeading } from "@/components/ui/page-heading";

type Employee = { id: string; name: string };
type Category = { id: string; name: string; icon: string };
type Scenario = { id: string; title: string; type: string; status: string; startDate: string; endDate: string; staffingMultiplier: number; note: string | null; employee: Employee | null; category: Category | null };
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const typeLabels: Record<string, string> = { ABSENCE: "Employee absence", DEMAND_SURGE: "Demand surge", TRAINING: "Training or meeting", SYSTEM_OUTAGE: "System outage", CUSTOM: "Custom event" };

export default function ScenariosPage() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [type, setType] = useState("ABSENCE");
  const [message, setMessage] = useState("");
  const load = async () => {
    const [scenarioResponse, teamResponse, settingsResponse] = await Promise.all([fetch("/api/scenarios"), fetch("/api/team"), fetch("/api/settings")]);
    setScenarios(await scenarioResponse.json());
    setEmployees(await teamResponse.json());
    setCategories((await settingsResponse.json()).taskCategories);
  };
  useEffect(() => { void load(); }, []);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget; const values = new FormData(form);
    const response = await fetch("/api/scenarios", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: values.get("title"), type, startDate: values.get("startDate"), endDate: values.get("endDate"), employeeId: values.get("employeeId") || null, categoryId: values.get("categoryId") || null, staffingMultiplier: Number(values.get("staffingMultiplier") || 1), startTime: values.get("startTime") || null, endTime: values.get("endTime") || null, note: values.get("note") || null }) });
    const body = await response.json(); setMessage(response.ok ? "Operational scenario activated." : body.error);
    if (response.ok) { form.reset(); setType("ABSENCE"); await load(); }
  }
  async function resolve(id: string) { await fetch("/api/scenarios", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status: "RESOLVED" }) }); setMessage("Scenario resolved. It no longer affects operations."); await load(); }
  async function remove(id: string) { if (!confirm("Delete this scenario permanently?")) return; await fetch("/api/scenarios", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }); await load(); }
  return <div className="mx-auto max-w-7xl">
    <PageHeading eyebrow="Operational resilience" title="Operation Scenarios" description="Model real operational events and apply their impact to availability, demand, task allocation, and daily planning." />
    {message && <p className="mb-5 rounded-xl bg-blue-50 p-4 text-sm font-semibold text-blue-700">{message}</p>}
    <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
      <form onSubmit={create} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="font-bold">Activate a scenario</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-bold sm:col-span-2">Scenario title<input required name="title" placeholder="Example: High-volume campaign launch" className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3" /></label>
          <label className="text-sm font-bold">Scenario type<select value={type} onChange={(e) => setType(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3">{Object.entries(typeLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
          {["ABSENCE", "TRAINING"].includes(type) && <label className="text-sm font-bold">Affected employee<select required name="employeeId" className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3"><option value="">Choose employee</option>{employees.map((employee)=><option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>}
          {type === "SYSTEM_OUTAGE" && <label className="text-sm font-bold">Unavailable work type<select name="categoryId" className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3"><option value="">All / unspecified</option>{categories.map((category)=><option key={category.id} value={category.id}>{category.icon} {category.name}</option>)}</select></label>}
          {type === "DEMAND_SURGE" && <label className="text-sm font-bold">Demand multiplier<input required name="staffingMultiplier" type="number" min="1.1" max="5" step="0.1" defaultValue="1.5" className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3" /></label>}
          <label className="text-sm font-bold">Start date<input required name="startDate" type="date" defaultValue={today()} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3" /></label>
          <label className="text-sm font-bold">End date<input required name="endDate" type="date" defaultValue={today()} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3" /></label>
          {type === "TRAINING" && <><label className="text-sm font-bold">Start time<input name="startTime" type="time" className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3" /></label><label className="text-sm font-bold">End time<input name="endTime" type="time" className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3" /></label></>}
          <label className="text-sm font-bold sm:col-span-2">Operational note<textarea name="note" rows={3} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3" /></label>
        </div>
        <button className="mt-5 flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-3 font-bold text-white"><Plus className="h-4 w-4" />Activate scenario</button>
      </form>
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="font-bold">Scenario register</h2><div className="mt-5 space-y-3">{scenarios.length ? scenarios.map((scenario)=><article key={scenario.id} className={`rounded-xl border p-4 ${scenario.status === "ACTIVE" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50 opacity-70"}`}><div className="flex gap-3"><TriangleAlert className="mt-0.5 h-5 w-5 text-amber-600"/><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><b>{scenario.title}</b><span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold">{typeLabels[scenario.type]}</span></div><p className="mt-1 text-sm text-slate-600">{scenario.startDate.slice(0,10)} → {scenario.endDate.slice(0,10)}{scenario.employee ? ` · ${scenario.employee.name}` : ""}{scenario.staffingMultiplier > 1 ? ` · ${scenario.staffingMultiplier}× demand` : ""}{scenario.category ? ` · ${scenario.category.name} unavailable` : ""}</p>{scenario.note && <p className="mt-2 text-sm text-slate-500">{scenario.note}</p>}</div><div className="flex gap-1">{scenario.status === "ACTIVE" && <button aria-label={`Resolve ${scenario.title}`} onClick={()=>void resolve(scenario.id)} className="rounded-lg p-2 text-emerald-600 hover:bg-white"><CheckCircle2 className="h-4 w-4"/></button>}<button aria-label={`Delete ${scenario.title}`} onClick={()=>void remove(scenario.id)} className="rounded-lg p-2 text-slate-400 hover:bg-white hover:text-red-600"><Trash2 className="h-4 w-4"/></button></div></div></article>) : <p className="rounded-xl bg-slate-50 p-8 text-center text-sm text-slate-500">No operational scenarios have been recorded.</p>}</div></section>
    </div>
  </div>;
}
