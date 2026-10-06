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
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z]/g, "");

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid operation date." }, { status: 400 });
  const date = new Date(`${parsed.data.date}T00:00:00.000Z`);
  const weekday = date.getUTCDay();
  const [assignments, categories, existingTasks, existingBreaks, settings] = await Promise.all([
    prisma.shiftAssignment.findMany({
      where: { date, status: "WORKING", schedulePeriod: { status: { in: ["APPROVED", "PUBLISHED"] } } },
      include: { employee: true, shift: { include: { staffingRules: { where: { dayOfWeek: weekday } } } } },
      orderBy: [{ shift: { order: "asc" } }, { employee: { name: "asc" } }],
    }),
    prisma.taskCategory.findMany({ where: { active: true }, orderBy: { order: "asc" } }),
    prisma.taskAssignment.count({ where: { date } }),
    prisma.breakSchedule.count({ where: { date } }),
    prisma.appSettings.upsert({ where: { id: "global" }, create: { id: "global" }, update: {} }),
  ]);
  if (!assignments.length) return NextResponse.json({ error: "Approve a working roster for this date before building the daily plan." }, { status: 409 });
  if ((existingTasks || existingBreaks) && !parsed.data.replace) return NextResponse.json({ error: "This day already contains tasks or breaks.", code: "PLAN_EXISTS", existingTasks, existingBreaks }, { status: 409 });
  if (!categories.length) return NextResponse.json({ error: "Add at least one active task category first." }, { status: 409 });

  const categoryByRole = new Map(categories.map((category) => [normalize(category.name), category]));
  const fallback = categories.find((category) => normalize(category.name).includes("follow")) ?? categories[0];
  const taskRows: { date: Date; employeeId: string; categoryId: string; note: string }[] = [];
  const warnings: string[] = [];
  const byShift = Map.groupBy(assignments, (assignment) => assignment.shiftId ?? "unassigned");
  for (const shiftAssignments of byShift.values()) {
    const rule = shiftAssignments[0]?.shift?.staffingRules[0];
    const queue: string[] = [];
    for (const [role, count] of [["calls", rule?.calls ?? 0], ["chats", rule?.chats ?? 0], ["tickets", rule?.tickets ?? 0]] as const) {
      const category = categoryByRole.get(role);
      if (!category && count > 0) warnings.push(`No active ${role} category exists, so those assignments used ${fallback.name}.`);
      for (let index = 0; index < count; index += 1) queue.push((category ?? fallback).id);
    }
    shiftAssignments.forEach((assignment, index) => {
      const categoryId = queue[index] ?? fallback.id;
      taskRows.push({ date, employeeId: assignment.employeeId, categoryId, note: "Automatically assigned from the approved staffing plan." });
    });
    if (queue.length > shiftAssignments.length) warnings.push(`${shiftAssignments[0]?.shift?.name ?? "A shift"} requires ${queue.length} task positions but only has ${shiftAssignments.length} working team members.`);
  }

  const breakRows: { date: Date; employeeId: string; startTime: string; endTime: string }[] = [];
  const breakMinutes = settings.defaultBreakMinutes;
  let globalCursor = 0;
  if (breakMinutes > 0) {
    for (const assignment of assignments) {
      if (!assignment.shift) continue;
      const earliest = toMinutes(assignment.shift.startTime) + 60;
      const latestEnd = toMinutes(assignment.shift.endTime) - 30;
      const start = Math.max(earliest, globalCursor);
      const end = start + breakMinutes;
      if (end > latestEnd) {
        warnings.push(`No safe ${breakMinutes}-minute break slot was available for ${assignment.employee.name}.`);
        continue;
      }
      breakRows.push({ date, employeeId: assignment.employeeId, startTime: toTime(start), endTime: toTime(end) });
      globalCursor = end;
    }
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
