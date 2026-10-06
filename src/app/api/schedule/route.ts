import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { generateSchedule } from "@/features/scheduling/engine/generate-schedule";

type ShiftConfig = { id: string; name: string; startTime: string; endTime: string; order: number; staffingRules: { dayOfWeek: number; minimumStaff: number; minimumBilingual: number; isOverride: boolean }[] };
type AccountConfig = { id: string; operatingWindows?: { dayOfWeek: number }[]; coverageRequirements: { dayOfWeek: number; startTime: string; endTime: string; minimumStaff: number; minimumBilingual: number }[] };

function effectiveStaffing(shifts: ShiftConfig[], accounts: AccountConfig[], employeeCount: number) {
  const operatingDays = [...new Set(accounts.flatMap((account) => (account.operatingWindows ?? account.coverageRequirements).map((item) => item.dayOfWeek)))];
  const staff = new Map<string, number>(); const bilingual = new Map<string, number>(); const requiredAccounts = new Map<string, string[]>();
  for (const shift of shifts) for (const day of operatingDays) {
    const covered = accounts.flatMap((account) => account.coverageRequirements.map((requirement) => ({ ...requirement, accountId: account.id }))).filter((requirement) => requirement.dayOfWeek === day && shift.startTime <= requirement.startTime && shift.endTime >= requirement.endTime);
    const rule = shift.staffingRules.find((item) => item.dayOfWeek === day);
    const key = `${shift.id}:${day}`;
    staff.set(key, rule?.isOverride ? rule.minimumStaff : Math.max(0, ...covered.map((item) => item.minimumStaff)));
    bilingual.set(key, rule?.isOverride ? rule.minimumBilingual : Math.max(0, ...covered.map((item) => item.minimumBilingual)));
    requiredAccounts.set(key, [...new Set(covered.map((item) => item.accountId))]);
  }
  const weeklyTarget = employeeCount * 5;
  let remaining = Math.max(0, weeklyTarget - [...staff.values()].reduce((sum, value) => sum + value, 0));
  const dayShift = [...shifts].sort((left, right) => left.startTime.localeCompare(right.startTime) || left.order - right.order)[0];
  while (remaining > 0 && dayShift) {
    const candidates = operatingDays.filter((day) => !dayShift.staffingRules.find((rule) => rule.dayOfWeek === day)?.isOverride && (staff.get(`${dayShift.id}:${day}`) ?? 0) + shifts.filter((shift) => shift.id !== dayShift.id).reduce((sum, shift) => sum + (staff.get(`${shift.id}:${day}`) ?? 0), 0) < employeeCount);
    if (!candidates.length) break;
    const weights = new Map(candidates.map((day) => [day, accounts.filter((account) => (account.operatingWindows ?? account.coverageRequirements).some((item) => item.dayOfWeek === day)).length]));
    const maxWeight = Math.max(...weights.values());
    const day = candidates.filter((item) => weights.get(item) === maxWeight).sort((left, right) => (staff.get(`${dayShift.id}:${left}`) ?? 0) - (staff.get(`${dayShift.id}:${right}`) ?? 0) || ((left + 6) % 7) - ((right + 6) % 7))[0];
    staff.set(`${dayShift.id}:${day}`, (staff.get(`${dayShift.id}:${day}`) ?? 0) + 1); remaining -= 1;
  }
  return { operatingDays, staff, bilingual, requiredAccounts };
}

