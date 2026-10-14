import { eachDayOfInterval, endOfMonth, format, startOfMonth } from "date-fns";
import type { GeneratedAssignment, PriorScheduleEntry, ScheduleEmployee, ScheduleShift, ScheduleWarning } from "../types";

type Input = {
  year: number;
  month: number;
  employees: ScheduleEmployee[];
  shifts: ScheduleShift[];
  maxConsecutiveDays: number;
  operatingDays: number[];
  maxWeeklyDays?: number;
  weekStartsOn?: number;
  priorAssignments?: Record<string, PriorScheduleEntry[]>;
  fairnessHistory?: Record<string, PriorScheduleEntry[]>;
  variationSeed?: number;
  startDate?: string;
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

function isWorking(status: GeneratedAssignment["status"]) {
  return status === "WORKING";
}

export function generateSchedule(input: Input, searchAttempt = 0): { assignments: GeneratedAssignment[]; warnings: ScheduleWarning[] } {
  const monthStart = startOfMonth(new Date(input.year, input.month - 1, 1));
  const requestedStart = input.startDate ? new Date(`${input.startDate}T12:00:00`) : monthStart;
  const first = requestedStart > monthStart ? requestedStart : monthStart;
  const weekStartsOn = input.weekStartsOn ?? 0;
  const monthEnd = endOfMonth(first);
  const planningEnd = new Date(monthEnd);
  planningEnd.setDate(planningEnd.getDate()+((weekStartsOn+6-planningEnd.getDay()+7)%7));
  // Check the rest of the final week before spending its remaining capacity.
  // These look-ahead days guide the boundary only; they are never persisted.
  const days = eachDayOfInterval({ start: first, end: planningEnd });
  const assignments: GeneratedAssignment[] = [];
  const warnings: ScheduleWarning[] = [];
  const workCount = new Map<string, number>();
  const shiftCount = new Map<string, number>();
  const consecutive = new Map<string, number>();
  const requiredRecoveryDays = new Map<string, number>();
  const weeklyCount = new Map<string, number>();
  const weeklyShift = new Map<string, string>();
  const rotationOrder = [...input.employees].sort((left, right) => left.name.localeCompare(right.name));
  const lateShift = [...input.shifts].sort((left, right) => right.startTime.localeCompare(left.startTime))[0];
  let consecutiveOffPlan: Map<string, Set<number>> | null = null;
  const lateCount = new Map<string, number>();
  const weekendLateCount = new Map<string, number>();
  const lateOwnerByWeek = new Map<string, ScheduleEmployee | null>();
  const weekKeyFor = (date: Date) => {
    const start = new Date(date);
    start.setDate(date.getDate() - ((date.getDay() - weekStartsOn + 7) % 7));
    return format(start, "yyyy-MM-dd");
  };
  const lateOwnerFor = (weekKey: string, requiredAccountIds: string[]) => {
    if (lateOwnerByWeek.has(weekKey)) return lateOwnerByWeek.get(weekKey) ?? null;
    const eligible = rotationOrder.filter((employee) => requiredAccountIds.every((accountId) => employee.accountIds.includes(accountId)));
    const candidates = eligible.length ? eligible : rotationOrder;
    const owner = [...candidates].sort((a, b) => {
      const aScore = (lateCount.get(a.id) ?? 0) * 100 + (weekendLateCount.get(a.id) ?? 0) * 35 + (workCount.get(a.id) ?? 0) * 2;
      const bScore = (lateCount.get(b.id) ?? 0) * 100 + (weekendLateCount.get(b.id) ?? 0) * 35 + (workCount.get(b.id) ?? 0) * 2;
      return aScore - bScore || variationRank(input.variationSeed ?? 0, `${weekKey}:${a.id}`) - variationRank(input.variationSeed ?? 0, `${weekKey}:${b.id}`);
    })[0] ?? null;
    lateOwnerByWeek.set(weekKey, owner);
    return owner;
  };
  let currentWeek = weekKeyFor(first);
  const yesterday = new Date(first);
  yesterday.setDate(first.getDate() - 1);
  for (const employee of input.employees) {
    const history = new Map((input.priorAssignments?.[employee.id] ?? []).map((entry) => [entry.date, entry]));
    const cursor = new Date(yesterday);
    let run = 0;
    while (history.get(format(cursor, "yyyy-MM-dd")) && isWorking(history.get(format(cursor, "yyyy-MM-dd"))!.status)) {
      run += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    consecutive.set(employee.id, run);
    weeklyCount.set(employee.id, [...history.values()].filter((entry) => isWorking(entry.status) && weekKeyFor(new Date(`${entry.date}T12:00:00`)) === currentWeek).length);
    const fairnessRows = [...new Map((input.fairnessHistory?.[employee.id] ?? input.priorAssignments?.[employee.id] ?? []).filter(entry=>entry.date < format(first,"yyyy-MM-dd")).map(entry=>[entry.date,entry])).values()];
    workCount.set(employee.id, fairnessRows.filter(entry=>entry.status === "WORKING").length);
    for (const shift of input.shifts) shiftCount.set(`${employee.id}:${shift.id}`,fairnessRows.filter(entry=>entry.status === "WORKING" && entry.shiftId === shift.id).length);
    const priorLate = fairnessRows.filter((entry) => entry.status === "WORKING" && entry.shiftId === lateShift?.id);
    lateCount.set(employee.id, priorLate.length);
    weekendLateCount.set(employee.id, priorLate.filter((entry) => [0, 6].includes(new Date(`${entry.date}T12:00:00`).getDay())).length);

    const recoveryCursor = new Date(yesterday);
    let recoveryDaysTaken = 0;
    while (history.get(format(recoveryCursor, "yyyy-MM-dd")) && !isWorking(history.get(format(recoveryCursor, "yyyy-MM-dd"))!.status)) {
      recoveryDaysTaken += 1;
      recoveryCursor.setDate(recoveryCursor.getDate() - 1);
    }
    let precedingWorkRun = 0;
    while (history.get(format(recoveryCursor, "yyyy-MM-dd")) && isWorking(history.get(format(recoveryCursor, "yyyy-MM-dd"))!.status)) {
      precedingWorkRun += 1;
      recoveryCursor.setDate(recoveryCursor.getDate() - 1);
    }
    requiredRecoveryDays.set(employee.id, precedingWorkRun >= input.maxConsecutiveDays ? Math.max(0, 2 - recoveryDaysTaken) : run >= input.maxConsecutiveDays ? 2 : 0);
  }
  consecutiveOffPlan = buildConsecutiveOffPlan(input);

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
      const lateOwner = shift.id === lateShift?.id ? lateOwnerFor(weekKey, requiredAccountIds) : null;
      const eligibleCandidates = available
        .filter((employee) => !assigned.has(employee.id) && (consecutive.get(employee.id) ?? 0) < input.maxConsecutiveDays)
        .filter((employee) => (weeklyCount.get(employee.id) ?? 0) < (input.maxWeeklyDays ?? 5))
        .filter((employee) => requiredAccountIds.every((accountId) => employee.accountIds.includes(accountId)))
        .sort((a, b) => {
          const aDayOffRank = a.dayOffPreferences.find((item) => item.dayOfWeek === weekday)?.rank ?? 99;
          const bDayOffRank = b.dayOffPreferences.find((item) => item.dayOfWeek === weekday)?.rank ?? 99;
          const aWeeklyShift = weeklyShift.get(a.id);
          const bWeeklyShift = weeklyShift.get(b.id);
          const aLatePenalty = shift.id === lateShift?.id ? (lateCount.get(a.id) ?? 0) * 50 + (weekendLateCount.get(a.id) ?? 0) * 20 : 0;
          const bLatePenalty = shift.id === lateShift?.id ? (lateCount.get(b.id) ?? 0) * 50 + (weekendLateCount.get(b.id) ?? 0) * 20 : 0;
          const aScore = (a.id === lateOwner?.id ? 500 : 0) + (a.preferredShiftId === shift.id ? 20 : 0) + (aWeeklyShift === shift.id ? 100 : aWeeklyShift ? -100 : 0) - (aDayOffRank === 1 ? 30 : aDayOffRank === 2 ? 15 : 0) - (workCount.get(a.id) ?? 0) * 2 - (shiftCount.get(`${a.id}:${shift.id}`) ?? 0) * 10 - aLatePenalty;
          const bScore = (b.id === lateOwner?.id ? 500 : 0) + (b.preferredShiftId === shift.id ? 20 : 0) + (bWeeklyShift === shift.id ? 100 : bWeeklyShift ? -100 : 0) - (bDayOffRank === 1 ? 30 : bDayOffRank === 2 ? 15 : 0) - (workCount.get(b.id) ?? 0) * 2 - (shiftCount.get(`${b.id}:${shift.id}`) ?? 0) * 10 - bLatePenalty;
          return bScore - aScore || variationRank(input.variationSeed ?? 0, `${dateKey}:${shift.id}:${a.id}`) - variationRank(input.variationSeed ?? 0, `${dateKey}:${shift.id}:${b.id}`);
        });
      const protectedRest = eligibleCandidates.filter((employee) => consecutiveOffPlan?.get(employee.id)?.has(weekday) || (requiredRecoveryDays.get(employee.id) ?? 0) > 0);
      const candidates = [...eligibleCandidates.filter((employee) => !protectedRest.some((resting) => resting.id === employee.id)), ...protectedRest];
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
        if (shift.id === lateShift?.id) {
          lateCount.set(employee.id, (lateCount.get(employee.id) ?? 0) + 1);
          if ([0, 6].includes(weekday)) weekendLateCount.set(employee.id, (weekendLateCount.get(employee.id) ?? 0) + 1);
        }
        assignments.push({ employeeId: employee.id, date: dateKey, status: "WORKING", shiftId: shift.id });
      });
      if (selected.length < required) warnings.push({ date: dateKey, shiftId: shift.id, severity: "critical", code: "STAFF_SHORTAGE", message: `${shift.name} needs ${required - selected.length} more team member(s).` });
      if (selected.filter((employee) => employee.isBilingual).length < bilingualRequired) warnings.push({ date: dateKey, shiftId: shift.id, severity: "critical", code: "BILINGUAL_SHORTAGE", message: `${shift.name} needs ${bilingualRequired - selected.filter((employee) => employee.isBilingual).length} more bilingual team member(s).` });
    }

    for (const employee of input.employees) {
      if (assigned.has(employee.id)) {
        const run = (consecutive.get(employee.id) ?? 0) + 1;
        consecutive.set(employee.id, run);
        requiredRecoveryDays.set(employee.id, run >= input.maxConsecutiveDays ? 2 : 0);
      }
      else {
        consecutive.set(employee.id, 0);
        requiredRecoveryDays.set(employee.id, Math.max(0, (requiredRecoveryDays.get(employee.id) ?? 0) - 1));
        const leave = leaves.get(employee.id);
        assignments.push({ employeeId: employee.id, date: dateKey, status: leave ? leaveStatus(leave.type) : "OFF", shiftId: null });
      }
    }
  }

  // A cutover can begin in the middle of a scheduling week. In that case the
  // earlier handover days count toward each person's weekly limit, so a simple
  // day-by-day pass can spend all remaining capacity before the weekend. Repair
  // a shortage by swapping equivalent work within the same week: one person
  // covers the missing slot while an under-utilised colleague takes one of
  // their earlier shifts. Leave is never changed by this repair.
  const employeeById = new Map(input.employees.map((employee) => [employee.id, employee]));
  const maximumWeeklyDays = input.maxWeeklyDays ?? 5;
  const assignmentFor = (employeeId: string, date: string) => assignments.find((assignment) => assignment.employeeId === employeeId && assignment.date === date);
  const weeklyWorkCount = (employeeId: string, weekKey: string) => [
    ...(input.priorAssignments?.[employeeId] ?? []),
    ...assignments.filter((assignment) => assignment.employeeId === employeeId),
  ].filter((assignment) => assignment.status === "WORKING" && weekKeyFor(new Date(`${assignment.date}T12:00:00`)) === weekKey).length;
  const canCoverShift = (employeeId: string, shift: ScheduleShift, weekday: number) => {
    const employee = employeeById.get(employeeId);
    return Boolean(employee && (shift.requiredAccountIdsByDay[weekday] ?? []).every((accountId) => employee.accountIds.includes(accountId)));
  };
  const respectsConsecutiveLimit = (employeeId: string, changes: Map<string, GeneratedAssignment["status"]>) => {
    const statuses = new Map<string, GeneratedAssignment["status"]>();
    for (const entry of input.priorAssignments?.[employeeId] ?? []) statuses.set(entry.date, entry.status);
    for (const entry of assignments.filter((assignment) => assignment.employeeId === employeeId)) statuses.set(entry.date, entry.status);
    for (const [date, status] of changes) statuses.set(date, status);
    const orderedDates = [...statuses.keys()].sort();
    if (!orderedDates.length) return true;
    let run = 0;
    let previousDate = -Infinity;
    for (const date of orderedDates) {
      const stamp = Date.parse(`${date}T12:00:00Z`);
      if (stamp - previousDate !== 86400000) run = 0;
      const status = statuses.get(date);
      run = status === "WORKING" ? run + 1 : 0;
      if (run > input.maxConsecutiveDays) return false;
      previousDate = stamp;
    }
    return true;
  };
  for (const date of days) {
    const dateKey = format(date, "yyyy-MM-dd");
    const weekday = date.getDay();
    const weekKey = weekKeyFor(date);
    for (const shift of input.shifts) {
      const required = shift.minimumByDay[weekday] ?? 0;
      while (assignments.filter((assignment) => assignment.date === dateKey && assignment.status === "WORKING" && assignment.shiftId === shift.id).length < required) {
        const direct = input.employees.find((employee) => {
          const current = assignmentFor(employee.id, dateKey);
          return current?.status === "OFF" && weeklyWorkCount(employee.id, weekKey) < maximumWeeklyDays && canCoverShift(employee.id, shift, weekday) && respectsConsecutiveLimit(employee.id, new Map([[dateKey, "WORKING"]]));
        });
        if (direct) {
          const current = assignmentFor(direct.id, dateKey)!;
          current.status = "WORKING";
          current.shiftId = shift.id;
          continue;
        }

        let repaired = false;
        for (const cover of input.employees) {
          const missingDay = assignmentFor(cover.id, dateKey);
          if (missingDay?.status !== "OFF" || !canCoverShift(cover.id, shift, weekday)) continue;
          const donorDays = assignments.filter((assignment) => assignment.employeeId === cover.id && assignment.status === "WORKING" && weekKeyFor(new Date(`${assignment.date}T12:00:00`)) === weekKey);
          for (const donor of donorDays) {
            const donorWeekday = new Date(`${donor.date}T12:00:00`).getDay();
            const donorShift = input.shifts.find((candidate) => candidate.id === donor.shiftId);
            if (!donorShift) continue;
            const relief = input.employees.find((employee) => {
              const reliefDay = assignmentFor(employee.id, donor.date);
              return employee.id !== cover.id && reliefDay?.status === "OFF" && weeklyWorkCount(employee.id, weekKey) < maximumWeeklyDays && canCoverShift(employee.id, donorShift, donorWeekday) && respectsConsecutiveLimit(employee.id, new Map([[donor.date, "WORKING"]]));
            });
            if (!relief) continue;
            const coverChanges = new Map<string, GeneratedAssignment["status"]>([[dateKey, "WORKING"], [donor.date, "OFF"]]);
            if (!respectsConsecutiveLimit(cover.id, coverChanges)) continue;
            const reliefDay = assignmentFor(relief.id, donor.date)!;
            missingDay.status = "WORKING";
            missingDay.shiftId = shift.id;
            donor.status = "OFF";
            donor.shiftId = null;
            reliefDay.status = "WORKING";
            reliefDay.shiftId = donorShift.id;
            repaired = true;
            break;
          }
          if (repaired) break;
        }
        if (!repaired) break;
      }
    }
  }
  // Prefer whole-week pattern swaps, then try compensated within-week exchanges
  // when the month boundary prevents a complete swap. Daily staffing, history,
  // leave, qualification and work limits are preserved; fairness stays a target.
  const indexed = new Map(assignments.map(a=>[`${a.employeeId}:${a.date}`,a]));
  const generatedWeeks = Map.groupBy(days,date=>weekKeyFor(date));
  const dateInfo = new Map<string, { weekend:boolean;week:string;previous:string;next:string }>();
  for(const date of new Set([...Object.values(input.fairnessHistory ?? input.priorAssignments ?? {}).flat().map(a=>a.date),...assignments.map(a=>a.date)])) {
    const parsed=new Date(`${date}T12:00:00`),previous=new Date(parsed),next=new Date(parsed);previous.setDate(previous.getDate()-1);next.setDate(next.getDate()+1);
    dateInfo.set(date,{week:weekKeyFor(parsed),weekend:[0,6].includes(parsed.getDay()),previous:format(previous,"yyyy-MM-dd"),next:format(next,"yyyy-MM-dd")});
  }
  const burden = (employeeId: string) => {
    const records = new Map([...(input.fairnessHistory?.[employeeId] ?? input.priorAssignments?.[employeeId] ?? []),...assignments.filter(a=>a.employeeId === employeeId)].map(a=>[a.date,a]));
    let weekends=0, nights=0, split=0;
    for (const row of records.values()) if (row.status === "WORKING") { if (dateInfo.get(row.date)?.weekend) weekends++; if(row.shiftId === lateShift?.id)nights++; }
    for (const rows of Map.groupBy([...records.values()],a=>dateInfo.get(a.date)!.week).values()) {
      if(rows.length !== 7 || !rows.some(a=>a.status === "WORKING"))continue;
      const pair=rows.some(a=>a.status !== "WORKING" && [dateInfo.get(a.date)!.previous,dateInfo.get(a.date)!.next].some(adjacent=>{const other=records.get(adjacent);return other && other.status !== "WORKING";}));
      if(!pair)split++;
    }
    return {score:weekends*weekends*100+nights*nights*25+split*split*60+split*500,split};
  };
  let balanced=false;
  for(let pass=0;pass<4;pass++) {
    let improved=false;
    for(const [week,weekDays] of generatedWeeks) {
      if(weekDays.length !== 7)continue;
      for(let left=0;left<input.employees.length;left++)for(let right=left+1;right<input.employees.length;right++) {
        const a=input.employees[left],b=input.employees[right];
        const allPairs=weekDays.map(date=>[indexed.get(`${a.id}:${format(date,"yyyy-MM-dd")}`)!,indexed.get(`${b.id}:${format(date,"yyyy-MM-dd")}`)!]);
        const aWorking=allPairs.filter(([x,y])=>x.status === "WORKING" && y.status === "OFF");
        const bWorking=allPairs.filter(([x,y])=>x.status === "OFF" && y.status === "WORKING");
        const sharedWorking=allPairs.filter(([x,y])=>x.status === "WORKING" && y.status === "WORKING" && x.shiftId !== y.shiftId);
        const sharedDirections=[...Map.groupBy(sharedWorking,([x,y])=>`${x.shiftId}:${y.shiftId}`).values()];
        const candidates=[allPairs,...(sharedWorking.length?[sharedWorking]:[]),...sharedDirections,...aWorking.flatMap(x=>bWorking.map(y=>[x,y]))];
        if(aWorking.length === bWorking.length && aWorking.length > 1)candidates.push([...aWorking,...bWorking]);
        for(const pairs of candidates) {
        if(pairs.some(([x,y])=>!["OFF","WORKING"].includes(x.status)||!["OFF","WORKING"].includes(y.status)))continue;
        if(pairs.every(([x,y])=>x.status === y.status && x.shiftId === y.shiftId))continue;
        const qualifies=(employee:ScheduleEmployee,row:GeneratedAssignment)=> row.status !== "WORKING" || Boolean(input.shifts.find(s=>s.id === row.shiftId && canCoverShift(employee.id,s,new Date(`${row.date}T12:00:00`).getDay())));
        if(pairs.some(([x,y])=>!qualifies(a,y)||!qualifies(b,x)))continue;
        const preferenceCost=(employee:ScheduleEmployee,rows:GeneratedAssignment[])=>rows.reduce((sum,row)=>sum+(row.status === "WORKING"?(employee.dayOffPreferences.find(p=>p.dayOfWeek === new Date(`${row.date}T12:00:00`).getDay())?.rank === 1?2:employee.dayOffPreferences.some(p=>p.dayOfWeek === new Date(`${row.date}T12:00:00`).getDay())?1:0)+(employee.preferredShiftId && employee.preferredShiftId !== row.shiftId?1:0):0),0);
        if(preferenceCost(a,pairs.map(([,y])=>y))+preferenceCost(b,pairs.map(([x])=>x))>preferenceCost(a,pairs.map(([x])=>x))+preferenceCost(b,pairs.map(([,y])=>y)))continue;
        const beforeA=burden(a.id),beforeB=burden(b.id);
        const saved=pairs.map(([x,y])=>[{status:x.status,shiftId:x.shiftId},{status:y.status,shiftId:y.shiftId}]);
        pairs.forEach(([x,y])=>{const status=x.status,shiftId=x.shiftId;x.status=y.status;x.shiftId=y.shiftId;y.status=status;y.shiftId=shiftId;});
        const afterA=burden(a.id),afterB=burden(b.id);
        const validLanguage=a.isBilingual === b.isBilingual || pairs.every(([row])=>input.shifts.every(shift=>assignments.filter(other=>other.date === row.date&&other.status === "WORKING"&&other.shiftId === shift.id&&employeeById.get(other.employeeId)?.isBilingual).length >= (shift.bilingualByDay[new Date(`${row.date}T12:00:00`).getDay()] ?? 0)));
        if(afterA.score+afterB.score < beforeA.score+beforeB.score && validLanguage && respectsConsecutiveLimit(a.id,new Map()) && respectsConsecutiveLimit(b.id,new Map()) && weeklyWorkCount(a.id,week)<=maximumWeeklyDays && weeklyWorkCount(b.id,week)<=maximumWeeklyDays) { improved=true;balanced=true; }
        else pairs.forEach(([x,y],index)=>{Object.assign(x,saved[index][0]);Object.assign(y,saved[index][1]);});
        }
      }
    }
    if(!improved)break;
  }
  const retainedWarnings = warnings.filter((warning) => warning.code !== "STAFF_SHORTAGE" && warning.code !== "BILINGUAL_SHORTAGE" && !(balanced && warning.code === "REST_PATTERN_OVERRIDE"));
  warnings.splice(0, warnings.length, ...retainedWarnings);
  for (const date of days) {
    const dateKey = format(date, "yyyy-MM-dd");
    const weekday = date.getDay();
    for (const shift of input.shifts) {
      const required = shift.minimumByDay[weekday] ?? 0;
      const requiredBilingual = shift.bilingualByDay[weekday] ?? 0;
      const staffed = assignments.filter((assignment) => assignment.date === dateKey && assignment.status === "WORKING" && assignment.shiftId === shift.id);
      if (staffed.length < required) warnings.push({ date: dateKey, shiftId: shift.id, severity: "critical", code: "STAFF_SHORTAGE", message: `${shift.name} needs ${required - staffed.length} more team member(s).` });
      const bilingual = staffed.filter((assignment) => employeeById.get(assignment.employeeId)?.isBilingual).length;
      if (bilingual < requiredBilingual) warnings.push({ date: dateKey, shiftId: shift.id, severity: "critical", code: "BILINGUAL_SHORTAGE", message: `${shift.name} needs ${requiredBilingual - bilingual} more bilingual team member(s).` });
    }
  }
  // Repairs can move OFF days after the initial rest plan was checked. Retain
  // a reviewable exception for the final roster rather than losing that change.
  const generatedKeys = new Set(assignments.map(a=>`${a.employeeId}:${a.date}`));
  if ((input.maxWeeklyDays ?? 5) === 5) for (const employee of input.employees) {
    const history = new Map([...(input.priorAssignments?.[employee.id] ?? []), ...assignments.filter(a=>a.employeeId === employee.id)].map(a=>[a.date,a]));
    const weeks = Map.groupBy([...history.values()], a=>weekKeyFor(new Date(`${a.date}T12:00:00`)));
    for (const [week, rows] of weeks) {
      if (rows.length < 7 || !rows.some(a=>generatedKeys.has(`${employee.id}:${a.date}`))) continue;
      const hasPair = rows.some(a=> {
        if (a.status === "WORKING") return false;
        return [-1,1].some(offset=> { const adjacent = new Date(`${a.date}T12:00:00`); adjacent.setDate(adjacent.getDate()+offset); const other=history.get(format(adjacent,"yyyy-MM-dd"));return other && other.status !== "WORKING"; });
      });
      if (!hasPair) warnings.push({ date:week,shiftId:`rest:${employee.id}`,severity:"warning",code:"REST_PATTERN_OVERRIDE",message:`${employee.name} does not have two consecutive rest days in the week of ${week}. Review and accept this rest exception.` });
    }
  }
  const finalDate=format(monthEnd,"yyyy-MM-dd");
  const result = { assignments:assignments.filter(a=>a.date<=finalDate), warnings:warnings.filter(w=>w.date<=finalDate) };
  // A greedy placement can paint itself into a corner despite a feasible team.
  // Try a bounded alternate ordering; never relax a coverage or work-limit rule.
  const critical=result.warnings.filter(w=>w.severity === "critical").length;
  if(critical && searchAttempt < 5) {
    const alternative=generateSchedule({...input,variationSeed:variationRank(input.variationSeed ?? 0,`${input.year}:${input.month}:repair:${searchAttempt}`)},searchAttempt+1);
    if(alternative.warnings.filter(w=>w.severity === "critical").length < critical)return alternative;
  }
  return result;
}
