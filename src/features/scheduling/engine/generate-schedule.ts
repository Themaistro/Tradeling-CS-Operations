import { eachDayOfInterval, endOfMonth, format, startOfMonth } from "date-fns";
import type { GeneratedAssignment, ScheduleEmployee, ScheduleShift, ScheduleWarning } from "../types";

type Input = {
  year: number;
  month: number;
  employees: ScheduleEmployee[];
  shifts: ScheduleShift[];
  maxConsecutiveDays: number;
  operatingDays: number[];
  maxWeeklyDays?: number;
  weekStartsOn?: number;
  priorWorkingDates?: Record<string, string[]>;
  variationSeed?: number;
};

function variationRank(seed: number, value: string) {
  let hash = seed | 0;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return hash >>> 0;
}

function buildConsecutiveOffPlan(input: Input) {
  if ((input.maxWeeklyDays ?? 5) !== 5 || input.operatingDays.length !== 7) return null;
  const required = Array.from({ length: 7 }, (_, day) => input.shifts.reduce((sum, shift) => sum + (shift.minimumByDay[day] ?? 0), 0));
  const capacity = required.map((count) => Math.max(0, input.employees.length - count));
  if (capacity.reduce((sum, count) => sum + count, 0) < input.employees.length * 2) return null;
  const employees = [...input.employees].sort((left, right) => right.dayOffPreferences.length - left.dayOffPreferences.length || variationRank(input.variationSeed ?? 0, left.id) - variationRank(input.variationSeed ?? 0, right.id));
  const plan = new Map<string, Set<number>>();
  const pairScore = (employee: ScheduleEmployee, firstDay: number) => {
    const secondDay = (firstDay + 1) % 7;
    const rank = (day: number) => employee.dayOffPreferences.find((item) => item.dayOfWeek === day)?.rank ?? 99;
    return (rank(firstDay) === 1 ? 50 : rank(firstDay) === 2 ? 20 : 0) + (rank(secondDay) === 1 ? 50 : rank(secondDay) === 2 ? 20 : 0);
  };
  const assign = (index: number): boolean => {
    if (index === employees.length) return true;
    const employee = employees[index];
    const pairs = Array.from({ length: 7 }, (_, day) => day).sort((left, right) => pairScore(employee, right) - pairScore(employee, left) || variationRank(input.variationSeed ?? 0, `${employee.id}:${left}`) - variationRank(input.variationSeed ?? 0, `${employee.id}:${right}`));
    for (const firstDay of pairs) {
      const secondDay = (firstDay + 1) % 7;
      if (capacity[firstDay] < 1 || capacity[secondDay] < 1) continue;
      capacity[firstDay] -= 1; capacity[secondDay] -= 1;
      plan.set(employee.id, new Set([firstDay, secondDay]));
      if (assign(index + 1)) return true;
      plan.delete(employee.id); capacity[firstDay] += 1; capacity[secondDay] += 1;
    }
    return false;
  };
  return assign(0) ? plan : null;
}

function leaveStatus(type: ScheduleEmployee["timeOff"][number]["type"]): GeneratedAssignment["status"] {
  if (type === "PTO") return "PTO";
  if (type === "UNPAID") return "UNPAID_LEAVE";
  if (type === "OTHER") return "OTHER_LEAVE";
  return type;
}

