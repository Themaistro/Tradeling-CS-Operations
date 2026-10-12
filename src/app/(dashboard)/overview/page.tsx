import {
  Activity,
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  Clock3,
  Coffee,
  MessageSquare,
  MoonStar,
  ShieldCheck,
  Users,
} from "lucide-react";
import { PageHeading } from "@/components/ui/page-heading";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const WORKING = "WORKING";
const LEAVE_STATUSES = new Set([
  "PTO", "ANNUAL_LEAVE", "EMERGENCY_LEAVE", "COMP_OFF", "PUBLIC_HOLIDAY",
  "SICK", "UNPAID_LEAVE", "OTHER_LEAVE",
]);

function timeLabel(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours >= 12 ? "PM" : "AM"}`;
}

export default async function OverviewPage() {
  const dateKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  const weekday = new Date(`${dateKey}T12:00:00.000Z`).getDay();
  const dateLabel = new Intl.DateTimeFormat("en-AE", { timeZone: "Asia/Dubai", weekday: "long", month: "long", day: "numeric" }).format(new Date());

  const [assignments, tasks, breaks, settings, accounts, lastPost, activeEmployees] = await Promise.all([
    prisma.shiftAssignment.findMany({ where: { date, schedulePeriod: { status: { in: ["APPROVED", "PUBLISHED"] } } }, include: { employee: true, shift: true }, orderBy: { employee: { name: "asc" } } }),
    prisma.taskAssignment.findMany({ where: { date }, include: { employee: true, category: true }, orderBy: [{ priority: "asc" }, { category: { order: "asc" } }] }),
    prisma.breakSchedule.findMany({ where: { date }, include: { employee: true }, orderBy: { startTime: "asc" } }),
    prisma.appSettings.upsert({ where: { id: "global" }, create: { id: "global" }, update: {} }),
    prisma.account.findMany({ where: { active: true }, include: { coverageRequirements: { where: { dayOfWeek: weekday } }, employeeCapabilities: true }, orderBy: { name: "asc" } }),
    prisma.slackPostLog.findFirst({ where: { scheduleDate: date }, orderBy: { createdAt: "desc" } }),
    prisma.employee.count({ where: { status: "ACTIVE" } }),
  ]);

  const working = assignments.filter((item) => item.status === WORKING);
  const off = assignments.filter((item) => item.status === "OFF");
  const leave = assignments.filter((item) => LEAVE_STATUSES.has(item.status));
  const late = working.filter((item) => item.shift?.startTime && item.shift.startTime >= "12:00");
  const wfh = working.filter((item) => item.workLocation === "WFH");
  const mainBreaks = breaks.filter((item) => item.type === "MAIN");
  const focusedTasks = tasks.filter((item) => item.priority === 1);
  const liveTasks = tasks.filter((item) => item.category.isLive);
  const coverageChecks = accounts.flatMap((account) => account.coverageRequirements.map((requirement) => {
    const capable = new Set(account.employeeCapabilities.map((item) => item.employeeId));
    const staffed = working.filter((assignment) => assignment.shift && capable.has(assignment.employeeId) && assignment.shift.startTime <= requirement.startTime && assignment.shift.endTime >= requirement.endTime).length;
    return { account: account.name, ...requirement, staffed };
  }));
  const coverage = coverageChecks.length ? Math.min(...coverageChecks.map((item) => item.minimumStaff ? Math.min(100, Math.round((item.staffed / item.minimumStaff) * 100)) : 100)) : working.length ? 100 : 0;
  const coverageRisks = coverageChecks.filter((item) => item.staffed < item.minimumStaff);
  const missingTasks = working.filter((assignment) => !tasks.some((task) => task.employeeId === assignment.employeeId));
  const attention = [
    ...coverageRisks.map((item) => `${item.account}: ${item.staffed}/${item.minimumStaff} required between ${item.startTime}–${item.endTime}`),
    ...(missingTasks.length ? [`${missingTasks.length} working ${missingTasks.length === 1 ? "agent has" : "agents have"} no task ownership yet`] : []),
  ];
  const stats = [
    { label: "Working today", value: String(working.length), helper: `${activeEmployees} active team members`, icon: Users, color: "text-blue-600 bg-blue-50" },
    { label: "Coverage", value: `${coverage}%`, helper: coverageRisks.length ? `${coverageRisks.length} item${coverageRisks.length === 1 ? "" : "s"} need review` : "All configured targets covered", icon: ShieldCheck, color: coverage >= 100 ? "text-emerald-600 bg-emerald-50" : "text-amber-600 bg-amber-50" },
    { label: "Focused tasks", value: String(focusedTasks.length), helper: `${liveTasks.length} live-channel assignment${liveTasks.length === 1 ? "" : "s"}`, icon: CheckCircle2, color: "text-violet-600 bg-violet-50" },
    { label: "Slack delivery", value: lastPost?.status === "SENT" ? "Sent" : "Pending", helper: lastPost?.status === "SENT" ? `Posted ${lastPost.source.toLowerCase()}` : settings.automationEnabled ? `Scheduled ${settings.postTime}` : "Manual posting", icon: MessageSquare, color: lastPost?.status === "SENT" ? "text-emerald-600 bg-emerald-50" : "text-orange-600 bg-orange-50" },
  ];

  return <div className="mx-auto max-w-7xl">
    <PageHeading eyebrow="Management overview" title="Today’s operation at a glance" description={`${dateLabel} · Staffing, service coverage, workload, and daily readiness in one place.`} />
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {stats.map(({ label, value, helper, icon: Icon, color }) => <article key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className={`mb-5 flex h-10 w-10 items-center justify-center rounded-xl ${color}`}><Icon className="h-5 w-5" /></div><p className="text-sm font-semibold text-slate-500">{label}</p><p className="mt-1 text-3xl font-bold text-slate-950">{value}</p><p className="mt-2 text-xs text-slate-400">{helper}</p></article>)}
    </section>
    <section className="mt-6 grid gap-6 xl:grid-cols-[1.55fr_1fr]">
      <article className="rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-6 py-5"><div><h2 className="font-bold text-slate-950">Who is working today</h2><p className="mt-1 text-sm text-slate-500">Confirmed approved roster, including shift and location.</p></div><span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">{working.length} scheduled</span></div>{working.length ? <div className="divide-y divide-slate-100">{working.map((assignment) => { const agentTasks = tasks.filter((task) => task.employeeId === assignment.employeeId); const mainBreak = mainBreaks.find((item) => item.employeeId === assignment.employeeId); const isLate = assignment.shift?.startTime && assignment.shift.startTime >= "12:00"; return <div key={assignment.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-6 py-4"><div className="min-w-44 flex-1"><p className="font-bold text-slate-900">{assignment.employee.name}</p><p className="mt-0.5 text-xs text-slate-500">{assignment.shift ? `${timeLabel(assignment.shift.startTime)} – ${timeLabel(assignment.shift.endTime)}` : "Shift not assigned"}</p></div><div className="flex flex-wrap gap-2"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${isLate ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-600"}`}>{isLate ? "Late shift" : "Day shift"}</span><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${assignment.workLocation === "WFH" ? "bg-cyan-50 text-cyan-700" : "bg-slate-100 text-slate-600"}`}>{assignment.workLocation === "WFH" ? "WFH" : "Office"}</span><span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-bold text-violet-700">{agentTasks.length} task{agentTasks.length === 1 ? "" : "s"}</span></div><p className="w-full text-xs font-medium text-slate-500 sm:w-auto">{mainBreak ? `Main break ${timeLabel(mainBreak.startTime)}–${timeLabel(mainBreak.endTime)}` : "Break not prepared"}</p></div>; })}</div> : <div className="p-10 text-center text-sm text-slate-500">There is no approved working roster for today.</div>}</article>
      <article className="rounded-3xl bg-slate-950 p-6 text-white shadow-sm"><div className="flex items-center justify-between"><AlertTriangle className={`h-7 w-7 ${attention.length ? "text-orange-400" : "text-emerald-400"}`} /><span className="text-xs font-bold uppercase tracking-wider text-slate-400">Manager attention</span></div><h2 className="mt-6 text-xl font-bold">{attention.length ? "Items to review" : "Operation is on track"}</h2><p className="mt-2 text-sm leading-6 text-slate-400">{attention.length ? "Review these items before the day becomes busy." : "Coverage, roster, and planned ownership are ready for the day."}</p><div className="mt-5 space-y-3">{attention.length ? attention.slice(0, 4).map((item) => <div key={item} className="rounded-xl bg-white/10 p-3 text-sm font-medium text-white">{item}</div>) : <>{["Approved working roster", "Coverage targets", "Task ownership prepared", "Slack connection ready"].map((item) => <div key={item} className="flex items-center gap-3 rounded-xl bg-white/10 px-3 py-2.5 text-sm"><CheckCircle2 className="h-4 w-4 text-emerald-400" />{item}</div>)}</>}</div></article>
    </section>
    <section className="mt-6 grid gap-6 xl:grid-cols-3">
      <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm xl:col-span-2"><div className="mb-5 flex items-center justify-between"><div><h2 className="font-bold">Service coverage</h2><p className="mt-1 text-sm text-slate-500">Configured account requirements compared with today’s scheduled, qualified people.</p></div><Activity className="text-blue-600" /></div>{coverageChecks.length ? <div className="space-y-3">{coverageChecks.map((item) => { const safe = item.staffed >= item.minimumStaff; return <div key={item.id} className="rounded-2xl border border-slate-100 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-bold text-slate-900">{item.account}</p><p className="mt-1 text-xs text-slate-500">{timeLabel(item.startTime)} – {timeLabel(item.endTime)}</p></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${safe ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{item.staffed} of {item.minimumStaff} covered</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className={safe ? "h-full rounded-full bg-emerald-500" : "h-full rounded-full bg-amber-500"} style={{ width: `${Math.min(100, item.minimumStaff ? (item.staffed / item.minimumStaff) * 100 : 100)}%` }} /></div></div>; })}</div> : <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">No account coverage requirements are configured for this day.</p>}</article>
      <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-center justify-between"><div><h2 className="font-bold">Team status</h2><p className="mt-1 text-sm text-slate-500">Today’s roster summary.</p></div><CalendarCheck className="text-violet-600" /></div><dl className="mt-5 space-y-3"><div className="flex items-center justify-between rounded-xl bg-blue-50 px-4 py-3"><dt className="text-sm font-semibold text-blue-800">Working</dt><dd className="font-bold text-blue-900">{working.length}</dd></div><div className="flex items-center justify-between rounded-xl bg-indigo-50 px-4 py-3"><dt className="flex items-center gap-2 text-sm font-semibold text-indigo-800"><MoonStar className="h-4 w-4" />Late shift</dt><dd className="font-bold text-indigo-900">{late.length}</dd></div><div className="flex items-center justify-between rounded-xl bg-cyan-50 px-4 py-3"><dt className="text-sm font-semibold text-cyan-800">Working from home</dt><dd className="font-bold text-cyan-900">{wfh.length}</dd></div><div className="flex items-center justify-between rounded-xl bg-slate-100 px-4 py-3"><dt className="text-sm font-semibold text-slate-700">Scheduled off</dt><dd className="font-bold text-slate-900">{off.length}</dd></div><div className="flex items-center justify-between rounded-xl bg-amber-50 px-4 py-3"><dt className="text-sm font-semibold text-amber-800">Leave / exception</dt><dd className="font-bold text-amber-900">{leave.length}</dd></div></dl></article>
    </section>
    <section className="mt-6 grid gap-6 xl:grid-cols-[1.15fr_1.85fr]">
      <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-center justify-between"><div><h2 className="font-bold">Break coverage</h2><p className="mt-1 text-sm text-slate-500">Main breaks only.</p></div><Coffee className="text-orange-500" /></div>{mainBreaks.length ? <div className="mt-5 space-y-3">{mainBreaks.map((item) => <div key={item.id} className="flex items-center justify-between rounded-xl bg-orange-50 px-4 py-3"><div><p className="text-sm font-bold text-slate-900">{item.employee.name}</p><p className="mt-0.5 text-xs text-slate-500">{timeLabel(item.startTime)} – {timeLabel(item.endTime)}</p></div><Clock3 className="h-4 w-4 text-orange-500" /></div>)}</div> : <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Breaks will appear once the approved schedule has been prepared.</p>}</article>
      <article className="rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-6 py-5"><div><h2 className="font-bold">Task ownership</h2><p className="mt-1 text-sm text-slate-500">Focused responsibilities prepared for today.</p></div><span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-bold text-violet-700">{tasks.length} assignments</span></div>{tasks.length ? <div className="divide-y divide-slate-100">{tasks.map((task) => <div key={task.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-6 py-3.5"><span className="text-lg" aria-hidden>{task.category.icon}</span><p className="min-w-48 flex-1 text-sm font-bold text-slate-900">{task.category.name}</p><p className="text-sm font-semibold text-slate-600">{task.employee.name}</p><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${task.priority === 1 ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-600"}`}>P{task.priority}</span></div>)}</div> : <div className="p-10 text-center text-sm text-slate-500">Daily task ownership has not been prepared yet.</div>}</article>
    </section>
  </div>;
}
