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
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const historyStart = new Date(monthStart); historyStart.setUTCDate(historyStart.getUTCDate() - 7);
  const priorAssignments = await prisma.shiftAssignment.findMany({ where: { date: { gte: historyStart, lt: monthStart }, status: "WORKING", employeeId: { in: employees.map((employee) => employee.id) }, schedulePeriod: { status: { in: ["APPROVED", "PUBLISHED"] } } }, select: { employeeId: true, date: true } });
  const priorWorkingDates = Object.fromEntries(employees.map((employee) => [employee.id, priorAssignments.filter((assignment) => assignment.employeeId === employee.id).map((assignment) => assignment.date.toISOString().slice(0, 10))]));
  const generated = generateSchedule({ year, month, maxConsecutiveDays: settings.maxConsecutiveDays, workingDays, weekStartsOn: settings.weekStartsOn, maxWeeklyDays: 5, priorWorkingDates, employees: employees.map(e => ({ id: e.id, name: e.name, preferredShiftId: e.preferredShiftId, isBilingual: e.isBilingual, dayOffPreferences: e.dayOffPreferences.map(d => ({ dayOfWeek: d.dayOfWeek, rank: d.rank })), timeOff: e.timeOff.map(t => ({ date: t.date.toISOString().slice(0, 10), type: t.type })) })), shifts: shifts.map(s => ({ id: s.id, name: s.name, minimumByDay: Object.fromEntries(s.staffingRules.map(r => [r.dayOfWeek, r.minimumStaff])), bilingualByDay: Object.fromEntries(s.staffingRules.map(r => [r.dayOfWeek, r.minimumBilingual])) })) });
  const period = await prisma.$transaction(async tx => {
    const saved = await tx.schedulePeriod.upsert({ where: { year_month: { year, month } }, create: { year, month, generatedAt: new Date() }, update: { status: "DRAFT", generatedAt: new Date() } });
    await tx.shiftAssignment.deleteMany({ where: { schedulePeriodId: saved.id } });
    await tx.shiftAssignment.createMany({ data: generated.assignments.map(a => ({ schedulePeriodId: saved.id, employeeId: a.employeeId, date: new Date(`${a.date}T00:00:00.000Z`), status: a.status, shiftId: a.shiftId })) });
    return saved;
  });
  return NextResponse.json({ period, warnings: generated.warnings });
}

export async function PATCH(request: Request) {
  const { year, month, status, overrideCoverage = false } = await request.json();
  if (!["DRAFT", "APPROVED", "PUBLISHED"].includes(status)) return NextResponse.json({ error: "Invalid schedule status." }, { status: 400 });
  const key = { year: Number(year), month: Number(month) };
  if (!Number.isInteger(key.year) || !Number.isInteger(key.month) || key.month < 1 || key.month > 12) return NextResponse.json({ error: "Invalid month." }, { status: 400 });
  const current = await prisma.schedulePeriod.findUnique({ where: { year_month: key }, include: { assignments: { include: { employee: true } } } });
  if (!current) return NextResponse.json({ error: "Generate the schedule before changing its status." }, { status: 404 });
  const transitions: Record<string, string[]> = { DRAFT: ["APPROVED"], APPROVED: ["DRAFT", "PUBLISHED"], PUBLISHED: [] };
  if (status !== current.status && !transitions[current.status]?.includes(status)) return NextResponse.json({ error: `A ${current.status.toLowerCase()} schedule cannot move directly to ${status.toLowerCase()}.` }, { status: 409 });
  if (status === "APPROVED" && !overrideCoverage) {
    const [rules, settings] = await Promise.all([
      prisma.staffingRule.findMany({ where: { shift: { active: true } }, include: { shift: true } }),
      prisma.appSettings.upsert({ where: { id: "global" }, create: { id: "global" }, update: {} }),
    ]);
    const operatingDays = new Set(settings.workingDays.split(",").map(Number));
    const shortages: string[] = [];
    const dates = [...new Set(current.assignments.map((assignment) => assignment.date.toISOString().slice(0, 10)))];
    for (const date of dates) {
      const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
      if (!operatingDays.has(weekday)) continue;
      for (const rule of rules.filter((item) => item.dayOfWeek === weekday)) {
        const staffed = current.assignments.filter((assignment) => assignment.date.toISOString().slice(0, 10) === date && assignment.status === "WORKING" && assignment.shiftId === rule.shiftId);
        if (staffed.length < rule.minimumStaff) shortages.push(`${date}: ${rule.shift.name} is short by ${rule.minimumStaff - staffed.length}.`);
        const bilingual = staffed.filter((assignment) => assignment.employee.isBilingual).length;
        if (bilingual < rule.minimumBilingual) shortages.push(`${date}: ${rule.shift.name} is short by ${rule.minimumBilingual - bilingual} bilingual team member(s).`);
      }
    }
    if (shortages.length) return NextResponse.json({ error: "Coverage requirements are not met.", code: "COVERAGE_BLOCKED", shortages }, { status: 409 });
  }
  const period = await prisma.schedulePeriod.update({ where: { year_month: key }, data: { status, approvedAt: status === "APPROVED" ? new Date() : status === "DRAFT" ? null : undefined } });
  return NextResponse.json(period);
}