export function generateSchedule(input: Input) {
  const first = startOfMonth(new Date(input.year, input.month - 1, 1));
  const days = eachDayOfInterval({ start: first, end: endOfMonth(first) });
  const assignments: GeneratedAssignment[] = [];
  const warnings: ScheduleWarning[] = [];
  const workCount = new Map<string, number>();
  const shiftCount = new Map<string, number>();
  const consecutive = new Map<string, number>();
  const weeklyCount = new Map<string, number>();
  const weeklyShift = new Map<string, string>();
  const weekStartsOn = input.weekStartsOn ?? 0;
  const rotationOrder = [...input.employees].sort((left, right) => left.name.localeCompare(right.name));
  const lateShift = [...input.shifts].sort((left, right) => right.startTime.localeCompare(left.startTime))[0];
  const consecutiveOffPlan = buildConsecutiveOffPlan(input);
  const weekKeyFor = (date: Date) => {
    const start = new Date(date);
    start.setDate(date.getDate() - ((date.getDay() - weekStartsOn + 7) % 7));
    return format(start, "yyyy-MM-dd");
  };
  const lateOwnerFor = (weekKey: string) => {
    if (!rotationOrder.length) return null;
    const weekNumber = Math.floor(new Date(`${weekKey}T12:00:00`).getTime() / 604800000);
    return rotationOrder[((weekNumber % rotationOrder.length) + rotationOrder.length) % rotationOrder.length];
  };
  let currentWeek = weekKeyFor(first);
  const yesterday = new Date(first);
  yesterday.setDate(first.getDate() - 1);
  for (const employee of input.employees) {
    const worked = new Set(input.priorWorkingDates?.[employee.id] ?? []);
    const cursor = new Date(yesterday);
    let run = 0;
    while (worked.has(format(cursor, "yyyy-MM-dd"))) {
      run += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    consecutive.set(employee.id, run);
    weeklyCount.set(employee.id, [...worked].filter((date) => weekKeyFor(new Date(`${date}T12:00:00`)) === currentWeek).length);
  }

  for (const date of days) {
    const dateKey = format(date, "yyyy-MM-dd");
    const weekday = date.getDay();
    const weekKey = weekKeyFor(date);
    if (weekKey !== currentWeek) {
      weeklyCount.clear();
      weeklyShift.clear();
      currentWeek = weekKey;
    }
    const leaves = new Map(input.employees.map((employee) => [employee.id, employee.timeOff.find((entry) => entry.date === dateKey)]));
    const isOperatingDay = input.operatingDays.includes(weekday);
    const available = input.employees.filter((employee) => !leaves.get(employee.id));
    const assigned = new Set<string>();

    const orderedShifts = isOperatingDay ? [...input.shifts].sort((left, right) => (left.minimumByDay[weekday] ?? 0) - (right.minimumByDay[weekday] ?? 0) || right.name.localeCompare(left.name)) : [];
    for (const shift of orderedShifts) {
      const required = shift.minimumByDay[weekday] ?? 0;
      const bilingualRequired = shift.bilingualByDay[weekday] ?? 0;
      const requiredAccountIds = shift.requiredAccountIdsByDay[weekday] ?? [];
      const lateOwner = shift.id === lateShift?.id ? lateOwnerFor(weekKey) : null;
      const eligibleCandidates = available
        .filter((employee) => !assigned.has(employee.id) && (consecutive.get(employee.id) ?? 0) < input.maxConsecutiveDays)
        .filter((employee) => (weeklyCount.get(employee.id) ?? 0) < (input.maxWeeklyDays ?? 5))
        .filter((employee) => requiredAccountIds.every((accountId) => employee.accountIds.includes(accountId)))
        .sort((a, b) => {
          const aDayOffRank = a.dayOffPreferences.find((item) => item.dayOfWeek === weekday)?.rank ?? 99;
          const bDayOffRank = b.dayOffPreferences.find((item) => item.dayOfWeek === weekday)?.rank ?? 99;
          const aWeeklyShift = weeklyShift.get(a.id);
          const bWeeklyShift = weeklyShift.get(b.id);
          const aScore = (a.id === lateOwner?.id ? 500 : 0) + (a.preferredShiftId === shift.id ? 20 : 0) + (aWeeklyShift === shift.id ? 100 : aWeeklyShift ? -100 : 0) - (aDayOffRank === 1 ? 30 : aDayOffRank === 2 ? 15 : 0) - (workCount.get(a.id) ?? 0) * 2 - (shiftCount.get(`${a.id}:${shift.id}`) ?? 0) * 10;
          const bScore = (b.id === lateOwner?.id ? 500 : 0) + (b.preferredShiftId === shift.id ? 20 : 0) + (bWeeklyShift === shift.id ? 100 : bWeeklyShift ? -100 : 0) - (bDayOffRank === 1 ? 30 : bDayOffRank === 2 ? 15 : 0) - (workCount.get(b.id) ?? 0) * 2 - (shiftCount.get(`${b.id}:${shift.id}`) ?? 0) * 10;
          return bScore - aScore || variationRank(input.variationSeed ?? 0, `${dateKey}:${shift.id}:${a.id}`) - variationRank(input.variationSeed ?? 0, `${dateKey}:${shift.id}:${b.id}`);
        });
      const protectedRest = eligibleCandidates.filter((employee) => consecutiveOffPlan?.get(employee.id)?.has(weekday));
      const candidates = [...eligibleCandidates.filter((employee) => !consecutiveOffPlan?.get(employee.id)?.has(weekday)), ...protectedRest];
      const bilingual = candidates.filter((employee) => employee.isBilingual).slice(0, bilingualRequired);
      const selected = [...bilingual, ...candidates.filter((employee) => !bilingual.some((chosen) => chosen.id === employee.id)).slice(0, Math.max(0, required - bilingual.length))];
      const restOverrides = selected.filter((employee) => protectedRest.some((resting) => resting.id === employee.id));
      if (restOverrides.length) warnings.push({ date: dateKey, shiftId: shift.id, severity: "warning", code: "REST_PATTERN_OVERRIDE", message: `${restOverrides.map((employee) => employee.name).join(", ")} had a planned day off adjusted to protect ${shift.name} coverage.` });
      selected.forEach((employee) => {
        assigned.add(employee.id);
        if (!weeklyShift.has(employee.id)) weeklyShift.set(employee.id, shift.id);
        workCount.set(employee.id, (workCount.get(employee.id) ?? 0) + 1);
        shiftCount.set(`${employee.id}:${shift.id}`, (shiftCount.get(`${employee.id}:${shift.id}`) ?? 0) + 1);
        weeklyCount.set(employee.id, (weeklyCount.get(employee.id) ?? 0) + 1);
        assignments.push({ employeeId: employee.id, date: dateKey, status: "WORKING", shiftId: shift.id });
      });
      if (selected.length < required) warnings.push({ date: dateKey, shiftId: shift.id, severity: "critical", code: "STAFF_SHORTAGE", message: `${shift.name} needs ${required - selected.length} more team member(s).` });
      if (selected.filter((employee) => employee.isBilingual).length < bilingualRequired) warnings.push({ date: dateKey, shiftId: shift.id, severity: "critical", code: "BILINGUAL_SHORTAGE", message: `${shift.name} needs ${bilingualRequired - selected.filter((employee) => employee.isBilingual).length} more bilingual team member(s).` });
    }

    for (const employee of input.employees) {
      if (assigned.has(employee.id)) consecutive.set(employee.id, (consecutive.get(employee.id) ?? 0) + 1);
      else {
        consecutive.set(employee.id, 0);
        const leave = leaves.get(employee.id);
        assignments.push({ employeeId: employee.id, date: dateKey, status: leave ? leaveStatus(leave.type) : "OFF", shiftId: null });
      }
    }
  }
  return { assignments, warnings };
}