export async function GET(request: Request) {
  const url = new URL(request.url); const year = Number(url.searchParams.get("year")); const month = Number(url.searchParams.get("month"));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return NextResponse.json({ error: "Invalid month." }, { status: 400 });
  const period = await prisma.schedulePeriod.findUnique({ where: { year_month: { year, month } }, include: { assignments: { include: { employee: true, shift: true }, orderBy: { date: "asc" } } } });
  if (!period) return NextResponse.json(null);
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));
  const breaks = await prisma.breakSchedule.findMany({
    where: { date: { gte: monthStart, lt: monthEnd } },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });
  const [rules, accounts] = await Promise.all([
    prisma.staffingRule.findMany({ include: { shift: true } }),
    prisma.account.findMany({ where: { active: true }, include: { coverageRequirements: true, employeeCapabilities: true } }),
  ]);
  const operatingDays = new Set(accounts.flatMap((account) => account.coverageRequirements.map((item) => item.dayOfWeek)));
  const warnings: { date: string; shiftId: string; severity: "critical"; code: string; message: string }[] = [];
  const working = period.assignments.filter((assignment) => assignment.status === "WORKING" && assignment.shiftId);
  const dateKeys = [...new Set(period.assignments.map((assignment) => assignment.date.toISOString().slice(0, 10)))];
  for (const date of dateKeys) {
    const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    if (!operatingDays.has(weekday)) continue;
    for (const rule of rules.filter((item) => item.dayOfWeek === weekday && item.shift.active && item.isOverride)) {
      const staffed = working.filter((assignment) => assignment.date.toISOString().slice(0, 10) === date && assignment.shiftId === rule.shiftId);
      if (staffed.length < rule.minimumStaff) warnings.push({ date, shiftId: rule.shiftId, severity: "critical", code: "STAFF_SHORTAGE", message: `${rule.shift.name} needs ${rule.minimumStaff - staffed.length} more team member(s).` });
      const bilingual = staffed.filter((assignment) => assignment.employee.isBilingual).length;
      if (bilingual < rule.minimumBilingual) warnings.push({ date, shiftId: rule.shiftId, severity: "critical", code: "BILINGUAL_SHORTAGE", message: `${rule.shift.name} needs ${rule.minimumBilingual - bilingual} more bilingual team member(s).` });
    }
    for (const account of accounts) for (const requirement of account.coverageRequirements.filter((item)=>item.dayOfWeek===weekday)) {
      const capable = new Set(account.employeeCapabilities.map((item)=>item.employeeId));
      const covered = working.filter((assignment)=>assignment.date.toISOString().slice(0,10)===date&&assignment.shift&&assignment.shift.startTime<=requirement.startTime&&assignment.shift.endTime>=requirement.endTime&&capable.has(assignment.employeeId));
      if(covered.length<requirement.minimumStaff)warnings.push({date,shiftId:`account:${account.id}`,severity:"critical",code:"STAFF_SHORTAGE",message:`${account.name} ${requirement.startTime}–${requirement.endTime} needs ${requirement.minimumStaff-covered.length} more qualified agent(s).`});
      const bilingual=covered.filter((assignment)=>assignment.employee.isBilingual).length;
      if(bilingual<requirement.minimumBilingual)warnings.push({date,shiftId:`account:${account.id}`,severity:"critical",code:"BILINGUAL_SHORTAGE",message:`${account.name} ${requirement.startTime}–${requirement.endTime} needs ${requirement.minimumBilingual-bilingual} more bilingual agent(s).`});
    }
  }
  return NextResponse.json({ ...period, breaks, warnings });
}

export async function POST(request: Request) {
  const { year, month, force = false } = await request.json();
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return NextResponse.json({ error: "Invalid month." }, { status: 400 });
  const [employees, shifts, settings, accounts] = await Promise.all([
    prisma.employee.findMany({ where: { status: "ACTIVE" }, include: { dayOffPreferences: true, timeOff: true, accountCapabilities: true } }),
    prisma.shift.findMany({ where: { active: true }, include: { staffingRules: true }, orderBy: { order: "asc" } }),
    prisma.appSettings.upsert({ where: { id: "global" }, create: { id: "global" }, update: {} }),
    prisma.account.findMany({ where: { active: true }, include: { operatingWindows: true, coverageRequirements: true } }),
  ]);
  if (!employees.length || !shifts.length) return NextResponse.json({ error: "Add at least one employee and one shift first." }, { status: 400 });
  const existing = await prisma.schedulePeriod.findUnique({ where: { year_month: { year, month } } });
  if (existing && existing.status !== "DRAFT" && !force) return NextResponse.json({ error: "This schedule is approved. Reopen it before generating a replacement.", code: "SCHEDULE_LOCKED" }, { status: 409 });
  const targets = effectiveStaffing(shifts, accounts, employees.length);
  const operatingDays = targets.operatingDays;
  if (!operatingDays.length) return NextResponse.json({ error: "Add operating hours for at least one active account before generating a schedule." }, { status: 409 });
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const historyStart = new Date(monthStart); historyStart.setUTCDate(historyStart.getUTCDate() - 7);
  const priorAssignments = await prisma.shiftAssignment.findMany({ where: { date: { gte: historyStart, lt: monthStart }, status: "WORKING", employeeId: { in: employees.map((employee) => employee.id) }, schedulePeriod: { status: { in: ["APPROVED", "PUBLISHED"] } } }, select: { employeeId: true, date: true } });
  const priorWorkingDates = Object.fromEntries(employees.map((employee) => [employee.id, priorAssignments.filter((assignment) => assignment.employeeId === employee.id).map((assignment) => assignment.date.toISOString().slice(0, 10))]));
  const generated = generateSchedule({ year, month, variationSeed: Date.now(), maxConsecutiveDays: settings.maxConsecutiveDays, operatingDays, weekStartsOn: settings.weekStartsOn, maxWeeklyDays: 5, priorWorkingDates, employees: employees.map(e => ({ id: e.id, name: e.name, preferredShiftId: e.preferredShiftId, isBilingual: e.isBilingual, accountIds: e.accountCapabilities.map((item) => item.accountId), dayOffPreferences: e.dayOffPreferences.map(d => ({ dayOfWeek: d.dayOfWeek, rank: d.rank })), timeOff: e.timeOff.map(t => ({ date: t.date.toISOString().slice(0, 10), type: t.type })) })), shifts: shifts.map(s => ({ id: s.id, name: s.name, minimumByDay: Object.fromEntries(operatingDays.map(day => [day, targets.staff.get(`${s.id}:${day}`) ?? 0])), bilingualByDay: Object.fromEntries(operatingDays.map(day => [day, targets.bilingual.get(`${s.id}:${day}`) ?? 0])), requiredAccountIdsByDay: Object.fromEntries(operatingDays.map(day => [day, targets.requiredAccounts.get(`${s.id}:${day}`) ?? []])) })) });
  const period = await prisma.$transaction(async tx => {
    const saved = await tx.schedulePeriod.upsert({ where: { year_month: { year, month } }, create: { year, month, generatedAt: new Date() }, update: { status: "DRAFT", generatedAt: new Date() } });
    await tx.shiftAssignment.deleteMany({ where: { schedulePeriodId: saved.id } });
    await tx.shiftAssignment.createMany({ data: generated.assignments.map(a => {
      const shift = shifts.find((item) => item.id === a.shiftId);
      const weekday = new Date(`${a.date}T00:00:00.000Z`).getUTCDay();
      const workLocation = a.status === "WORKING" && ([0, 5, 6].includes(weekday) || /late|night/i.test(shift?.name ?? "")) ? "WFH" : "OFFICE";
      return { schedulePeriodId: saved.id, employeeId: a.employeeId, date: new Date(`${a.date}T00:00:00.000Z`), status: a.status, shiftId: a.shiftId, workLocation };
    }) });
    return saved;
  });
  return NextResponse.json({ period, warnings: generated.warnings });
}

