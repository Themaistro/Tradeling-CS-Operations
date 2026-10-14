import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { clock, dateKey, operationToday } from "@/lib/validation";
import { changedPlan } from "@/lib/daily-plan";
import { mainBreakCover } from "@/lib/main-break-cover";

const schema = z.object({ date: dateKey, employeeId: z.string(), type: z.enum(["MAIN", "SHORT"]), startTime: clock, endTime: clock, allowDurationException: z.boolean().default(false) });
const toMinutes = (value: string) => { const [hours, minutes] = value.split(":").map(Number); return hours * 60 + minutes; };

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the break details." }, { status: 400 });
  const input = parsed.data; const start = toMinutes(input.startTime); const end = toMinutes(input.endTime);
  if (end <= start) return NextResponse.json({ error: "Break end time must be after the start time." }, { status: 400 });
  const date = new Date(`${input.date}T00:00:00.000Z`);
  const [assignments, existingBreaks, settings, accounts] = await Promise.all([
    prisma.shiftAssignment.findMany({ where: { date, status: "WORKING", employee: { status: "ACTIVE" }, schedulePeriod: { status: { in: ["APPROVED", "PUBLISHED"] } } }, include: { shift: true, employee: true } }),
    prisma.breakSchedule.findMany({ where: { date } }),
    prisma.appSettings.upsert({ where: { id: "global" }, create: { id: "global" }, update: {} }),
    prisma.account.findMany({ where: { active: true }, include: { employeeCapabilities: true, coverageRequirements: true } }),
  ]);
  const working = assignments.find((assignment) => assignment.employeeId === input.employeeId);
  if (input.date < operationToday(settings.timezone)) return NextResponse.json({ error: "Past break history is preserved. Choose today or a future date." }, { status: 409 });
  if (!working?.shift) return NextResponse.json({ error: "Breaks can only be added for employees working that day." }, { status: 409 });
  if (input.startTime < working.shift.startTime || input.endTime > working.shift.endTime) return NextResponse.json({ error: `Break must be within the ${working.shift.startTime}–${working.shift.endTime} shift.` }, { status: 400 });
  const expected = input.type === "MAIN" ? settings.mainBreakMinutes : settings.shortBreakMinutes;
  const durationException = end - start !== expected && input.allowDurationException;
  if (end - start !== expected && !durationException) return NextResponse.json({ error: `${input.type === "MAIN" ? "Main" : "Short"} break must be ${expected} minutes. To save a different duration for this day only, select Allow duration exception.` }, { status: 400 });
  const otherBreak = existingBreaks.find((item) => item.employeeId === input.employeeId && item.type !== input.type);
  if (input.type === "SHORT" && !otherBreak) return NextResponse.json({ error: "Save the main break before adding the short break." }, { status: 409 });
  if (otherBreak) {
    const otherStart = toMinutes(otherBreak.startTime); const otherEnd = toMinutes(otherBreak.endTime);
    if (start < otherEnd && end > otherStart) return NextResponse.json({ error: "An employee's main and short breaks cannot overlap." }, { status: 409 });
    const mainEnd = input.type === "MAIN" ? end : otherEnd;
    const shortStart = input.type === "SHORT" ? start : otherStart;
    if (shortStart < mainEnd + settings.shortBreakDelayMinutes) return NextResponse.json({ error: `Keep the short break at least ${settings.shortBreakDelayMinutes} minutes after the main break.` }, { status: 409 });
  }
  const gap = settings.breakGapMinutes;
  const concurrentMainBreaks = input.type === "MAIN" ? existingBreaks.filter((item) => item.type === "MAIN" && item.employeeId !== input.employeeId && toMinutes(item.startTime) < end + gap && toMinutes(item.endTime) + gap > start).length : 0;
  if (concurrentMainBreaks >= settings.maxConcurrentMainBreaks) return NextResponse.json({ error: `A maximum of ${settings.maxConcurrentMainBreaks} agents can share a main-break slot. Keep ${gap} minutes between break groups.` }, { status: 409 });
  const hasCoverage = assignments.some((assignment) => assignment.employeeId !== input.employeeId && assignment.shift && toMinutes(assignment.shift.startTime) <= start && toMinutes(assignment.shift.endTime) >= end && !existingBreaks.some((item) => item.employeeId === assignment.employeeId && toMinutes(item.startTime) < end && toMinutes(item.endTime) > start));
  if (!hasCoverage) return NextResponse.json({ error: "No other scheduled agent is available to cover live calls and chats during this break." }, { status: 409 });
  const coverEmployeeId = input.type === "MAIN" ? mainBreakCover(input.employeeId, input.startTime, input.endTime, date.getUTCDay(), assignments, existingBreaks, accounts) : null;
  if (input.type === "MAIN" && !coverEmployeeId) return NextResponse.json({ error: "No qualified live-service cover is available for this main break. Choose another time." }, { status: 409 });
  const proposed = [...existingBreaks.filter(b=>b.employeeId !== input.employeeId || b.type !== input.type), { employeeId: input.employeeId, startTime: input.startTime, endTime: input.endTime }];
  if (input.type === "MAIN" && existingBreaks.filter(b=>b.type === "MAIN" && b.employeeId !== input.employeeId).some(b=>!mainBreakCover(b.employeeId,b.startTime,b.endTime,date.getUTCDay(),assignments,proposed,accounts))) return NextResponse.json({ error: "This change would leave another main break without qualified cover. Choose a different time." }, { status: 409 });
  const saved = await prisma.breakSchedule.upsert({ where: { date_employeeId_type: { date, employeeId: input.employeeId, type: input.type } }, create: { date, employeeId: input.employeeId, type: input.type, startTime: input.startTime, endTime: input.endTime, coverEmployeeId, durationException }, update: { startTime: input.startTime, endTime: input.endTime, coverEmployeeId, durationException } });
  for (const other of existingBreaks.filter(b=>b.type === "MAIN" && b.id !== saved.id)) {
    const cover = mainBreakCover(other.employeeId,other.startTime,other.endTime,date.getUTCDay(),assignments,proposed,accounts);
    if (cover !== other.coverEmployeeId) await prisma.breakSchedule.update({ where: { id: other.id }, data: { coverEmployeeId: cover } });
  }
  await changedPlan(date);
  return NextResponse.json(saved);
}

export async function DELETE(request: Request) {
  const parsed = z.object({ date: dateKey, employeeId: z.string(), type: z.enum(["MAIN", "SHORT"]).optional() }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid break." }, { status: 400 });
  const settings = await prisma.appSettings.findUnique({ where: { id: "global" } });
  if (parsed.data.date < operationToday(settings?.timezone || "UTC")) return NextResponse.json({ error: "Past break history is preserved." }, { status: 409 });
  await prisma.breakSchedule.deleteMany({ where: { date: new Date(`${parsed.data.date}T00:00:00.000Z`), employeeId: parsed.data.employeeId, type: parsed.data.type } });
  await changedPlan(new Date(`${parsed.data.date}T00:00:00Z`));
  return NextResponse.json({ ok: true });
}
