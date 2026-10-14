import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { operationToday, dateKey } from "@/lib/validation";

const leaveTypes=["PTO","ANNUAL_LEAVE","EMERGENCY_LEAVE","COMP_OFF","PUBLIC_HOLIDAY","SICK","UNPAID","OTHER","UNPAID_LEAVE","OTHER_LEAVE"] as const;
const schema=z.object({name:z.string().trim().min(2).max(80),slackId:z.string().trim().max(30).nullable(),isBilingual:z.boolean(),preferredShiftId:z.string().nullable(),daysOff:z.array(z.number().int().min(0).max(6)),timeOff:z.array(z.object({date:dateKey,type:z.enum(leaveTypes),note:z.string().max(200).nullable().optional()}))});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Please check the employee details." }, { status: 400 });
  const { daysOff, timeOff, ...employee } = parsed.data;
  const slackId = employee.slackId || null;
  const currentOwner = slackId ? await prisma.employee.findUnique({ where: { slackId }, select: { id: true, name: true, status: true } }) : null;
  const settings = await prisma.appSettings.findUnique({ where: { id: "global" } });
  const today = operationToday(settings?.timezone || "UTC");
  const affectedPeriods = new Set<string>();
  if (currentOwner && currentOwner.id !== id && currentOwner.status === "ACTIVE") {
    return NextResponse.json({ error: `This Slack ID is already assigned to ${currentOwner.name}.` }, { status: 409 });
  }
  try {
    await prisma.$transaction(async (tx) => {
      const existingLeave = await tx.timeOff.findMany({ where: { employeeId: id }, select: { date: true, type: true } });
      const existingByDate = new Map(existingLeave.map((item) => [item.date.toISOString().slice(0, 10), item.type]));
      const requestedByDate = new Map(timeOff.map((item) => [item.date, item.type]));
      const changedDates = new Set<string>();
      for (const item of timeOff) if (existingByDate.get(item.date) !== item.type) changedDates.add(item.date);
      for (const item of existingLeave) {
        const key = item.date.toISOString().slice(0, 10);
        if (!requestedByDate.has(key)) changedDates.add(key);
      }

      if ([...changedDates].some(date => date < today)) throw new Error("PAST_LEAVE");
      // Save future leave first, then reopen the affected periods for review.
      const plannedImpactDates = [...changedDates].filter((date) => requestedByDate.get(date) !== "EMERGENCY_LEAVE");
      if (plannedImpactDates.length) {
        const impacted = await tx.shiftAssignment.findMany({
          where: { employeeId: id, date: { in: plannedImpactDates.map((date) => new Date(`${date}T00:00:00.000Z`)) } },
          select: { schedulePeriodId: true, schedulePeriod: { select: { year: true, month: true, status: true } } },
        });
        if (impacted.length) {
          for (const item of impacted) affectedPeriods.add(`${item.schedulePeriod.year}-${String(item.schedulePeriod.month).padStart(2, "0")}`);
          await tx.schedulePeriod.updateMany({ where: { id: { in: [...new Set(impacted.map(item => item.schedulePeriodId))] } }, data: { status: "DRAFT", approvedAt: null } });
        }
      }
      if (currentOwner && currentOwner.id !== id) await tx.employee.update({ where: { id: currentOwner.id }, data: { slackId: null } });
      await tx.employee.update({ where: { id }, data: { ...employee, slackId, preferredShiftId: employee.preferredShiftId || null } });
      await tx.dayOffPreference.deleteMany({ where: { employeeId: id } });
      if (daysOff.length) await tx.dayOffPreference.createMany({ data: daysOff.map((dayOfWeek) => ({ employeeId: id, rank: 1, dayOfWeek })) });
      await tx.timeOff.deleteMany({ where: { employeeId: id } });
      if (timeOff.length) await tx.timeOff.createMany({ data: timeOff.map((item) => ({ employeeId: id, date: new Date(`${item.date}T00:00:00.000Z`), type: item.type, note: item.note || null })) });
      for (const item of timeOff.filter((item) => changedDates.has(item.date))) {
        const date = new Date(`${item.date}T00:00:00.000Z`);
        const status = item.type === "UNPAID" ? "UNPAID_LEAVE" : item.type === "OTHER" ? "OTHER_LEAVE" : item.type;
        await tx.shiftAssignment.updateMany({ where: { employeeId: id, date }, data: { status, shiftId: null, workLocation: "OFFICE", source: item.type === "EMERGENCY_LEAVE" ? "emergency-leave" : "leave" } });
        await tx.taskAssignment.deleteMany({ where: { employeeId: id, date } });
        await tx.breakSchedule.deleteMany({ where: { employeeId: id, date } });
      }
      for (const key of changedDates) if (!requestedByDate.has(key)) {
        const date = new Date(`${key}T00:00:00Z`);
        await tx.shiftAssignment.updateMany({ where: { employeeId: id, date }, data: { status: "OFF", shiftId: null, source: "leave-needs-review" } });
        await tx.taskAssignment.deleteMany({ where: { employeeId: id, date } });
        await tx.breakSchedule.deleteMany({ where: { employeeId: id, date } });
      }
    });
    return NextResponse.json({ ok: true, affectedPeriods: [...affectedPeriods], reassignedArchivedSlackId: Boolean(currentOwner && currentOwner.id !== id) });
  } catch (error) {
    if (error instanceof Error && error.message === "PAST_LEAVE") return NextResponse.json({ error: "Past leave history is preserved. Choose today or a future date for availability changes." }, { status: 409 });
    return NextResponse.json({ error: "The employee could not be saved. Check that the Slack ID is unique and try again." }, { status: 409 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const permanent = new URL(request.url).searchParams.get("permanent") === "true";
  if (permanent) {
    const employee = await prisma.employee.findUnique({ where: { id }, select: { status: true } });
    if (!employee) return NextResponse.json({ error: "Archived employee not found." }, { status: 404 });
    if (employee.status !== "INACTIVE") {
      return NextResponse.json({ error: "Only archived employees can be permanently deleted." }, { status: 409 });
    }
    await prisma.employee.delete({ where: { id } });
    return NextResponse.json({ ok: true, permanentlyDeleted: true });
  }
  const settings = await prisma.appSettings.upsert({ where: { id: "global" }, create: { id: "global" }, update: {} });
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: settings.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const date = new Date(`${todayKey}T00:00:00.000Z`);
  const futureWorking = await prisma.shiftAssignment.findMany({
    where: { employeeId: id, date: { gte: date }, status: "WORKING" },
    select: { date: true, schedulePeriodId: true, schedulePeriod: { select: { year: true, month: true } } },
    orderBy: { date: "asc" },
  });
  await prisma.$transaction(async (tx) => {
    await tx.employee.update({ where: { id }, data: { status: "INACTIVE" } });
    if (!futureWorking.length) return;
    const affectedDates = [...new Set(futureWorking.map((item) => item.date.toISOString().slice(0, 10)))].map((item) => new Date(`${item}T00:00:00.000Z`));
    const affectedPeriodIds = [...new Set(futureWorking.map((item) => item.schedulePeriodId))];
    await tx.shiftAssignment.updateMany({
      where: { employeeId: id, date: { in: affectedDates }, status: "WORKING" },
      data: { status: "OFF", shiftId: null, workLocation: "OFFICE", source: "archive-needs-replacement" },
    });
    // Rebuild daily ownership after the replacement plan is approved; leaving a
    // partial task plan would be more dangerous than clearing it for review.
    await tx.taskAssignment.deleteMany({ where: { date: { in: affectedDates } } });
    await tx.breakSchedule.deleteMany({ where: { date: { in: affectedDates } } });
    await tx.schedulePeriod.updateMany({ where: { id: { in: affectedPeriodIds } }, data: { status: "DRAFT", approvedAt: null } });
  });
  const periods = [...new Set(futureWorking.map((item) => `${item.schedulePeriod.year}-${String(item.schedulePeriod.month).padStart(2, "0")}`))];
  return NextResponse.json({ ok: true, replacementsRequired: futureWorking.length, affectedPeriods: periods, reopened: periods.length > 0 });
}

export async function PUT(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const employee = await prisma.employee.findUnique({ where: { id }, select: { id: true, name: true, status: true } });
  if (!employee) return NextResponse.json({ error: "Archived employee not found." }, { status: 404 });
  if (employee.status === "ACTIVE") return NextResponse.json({ ok: true });
  const activeDuplicate = await prisma.employee.findFirst({ where: { status: "ACTIVE", name: { equals: employee.name, mode: "insensitive" } }, select: { name: true } });
  if (activeDuplicate) return NextResponse.json({ error: `${activeDuplicate.name} already has an active profile. Update that profile instead of restoring a duplicate.` }, { status: 409 });
  await prisma.employee.update({ where: { id }, data: { status: "ACTIVE" } });
  return NextResponse.json({ ok: true });
}
