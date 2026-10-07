import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

const leaveTypes=["PTO","ANNUAL_LEAVE","EMERGENCY_LEAVE","COMP_OFF","PUBLIC_HOLIDAY","SICK","UNPAID","OTHER","UNPAID_LEAVE","OTHER_LEAVE"] as const;
const schema=z.object({name:z.string().trim().min(2).max(80),slackId:z.string().trim().max(30).nullable(),isBilingual:z.boolean(),preferredShiftId:z.string().nullable(),daysOff:z.array(z.number().int().min(0).max(6)),timeOff:z.array(z.object({date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),type:z.enum(leaveTypes),note:z.string().max(200).nullable().optional()}))});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Please check the employee details." }, { status: 400 });
  const { daysOff, timeOff, ...employee } = parsed.data;
  const slackId = employee.slackId || null;
  const currentOwner = slackId ? await prisma.employee.findUnique({ where: { slackId }, select: { id: true, name: true, status: true } }) : null;
  if (currentOwner && currentOwner.id !== id && currentOwner.status === "ACTIVE") {
    return NextResponse.json({ error: `This Slack ID is already assigned to ${currentOwner.name}.` }, { status: 409 });
  }
  try {
    await prisma.$transaction(async (tx) => {
      if (currentOwner && currentOwner.id !== id) await tx.employee.update({ where: { id: currentOwner.id }, data: { slackId: null } });
      await tx.employee.update({ where: { id }, data: { ...employee, slackId, preferredShiftId: employee.preferredShiftId || null } });
      await tx.dayOffPreference.deleteMany({ where: { employeeId: id } });
      if (daysOff.length) await tx.dayOffPreference.createMany({ data: daysOff.map((dayOfWeek) => ({ employeeId: id, rank: 1, dayOfWeek })) });
      await tx.timeOff.deleteMany({ where: { employeeId: id } });
      if (timeOff.length) await tx.timeOff.createMany({ data: timeOff.map((item) => ({ employeeId: id, date: new Date(`${item.date}T00:00:00.000Z`), type: item.type, note: item.note || null })) });
      for (const item of timeOff) {
        const date = new Date(`${item.date}T00:00:00.000Z`);
        const status = item.type === "UNPAID" ? "UNPAID_LEAVE" : item.type === "OTHER" ? "OTHER_LEAVE" : item.type;
        await tx.shiftAssignment.updateMany({ where: { employeeId: id, date }, data: { status, shiftId: null, workLocation: "OFFICE", source: item.type === "EMERGENCY_LEAVE" ? "emergency-leave" : "leave" } });
        await tx.taskAssignment.deleteMany({ where: { employeeId: id, date } });
        await tx.breakSchedule.deleteMany({ where: { employeeId: id, date } });
      }
    });
    return NextResponse.json({ ok: true, reassignedArchivedSlackId: Boolean(currentOwner && currentOwner.id !== id) });
  } catch {
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
  await prisma.employee.update({ where: { id }, data: { status: "INACTIVE" } });
  return NextResponse.json({ ok: true });
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
