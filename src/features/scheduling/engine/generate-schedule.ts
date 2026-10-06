import { eachDayOfInterval, endOfMonth, format, startOfMonth } from "date-fns";
import type { GeneratedAssignment, ScheduleEmployee, ScheduleShift, ScheduleWarning } from "../types";

type Input = { year: number; month: number; employees: ScheduleEmployee[]; shifts: ScheduleShift[]; maxConsecutiveDays: number };

export function generateSchedule(input: Input) {
  const first = startOfMonth(new Date(input.year, input.month - 1, 1));
  const days = eachDayOfInterval({ start: first, end: endOfMonth(first) });
  const assignments: GeneratedAssignment[] = [];
  const warnings: ScheduleWarning[] = [];
  const workCount = new Map<string, number>();
  const consecutive = new Map<string, number>();

  for (const date of days) {
    const dateKey = format(date, "yyyy-MM-dd");
    const weekday = date.getDay();
    const available = input.employees.filter((employee) => !employee.timeOff.includes(dateKey) && !employee.daysOff.includes(weekday));
    const assigned = new Set<string>();

    for (const shift of input.shifts) {
      const required = shift.minimumByDay[weekday] ?? 0;
      const bilingualRequired = shift.bilingualByDay[weekday] ?? 0;
      const candidates = available
        .filter((employee) => !assigned.has(employee.id) && (consecutive.get(employee.id) ?? 0) < input.maxConsecutiveDays)
        .sort((a, b) => {
          const bilingualPriority = Number(b.isBilingual) - Number(a.isBilingual);
          const preferencePriority = Number(b.preferredShiftId === shift.id) - Number(a.preferredShiftId === shift.id);
          return bilingualPriority + preferencePriority || (workCount.get(a.id) ?? 0) - (workCount.get(b.id) ?? 0);
        });
      const selected = candidates.slice(0, required);
      selected.forEach((employee) => {
        assigned.add(employee.id);
        workCount.set(employee.id, (workCount.get(employee.id) ?? 0) + 1);
        assignments.push({ employeeId: employee.id, date: dateKey, status: "WORKING", shiftId: shift.id });
      });
      if (selected.length < required) warnings.push({ date: dateKey, shiftId: shift.id, message: `${shift.name} needs ${required - selected.length} more team member(s).` });
      if (selected.filter((employee) => employee.isBilingual).length < bilingualRequired) warnings.push({ date: dateKey, shiftId: shift.id, message: `${shift.name} is below bilingual coverage.` });
    }

    for (const employee of input.employees) {
      if (assigned.has(employee.id)) consecutive.set(employee.id, (consecutive.get(employee.id) ?? 0) + 1);
      else {
        consecutive.set(employee.id, 0);
        assignments.push({ employeeId: employee.id, date: dateKey, status: employee.timeOff.includes(dateKey) ? "PTO" : "OFF", shiftId: null });
      }
    }
  }
  return { assignments, warnings };
}
