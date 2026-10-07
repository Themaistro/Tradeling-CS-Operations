import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const startValue = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(startValue ?? "")) {
  console.error("Usage: node scripts/audit-week.mjs YYYY-MM-DD");
  process.exit(2);
}

const start = new Date(`${startValue}T00:00:00.000Z`);
const end = new Date(start);
end.setUTCDate(end.getUTCDate() + 7);
const key = (date) => date.toISOString().slice(0, 10);
const minutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const overlaps = (aStart, aEnd, bStart, bEnd) => minutes(aStart) < minutes(bEnd) && minutes(aEnd) > minutes(bStart);

const [employees, assignments, tasks, breaks, accounts, settings] = await Promise.all([
  prisma.employee.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" } }),
  prisma.shiftAssignment.findMany({
    where: { date: { gte: start, lt: end }, schedulePeriod: { status: { in: ["APPROVED", "PUBLISHED"] } } },
    include: { employee: true, shift: true },
  }),
  prisma.taskAssignment.findMany({ where: { date: { gte: start, lt: end } }, include: { category: true } }),
  prisma.breakSchedule.findMany({ where: { date: { gte: start, lt: end } } }),
  prisma.account.findMany({ where: { active: true }, include: { coverageRequirements: true, employeeCapabilities: true } }),
  prisma.appSettings.findUnique({ where: { id: "global" } }),
]);

const failures = [];
const warnings = [];
const passes = [];
const fail = (message) => failures.push(message);
const warn = (message) => warnings.push(message);
const pass = (message) => passes.push(message);
const working = assignments.filter((item) => item.status === "WORKING" && item.shift);
const dates = Array.from({ length: 7 }, (_, index) => { const date = new Date(start); date.setUTCDate(date.getUTCDate() + index); return key(date); });

