import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { generateSchedule } from "@/features/scheduling/engine/generate-schedule";

export async function GET(request: Request) {
  const url = new URL(request.url); const year = Number(url.searchParams.get("year")); const month = Number(url.searchParams.get("month"));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return NextResponse.json({ error: "Invalid month." }, { status: 400 });
  const period = await prisma.schedulePeriod.findUnique({ where: { year_month: { year, month } }, include: { assignments: { include: { employee: true, shift: true }, orderBy: { date: "asc" } } } });
  if (!period) return NextResponse.json(null);
  const [rules, settings] = await Promise.all([
    prisma.staffingRule.findMany({ include: { shift: true } }),
    prisma.appSettings.upsert({ where: { id: "global" }, create: { id: "global" }, update: {} }),
  ]);
  const operatingDays = new Set(settings.workingDays.split(",").map(Number));
  const warnings: { date: string; shiftId: string; severity: "critical"; code: string; message: string }[] = [];
  const working = period.assignments.filter((assignment) => assignment.status === "WORKING" && assignment.shiftId);
  const dateKeys = [...new Set(period.assignments.map((assignment) => assignment.date.toISOString().slice(0, 10)))];
  for (const date of dateKeys) {
    const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    if (!operatingDays.has(weekday)) continue;
    for (const rule of rules.filter((item) => item.dayOfWeek === weekday && item.shift.active)) {
      const staffed = working.filter((assignment) => assignment.date.toISOString().slice(0, 10) === date && assignment.shiftId === rule.shiftId);
      if (staffed.length < rule.minimumStaff) warnings.push({ date, shiftId: rule.shiftId, severity: "critical", code: "STAFF_SHORTAGE", message: `${rule.shift.name} needs ${rule.minimumStaff - staffed.length} more team member(s).` });
      const bilingual = staffed.filter((assignment) => assignment.employee.isBilingual).length;
      if (bilingual < rule.minimumBilingual) warnings.push({ date, shiftId: rule.shiftId, severity: "critical", code: "BILINGUAL_SHORTAGE", message: `${rule.shift.name} needs ${rule.minimumBilingual - bilingual} more bilingual team member(s).` });
    }
  }
  return NextResponse.json({ ...period, warnings });
}

export async function POST(request: Request) {
  const { year, month, force = false } = await request.json();
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return NextResponse.json({ error: "Invalid month." }, { status: 400 });
  const [employees, shifts, settings] = await Promise.all([
    prisma.employee.findMany({ where: { status: "ACTIVE" }, include: { dayOffPreferences: true, timeOff: true } }),
    prisma.shift.findMany({ where: { active: true }, include: { staffingRules: true }, orderBy: { order: "asc" } }),
    prisma.appSettings.upsert({ where: { id: "global" }, create: { id: "global" }, update: {} }),
  ]);
  if (!employees.length || !shifts.length) return NextResponse.json({ error: "Add at least one employee and one shift first." }, { status: 400 });
  const existing = await prisma.schedulePeriod.findUnique({ where: { year_month: { year, month } } });
  if (existing && existing.status !== "DRAFT" && !force) return NextResponse.json({ error: "This schedule is approved. Reopen it before generating a replacement.", code: "SCHEDULE_LOCKED" }, { status: 409 });
  const workingDays = settings.workingDays.split(",").map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  const generated = generateSchedule({ year, month, maxConsecutiveDays: settings.maxConsecutiveDays, workingDays, maxWeeklyDays: 5, employees: employees.map(e => ({ id: e.id, name: e.name, preferredShiftId: e.preferredShiftId, isBilingual: e.isBilingual, dayOffPreferences: e.dayOffPreferences.map(d => ({ dayOfWeek: d.dayOfWeek, rank: d.rank })), timeOff: e.timeOff.map(t => ({ date: t.date.toISOString().slice(0, 10), type: t.type })) })), shifts: shifts.map(s => ({ id: s.id, name: s.name, minimumByDay: Object.fromEntries(s.staffingRules.map(r => [r.dayOfWeek, r.minimumStaff])), bilingualByDay: Object.fromEntries(s.staffingRules.map(r => [r.dayOfWeek, r.minimumBilingual])) })) });
  const period = await prisma.$transaction(async tx => {
    const saved = await tx.schedulePeriod.upsert({ where: { year_month: { year, month } }, create: { year, month, generatedAt: new Date() }, update: { status: "DRAFT", generatedAt: new Date() } });
    await tx.shiftAssignment.deleteMany({ where: { schedulePeriodId: saved.id } });
    await tx.shiftAssignment.createMany({ data: generated.assignments.map(a => ({ schedulePeriodId: saved.id, employeeId: a.employeeId, date: new Date(`${a.date}T00:00:00.000Z`), status: a.status, shiftId: a.shiftId })) });
    return saved;
  });
  return NextResponse.json({ period, warnings: generated.warnings });
}

export async function PATCH(request: Request) {
  const { year, month, status } = await request.json();
  if (!["DRAFT", "APPROVED", "PUBLISHED"].includes(status)) return NextResponse.json({ error: "Invalid schedule status." }, { status: 400 });
  const period = await prisma.schedulePeriod.update({ where: { year_month: { year: Number(year), month: Number(month) } }, data: { status, approvedAt: status === "APPROVED" ? new Date() : undefined } });
  return NextResponse.json(period);
}
