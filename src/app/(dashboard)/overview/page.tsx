import {
  Activity,
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  MessageSquare,
  ShieldCheck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { PageHeading } from "@/components/ui/page-heading";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const LEAVE_STATUSES = new Set([
  "PTO", "ANNUAL_LEAVE", "EMERGENCY_LEAVE", "COMP_OFF", "PUBLIC_HOLIDAY",
  "SICK", "UNPAID_LEAVE", "OTHER_LEAVE",
]);

function timeLabel(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours >= 12 ? "PM" : "AM"}`;
}

function acknowledgementTime(value: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-AE", { timeZone: timezone, hour: "numeric", minute: "2-digit", hour12: true }).format(value);
}

function initials(name: string) {
  return name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

function absenceLabel(status: string) {
  return status.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function moveDate(value: string, days: number) {
  const result = new Date(`${value}T12:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const params = await searchParams;
  const settings = await prisma.appSettings.upsert({ where: { id: "global" }, create: { id: "global" }, update: {} });
  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: settings.timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const dateKey = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : todayKey;
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  const weekday = new Date(`${dateKey}T12:00:00.000Z`).getUTCDay();
  const dateLabel = new Intl.DateTimeFormat("en-AE", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date(`${dateKey}T12:00:00.000Z`));
  const isToday = dateKey === todayKey;

  const [assignments, tasks, breaks, accounts, lastPost, activeTeam, shifts, acknowledgements, plan] = await Promise.all([
    prisma.shiftAssignment.findMany({
      where: { date, schedulePeriod: dateKey < todayKey ? undefined : { status: { in: ["APPROVED", "PUBLISHED"] } }, employee: dateKey < todayKey ? undefined : { status: "ACTIVE" } },
      include: { employee: true, shift: true },
      orderBy: { employee: { name: "asc" } },
    }),
    prisma.taskAssignment.findMany({
      where: { date }, include: { employee: true, category: true },
      orderBy: [{ priority: "asc" }, { category: { order: "asc" } }],
    }),
    prisma.breakSchedule.findMany({
      where: { date }, include: { employee: true }, orderBy: { startTime: "asc" },
    }),
    prisma.account.findMany({
      where: { active: true },
      include: { coverageRequirements: { where: { dayOfWeek: weekday } }, employeeCapabilities: true },
      orderBy: { name: "asc" },
    }),
    prisma.slackPostLog.findFirst({ where: { scheduleDate: date }, orderBy: { createdAt: "desc" } }),
    prisma.employee.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.shift.findMany({ where: { active: true }, select: { id: true, startTime: true } }),
    prisma.acknowledgement.findMany({ where: { scheduleDate: date }, select: { employeeId: true, taskCategoryId: true, acknowledgedAt: true, planRevision: true } }),
    prisma.dailyPlan.findUnique({ where: { date } }),
  ]);

  const working = assignments.filter((item) => item.status === "WORKING");
  const off = assignments.filter((item) => item.status === "OFF");
  const leave = assignments.filter((item) => LEAVE_STATUSES.has(item.status));
  const unscheduled = activeTeam.filter((employee) => !assignments.some((item) => item.employeeId === employee.id));
  const latestStartingShiftId = [...shifts].sort((left, right) => right.startTime.localeCompare(left.startTime))[0]?.id;
  const mainBreaks = breaks.filter((item) => item.type === "MAIN");
  const focusedTasks = tasks.filter((item) => item.priority === 1);
  const liveTasks = tasks.filter((item) => item.category.isLive);

  const coverageChecks = accounts.flatMap((account) => account.coverageRequirements.map((requirement) => {
    const capable = new Set(account.employeeCapabilities.map((item) => item.employeeId));
    const qualifying = working.filter((assignment) => assignment.shift && capable.has(assignment.employeeId) && assignment.shift.startTime <= requirement.startTime && assignment.shift.endTime >= requirement.endTime);
    return { account: account.name, ...requirement, staffed: qualifying.length, bilingual: qualifying.filter(item=>item.employee.isBilingual).length };
  }));
  const coverageRisks = coverageChecks.filter((item) => item.staffed < item.minimumStaff || item.bilingual < item.minimumBilingual);
  const coverage = coverageChecks.length
    ? Math.min(...coverageChecks.flatMap(item=>[item.minimumStaff ? Math.min(100, Math.round(item.staffed / item.minimumStaff * 100)) : 100, item.minimumBilingual ? Math.min(100, Math.round(item.bilingual / item.minimumBilingual * 100)) : 100]))
    : working.length ? 100 : 0;
  const missingTasks = working.filter((assignment) => !tasks.some((task) => task.employeeId === assignment.employeeId));
  const taskCoverage = Array.from(tasks.reduce((groups, task) => {
    const coverageKey = task.category.name.trim().toLocaleLowerCase();
    const existing = groups.get(coverageKey) ?? {
      id: coverageKey,
      name: task.category.name,
      icon: task.category.icon,
      isLive: task.category.isLive,
      owners: [] as { name: string; priority: number }[],
    };
    existing.owners.push({ name: task.employee.name, priority: task.priority });
    groups.set(coverageKey, existing);
    return groups;
  }, new Map<string, { id: string; name: string; icon: string; isLive: boolean; owners: { name: string; priority: number }[] }>()).values());
  const readiness = [
    { label: "Approved roster", detail: `${working.length} on duty`, done: working.length > 0 },
    { label: "Coverage targets", detail: coverageRisks.length ? `${coverageRisks.length} need review` : "All targets met", done: coverage >= 100 },
    { label: "Task ownership", detail: missingTasks.length ? `${missingTasks.length} missing` : "All working agents covered", done: tasks.length > 0 && missingTasks.length === 0 },
    { label: "Break planning", detail: mainBreaks.length === working.length ? "Main breaks prepared" : `${mainBreaks.length}/${working.length} prepared`, done: mainBreaks.length === working.length && working.length > 0 },
  ];
  const attention = [
    ...coverageRisks.map((item) => `${item.account}: ${item.staffed}/${item.minimumStaff} required between ${item.startTime}–${item.endTime}`),
    ...(missingTasks.length ? [`${missingTasks.length} working ${missingTasks.length === 1 ? "agent has" : "agents have"} no assigned work yet`] : []),
    ...(unscheduled.length ? [`${unscheduled.length} active team member${unscheduled.length === 1 ? " is" : "s are"} missing from today’s roster`] : []),
  ];
  const stats = [
    { label: "On duty", value: String(working.length), helper: `${activeTeam.length} active team members`, icon: Users, color: "text-blue-600 bg-blue-50" },
    { label: "Service coverage", value: `${coverage}%`, helper: coverageRisks.length ? `${coverageRisks.length} item${coverageRisks.length === 1 ? "" : "s"} need review` : "All configured targets covered", icon: ShieldCheck, color: coverage >= 100 ? "text-emerald-600 bg-emerald-50" : "text-amber-600 bg-amber-50" },
    { label: "Priority ownership", value: String(focusedTasks.length), helper: `${liveTasks.length} live-service assignment${liveTasks.length === 1 ? "" : "s"}`, icon: CheckCircle2, color: "text-violet-600 bg-violet-50" },
    { label: "Slack post", value: lastPost?.status === "SENT" ? "Sent" : "Pending", helper: lastPost?.status === "SENT" ? `Posted ${lastPost.source.toLowerCase()}` : settings.automationEnabled ? `Scheduled ${settings.postTime}` : "Manual posting", icon: MessageSquare, color: lastPost?.status === "SENT" ? "text-emerald-600 bg-emerald-50" : "text-orange-600 bg-orange-50" },
  ];

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="Operations overview"
        title={isToday ? "Today’s operation at a glance" : `Operations for ${dateLabel}`}
        description="See the full team, their work, coverage, breaks, and exceptions without opening individual pages."
      />

      <section className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div><p className="text-xs font-bold uppercase tracking-wider text-slate-400">Viewing plan</p><p className="mt-1 font-bold text-slate-900">{isToday ? `${dateLabel} · Today` : dateLabel}</p></div>
        <form className="flex flex-wrap items-center gap-2" action="/overview">
          <Link href={`/overview?date=${moveDate(dateKey, -1)}`} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Previous day</Link>
          <input aria-label="Choose overview date" type="date" name="date" defaultValue={dateKey} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700" />
          <button type="submit" className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-bold text-white">View</button>
          <Link href={`/overview?date=${moveDate(dateKey, 1)}`} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Next day</Link>
        </form>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(({ label, value, helper, icon: Icon, color }) => (
          <article key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className={`mb-5 flex h-10 w-10 items-center justify-center rounded-xl ${color}`}><Icon className="h-5 w-5" /></div>
            <p className="text-sm font-semibold text-slate-500">{label}</p>
            <p className="mt-1 text-3xl font-bold text-slate-950">{value}</p>
            <p className="mt-2 text-xs text-slate-400">{helper}</p>
          </article>
        ))}
      </section>

      <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between"><div><h2 className="font-bold text-slate-950">Daily readiness</h2><p className="mt-1 text-sm text-slate-500">The original quick operational checks, kept visible before the detailed team view.</p></div><CalendarCheck className="text-violet-600" /></div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{readiness.map((item) => <div key={item.label} className={`flex items-center gap-3 rounded-2xl px-4 py-3 ${item.done ? "bg-emerald-50" : "bg-amber-50"}`}><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${item.done ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{item.done ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}</span><div><p className="text-sm font-bold text-slate-900">{item.label}</p><p className={`mt-0.5 text-xs font-semibold ${item.done ? "text-emerald-700" : "text-amber-700"}`}>{item.detail}</p></div></div>)}</div>
      </section>

      <section className="mt-6">
        <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="font-bold text-slate-950">Team on duty</h2><p className="mt-1 text-sm text-slate-500">Each person’s shift, work location, main break, and assigned responsibilities.</p></div>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">{working.length} working today</span>
          </div>
          {working.length ? (
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {working.map((assignment) => {
                const agentTasks = tasks.filter((task) => task.employeeId === assignment.employeeId);
                const mainBreak = mainBreaks.find((item) => item.employeeId === assignment.employeeId);
                const isLatestShift = assignment.shift?.id === latestStartingShiftId;
                const shiftLabel = assignment.shift?.name ?? "Working";
                const taskCategoryIds = [...new Set(agentTasks.map((task) => task.categoryId))];
                const agentAcknowledgements = acknowledgements.filter((item) => item.employeeId === assignment.employeeId && item.planRevision === (plan?.revision || 1));
                const acknowledgedCategoryIds = new Set(agentAcknowledgements.map((item) => item.taskCategoryId));
                const acknowledged = taskCategoryIds.length > 0 && taskCategoryIds.every((categoryId) => acknowledgedCategoryIds.has(categoryId));
                const acknowledgedAt = agentAcknowledgements.length ? new Date(Math.max(...agentAcknowledgements.map((item) => item.acknowledgedAt.getTime()))) : null;
                return (
                  <article key={assignment.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-black text-white">{initials(assignment.employee.name)}</div>
                      <div className="min-w-0 flex-1"><p className="truncate font-bold text-slate-950">{assignment.employee.name}</p><p className="mt-0.5 text-xs font-medium text-slate-500">{assignment.shift ? `${timeLabel(assignment.shift.startTime)} – ${timeLabel(assignment.shift.endTime)}` : "Shift not assigned"}</p></div>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${isLatestShift ? "bg-indigo-100 text-indigo-700" : "bg-blue-100 text-blue-700"}`}>{shiftLabel}</span>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${assignment.workLocation === "WFH" ? "bg-cyan-100 text-cyan-700" : "bg-slate-200 text-slate-700"}`}>{assignment.workLocation === "WFH" ? "Working from home" : "Office"}</span>
                      {mainBreak && <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-bold text-orange-700">Break {timeLabel(mainBreak.startTime)}–{timeLabel(mainBreak.endTime)}</span>}
                      {agentTasks.length ? <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${acknowledged ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{acknowledged ? `Acknowledged ${acknowledgedAt ? acknowledgementTime(acknowledgedAt, settings.timezone) : ""}` : "Awaiting acknowledgement"}</span> : <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-bold text-slate-600">No tasks to acknowledge</span>}
                    </div>
                    <div className="mt-4 border-t border-slate-200 pt-3"><p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Today’s responsibilities</p>{agentTasks.length ? <div className="mt-2 flex flex-wrap gap-2">{agentTasks.map((task) => <span key={task.id} className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold ${task.priority === 1 ? "bg-violet-100 text-violet-800" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}><span aria-hidden>{task.category.icon}</span>{task.category.name}<span className="opacity-60">P{task.priority}</span></span>)}</div> : <p className="mt-2 text-sm font-medium text-amber-700">No work has been assigned yet.</p>}</div>
                  </article>
                );
              })}
            </div>
          ) : <div className="mt-5 rounded-2xl bg-slate-50 p-10 text-center text-sm text-slate-500">There is no approved working roster for today.</div>}
          <div className="mt-5 border-t border-slate-200 pt-5"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold text-slate-900">Not on duty today</h3><p className="mt-1 text-sm text-slate-500">Scheduled off, leave, and any active team member missing from the roster.</p></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${off.length + leave.length + unscheduled.length ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700"}`}>{off.length + leave.length + unscheduled.length ? `${off.length + leave.length + unscheduled.length} unavailable` : "Everyone scheduled"}</span></div>{off.length || leave.length || unscheduled.length ? <div className="mt-3 flex flex-wrap gap-2">{off.map((item) => <span key={item.id} className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700">{item.employee.name}<span className="ml-2 text-xs font-semibold text-slate-500">Off</span></span>)}{leave.map((item) => <span key={item.id} className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800">{item.employee.name}<span className="ml-2 text-xs font-semibold text-amber-700">{absenceLabel(item.status)}</span></span>)}{unscheduled.map((item) => <span key={item.id} className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800">{item.name}<span className="ml-2 text-xs font-semibold text-rose-700">Not scheduled</span></span>)}</div> : <div className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">Everyone on the active team is scheduled and available today.</div>}</div>
        </article>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[2fr_1fr]">
        <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between"><div><h2 className="font-bold">Service coverage</h2><p className="mt-1 text-sm text-slate-500">Configured account requirements against today’s qualified people.</p></div><Activity className="text-blue-600" /></div>
          {coverageChecks.length ? <div className="space-y-3">{coverageChecks.map((item) => { const safe = item.staffed >= item.minimumStaff && item.bilingual >= item.minimumBilingual; return <div key={item.id} className="rounded-2xl border border-slate-100 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-bold text-slate-900">{item.account}</p><p className="mt-1 text-xs text-slate-500">{timeLabel(item.startTime)} – {timeLabel(item.endTime)}</p></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${safe ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{item.staffed} of {item.minimumStaff} covered{item.minimumBilingual ? ` · Language ${item.bilingual}/${item.minimumBilingual}` : ""}</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className={safe ? "h-full rounded-full bg-emerald-500" : "h-full rounded-full bg-amber-500"} style={{ width: `${Math.min(100, item.minimumStaff ? (item.staffed / item.minimumStaff) * 100 : 100)}%` }} /></div></div>; })}</div> : <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">No account coverage requirements are configured for this day.</p>}
        </article>

        <article className="self-start rounded-3xl bg-slate-950 p-6 text-white shadow-sm">
          <div className="flex items-center justify-between"><AlertTriangle className={`h-6 w-6 ${attention.length ? "text-orange-400" : "text-emerald-400"}`} /><span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Manager check</span></div>
          <h2 className="mt-4 text-lg font-bold">{attention.length ? "Needs attention" : "Ready for the day"}</h2>
          <p className="mt-1 text-sm leading-5 text-slate-400">{attention.length ? "Review the items below before peak hours." : "The roster, coverage and task ownership are in place."}</p>
          <div className="mt-4 space-y-2">{attention.length ? attention.slice(0, 3).map((item) => <div key={item} className="rounded-xl bg-white/10 p-3 text-sm font-medium text-white">{item}</div>) : ["Working roster approved", "Coverage targets met", "Task ownership prepared"].map((item) => <div key={item} className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2.5 text-sm"><CheckCircle2 className="h-4 w-4 text-emerald-400" />{item}</div>)}</div>
        </article>
      </section>

      <section className="mt-6">
        <article className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-6 py-5"><div><h2 className="font-bold">Task coverage by responsibility</h2><p className="mt-1 text-sm text-slate-500">A quick check of who owns each task today.</p></div><span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-bold text-violet-700">{tasks.length} assignments</span></div>
          {taskCoverage.length ? <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">{taskCoverage.map((task) => <article key={task.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4"><div className="flex items-start gap-3"><span className="mt-0.5 text-lg" aria-hidden>{task.icon}</span><div className="min-w-0"><p className="font-bold text-slate-900">{task.name}</p><p className={`mt-1 text-xs font-bold ${task.isLive ? "text-rose-600" : "text-slate-400"}`}>{task.isLive ? "Live service" : "Planned work"}</p></div></div><div className="mt-3 flex flex-wrap gap-2">{task.owners.map((owner, index) => <span key={`${owner.name}-${index}`} className={`rounded-lg px-2.5 py-1.5 text-xs font-bold ${owner.priority === 1 ? "bg-violet-100 text-violet-800" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}>{owner.name}<span className="ml-1 opacity-60">P{owner.priority}</span></span>)}</div></article>)}</div> : <div className="p-10 text-center text-sm text-slate-500">Daily task ownership has not been prepared yet.</div>}
        </article>
      </section>
    </div>
  );
}
