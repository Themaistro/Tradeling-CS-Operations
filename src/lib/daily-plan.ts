import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/prisma";

export async function operationHash() {
  const [accounts, categories, employees, shifts, settings] = await Promise.all([
    prisma.account.findMany({ orderBy: { id: "asc" }, include: { operatingWindows: { orderBy: { id: "asc" } }, coverageRequirements: { orderBy: { id: "asc" } }, employeeCapabilities: { orderBy: { employeeId: "asc" } } } }),
    prisma.taskCategory.findMany({ orderBy: { id: "asc" } }),
    prisma.employee.findMany({ orderBy: { id: "asc" }, select: { id: true, status: true, isBilingual: true } }),
    prisma.shift.findMany({ orderBy: { id: "asc" }, select: { id: true, active: true, startTime: true, endTime: true } }),
    prisma.appSettings.findUnique({ where: { id: "global" } }),
  ]);
  // Cosmetic labels/icons do not change ownership or invalidate a prepared day.
  const config = { accounts: accounts.map(a => ({ id: a.id, active: a.active, windows: a.operatingWindows, coverage: a.coverageRequirements, eligible: a.employeeCapabilities })), categories: categories.map(c => ({ id: c.id, active: c.active, accountId: c.accountId, name: c.name, mode: c.mode, priority: c.defaultPriority, live: c.isLive, rotation: c.rotationOrder })), employees, shifts, breaks: settings && [settings.mainBreakMinutes, settings.shortBreakMinutes, settings.mainBreakAfterMinutes, settings.breakGapMinutes, settings.shortBreakDelayMinutes, settings.maxConcurrentMainBreaks] };
  return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

export async function changedPlan(date: Date) {
  const configHash = await operationHash();
  const existing = await prisma.dailyPlan.findUnique({ where: { date } });
  return prisma.dailyPlan.upsert({ where: { date }, create: { date, revision: 2, configHash }, update: { revision: { increment: 1 }, configHash: existing?.configHash ?? configHash } });
}

export async function planForPosting(date: Date, readOnly = false) {
  const configHash = await operationHash();
  const existing = await prisma.dailyPlan.findUnique({ where: { date } });
  if (existing && existing.configHash !== configHash) throw new Error("Operation settings changed. Review and rebuild this day's plan before posting.");
  return existing ?? (readOnly ? { date, revision: 1, configHash } : prisma.dailyPlan.upsert({ where: { date }, create: { date, revision: 1, configHash }, update: {} }));
}
