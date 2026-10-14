import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { operationHash } from "@/lib/daily-plan";
import { mainBreakCover } from "@/lib/main-break-cover";
import { dateKey as validDate, operationToday } from "@/lib/validation";

const schema = z.object({
  date: validDate,
  replace: z.boolean().default(false),
});

const toMinutes = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};
const toTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid operation date." }, { status: 400 });
  const date = new Date(`${parsed.data.date}T00:00:00.000Z`);
  const weekday = date.getUTCDay();
  const historyStart = new Date(date); historyStart.setUTCDate(historyStart.getUTCDate() - 42);
  const [assignments, categories, accounts, focusHistory, rotationBaselines, existingTasks, existingBreaks, settings] = await Promise.all([
    prisma.shiftAssignment.findMany({
      where: { date, status: "WORKING", employee: { status: "ACTIVE" }, schedulePeriod: { status: { in: ["APPROVED", "PUBLISHED"] } } },
      include: { employee: true, shift: { include: { staffingRules: { where: { dayOfWeek: weekday } } } } },
      orderBy: [{ shift: { order: "asc" } }, { employee: { name: "asc" } }],
    }),
    prisma.taskCategory.findMany({ where: { active: true }, orderBy: { order: "asc" } }),
    prisma.account.findMany({ where: { active: true }, include: { coverageRequirements: true, employeeCapabilities: true } }),
    prisma.taskAssignment.findMany({ where: { date: { gte: historyStart, lt: date }, category: { mode: "FOCUS" } }, include: { category: true }, orderBy: { date: "desc" } }),
    prisma.rotationBaseline.findMany({ where: { effectiveDate: { lt: date } }, include: { taskCategory: true } }),
    prisma.taskAssignment.count({ where: { date } }),
    prisma.breakSchedule.count({ where: { date } }),
    prisma.appSettings.upsert({ where: { id: "global" }, create: { id: "global" }, update: {} }),
  ]);
  if (parsed.data.date < operationToday(settings.timezone)) return NextResponse.json({ error: "Past daily plans are preserved. Choose today or a future date." }, { status: 409 });
  if (!assignments.length) return NextResponse.json({ error: "Approve a working roster for this date before building the daily plan." }, { status: 409 });
  if ((existingTasks || existingBreaks) && !parsed.data.replace) return NextResponse.json({ error: "This day already contains tasks or breaks.", code: "PLAN_EXISTS", existingTasks, existingBreaks }, { status: 409 });
  if (!categories.length) return NextResponse.json({ error: "Add at least one active task category first." }, { status: 409 });

  const taskRows: { date: Date; employeeId: string; categoryId: string; note: string; priority: number; startTime: string | null; endTime: string | null }[] = [];
  const warnings: string[] = [];
  const normalizeQueue = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const weekStart = new Date(date); weekStart.setUTCDate(weekStart.getUTCDate() - ((weekday - settings.weekStartsOn + 7) % 7));
  const byShift = Map.groupBy(assignments, (assignment) => assignment.shiftId ?? "unassigned");
  const shiftGroups = [...byShift.values()].filter((group) => Boolean(group[0]?.shift)).sort((left, right) => left[0]!.shift!.startTime.localeCompare(right[0]!.shift!.startTime));
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const accountsCoveredForWholeShift = (shift: NonNullable<(typeof assignments)[number]["shift"]>) => accounts.filter((account) => account.coverageRequirements.some((requirement) => requirement.dayOfWeek === weekday && shift.startTime <= requirement.startTime && shift.endTime >= requirement.endTime));
  for (const shiftAssignments of shiftGroups) {
    const shift = shiftAssignments[0]?.shift;
    if (!shift) continue;
    const relevantAccounts = accountsCoveredForWholeShift(shift);
    const relevantAccountIds = new Set(relevantAccounts.map((account) => account.id));
    const relevantCategories = categories.filter((category) => category.accountId && relevantAccountIds.has(category.accountId));
    const grouped = Map.groupBy(relevantCategories, (category) => normalizeQueue(category.name));
    for (const items of grouped.values()) if (items.some(item=>item.mode !== items[0].mode || item.defaultPriority !== items[0].defaultPriority || item.isLive !== items[0].isLive)) return NextResponse.json({ error: `The shared task ${items[0].name} has conflicting account settings. Align its assignment method, priority and live-coverage setting, or use distinct task names.` }, { status: 409 });
    const queues = [...grouped.values()].map((items) => {
      const accountNames = relevantAccounts.filter((account) => items.some((item) => item.accountId === account.id)).map((account) => account.name);
      const requirements = relevantAccounts.flatMap((account) => account.coverageRequirements.filter((requirement) => requirement.dayOfWeek === weekday && shift.startTime <= requirement.startTime && shift.endTime >= requirement.endTime));
      return { category: items[0], accountNames, startTime: requirements.map((item) => item.startTime).sort()[0] ?? shift.startTime, endTime: requirements.map((item) => item.endTime).sort().at(-1) ?? shift.endTime };
    });
    const eligible = (queue: (typeof queues)[number]) => {
      const accountIds = grouped.get(queue.category.name.toLowerCase().replace(/[^a-z0-9]/g, ""))?.map((item) => item.accountId).filter(Boolean) as string[];
      return shiftAssignments.filter((assignment) => accountIds.every((accountId) => accounts.find((account) => account.id === accountId)?.employeeCapabilities.some((capability) => capability.employeeId === assignment.employeeId)));
    };
    const focusOwners = new Set<string>();
    const focusQueues = queues.filter((item) => item.category.mode === "FOCUS").sort((left, right) => left.category.rotationOrder - right.category.rotationOrder);
    for (const queue of focusQueues) {
      const candidates = eligible(queue);
      if (!candidates.length) { warnings.push(`${queue.category.name} has no eligible scheduled agent on ${shift.name}.`); continue; }
      const unassigned = candidates.filter((assignment) => !focusOwners.has(assignment.employeeId));
      const pool = unassigned.length ? unassigned : candidates;
      const queueKey = normalizeQueue(queue.category.name);
      const continued = pool.find((assignment) => focusHistory.some((task) => task.employeeId === assignment.employeeId && task.date >= weekStart && normalizeQueue(task.category.name) === queueKey && task.startTime === queue.startTime));
      const expected = pool.find((assignment) => {
        const last = focusHistory.find((task) => task.employeeId === assignment.employeeId && task.date < weekStart && task.startTime === queue.startTime);
        const baseline = rotationBaselines.find((item) => item.employeeId === assignment.employeeId)?.taskCategory;
        const previousName = last?.category.name ?? baseline?.name;
        if (!previousName) return false;
        const previousIndex = focusQueues.findIndex((item) => normalizeQueue(item.category.name) === normalizeQueue(previousName));
        return previousIndex >= 0 && normalizeQueue(focusQueues[(previousIndex + 1) % focusQueues.length].category.name) === queueKey;
      });
      const assignment = continued ?? expected ?? pool.sort((left, right) => {
        const leftLast = focusHistory.find((task) => task.employeeId === left.employeeId && normalizeQueue(task.category.name) === queueKey)?.date.getTime() ?? 0;
        const rightLast = focusHistory.find((task) => task.employeeId === right.employeeId && normalizeQueue(task.category.name) === queueKey)?.date.getTime() ?? 0;
        return leftLast - rightLast || left.employee.name.localeCompare(right.employee.name);
      })[0];
      if (!unassigned.length && shiftAssignments.length > 1) warnings.push(`${assignment.employee.name} must cover more than one focus queue on ${shift.name} because no additional eligible agent is available.`);
      focusOwners.add(assignment.employeeId);
      taskRows.push({ date, employeeId: assignment.employeeId, categoryId: queue.category.id, priority: queue.category.defaultPriority, startTime: queue.startTime, endTime: queue.endTime, note: `${queue.accountNames.join(" + ")} · primary focus` });
    }
    for (const queue of queues.filter((item) => item.category.mode === "EVERYONE")) for (const assignment of eligible(queue)) {
      taskRows.push({ date, employeeId: assignment.employeeId, categoryId: queue.category.id, priority: queue.category.defaultPriority, startTime: queue.startTime, endTime: queue.endTime, note: queue.accountNames.join(" + ") });
    }
    for (const queue of queues.filter((item) => item.category.mode === "SECONDARY")) {
      const candidates = eligible(queue);
      if (!candidates.length) { warnings.push(`${queue.category.name} has no eligible scheduled agent on ${shift.name}.`); continue; }
      const assignment = candidates.sort((left, right) => taskRows.filter((item) => item.employeeId === left.employeeId).length - taskRows.filter((item) => item.employeeId === right.employeeId).length)[0];
      taskRows.push({ date, employeeId: assignment.employeeId, categoryId: queue.category.id, priority: queue.category.defaultPriority, startTime: queue.startTime, endTime: queue.endTime, note: queue.accountNames.join(" + ") });
    }
  }

  // Everyone responsibilities use each worker's complete intersection with
  // account service periods, including a lone afternoon shift.
  for (const assignment of assignments) for (const category of categories.filter(c=>c.mode === "EVERYONE")) {
    const account = accounts.find(a=>a.id === category.accountId);
    const shift = assignment.shift;
    if (!account || !shift || !account.employeeCapabilities.some(c=>c.employeeId === assignment.employeeId)) continue;
    const windows = account.coverageRequirements.filter(w=>w.dayOfWeek === weekday && w.startTime < shift.endTime && w.endTime > shift.startTime);
    if (!windows.length) continue;
    const startTime = windows.map(w=>w.startTime > shift.startTime ? w.startTime : shift.startTime).sort()[0];
    const endTime = windows.map(w=>w.endTime < shift.endTime ? w.endTime : shift.endTime).sort().at(-1)!;
    const existing = taskRows.find(r=>r.employeeId === assignment.employeeId && r.categoryId === category.id);
    if (existing) { existing.startTime = startTime; existing.endTime = endTime; existing.priority = category.defaultPriority; }
    else if (!taskRows.some(r=>r.employeeId === assignment.employeeId && normalizeQueue(categoryById.get(r.categoryId)?.name || "") === normalizeQueue(category.name) && r.note.split(" + ").includes(account.name) && r.startTime! <= startTime && r.endTime! >= endTime)) taskRows.push({date,employeeId:assignment.employeeId,categoryId:category.id,priority:category.defaultPriority,startTime,endTime,note:account.name});
  }

  // An afternoon/night shift shares daytime coverage before becoming
  // the sole late coverage. During that overlap, it shares Calls and Chats.
  // If the daytime team is short a rotating focus queue, the overlap agent
  // takes that missing responsibility until the day shift ends.
  const dayGroup = shiftGroups[0];
  if (dayGroup?.[0]?.shift) for (const overlapGroup of shiftGroups.slice(1)) {
    const dayShift = dayGroup[0].shift; const overlapShift = overlapGroup[0]?.shift;
    if (!overlapShift) continue;
    const overlapStart = Math.max(toMinutes(dayShift.startTime), toMinutes(overlapShift.startTime));
    const overlapEnd = Math.min(toMinutes(dayShift.endTime), toMinutes(overlapShift.endTime));
    if (overlapEnd <= overlapStart) continue;
    const overlapAccounts = accounts.filter((account) => account.coverageRequirements.some((requirement) => requirement.dayOfWeek === weekday && toMinutes(requirement.startTime) < overlapEnd && toMinutes(requirement.endTime) > overlapStart));
    const lateAccountIds = new Set(accountsCoveredForWholeShift(overlapShift).map((account) => account.id));
    const overlapCategories = categories.filter((category) => category.accountId && overlapAccounts.some((account) => account.id === category.accountId));
    const overlapQueues = [...Map.groupBy(overlapCategories, (category) => normalizeQueue(category.name)).entries()];
    const dayEmployeeIds = new Set(dayGroup.map((assignment) => assignment.employeeId));
    const coveredDayFocus = new Set(taskRows.filter((row) => dayEmployeeIds.has(row.employeeId) && categoryById.get(row.categoryId)?.mode === "FOCUS").map((row) => normalizeQueue(categoryById.get(row.categoryId)?.name ?? "")));
    const supportCategory = (items: typeof categories) => items.find((category) => !lateAccountIds.has(category.accountId ?? "") && !taskRows.some((row) => row.employeeId === overlapGroup[0]!.employeeId && row.categoryId === category.id));
    const focusQueues = overlapQueues.filter(([, items]) => items[0].mode === "FOCUS");
    const missingFocus = focusQueues.filter(([, items]) => !coveredDayFocus.has(normalizeQueue(items[0].name)));
    const assignedOverlapFocus = new Set<string>();
    const assignOverlapFocus = (queueName: string, items: typeof categories, replacement?: (typeof taskRows)[number]) => {
      const category = supportCategory(items); const candidate = [...overlapGroup].sort((left, right) => taskRows.filter((row) => row.employeeId === left.employeeId).length - taskRows.filter((row) => row.employeeId === right.employeeId).length)[0];
      if (!category || !candidate) { warnings.push(`${items[0].name} has no overlap-shift cover for the daytime shortage.`); return false; }
      const values = { employeeId: candidate.employeeId, categoryId: category.id, priority: 1, startTime: toTime(overlapStart), endTime: toTime(overlapEnd), note: `${overlapAccounts.filter((account) => account.id === category.accountId).map((account) => account.name).join(" + ")} · primary focus during shared coverage` };
      if (replacement) Object.assign(replacement, values); else taskRows.push({ date, ...values });
      assignedOverlapFocus.add(queueName);
      return true;
    };
    // If there are fewer Day agents than daytime focus queues, move a
    // non-live focus responsibility to the overlapping shift rather than
    // giving two primary responsibilities to a Day agent.
    const singleAgentService = dayGroup.length === 1 && overlapAccounts.length === 1 && overlapAccounts[0].coverageRequirements.filter(r=>r.dayOfWeek === weekday && toMinutes(r.startTime)<overlapEnd && toMinutes(r.endTime)>overlapStart).every(r=>r.minimumStaff === 1);
    let remainingCover = singleAgentService ? 0 : Math.max(0, focusQueues.length - dayGroup.length);
    const transferableFocus = focusQueues
      .map(([queueName, items]) => ({ queueName, items, row: taskRows.find((row) => dayEmployeeIds.has(row.employeeId) && normalizeQueue(categoryById.get(row.categoryId)?.name ?? "") === queueName) }))
      .filter((item): item is { queueName: string; items: typeof categories; row: (typeof taskRows)[number] } => Boolean(item.row))
      .sort((left, right) => Number(left.items[0].isLive) - Number(right.items[0].isLive) || right.items[0].rotationOrder - left.items[0].rotationOrder);
    for (const item of transferableFocus) {
      if (!remainingCover) break;
      const ownerFocusCount = taskRows.filter((row) => row.employeeId === item.row.employeeId && categoryById.get(row.categoryId)?.mode === "FOCUS").length;
      if (ownerFocusCount < 2) continue;
      if (assignOverlapFocus(item.queueName, item.items, item.row)) remainingCover -= 1;
    }
    for (const [queueName, items] of missingFocus) {
      if (!assignedOverlapFocus.has(queueName)) assignOverlapFocus(queueName, items);
    }
    if (assignedOverlapFocus.size) for (const [queueName, items] of overlapQueues.filter(([, items]) => items[0].isLive && items[0].mode !== "EVERYONE")) {
      if (assignedOverlapFocus.has(queueName)) continue;
      const category = supportCategory(items);
      if (!category) continue;
      for (const assignment of overlapGroup) taskRows.push({ date, employeeId: assignment.employeeId, categoryId: category.id, priority: 2, startTime: toTime(overlapStart), endTime: toTime(overlapEnd), note: `${overlapAccounts.map((account) => account.name).join(" + ")} · shared coverage` });
    }
  }

  const breakRows: { date: Date; employeeId: string; type: "MAIN" | "SHORT"; startTime: string; endTime: string; coverEmployeeId?: string | null }[] = [];
  const findSlot = (employeeId: string, type: "MAIN" | "SHORT", earliest: number, latestEnd: number, duration: number) => {
    for (let start = earliest; start + duration <= latestEnd; start += 10) {
      const end = start + duration;
      const conflicts = type === "MAIN" && breakRows.filter((item) => item.type === "MAIN" && toMinutes(item.startTime) < end + settings.breakGapMinutes && toMinutes(item.endTime) + settings.breakGapMinutes > start).length >= settings.maxConcurrentMainBreaks;
      if (conflicts) continue;
      const covered = assignments.some((assignment) => assignment.employeeId !== employeeId && assignment.shift && toMinutes(assignment.shift.startTime) <= start && toMinutes(assignment.shift.endTime) >= end && !breakRows.some((item) => item.employeeId === assignment.employeeId && toMinutes(item.startTime) < end && toMinutes(item.endTime) > start));
      if (covered && (type === "SHORT" || mainBreakCover(employeeId, toTime(start), toTime(end), weekday, assignments, breakRows, accounts))) return { start, end };
    }
    return null;
  };
  for (const assignment of assignments) {
    if (!assignment.shift || settings.mainBreakMinutes <= 0) continue;
    const shiftStart = toMinutes(assignment.shift.startTime); const shiftEnd = toMinutes(assignment.shift.endTime);
    const overlapEnd = Math.max(shiftStart, ...assignments.filter((other) => other.employeeId !== assignment.employeeId && other.shift && toMinutes(other.shift.startTime) < shiftEnd && toMinutes(other.shift.endTime) > shiftStart).map((other) => toMinutes(other.shift!.endTime)));
    const latestMainStartForSplitBreak = overlapEnd - settings.mainBreakMinutes - settings.shortBreakDelayMinutes - settings.shortBreakMinutes;
    const preferredMainStart = shiftStart + settings.mainBreakAfterMinutes;
    const mainStart = Math.max(shiftStart, Math.min(preferredMainStart, latestMainStartForSplitBreak));
    const slot = findSlot(assignment.employeeId, "MAIN", mainStart, shiftEnd, settings.mainBreakMinutes);
    if (!slot) { warnings.push(`No coverage-safe ${settings.mainBreakMinutes}-minute main break was available for ${assignment.employee.name}.`); continue; }
    breakRows.push({ date, employeeId: assignment.employeeId, type: "MAIN", startTime: toTime(slot.start), endTime: toTime(slot.end) });
  }
  for (const assignment of assignments) {
    if (!assignment.shift || settings.shortBreakMinutes <= 0) continue;
    const main = breakRows.find((item) => item.employeeId === assignment.employeeId && item.type === "MAIN");
    const shiftStart = toMinutes(assignment.shift.startTime); const shiftEnd = toMinutes(assignment.shift.endTime);
    const earliest = main ? toMinutes(main.endTime) + settings.shortBreakDelayMinutes : shiftStart + settings.mainBreakAfterMinutes;
    let slot = findSlot(assignment.employeeId, "SHORT", earliest, shiftEnd, settings.shortBreakMinutes);
    if (!slot && main && settings.shortBreakDelayMinutes > 0) {
      slot = findSlot(assignment.employeeId, "SHORT", toMinutes(main.endTime), shiftEnd, settings.shortBreakMinutes);
      if (slot) warnings.push(`${assignment.employee.name}'s short break was moved earlier to preserve live-channel coverage.`);
    }
    if (!slot) { warnings.push(`No coverage-safe ${settings.shortBreakMinutes}-minute short break was available for ${assignment.employee.name}.`); continue; }
    breakRows.push({ date, employeeId: assignment.employeeId, type: "SHORT", startTime: toTime(slot.start), endTime: toTime(slot.end) });
  }

  for (const row of breakRows.filter(item => item.type === "MAIN")) {
    row.coverEmployeeId = mainBreakCover(row.employeeId, row.startTime, row.endTime, weekday, assignments, breakRows, accounts);
    if (!row.coverEmployeeId) warnings.push(`Review ${row.employeeId}'s main break: no qualified live-service cover remains available.`);
  }
  const configHash = await operationHash();
  await prisma.$transaction(async (tx) => {
    if (parsed.data.replace) {
      await tx.taskAssignment.deleteMany({ where: { date } });
      await tx.breakSchedule.deleteMany({ where: { date } });
    }
    if (taskRows.length) await tx.taskAssignment.createMany({ data: taskRows });
    if (breakRows.length) await tx.breakSchedule.createMany({ data: breakRows });
    await tx.dailyPlan.upsert({ where: { date }, create: { date, configHash, revision: parsed.data.replace ? 2 : 1 }, update: { configHash, revision: { increment: 1 } } });
  });
  return NextResponse.json({ ok: true, tasksCreated: taskRows.length, breaksCreated: breakRows.length, warnings: [...new Set(warnings)] });
}