export async function PATCH(request: Request) {
  const { year, month, status, overrideCoverage = false } = await request.json();
  if (!["DRAFT", "APPROVED", "PUBLISHED"].includes(status)) return NextResponse.json({ error: "Invalid schedule status." }, { status: 400 });
  const key = { year: Number(year), month: Number(month) };
  if (!Number.isInteger(key.year) || !Number.isInteger(key.month) || key.month < 1 || key.month > 12) return NextResponse.json({ error: "Invalid month." }, { status: 400 });
  const current = await prisma.schedulePeriod.findUnique({ where: { year_month: key }, include: { assignments: { include: { employee: true, shift: true } } } });
  if (!current) return NextResponse.json({ error: "Generate the schedule before changing its status." }, { status: 404 });
  const transitions: Record<string, string[]> = { DRAFT: ["APPROVED"], APPROVED: ["DRAFT", "PUBLISHED"], PUBLISHED: ["DRAFT"] };
  if (status !== current.status && !transitions[current.status]?.includes(status)) return NextResponse.json({ error: `A ${current.status.toLowerCase()} schedule cannot move directly to ${status.toLowerCase()}.` }, { status: 409 });
  if (status === "APPROVED" && !overrideCoverage) {
    const [rules, accounts] = await Promise.all([
      prisma.staffingRule.findMany({ where: { shift: { active: true } }, include: { shift: true } }),
      prisma.account.findMany({ where: { active: true }, include: { coverageRequirements: true, employeeCapabilities: true } }),
    ]);
    const operatingDays = new Set(accounts.flatMap((account) => account.coverageRequirements.map((item) => item.dayOfWeek)));
    const shortages: string[] = [];
    const dates = [...new Set(current.assignments.map((assignment) => assignment.date.toISOString().slice(0, 10)))];
    for (const date of dates) {
      const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
      if (!operatingDays.has(weekday)) continue;
      for (const rule of rules.filter((item) => item.dayOfWeek === weekday && item.isOverride)) {
        const staffed = current.assignments.filter((assignment) => assignment.date.toISOString().slice(0, 10) === date && assignment.status === "WORKING" && assignment.shiftId === rule.shiftId);
        if (staffed.length < rule.minimumStaff) shortages.push(`${date}: ${rule.shift.name} is short by ${rule.minimumStaff - staffed.length}.`);
        const bilingual = staffed.filter((assignment) => assignment.employee.isBilingual).length;
        if (bilingual < rule.minimumBilingual) shortages.push(`${date}: ${rule.shift.name} is short by ${rule.minimumBilingual - bilingual} bilingual team member(s).`);
      }
      for (const account of accounts) for (const requirement of account.coverageRequirements.filter((item)=>item.dayOfWeek===weekday)) {
        const capable=new Set(account.employeeCapabilities.map((item)=>item.employeeId));
        const qualifying=current.assignments.filter((assignment)=>assignment.date.toISOString().slice(0,10)===date&&assignment.status==="WORKING"&&assignment.shift&&assignment.shift.startTime<=requirement.startTime&&assignment.shift.endTime>=requirement.endTime&&capable.has(assignment.employeeId));
        if(qualifying.length<requirement.minimumStaff)shortages.push(`${date}: ${account.name} ${requirement.startTime}–${requirement.endTime} is short by ${requirement.minimumStaff-qualifying.length}.`);
      }
    }
    if (shortages.length) return NextResponse.json({ error: "Coverage requirements are not met.", code: "COVERAGE_BLOCKED", shortages }, { status: 409 });
  }
  const period = await prisma.schedulePeriod.update({ where: { year_month: key }, data: { status, approvedAt: status === "APPROVED" ? new Date() : status === "DRAFT" ? null : undefined } });
  return NextResponse.json(period);
}
