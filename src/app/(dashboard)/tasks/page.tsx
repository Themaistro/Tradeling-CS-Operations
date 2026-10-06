"use client";
/* eslint-disable react-hooks/set-state-in-effect */
import { FormEvent, useEffect, useState } from "react";
import { Clock3, LoaderCircle, Plus, Sparkles, Trash2, UserRound } from "lucide-react";
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
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export default function TasksPage() {
  const [date, setDate] = useState(today());
  const [data, setData] = useState<Daily | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  async function load() {
    setLoading(true);
    const r = await fetch(`/api/daily?date=${date}`);
    setData(await r.json());
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
    return () => {
      active = false;
    };
  }, [date]);
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
      <div className="mb-6 flex flex-wrap items-end gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <label className="text-sm font-bold">
          Operation date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-2 block rounded-xl border border-slate-200 px-4 py-3"
          />
        </label>
        <p className="pb-3 text-sm text-slate-500">
          Only employees working on the approved roster appear below.
        </p>
        <button
          type="button"
          disabled={loading || !data?.assignments.length}
          onClick={() => void buildPlan()}
          className="ml-auto flex items-center gap-2 rounded-xl bg-violet-700 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Sparkles className="h-4 w-4" />
          Build daily plan
        </button>
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
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <header className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-50 text-orange-600">
                      <UserRound className="h-5 w-5" />
                    </span>
                    <div>
                      <h2 className="font-bold">{a.employee.name}</h2>
                      <p className="text-sm text-slate-500">{a.shift.name}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1">{employeeBreaks.map((br)=><div key={br.type} className="flex items-center gap-1 rounded-full bg-blue-50 pl-3 text-xs font-bold text-blue-700"><Clock3 className="h-3 w-3" />{br.type === "MAIN" ? "40m" : "20m"} · {br.startTime}–{br.endTime}<button type="button" aria-label={`Remove ${br.type.toLowerCase()} break for ${a.employee.name}`} onClick={() => void removeBreak(a.employee.id,br.type)} className="rounded-full p-2 text-blue-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3 w-3" /></button></div>)}</div>
                </header>
                <div className="mt-4 space-y-2">
                  {tasks.map((t) => (
                    <div key={t.id} className="relative rounded-xl bg-slate-50 p-3 pr-10">
                      <b className="text-sm">
                        {t.category.icon} {t.category.name} · P{t.priority}
                      </b>
                      {t.startTime && t.endTime && <span className="ml-2 text-xs font-semibold text-slate-400">{t.startTime}–{t.endTime}</span>}
                      {t.note && (
                        <p className="mt-1 text-sm text-slate-500">{t.note}</p>
                      )}
                      <button onClick={()=>removeTask(a.employee.id,t.categoryId)} className="absolute right-3 top-3 text-slate-400 hover:text-red-600"><Trash2 className="h-4 w-4"/></button>
                    </div>
                  ))}
                </div>
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
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
