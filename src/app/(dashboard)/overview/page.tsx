import {
  Activity,
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  Clock3,
  Users,
} from "lucide-react";
import { PageHeading } from "@/components/ui/page-heading";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";
export default async function OverviewPage() {
  const dateKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  const weekday = new Date(`${dateKey}T12:00:00.000Z`).getDay();
  const [working, tasks, settings, rules, lastPost] = await Promise.all([
    prisma.shiftAssignment.count({
      where: {
        date,
        status: "WORKING",
        schedulePeriod: { status: { in: ["APPROVED", "PUBLISHED"] } },
      },
    }),
    prisma.taskAssignment.count({ where: { date } }),
    prisma.appSettings.upsert({
      where: { id: "global" },
      create: { id: "global" },
      update: {},
    }),
    prisma.staffingRule.aggregate({
      where: { dayOfWeek: weekday },
      _sum: { minimumStaff: true },
    }),
    prisma.slackPostLog.findFirst({
      where: { scheduleDate: date },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const required = rules._sum.minimumStaff || 0;
  const coverage = required
    ? Math.min(100, Math.round((working / required) * 100))
    : working
      ? 100
      : 0;
  const stats = [
    {
      label: "Working today",
      value: String(working),
      helper: "Approved schedule",
      icon: Users,
      color: "text-blue-600 bg-blue-50",
    },
    {
      label: "Coverage",
      value: `${coverage}%`,
      helper: `${working} of ${required || "—"} required`,
      icon: Activity,
      color:
        coverage >= 100
          ? "text-emerald-600 bg-emerald-50"
          : "text-amber-600 bg-amber-50",
    },
    {
      label: "Tasks assigned",
      value: String(tasks),
      helper: "For today’s roster",
      icon: CheckCircle2,
      color: "text-violet-600 bg-violet-50",
    },
    {
      label: "Slack delivery",
      value: lastPost?.status || "Pending",
      helper: settings.automationEnabled
        ? `Scheduled ${settings.postTime}`
        : "Manual posting",
      icon: Clock3,
      color: "text-orange-600 bg-orange-50",
    },
  ];
  const readiness = [
    { label: "Approved working roster", done: working > 0 },
    { label: "Daily task assignments", done: tasks >= working && working > 0 },
    { label: "Coverage target", done: coverage >= 100 },
    { label: "Slack channel", done: Boolean(settings.slackChannelId) },
  ];
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        eyebrow="Operations overview"
        title="Today’s operations"
        description={`${new Intl.DateTimeFormat("en-AE", { timeZone: "Asia/Dubai", weekday: "long", month: "long", day: "numeric" }).format(new Date())} · Live readiness from the shared operations database.`}
      />
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(({ label, value, helper, icon: Icon, color }) => (
          <article
            key={label}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div
              className={`mb-5 flex h-10 w-10 items-center justify-center rounded-xl ${color}`}
            >
              <Icon className="h-5 w-5" />
            </div>
            <p className="text-sm font-semibold text-slate-500">{label}</p>
            <p className="mt-1 text-3xl font-bold">{value}</p>
            <p className="mt-2 text-xs text-slate-400">{helper}</p>
          </article>
        ))}
      </section>
      <section className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="font-bold">Today’s readiness</h2>
              <p className="mt-1 text-sm text-slate-500">
                Live checks before publishing the roster.
              </p>
            </div>
            <CalendarCheck className="text-orange-500" />
          </div>
          <div className="space-y-3">
            {readiness.map((item) => (
              <div
                key={item.label}
                className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3"
              >
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full ${item.done ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}
                >
                  {item.done ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <AlertTriangle className="h-4 w-4" />
                  )}
                </span>
                <span className="text-sm font-semibold">{item.label}</span>
                <span className="ml-auto text-xs font-bold text-slate-400">
                  {item.done ? "Ready" : "Required"}
                </span>
              </div>
            ))}
          </div>
        </article>
        <article className="rounded-3xl bg-slate-950 p-6 text-white">
          <AlertTriangle
            className={`mb-6 h-7 w-7 ${readiness.every((x) => x.done) ? "text-emerald-400" : "text-orange-400"}`}
          />
          <h2 className="text-xl font-bold">
            {readiness.every((x) => x.done)
              ? "Ready to publish"
              : "Action required"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            {readiness.every((x) => x.done)
              ? "Today’s staffing, tasks, coverage, and Slack channel are ready."
              : "Complete the outstanding readiness items before publishing today’s operations roster."}
          </p>
        </article>
      </section>
    </div>
  );
}
