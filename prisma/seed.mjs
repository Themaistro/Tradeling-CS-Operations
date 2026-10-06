import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const shifts = [{ name: "Day", legacyName: "Morning", startTime: "09:00", endTime: "18:00", color: "orange", order: 1 }, { name: "Late", legacyName: "Evening", startTime: "13:00", endTime: "22:00", color: "blue", order: 2 }];
  for (const shift of shifts) {
    const { legacyName, ...shiftData } = shift;
    let saved = await prisma.shift.findFirst({ where: { name: { in: [shift.name, legacyName] } } });
    if (!saved) saved = await prisma.shift.create({ data: shiftData });
    else if (saved.name === legacyName) saved = await prisma.shift.update({ where: { id: saved.id }, data: shiftData });
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
      const minimumStaff = shiftData.name === "Late" ? 1 : dayOfWeek === 1 ? 5 : [2, 3, 4, 5].includes(dayOfWeek) ? 4 : 1;
      const rule = { minimumStaff, minimumBilingual: 0, isOverride: false };
      await prisma.staffingRule.upsert({ where: { dayOfWeek_shiftId: { dayOfWeek, shiftId: saved.id } }, create: { dayOfWeek, shiftId: saved.id, ...rule }, update: {} });
    }
  }
  await prisma.taskCategory.updateMany({ where: { accountId: null }, data: { active: false } });
  const accountDefaults = [
    { name: "Tradeling", code: "TRADELING", color: "orange", days: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "18:00" },
    { name: "Hugo Boss", code: "HUGO_BOSS", color: "blue", days: [0, 1, 2, 3, 4, 5, 6], startTime: "09:00", endTime: "22:00" },
  ];
  for (const accountDefault of accountDefaults) {
    const { days, startTime, endTime, ...accountData } = accountDefault;
    const account = await prisma.account.upsert({ where: { code: accountData.code }, create: accountData, update: {} });
    const workstreams = accountData.code === "TRADELING"
      ? [
          ["Calls", "Phone", true, "EVERYONE", 2], ["Chats", "Live channels", true, "FOCUS", 1], ["CS-Supp Chat", "Chat groups", false, "SECONDARY", 2], ["Sales-CX Chat", "Chat groups", false, "SECONDARY", 2], ["International-OMT-Supp", "Chat groups", false, "SECONDARY", 2], ["Inbound", "Chat groups", false, "SECONDARY", 2],
          ["Stakeholder Emails", "Emails", false, "SECONDARY", 2], ["Open Emails", "Emails", false, "FOCUS", 1], ["Returns & CX Escalations", "Cases", false, "FOCUS", 1], ["Internal Emails & Tickets", "Cases", false, "FOCUS", 1], ["Seller Verification", "Reviews", false, "SECONDARY", 2], ["Social Reviews", "Reviews", false, "SECONDARY", 2],
        ]
      : [["Calls", "Phone", true, "EVERYONE", 2], ["Chats", "Live channels", true, "FOCUS", 1], ["Open Emails", "Emails", false, "FOCUS", 1], ["Internal Emails & Tickets", "Cases", false, "FOCUS", 1]];
    for (const [order, [name, groupName, isLive, mode, defaultPriority]] of workstreams.entries()) {
      const rotationOrder = { "Chats": 1, "Returns & CX Escalations": 2, "Open Emails": 3, "Internal Emails & Tickets": 4 }[name] ?? 0;
      const existing = await prisma.taskCategory.findFirst({ where: { accountId: account.id, name } });
      if (!existing) await prisma.taskCategory.create({ data: { accountId: account.id, name, groupName, isLive, mode, defaultPriority, rotationOrder, order } });
    }
    for (const dayOfWeek of days) await prisma.accountOperatingWindow.upsert({ where: { accountId_dayOfWeek_startTime_endTime: { accountId: account.id, dayOfWeek, startTime, endTime } }, create: { accountId: account.id, dayOfWeek, startTime, endTime }, update: {} });
    for (const dayOfWeek of days) {
      const windows = accountData.code === "HUGO_BOSS" ? [["09:00", "18:00"], ["18:00", "22:00"]] : [["09:00", "18:00"]];
      for (const [coverageStart, coverageEnd] of windows) await prisma.coverageRequirement.upsert({ where: { accountId_dayOfWeek_startTime_endTime: { accountId: account.id, dayOfWeek, startTime: coverageStart, endTime: coverageEnd } }, create: { accountId: account.id, dayOfWeek, startTime: coverageStart, endTime: coverageEnd, minimumStaff: 1 }, update: {} });
    }
    const employees = await prisma.employee.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
    for (const employee of employees) await prisma.employeeAccountCapability.upsert({ where: { employeeId_accountId: { employeeId: employee.id, accountId: account.id } }, create: { employeeId: employee.id, accountId: account.id }, update: {} });
  }
  await prisma.appSettings.upsert({ where: { id: "global" }, update: {}, create: { id: "global" } });
}
main().finally(() => prisma.$disconnect());
