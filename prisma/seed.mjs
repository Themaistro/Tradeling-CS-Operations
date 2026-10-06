import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const shifts = [{ name: "Morning", startTime: "08:00", endTime: "17:00", color: "orange", order: 1 }, { name: "Evening", startTime: "12:00", endTime: "21:00", color: "blue", order: 2 }];
  for (const shift of shifts) {
    let saved = await prisma.shift.findFirst({ where: { name: shift.name } });
    if (!saved) saved = await prisma.shift.create({ data: shift });
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
      await prisma.staffingRule.upsert({ where: { dayOfWeek_shiftId: { dayOfWeek, shiftId: saved.id } }, create: { dayOfWeek, shiftId: saved.id, minimumStaff: 1, minimumBilingual: 0, calls: 1, chats: 0, tickets: 0 }, update: {} });
    }
  }
  for (const [order, name] of ["Calls", "Chats", "Tickets", "Follow-ups"].entries()) {
    if (!await prisma.taskCategory.findFirst({ where: { name } })) await prisma.taskCategory.create({ data: { name, order } });
  }
  await prisma.appSettings.upsert({ where: { id: "global" }, update: {}, create: { id: "global" } });
}
main().finally(() => prisma.$disconnect());
