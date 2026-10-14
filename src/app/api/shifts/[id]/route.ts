import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { clock, operationToday } from "@/lib/validation";
const schema = z.object({ name: z.string().trim().min(2), startTime: clock, endTime: clock, color: z.string().optional() }).refine(value => value.endTime > value.startTime, { message: "End time must be after start time." });
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the shift details." }, { status: 400 });
  const original = await prisma.shift.findUnique({ where: { id }, include: { staffingRules: true } });
  if (!original) return NextResponse.json({ error: "Shift not found." }, { status: 404 });
  if (await prisma.shift.findFirst({ where: { active: true, id: { not: id }, startTime: parsed.data.startTime, endTime: parsed.data.endTime } })) return NextResponse.json({ error: "Another active shift already uses those times." }, { status: 409 });
  const timingChanged = parsed.data.startTime !== original.startTime || parsed.data.endTime !== original.endTime;
  if (!timingChanged || !(await prisma.shiftAssignment.count({ where: { shiftId: id } }))) return NextResponse.json(await prisma.shift.update({ where: { id }, data: parsed.data }));
  const settings = await prisma.appSettings.findUnique({ where: { id: "global" } });
  const today = new Date(`${operationToday(settings?.timezone || "UTC")}T00:00:00Z`);
  const result = await prisma.$transaction(async tx => {
    const saved = await tx.shift.create({ data: { ...parsed.data, order: original.order, staffingRules: { create: original.staffingRules.map(({ dayOfWeek, minimumStaff, minimumBilingual, isOverride })=>({ dayOfWeek, minimumStaff, minimumBilingual, isOverride })) } } });
    await tx.shift.update({ where: { id }, data: { active: false } });
    await tx.employee.updateMany({ where: { preferredShiftId: id }, data: { preferredShiftId: saved.id } });
    const affected = await tx.shiftAssignment.findMany({ where: { shiftId: id, date: { gte: today } }, select: { date: true, schedulePeriodId: true } });
    await tx.shiftAssignment.updateMany({ where: { shiftId: id, date: { gte: today } }, data: { shiftId: saved.id, source: "shift-needs-review" } });
    const dates = affected.map(a=>a.date);
    await tx.schedulePeriod.updateMany({ where: { id: { in: [...new Set(affected.map(a=>a.schedulePeriodId))] } }, data: { status: "DRAFT", approvedAt: null } });
    await tx.taskAssignment.deleteMany({ where: { date: { in: dates } } });
    await tx.breakSchedule.deleteMany({ where: { date: { in: dates } } });
    await tx.dailyPlan.updateMany({ where: { date: { in: dates } }, data: { configHash: "", revision: { increment: 1 } } });
    return { ...saved, reviewRequired: dates.length > 0 };
  });
  return NextResponse.json(result);
}
export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (await prisma.shift.count({ where: { active: true } }) <= 1) return NextResponse.json({ error: "At least one active shift is required." }, { status: 409 });
  const settings = await prisma.appSettings.findUnique({ where: { id: "global" } });
  if (await prisma.shiftAssignment.count({ where: { shiftId: id, date: { gte: new Date(`${operationToday(settings?.timezone || "UTC")}T00:00:00Z`) }, status: "WORKING" } })) return NextResponse.json({ error: "This shift has future working assignments. Replace that coverage before removing the shift." }, { status: 409 });
  await prisma.shift.update({ where: { id }, data: { active: false } });
  return NextResponse.json({ ok: true });
}
