import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

const schema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), employeeId: z.string(), type: z.enum(["MAIN", "SHORT"]), startTime: z.string().regex(/^\d{2}:\d{2}$/), endTime: z.string().regex(/^\d{2}:\d{2}$/) });
const toMinutes = (value: string) => { const [hours, minutes] = value.split(":").map(Number); return hours * 60 + minutes; };

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the break details." }, { status: 400 });
  const input = parsed.data; const start = toMinutes(input.startTime); const end = toMinutes(input.endTime);
  if (end <= start) return NextResponse.json({ error: "Break end time must be after the start time." }, { status: 400 });
  const date = new Date(`${input.date}T00:00:00.000Z`);
  const [assignments, existingBreaks, settings] = await Promise.all([
    prisma.shiftAssignment.findMany({ where: { date, status: "WORKING", schedulePeriod: { status: { in: ["APPROVED", "PUBLISHED"] } } }, include: { shift: true } }),
    prisma.breakSchedule.findMany({ where: { date } }),
    prisma.appSettings.upsert({ where: { id: "global" }, create: { id: "global" }, update: {} }),
  ]);
  const working = assignments.find((assignment) => assignment.employeeId === input.employeeId);
  if (!working?.shift) return NextResponse.json({ error: "Breaks can only be added for employees working that day." }, { status: 409 });
  if (input.startTime < working.shift.startTime || input.endTime > working.shift.endTime) return NextResponse.json({ error: `Break must be within the ${working.shift.startTime}–${working.shift.endTime} shift.` }, { status: 400 });
  const expected = input.type === "MAIN" ? settings.mainBreakMinutes : settings.shortBreakMinutes;
  if (end - start !== expected) return NextResponse.json({ error: `${input.type === "MAIN" ? "Main" : "Short"} break must be exactly ${expected} minutes.` }, { status: 400 });
  const gap = settings.breakGapMinutes;
  const concurrentMainBreaks = input.type === "MAIN" ? existingBreaks.filter((item) => item.type === "MAIN" && item.employeeId !== input.employeeId && toMinutes(item.startTime) < end + gap && toMinutes(item.endTime) + gap > start).length : 0;
  if (concurrentMainBreaks >= settings.maxConcurrentMainBreaks) return NextResponse.json({ error: `A maximum of ${settings.maxConcurrentMainBreaks} agents can share a main-break slot. Keep ${gap} minutes between break groups.` }, { status: 409 });
  const hasCoverage = assignments.some((assignment) => assignment.employeeId !== input.employeeId && assignment.shift && toMinutes(assignment.shift.startTime) <= start && toMinutes(assignment.shift.endTime) >= end && !existingBreaks.some((item) => item.employeeId === assignment.employeeId && toMinutes(item.startTime) < end && toMinutes(item.endTime) > start));
  if (!hasCoverage) return NextResponse.json({ error: "No other scheduled agent is available to cover live calls and chats during this break." }, { status: 409 });
  return NextResponse.json(await prisma.breakSchedule.upsert({ where: { date_employeeId_type: { date, employeeId: input.employeeId, type: input.type } }, create: { date, employeeId: input.employeeId, type: input.type, startTime: input.startTime, endTime: input.endTime }, update: { startTime: input.startTime, endTime: input.endTime } }));
}

export async function DELETE(request: Request) {
  const parsed = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), employeeId: z.string(), type: z.enum(["MAIN", "SHORT"]).optional() }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid break." }, { status: 400 });
  await prisma.breakSchedule.deleteMany({ where: { date: new Date(`${parsed.data.date}T00:00:00.000Z`), employeeId: parsed.data.employeeId, type: parsed.data.type } });
  return NextResponse.json({ ok: true });
}
