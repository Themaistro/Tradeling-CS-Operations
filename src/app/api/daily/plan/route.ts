import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  replace: z.boolean().default(false),
});

const toMinutes = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};
const toTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid operation date." }, { status: 400 });
  const date = new Date(`${parsed.data.date}T00:00:00.000Z`);
  const weekday = date.getUTCDay();
  const historyStart = new Date(date); historyStart.setUTCDate(historyStart.getUTCDate() - 42);
  const [assignments, categories, accounts, focusHistory, existingTasks, existingBreaks, settings] = await Promise.all([
    prisma.shiftAssignment.findMany({
      where: { date, status: "WORKING", schedulePeriod: { status: { in: ["APPROVED", "PUBLISHED"] } } },
      include: { employee: true, shift: { include: { staffingRules: { where: { dayOfWeek: weekday } } } } },
      orderBy: [{ shift: { order: "asc" } }, { employee: { name: "asc" } }],
    }),
    prisma.taskCategory.findMany({ where: { active: true }, orderBy: { order: "asc" } }),
    prisma.account.findMany({ where: { active: true }, include: { coverageRequirements: true, employeeCapabilities: true } }),
    prisma.taskAssignment.findMany({ where: { date: { gte: historyStart, lt: date }, category: { mode: "FOCUS" } }, include: { category: true }, orderBy: { date: "desc" } }),
    prisma.taskAssignment.count({ where: { date } }),
    prisma.breakSchedule.count({ where: { date } }),
    prisma.appSettings.upsert({ where: { id: "global" }, create: { id: "global" }, update: {} }),
  ]);
  if (!assignments.length) return NextResponse.json({ error: "Approve a working roster for this date before building the daily plan." }, { status: 409 });
  if ((existingTasks || existingBreaks) && !parsed.data.replace) return NextResponse.json({ error: "This day already contains tasks or breaks.", code: "PLAN_EXISTS", existingTasks, existingBreaks }, { status: 409 });
  if (!categories.length) return NextResponse.json({ error: "Add at least one active task category first." }, { status: 409 });

  const taskRows: { date: Date; employeeId: string; categoryId: string; note: string; priority: number; startTime: string | null; endTime: string | null }[] = [];
  const warnings: string[] = [];
  const normalizeQueue = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const weekStart = new Date(date); weekStart.setUTCDate(weekStart.getUTCDate() - ((weekday - settings.weekStartsOn + 7) % 7));
  const byShift = Map.groupBy(assignments, (assignment) => assignment.shiftId ?? "unassigned");
  for (const shiftAssignments of byShift.values()) {
    const shift = shiftAssignments[0]?.shift;
    if (!shift) continue;
    const relevantAccounts = accounts.filter((account) => account.coverageRequirements.some((requirement) => requirement.dayOfWeek === weekday && shift.startTime <= requirement.startTime && shift.endTime >= requirement.endTime));
    const relevantAccountIds = new Set(relevantAccounts.map((account) => account.id));
    const relevantCategories = categories.filter((category) => category.accountId && relevantAccountIds.has(category.accountId));
    const grouped = Map.groupBy(relevantCategories, (category) => normalizeQueue(category.name));
    const queues = [...grouped.values()].map((items) => {
      const accountNames = relevantAccounts.filter((account) => items.some((item) => item.accountId === account.id)).map((account) => account.name);
      const requirements = relevantAccounts.flatMap((account) => account.coverageRequirements.filter((requirement) => requirement.dayOfWeek === weekday && shift.startTime <= requirement.startTime && shift.endTime >= requirement.endTime));
      return { category: items[0], accountNames, startTime: requirements.map((item) => item.startTime).sort()[0] ?? shift.startTime, endTime: requirements.map((item) => item.endTime).sort().at(-1) ?? shift.endTime };
    });
    const eligible = (queue: (typeof queues)[number]) => {
      const accountIds = grouped.get(queue.category.name.toLowerCase().replace(/[^a-z0-9]/g, ""))?.map((item) => item.accountId).filter(Boolean) as string[];
      return shiftAssignments.filter((assignment) => accountIds.every((accountId) => accounts.find((account) => account.id === accountId)?.employeeCapabilities.some((capability) => capability.employeeId === assignment.employeeId)));
    };
    const focusOwners = new Set<string>();
    const focusQueues = queues.filter((item) => item.category.mode === "FOCUS").sort((left, right) => left.category.rotationOrder - right.category.rotationOrder);
    for (const queue of focusQueues) {
      const candidates = eligible(queue);
      if (!candidates.length) { warnings.push(`${queue.category.name} has no eligible scheduled agent on ${shift.name}.`); continue; }
      const unassigned = candidates.filter((assignment) => !focusOwners.has(assignment.employeeId));
      const pool = unassigned.length ? unassigned : candidates;
      const queueKey = normalizeQueue(queue.category.name);
      const continued = pool.find((assignment) => focusHistory.some((task) => task.employeeId === assignment.employeeId && task.date >= weekStart && normalizeQueue(task.category.name) === queueKey && task.startTime === queue.startTime));
      const expected = pool.find((assignment) => {
        const last = focusHistory.find((task) => task.employeeId === assignment.employeeId && task.date < weekStart && task.startTime === queue.startTime);
        if (!last) return false;
        const previousIndex = focusQueues.findIndex((item) => normalizeQueue(item.category.name) === normalizeQueue(last.category.name));
        return previousIndex >= 0 && normalizeQueue(focusQueues[(previousIndex + 1) % focusQueues.length].category.name) === queueKey;
      });
      const assignment = continued ?? expected ?? pool.sort((left, right) => {
        const leftLast = focusHistory.find((task) => task.employeeId === left.employeeId && normalizeQueue(task.category.name) === queueKey)?.date.getTime() ?? 0;
        const rightLast = focusHistory.find((task) => task.employeeId === right.employeeId && normalizeQueue(task.category.name) === queueKey)?.date.getTime() ?? 0;
        return leftLast - rightLast || left.employee.name.localeCompare(right.employee.name);
      })[0];
      if (!unassigned.length && shiftAssignments.length > 1) warnings.push(`${assignment.employee.name} must cover more than one focus queue on ${shift.name} because no additional eligible agent is available.`);
      focusOwners.add(assignment.employeeId);
      taskRows.push({ date, employeeId: assignment.employeeId, categoryId: queue.category.id, priority: 1, startTime: queue.startTime, endTime: queue.endTime, note: `${queue.accountNames.join(" + ")} · primary focus` });
    }
    for (const queue of queues.filter((item) => item.category.mode === "EVERYONE")) for (const assignment of eligible(queue)) {
      taskRows.push({ date, employeeId: assignment.employeeId, categoryId: queue.category.id, priority: focusOwners.has(assignment.employeeId) ? 2 : 1, startTime: queue.startTime, endTime: queue.endTime, note: queue.accountNames.join(" + ") });
    }
    for (const queue of queues.filter((item) => item.category.mode === "SECONDARY")) {
      const candidates = eligible(queue);
      if (!candidates.length) { warnings.push(`${queue.category.name} has no eligible scheduled agent on ${shift.name}.`); continue; }
      const assignment = candidates.sort((left, right) => taskRows.filter((item) => item.employeeId === left.employeeId).length - taskRows.filter((item) => item.employeeId === right.employeeId).length)[0];
      taskRows.push({ date, employeeId: assignment.employeeId, categoryId: queue.category.id, priority: queue.category.defaultPriority, startTime: queue.startTime, endTime: queue.endTime, note: queue.accountNames.join(" + ") });
    }
  }

  const breakRows: { date: Date; employeeId: string; type: "MAIN" | "SHORT"; startTime: string; endTime: string }[] = [];
  const findSlot = (employeeId: string, type: "MAIN" | "SHORT", earliest: number, latestEnd: number, duration: number) => {
    for (let start = earliest; start + duration <= latestEnd; start += 10) {
      const end = start + duration;
      const conflicts = type === "MAIN" && breakRows.filter((item) => item.type === "MAIN" && toMinutes(item.startTime) < end + settings.breakGapMinutes && toMinutes(item.endTime) + settings.breakGapMinutes > start).length >= settings.maxConcurrentMainBreaks;
      if (conflicts) continue;
      const covered = assignments.some((assignment) => assignment.employeeId !== employeeId && assignment.shift && toMinutes(assignment.shift.startTime) <= start && toMinutes(assignment.shift.endTime) >= end && !breakRows.some((item) => item.employeeId === assignment.employeeId && toMinutes(item.startTime) < end && toMinutes(item.endTime) > start));
      if (covered) return { start, end };
    }
    return null;
  };
  for (const assignment of assignments) {
    if (!assignment.shift || settings.mainBreakMinutes <= 0) continue;
    const shiftStart = toMinutes(assignment.shift.startTime); const shiftEnd = toMinutes(assignment.shift.endTime);
    const overlapEnd = Math.max(shiftStart, ...assignments.filter((other) => other.employeeId !== assignment.employeeId && other.shift && toMinutes(other.shift.startTime) < shiftEnd && toMinutes(other.shift.endTime) > shiftStart).map((other) => toMinutes(other.shift!.endTime)));
    const latestMainStartForSplitBreak = overlapEnd - settings.mainBreakMinutes - settings.shortBreakDelayMinutes - settings.shortBreakMinutes;
    const preferredMainStart = shiftStart + settings.mainBreakAfterMinutes;
    const mainStart = Math.max(shiftStart, Math.min(preferredMainStart, latestMainStartForSplitBreak));
    const slot = findSlot(assignment.employeeId, "MAIN", mainStart, shiftEnd, settings.mainBreakMinutes);
    if (!slot) { warnings.push(`No coverage-safe ${settings.mainBreakMinutes}-minute main break was available for ${assignment.employee.name}.`); continue; }
    breakRows.push({ date, employeeId: assignment.employeeId, type: "MAIN", startTime: toTime(slot.start), endTime: toTime(slot.end) });
  }
  for (const assignment of assignments) {
    if (!assignment.shift || settings.shortBreakMinutes <= 0) continue;
    const main = breakRows.find((item) => item.employeeId === assignment.employeeId && item.type === "MAIN");
    const shiftStart = toMinutes(assignment.shift.startTime); const shiftEnd = toMinutes(assignment.shift.endTime);
    const earliest = main ? toMinutes(main.endTime) + settings.shortBreakDelayMinutes : shiftStart + settings.mainBreakAfterMinutes;
    let slot = findSlot(assignment.employeeId, "SHORT", earliest, shiftEnd, settings.shortBreakMinutes);
    if (!slot && main && settings.shortBreakDelayMinutes > 0) {
      slot = findSlot(assignment.employeeId, "SHORT", toMinutes(main.endTime), shiftEnd, settings.shortBreakMinutes);
      if (slot) warnings.push(`${assignment.employee.name}'s short break was moved earlier to preserve live-channel coverage.`);
    }
    if (!slot) { warnings.push(`No coverage-safe ${settings.shortBreakMinutes}-minute short break was available for ${assignment.employee.name}.`); continue; }
    breakRows.push({ date, employeeId: assignment.employeeId, type: "SHORT", startTime: toTime(slot.start), endTime: toTime(slot.end) });
  }

  await prisma.$transaction(async (tx) => {
    if (parsed.data.replace) {
      await tx.taskAssignment.deleteMany({ where: { date } });
      await tx.breakSchedule.deleteMany({ where: { date } });
    }
    if (taskRows.length) await tx.taskAssignment.createMany({ data: taskRows });
    if (breakRows.length) await tx.breakSchedule.createMany({ data: breakRows });
  });
  return NextResponse.json({ ok: true, tasksCreated: taskRows.length, breaksCreated: breakRows.length, warnings: [...new Set(warnings)] });
}
