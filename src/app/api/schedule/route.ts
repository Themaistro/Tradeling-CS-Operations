import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { generateSchedule } from "@/features/scheduling/engine/generate-schedule";

export async function GET(request: Request) {
  const url = new URL(request.url); const year = Number(url.searchParams.get("year")); const month = Number(url.searchParams.get("month"));
  const period = await prisma.schedulePeriod.findUnique({ where: { year_month: { year, month } }, include: { assignments: { include: { employee: true, shift: true }, orderBy: { date: "asc" } } } });
  return NextResponse.json(period);
}

export async function POST(request: Request) {
  const { year, month } = await request.json();
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return NextResponse.json({ error: "Invalid month." }, { status: 400 });
  const [employees, shifts, settings] = await Promise.all([
    prisma.employee.findMany({ where: { status: "ACTIVE" }, include: { dayOffPreferences: true, timeOff: true } }),
    prisma.shift.findMany({ where: { active: true }, include: { staffingRules: true }, orderBy: { order: "asc" } }),
    prisma.appSettings.upsert({ where: { id: "global" }, create: { id: "global" }, update: {} }),
  ]);
  if (!employees.length || !shifts.length) return NextResponse.json({ error: "Add at least one employee and one shift first." }, { status: 400 });
  const generated = generateSchedule({ year, month, maxConsecutiveDays: settings.maxConsecutiveDays, employees: employees.map(e => ({ id: e.id, name: e.name, preferredShiftId: e.preferredShiftId, isBilingual: e.isBilingual, daysOff: e.dayOffPreferences.map(d => d.dayOfWeek), timeOff: e.timeOff.map(t => t.date.toISOString().slice(0, 10)) })), shifts: shifts.map(s => ({ id: s.id, name: s.name, minimumByDay: Object.fromEntries(s.staffingRules.map(r => [r.dayOfWeek, r.minimumStaff])), bilingualByDay: Object.fromEntries(s.staffingRules.map(r => [r.dayOfWeek, r.minimumBilingual])) })) });
  const period = await prisma.$transaction(async tx => {
    const saved = await tx.schedulePeriod.upsert({ where: { year_month: { year, month } }, create: { year, month, generatedAt: new Date() }, update: { status: "DRAFT", generatedAt: new Date() } });
    await tx.shiftAssignment.deleteMany({ where: { schedulePeriodId: saved.id } });
    await tx.shiftAssignment.createMany({ data: generated.assignments.map(a => ({ schedulePeriodId: saved.id, employeeId: a.employeeId, date: new Date(`${a.date}T00:00:00.000Z`), status: a.status, shiftId: a.shiftId })) });
    return saved;
  });
  return NextResponse.json({ period, warnings: generated.warnings });
}
