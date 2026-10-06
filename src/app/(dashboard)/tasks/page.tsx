"use client";
/* eslint-disable react-hooks/set-state-in-effect */
import { FormEvent, useEffect, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, LoaderCircle, Plus, Sparkles, Trash2, UserRound } from "lucide-react";
import { PageHeading } from "@/components/ui/page-heading";
type Daily = {
  assignments: {
    id: string;
    employee: { id: string; name: string };
    shift: { name: string };
  }[];
  categories: { id: string; name: string; icon: string; defaultPriority: number }[];
  tasks: {
    id: string;
    employeeId: string;
    categoryId: string;
    note: string | null;
    priority: number;
    startTime: string | null;
    endTime: string | null;
    category: { name: string; icon: string };
  }[];
  breaks: { employeeId: string; type: "MAIN" | "SHORT"; startTime: string; endTime: string }[];
};
type WeekSummary = { date: string; agents: number; tasks: number; breaks: number }[];
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const asUtcDate = (value: string) => new Date(`${value}T12:00:00.000Z`);
const dateKey = (value: Date) => value.toISOString().slice(0, 10);
const weekStartFor = (value: string) => {
  const result = asUtcDate(value);
  result.setUTCDate(result.getUTCDate() - result.getUTCDay());
  return dateKey(result);
};
export default function TasksPage() {
  const [date, setDate] = useState(today());
  const [data, setData] = useState<Daily | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [week, setWeek] = useState<WeekSummary>([]);
  async function loadWeek(selectedDate = date) {
    const response = await fetch(`/api/daily?weekStart=${weekStartFor(selectedDate)}`);
    setWeek(await response.json());
  }
  async function load() {
    setLoading(true);
    const r = await fetch(`/api/daily?date=${date}`);
    setData(await r.json());
    await loadWeek();
    setLoading(false);
  }
  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/daily?date=${date}`)
      .then((r) => r.json())
      .then((v) => {
        if (active) setData(v);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    void fetch(`/api/daily?weekStart=${weekStartFor(date)}`).then((response)=>response.json()).then((value)=>{if(active)setWeek(value);});
    return () => {
      active = false;
    };
  }, [date]);
  function moveWeek(offset: number) {
    const next = asUtcDate(date);
    next.setUTCDate(next.getUTCDate() + offset * 7);
    setDate(dateKey(next));
  }
  async function addTask(e: FormEvent<HTMLFormElement>, employeeId: string) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await fetch("/api/daily/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date,
        employeeId,
        type: f.get("type"),
        categoryId: f.get("categoryId"),
        note: f.get("note"),
        priority: Number(f.get("priority")),
      }),
    });
    setMessage(r.ok ? "Task assignment saved." : (await r.json()).error);
    await load();
  }
  async function removeTask(employeeId:string,categoryId:string){await fetch("/api/daily/tasks",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({date,employeeId,categoryId})});setMessage("Task assignment removed.");await load()}
  async function saveBreak(e: FormEvent<HTMLFormElement>, employeeId: string) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await fetch("/api/daily/breaks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date,
        employeeId,
        type: f.get("type"),
        startTime: f.get("start"),
        endTime: f.get("end"),
      }),
    });
    setMessage(r.ok ? "Break time saved." : (await r.json()).error);
    await load();
  }
  async function removeBreak(employeeId: string, type: "MAIN" | "SHORT") {
    const response = await fetch("/api/daily/breaks", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, employeeId, type }) });
    setMessage(response.ok ? "Break removed." : (await response.json()).error);
    await load();
  }
  async function buildPlan(replace = false) {
    setLoading(true);
    const response = await fetch("/api/daily/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, replace }) });
    const body = await response.json();
    if (response.status === 409 && body.code === "PLAN_EXISTS") {
      setLoading(false);
      if (confirm(`This date already has ${body.existingTasks} task assignment(s) and ${body.existingBreaks} break(s). Rebuild the complete daily plan?`)) await buildPlan(true);
      return;
    }
    setMessage(response.ok ? `Daily plan created: ${body.tasksCreated} task assignment(s) and ${body.breaksCreated} break(s).${body.warnings?.length ? ` ${body.warnings.join(" ")}` : ""}` : body.error);
    await load();
  }
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="Daily workflow"
        title="Daily Tasks"
        description="Assign responsibilities, notes, and breaks to employees from the approved schedule."
      />
      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Previous week" onClick={() => moveWeek(-1)} className="rounded-xl border border-slate-200 p-2.5 text-slate-500 hover:bg-slate-50"><ChevronLeft className="h-4 w-4" /></button>
            <div className="min-w-48 text-center"><p className="text-xs font-bold uppercase tracking-wider text-slate-400">Week</p><p className="font-bold text-slate-900">{week[0] && asUtcDate(week[0].date).toLocaleDateString("en",{month:"short",day:"numeric",timeZone:"UTC"})} – {week[6] && asUtcDate(week[6].date).toLocaleDateString("en",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"})}</p></div>
            <button type="button" aria-label="Next week" onClick={() => moveWeek(1)} className="rounded-xl border border-slate-200 p-2.5 text-slate-500 hover:bg-slate-50"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <div className="flex items-center gap-3">
            <label className="relative"><CalendarDays className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" /><input aria-label="Choose operation date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-xl border border-slate-200 py-2.5 pl-10 pr-3 text-sm font-semibold" /></label>
            <button type="button" disabled={loading || !data?.assignments.length} onClick={() => void buildPlan()} className="flex items-center gap-2 rounded-xl bg-violet-700 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"><Sparkles className="h-4 w-4" />Build daily plan</button>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {week.map((item) => { const selected=item.date===date; const day=asUtcDate(item.date); return <button type="button" key={item.date} onClick={()=>setDate(item.date)} className={`rounded-xl border p-3 text-left transition ${selected?"border-orange-500 bg-orange-50 ring-2 ring-orange-100":"border-slate-200 hover:border-slate-300 hover:bg-slate-50"}`}><span className={`text-xs font-extrabold uppercase tracking-wider ${selected?"text-orange-600":"text-slate-400"}`}>{day.toLocaleDateString("en",{weekday:"short",timeZone:"UTC"})}</span><b className="mt-1 block text-lg text-slate-900">{day.getUTCDate()}</b><span className="mt-2 block text-xs font-semibold text-slate-500">{item.agents} agents · {item.tasks} tasks</span></button>; })}
        </div>
      </div>
      {message && (
        <p className="mb-5 rounded-xl bg-blue-50 p-4 text-sm font-semibold text-blue-700">
          {message}
        </p>
      )}
      {loading ? (
        <div className="flex justify-center p-16">
          <LoaderCircle className="animate-spin text-orange-500" />
        </div>
      ) : !data?.assignments.length ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-14 text-center">
          <h2 className="font-bold">
            No approved working roster for this date
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            Generate and approve the monthly schedule first.
          </p>
        </div>
      ) : (
        <div>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-500">Selected day</p><h2 className="mt-1 text-2xl font-bold text-slate-950">{asUtcDate(date).toLocaleDateString("en",{weekday:"long",month:"long",day:"numeric",year:"numeric",timeZone:"UTC"})}</h2><p className="mt-1 text-sm text-slate-500">{data.assignments.length} scheduled agents · {data.tasks.length} task assignments · {data.breaks.length} breaks</p></div></div>
        <div className="grid gap-5 xl:grid-cols-2">
          {data.assignments.map((a) => {
            const tasks = data.tasks.filter(
              (t) => t.employeeId === a.employee.id,
            );
            const employeeBreaks = data.breaks.filter((b) => b.employeeId === a.employee.id);
            const mainBreak = employeeBreaks.find((b) => b.type === "MAIN");
            return (
              <article
                key={a.id}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
              >
                <header className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-5 py-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-50 text-orange-600">
                      <UserRound className="h-5 w-5" />
                    </span>
                    <div>
                      <h2 className="font-bold">{a.employee.name}</h2>
                      <p className="text-sm text-slate-500">{a.shift.name} shift · {tasks.length} task{tasks.length===1?"":"s"}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1">{employeeBreaks.map((br)=><div key={br.type} className="flex items-center gap-1 rounded-full bg-blue-50 pl-3 text-xs font-bold text-blue-700"><Clock3 className="h-3 w-3" />{br.type === "MAIN" ? "40m" : "20m"} · {br.startTime}–{br.endTime}<button type="button" aria-label={`Remove ${br.type.toLowerCase()} break for ${a.employee.name}`} onClick={() => void removeBreak(a.employee.id,br.type)} className="rounded-full p-2 text-blue-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3 w-3" /></button></div>)}</div>
                </header>
                <div className="space-y-3 p-5">
                  {!tasks.length && <div className="rounded-xl border border-dashed border-slate-200 p-5 text-center text-sm text-slate-400">No tasks assigned yet.</div>}
                  {tasks.map((t) => (
                    <div key={t.id} className="relative flex gap-3 rounded-xl border border-slate-100 bg-white p-3.5 pr-10 shadow-sm">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-lg">{t.category.icon}</span>
                      <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><b className="text-sm text-slate-900">{t.category.name}</b><span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${t.priority===1?"bg-orange-100 text-orange-700":"bg-slate-100 text-slate-600"}`}>P{t.priority}</span></div>
                      {t.startTime && t.endTime && <span className="mt-1 block text-xs font-semibold text-slate-400">{t.startTime}–{t.endTime}</span>}
                      {t.note && (
                        <p className="mt-1 text-sm text-slate-500">{t.note}</p>
                      )}
                      </div>
                      <button onClick={()=>removeTask(a.employee.id,t.categoryId)} className="absolute right-3 top-3 text-slate-400 hover:text-red-600"><Trash2 className="h-4 w-4"/></button>
                    </div>
                  ))}
                </div>
                <details className="border-t border-slate-100 px-5 py-4">
                  <summary className="cursor-pointer select-none text-sm font-bold text-slate-600">Manage tasks and breaks</summary>
                <form
                  onSubmit={(e) => addTask(e, a.employee.id)}
                  className="mt-4 grid gap-2 sm:grid-cols-[1fr_90px_1.4fr_auto]"
                >
                  <select
                    required
                    name="categoryId"
                    className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  >
                    <option value="">Choose task</option>
                    {data.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.icon} {c.name}
                      </option>
                    ))}
                  </select>
                  <select name="priority" defaultValue="1" className="rounded-xl border border-slate-200 px-3 py-2 text-sm"><option value="1">P1</option><option value="2">P2</option></select>
                  <input
                    name="note"
                    placeholder="Optional note"
                    className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  />
                  <button className="rounded-xl bg-slate-950 px-3 text-white">
                    <Plus className="h-4 w-4" />
                  </button>
                </form>
                <form
                  onSubmit={(e) => saveBreak(e, a.employee.id)}
                  className="mt-3 flex items-end gap-2 rounded-xl border border-slate-200 p-3"
                >
                  <label className="text-xs font-bold">Break type<select name="type" className="mt-1 block rounded-lg border border-slate-200 px-2 py-2"><option value="MAIN">Main · 40 min</option><option value="SHORT">Short · 20 min</option></select></label>
                  <label className="text-xs font-bold">
                    Break start
                    <input
                      required
                      name="start"
                      type="time"
                      defaultValue={mainBreak?.startTime}
                      className="mt-1 block rounded-lg border border-slate-200 px-2 py-2"
                    />
                  </label>
                  <label className="text-xs font-bold">
                    Break end
                    <input
                      required
                      name="end"
                      type="time"
                      defaultValue={mainBreak?.endTime}
                      className="mt-1 block rounded-lg border border-slate-200 px-2 py-2"
                    />
                  </label>
                  <button className="ml-auto rounded-lg bg-orange-500 px-4 py-2 text-sm font-bold text-white">
                    Save break
                  </button>
                </form>
                </details>
              </article>
            );
          })}
        </div></div>
      )}
    </div>
  );
}
