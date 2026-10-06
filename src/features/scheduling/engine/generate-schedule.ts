import { eachDayOfInterval, endOfMonth, format, startOfMonth } from "date-fns";
import type { GeneratedAssignment, ScheduleEmployee, ScheduleShift, ScheduleWarning } from "../types";

type Input = {
  year: number;
  month: number;
  employees: ScheduleEmployee[];
  shifts: ScheduleShift[];
  maxConsecutiveDays: number;
  workingDays: number[];
  maxWeeklyDays?: number;
  weekStartsOn?: number;
  priorWorkingDates?: Record<string, string[]>;
};

function leaveStatus(type: ScheduleEmployee["timeOff"][number]["type"]): GeneratedAssignment["status"] {
  if (type === "SICK") return "SICK";
  return "PTO";
}

export function generateSchedule(input: Input) {
  const first = startOfMonth(new Date(input.year, input.month - 1, 1));
  const days = eachDayOfInterval({ start: first, end: endOfMonth(first) });
  const assignments: GeneratedAssignment[] = [];
  const warnings: ScheduleWarning[] = [];
  const workCount = new Map<string, number>();
  const consecutive = new Map<string, number>();
  const weeklyCount = new Map<string, number>();
  const weekStartsOn = input.weekStartsOn ?? 0;
  const weekKeyFor = (date: Date) => {
    const start = new Date(date);
    start.setDate(date.getDate() - ((date.getDay() - weekStartsOn + 7) % 7));
    return format(start, "yyyy-MM-dd");
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
      currentWeek = weekKey;
    }
    const leaves = new Map(input.employees.map((employee) => [employee.id, employee.timeOff.find((entry) => entry.date === dateKey)]));
    const isOperatingDay = input.workingDays.includes(weekday);
    const available = input.employees.filter((employee) => !leaves.get(employee.id));
    const assigned = new Set<string>();

    for (const shift of isOperatingDay ? input.shifts : []) {
      const required = shift.minimumByDay[weekday] ?? 0;
      const bilingualRequired = shift.bilingualByDay[weekday] ?? 0;
      const candidates = available
        .filter((employee) => !assigned.has(employee.id) && (consecutive.get(employee.id) ?? 0) < input.maxConsecutiveDays)
        .filter((employee) => (weeklyCount.get(employee.id) ?? 0) < (input.maxWeeklyDays ?? 5))
        .sort((a, b) => {
          const aDayOffRank = a.dayOffPreferences.find((item) => item.dayOfWeek === weekday)?.rank ?? 99;
          const bDayOffRank = b.dayOffPreferences.find((item) => item.dayOfWeek === weekday)?.rank ?? 99;
          const aScore = (a.preferredShiftId === shift.id ? 20 : 0) - (aDayOffRank === 1 ? 30 : aDayOffRank === 2 ? 15 : 0) - (workCount.get(a.id) ?? 0) * 2;
          const bScore = (b.preferredShiftId === shift.id ? 20 : 0) - (bDayOffRank === 1 ? 30 : bDayOffRank === 2 ? 15 : 0) - (workCount.get(b.id) ?? 0) * 2;
          return bScore - aScore || a.name.localeCompare(b.name);
        });
      const bilingual = candidates.filter((employee) => employee.isBilingual).slice(0, bilingualRequired);
      const selected = [...bilingual, ...candidates.filter((employee) => !bilingual.some((chosen) => chosen.id === employee.id)).slice(0, Math.max(0, required - bilingual.length))];
      selected.forEach((employee) => {
        assigned.add(employee.id);
        workCount.set(employee.id, (workCount.get(employee.id) ?? 0) + 1);
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
