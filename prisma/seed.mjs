import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const shifts = [{ name: "Morning", startTime: "08:00", endTime: "17:00", color: "orange", order: 1 }, { name: "Evening", startTime: "12:00", endTime: "21:00", color: "blue", order: 2 }];
  for (const shift of shifts) {
    if (!await prisma.shift.findFirst({ where: { name: shift.name } })) await prisma.shift.create({ data: shift });
  }
  for (const [order, name] of ["Calls", "Chats", "Tickets", "Follow-ups"].entries()) {
    if (!await prisma.taskCategory.findFirst({ where: { name } })) await prisma.taskCategory.create({ data: { name, order } });
  }
  await prisma.appSettings.upsert({ where: { id: "global" }, update: {}, create: { id: "global" } });
}
main().finally(() => prisma.$disconnect());
