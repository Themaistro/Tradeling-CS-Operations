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
  const [assignments, categories, accounts, existingTasks, existingBreaks, settings] = await Promise.all([
    prisma.shiftAssignment.findMany({
      where: { date, status: "WORKING", schedulePeriod: { status: { in: ["APPROVED", "PUBLISHED"] } } },
      include: { employee: true, shift: { include: { staffingRules: { where: { dayOfWeek: weekday } } } } },
      orderBy: [{ shift: { order: "asc" } }, { employee: { name: "asc" } }],
    }),
    prisma.taskCategory.findMany({ where: { active: true }, orderBy: { order: "asc" } }),
    prisma.account.findMany({ where: { active: true }, include: { coverageRequirements: true, employeeCapabilities: true } }),
    prisma.taskAssignment.count({ where: { date } }),
    prisma.breakSchedule.count({ where: { date } }),
    prisma.appSettings.upsert({ where: { id: "global" }, create: { id: "global" }, update: {} }),
  ]);
  if (!assignments.length) return NextResponse.json({ error: "Approve a working roster for this date before building the daily plan." }, { status: 409 });
  if ((existingTasks || existingBreaks) && !parsed.data.replace) return NextResponse.json({ error: "This day already contains tasks or breaks.", code: "PLAN_EXISTS", existingTasks, existingBreaks }, { status: 409 });
  if (!categories.length) return NextResponse.json({ error: "Add at least one active task category first." }, { status: 409 });

  const taskRows: { date: Date; employeeId: string; categoryId: string; note: string }[] = [];
  const warnings: string[] = [];
  const byShift = Map.groupBy(assignments, (assignment) => assignment.shiftId ?? "unassigned");
  for (const shiftAssignments of byShift.values()) {
    const shift = shiftAssignments[0]?.shift;
    if (!shift) continue;
    const relevantAccounts = accounts.filter((account) => account.coverageRequirements.some((requirement) => requirement.dayOfWeek === weekday && shift.startTime <= requirement.startTime && shift.endTime >= requirement.endTime));
    const relevantAccountIds = new Set(relevantAccounts.map((account) => account.id));
    const relevantCategories = categories.filter((category) => !category.accountId || relevantAccountIds.has(category.accountId)).sort((a, b) => Number(b.isLive) - Number(a.isLive) || a.order - b.order);
    let cursor = 0;
    for (const category of relevantCategories) {
      const account = category.accountId ? relevantAccounts.find((item) => item.id === category.accountId) : null;
      const capable = account ? new Set(account.employeeCapabilities.map((item) => item.employeeId)) : null;
      const candidates = shiftAssignments.filter((assignment) => !capable || capable.has(assignment.employeeId));
      if (!candidates.length) { warnings.push(`${category.name} has no eligible scheduled agent on ${shift.name}.`); continue; }
      const assignment = candidates[cursor % candidates.length]; cursor += 1;
      taskRows.push({ date, employeeId: assignment.employeeId, categoryId: category.id, note: "Automatically assigned from the active operation workstreams." });
    }
    const fallback = relevantCategories.find((category) => !category.isLive) ?? relevantCategories[0];
    if (fallback) shiftAssignments.forEach((assignment) => {
      if (!taskRows.some((item) => item.employeeId === assignment.employeeId)) taskRows.push({ date, employeeId: assignment.employeeId, categoryId: fallback.id, note: "Automatically assigned from the active operation workstreams." });
    });
    const liveCount = relevantCategories.filter((category) => category.isLive).length;
    if (liveCount > shiftAssignments.length) warnings.push(`${shift.name} has more live workstreams than agents. Shared coverage was assigned and should be monitored.`);
  }

  const breakRows: { date: Date; employeeId: string; type: "MAIN" | "SHORT"; startTime: string; endTime: string }[] = [];
  const findSlot = (employeeId: string, type: "MAIN" | "SHORT", earliest: number, latestEnd: number, duration: number) => {
    for (let start = earliest; start + duration <= latestEnd; start += 10) {
      const end = start + duration;
      const conflicts = type === "MAIN" && breakRows.some((item) => item.type === "MAIN" && toMinutes(item.startTime) < end + settings.breakGapMinutes && toMinutes(item.endTime) + settings.breakGapMinutes > start);
      if (conflicts) continue;
      const covered = assignments.some((assignment) => assignment.employeeId !== employeeId && assignment.shift && toMinutes(assignment.shift.startTime) <= start && toMinutes(assignment.shift.endTime) >= end && !breakRows.some((item) => item.employeeId === assignment.employeeId && toMinutes(item.startTime) < end && toMinutes(item.endTime) > start));
      if (covered) return { start, end };
    }
    return null;
  };
  for (const assignment of assignments) {
    if (!assignment.shift || settings.mainBreakMinutes <= 0) continue;
    const shiftStart = toMinutes(assignment.shift.startTime); const shiftEnd = toMinutes(assignment.shift.endTime);
    const slot = findSlot(assignment.employeeId, "MAIN", shiftStart + settings.mainBreakAfterMinutes, shiftEnd, settings.mainBreakMinutes);
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
