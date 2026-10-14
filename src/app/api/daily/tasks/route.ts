import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { clock, dateKey, operationToday } from "@/lib/validation";
import { changedPlan } from "@/lib/daily-plan";
const schema = z.object({ date: dateKey, employeeId: z.string(), categoryId: z.string(), note: z.string().max(500).nullable().optional(), priority: z.number().int().min(1).max(2).optional(), startTime: clock.nullable().optional(), endTime: clock.nullable().optional() });
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the task details." }, { status: 400 });
  const input = parsed.data;
  const date = new Date(`${input.date}T00:00:00Z`);
  const settings = await prisma.appSettings.findUnique({ where: { id: "global" } });
  if (input.date < operationToday(settings?.timezone || "UTC")) return NextResponse.json({ error: "Past task history is preserved. Choose today or a future date." }, { status: 409 });
  const [working, category, existing] = await Promise.all([
    prisma.shiftAssignment.findFirst({ where: { date, employeeId: input.employeeId, status: "WORKING", employee: { status: "ACTIVE" }, schedulePeriod: { status: { in: ["APPROVED", "PUBLISHED"] } } }, include: { shift: true, employee: { include: { accountCapabilities: true } } } }),
    prisma.taskCategory.findFirst({ where: { id: input.categoryId, active: true }, include: { account: { include: { operatingWindows: true } } } }),
    prisma.taskAssignment.findUnique({ where: { date_employeeId_categoryId: { date, employeeId: input.employeeId, categoryId: input.categoryId } } }),
  ]);
  if (!working?.shift || !category) return NextResponse.json({ error: "Choose an active task for an employee working that day." }, { status: 409 });
  const shift = working.shift;
  if (category.account && (!category.account.active || !working.employee.accountCapabilities.some(c => c.accountId === category.accountId))) return NextResponse.json({ error: "This employee is not eligible for this account." }, { status: 409 });
  const windows = category.account ? category.account.operatingWindows.filter(w => w.dayOfWeek === date.getUTCDay() && w.startTime < shift.endTime && w.endTime > shift.startTime).map(w => ({ start: w.startTime > shift.startTime ? w.startTime : shift.startTime, end: w.endTime < shift.endTime ? w.endTime : shift.endTime })) : [{ start: shift.startTime, end: shift.endTime }];
  if (!windows.length) return NextResponse.json({ error: "This account is closed during the selected shift." }, { status: 409 });
  const explicit = Boolean(input.startTime || input.endTime);
  if (explicit && (!input.startTime || !input.endTime)) return NextResponse.json({ error: "Provide both task times." }, { status: 400 });
  const startTime = explicit ? input.startTime! : existing?.startTime ?? windows[0].start;
  const endTime = explicit ? input.endTime! : existing?.endTime ?? windows[0].end;
  if (startTime >= endTime || !windows.some(w => startTime >= w.start && endTime <= w.end)) return NextResponse.json({ error: "Task times must be inside the employee's shift and this account's service hours." }, { status: 400 });
  const values = { startTime, endTime, note: input.note === undefined ? existing?.note ?? null : input.note || null, priority: input.priority ?? existing?.priority ?? category.defaultPriority };
  const result = await prisma.taskAssignment.upsert({ where: { date_employeeId_categoryId: { date, employeeId: input.employeeId, categoryId: input.categoryId } }, create: { date, employeeId: input.employeeId, categoryId: input.categoryId, ...values }, update: values });
  await changedPlan(date);
  return NextResponse.json(result);
}
export async function DELETE(request: Request) {
  const parsed = schema.pick({ date: true, employeeId: true, categoryId: true }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid task." }, { status: 400 });
  const settings = await prisma.appSettings.findUnique({ where: { id: "global" } });
  if (parsed.data.date < operationToday(settings?.timezone || "UTC")) return NextResponse.json({ error: "Past task history is preserved." }, { status: 409 });
  await prisma.taskAssignment.deleteMany({ where: { ...parsed.data, date: new Date(`${parsed.data.date}T00:00:00Z`) } });
  await changedPlan(new Date(`${parsed.data.date}T00:00:00Z`));
  return NextResponse.json({ ok: true });
}