for (const date of dates) {
  const dayAssignments = assignments.filter((item) => key(item.date) === date);
  const dayWorking = working.filter((item) => key(item.date) === date);
  if (dayAssignments.length !== employees.length) fail(`${date}: expected ${employees.length} roster rows, found ${dayAssignments.length}.`);
  if (!dayWorking.some((item) => /late|night/i.test(item.shift.name))) fail(`${date}: no late-shift agent covers the evening.`);
  for (const account of accounts) {
    const requirements = account.coverageRequirements.filter((item) => item.dayOfWeek === new Date(`${date}T00:00:00.000Z`).getUTCDay());
    const capable = new Set(account.employeeCapabilities.map((item) => item.employeeId));
    for (const requirement of requirements) {
      const covered = dayWorking.filter((item) => capable.has(item.employeeId) && item.shift.startTime <= requirement.startTime && item.shift.endTime >= requirement.endTime);
      if (covered.length < requirement.minimumStaff) fail(`${date}: ${account.name} ${requirement.startTime}–${requirement.endTime} is short by ${requirement.minimumStaff - covered.length}.`);
      if (covered.filter((item) => item.employee.isBilingual).length < requirement.minimumBilingual) fail(`${date}: ${account.name} lacks required bilingual coverage.`);
    }
  }
  for (const assignment of dayWorking) {
    const agentTasks = tasks.filter((item) => key(item.date) === date && item.employeeId === assignment.employeeId);
    const agentBreaks = breaks.filter((item) => key(item.date) === date && item.employeeId === assignment.employeeId);
    if (!agentTasks.length) fail(`${date}: ${assignment.employee.name} is working but has no tasks.`);
    if (!agentTasks.some((item) => /calls?/i.test(item.category.name))) fail(`${date}: ${assignment.employee.name} is working but is not assigned to Calls.`);
    const focusTasks = agentTasks.filter((item) => item.category.mode === "FOCUS");
    const sameShiftCount = dayWorking.filter((item) => item.shiftId === assignment.shiftId).length;
    if (focusTasks.length > 1 && sameShiftCount > 1) fail(`${date}: ${assignment.employee.name} has ${focusTasks.length} conflicting focus tasks.`);
    if (agentBreaks.filter((item) => item.type === "MAIN").length !== 1) fail(`${date}: ${assignment.employee.name} does not have exactly one main break.`);
    if (agentBreaks.filter((item) => item.type === "SHORT").length !== 1) fail(`${date}: ${assignment.employee.name} does not have exactly one short break.`);
    for (const item of agentBreaks) {
      const expectedDuration = item.type === "MAIN" ? settings?.mainBreakMinutes : settings?.shortBreakMinutes;
      if (expectedDuration && minutes(item.endTime) - minutes(item.startTime) !== expectedDuration) fail(`${date}: ${assignment.employee.name}'s ${item.type.toLowerCase()} break has the wrong duration.`);
      if (minutes(item.startTime) < minutes(assignment.shift.startTime) || minutes(item.endTime) > minutes(assignment.shift.endTime)) fail(`${date}: ${assignment.employee.name}'s ${item.type.toLowerCase()} break falls outside the shift.`);
      const cover = dayWorking.some((other) => other.employeeId !== assignment.employeeId && minutes(other.shift.startTime) <= minutes(item.startTime) && minutes(other.shift.endTime) >= minutes(item.endTime) && !breaks.some((otherBreak) => key(otherBreak.date) === date && otherBreak.employeeId === other.employeeId && overlaps(otherBreak.startTime, otherBreak.endTime, item.startTime, item.endTime)));
      if (!cover) fail(`${date}: ${assignment.employee.name}'s ${item.type.toLowerCase()} break has no available cover.`);
    }
    const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    const shouldBeWfh = settings?.wfhDays.includes(weekday) || (settings?.lateShiftWfh && /late|night/i.test(assignment.shift.name));
    if (shouldBeWfh && assignment.workLocation !== "WFH") fail(`${date}: ${assignment.employee.name} should be marked WFH.`);
  }
  for (const assignment of dayAssignments.filter((item) => item.status !== "WORKING")) {
    if (tasks.some((item) => key(item.date) === date && item.employeeId === assignment.employeeId)) fail(`${date}: ${assignment.employee.name} is ${assignment.status} but still has tasks.`);
    if (breaks.some((item) => key(item.date) === date && item.employeeId === assignment.employeeId)) fail(`${date}: ${assignment.employee.name} is ${assignment.status} but still has breaks.`);
  }
}

for (const employee of employees) {
  const rows = assignments.filter((item) => item.employeeId === employee.id);
  const workCount = rows.filter((item) => item.status === "WORKING").length;
  if (workCount !== (settings?.maxWeeklyDays ?? 5)) fail(`${employee.name}: works ${workCount} days instead of ${settings?.maxWeeklyDays ?? 5}.`);
  const statuses = dates.map((date) => rows.find((item) => key(item.date) === date)?.status === "WORKING");
  const consecutiveOff = statuses.some((value, index) => !value && !statuses[(index + 1) % 7]);
  if (!consecutiveOff) fail(`${employee.name}: does not have two consecutive days off.`);
  if (!employee.slackId) fail(`${employee.name}: Slack member ID is missing, so a private briefing cannot be delivered.`);
}

const lateOwners = new Set(working.filter((item) => /late|night/i.test(item.shift.name)).map((item) => item.employeeId));
if (lateOwners.size > 3) warn(`Late coverage uses ${lateOwners.size} different agents in one week; weekly ownership may be too fragmented.`);
else pass(`Late coverage is shared by ${lateOwners.size} agent(s) during the week.`);
if (!failures.length) pass("All seven days meet roster, account coverage, task, break, leave, and Slack-ID checks.");

console.log(JSON.stringify({ week: `${dates[0]} to ${dates[6]}`, totals: { employees: employees.length, rosterRows: assignments.length, workingAssignments: working.length, tasks: tasks.length, breaks: breaks.length }, passes, warnings, failures }, null, 2));
await prisma.$disconnect();
process.exitCode = failures.length ? 1 : 0;
