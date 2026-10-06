import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

const time = z.string().regex(/^\d{2}:\d{2}$/);
const day = z.number().int().min(0).max(6);
const actions = z.discriminatedUnion("action", [
  z.object({ action: z.literal("createAccount"), name: z.string().trim().min(2).max(80), code: z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9_-]+$/), color: z.string().default("blue") }),
  z.object({ action: z.literal("updateAccount"), id: z.string(), name: z.string().trim().min(2).max(80), code: z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9_-]+$/), active: z.boolean() }),
  z.object({ action: z.literal("addWindow"), accountId: z.string(), dayOfWeek: day, startTime: time, endTime: time }),
  z.object({ action: z.literal("removeWindow"), id: z.string() }),
  z.object({ action: z.literal("upsertCoverage"), accountId: z.string(), dayOfWeek: day, startTime: time, endTime: time, minimumStaff: z.number().int().min(0).max(100), minimumBilingual: z.number().int().min(0).max(100) }),
  z.object({ action: z.literal("removeCoverage"), id: z.string() }),
  z.object({ action: z.literal("setCapability"), employeeId: z.string(), accountId: z.string(), enabled: z.boolean() }),
]);

export async function GET() {
  const [accounts, employees, shifts] = await Promise.all([
    prisma.account.findMany({ include: { operatingWindows: { orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }] }, coverageRequirements: { orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }] }, taskCategories: { where: { active: true }, orderBy: { order: "asc" } }, employeeCapabilities: true }, orderBy: { name: "asc" } }),
    prisma.employee.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true, accountCapabilities: true }, orderBy: { name: "asc" } }),
    prisma.shift.findMany({ where: { active: true }, include: { staffingRules: true }, orderBy: { order: "asc" } }),
  ]);
  return NextResponse.json({ accounts, employees, shifts });
}

export async function POST(request: Request) {
  const parsed = actions.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the operation settings." }, { status: 400 });
  const data = parsed.data;
  try {
    if (data.action === "createAccount") return NextResponse.json(await prisma.account.create({ data: { name: data.name, code: data.code.toUpperCase(), color: data.color } }), { status: 201 });
    if (data.action === "updateAccount") return NextResponse.json(await prisma.account.update({ where: { id: data.id }, data: { name: data.name, code: data.code.toUpperCase(), active: data.active } }));
    if (data.action === "addWindow") {
      if (data.endTime <= data.startTime) return NextResponse.json({ error: "Operating end time must be after its start time." }, { status: 400 });
      const { action: _, ...window } = data; void _;
      return NextResponse.json(await prisma.accountOperatingWindow.create({ data: window }), { status: 201 });
    }
    if (data.action === "removeWindow") {
      const window = await prisma.accountOperatingWindow.findUnique({ where: { id: data.id } });
      if (!window) return NextResponse.json({ error: "Operating window not found." }, { status: 404 });
      const dependentCoverage = await prisma.coverageRequirement.count({ where: { accountId: window.accountId, dayOfWeek: window.dayOfWeek, startTime: { gte: window.startTime }, endTime: { lte: window.endTime } } });
      if (dependentCoverage) return NextResponse.json({ error: "Remove the coverage windows inside these operating hours first." }, { status: 409 });
      await prisma.accountOperatingWindow.delete({ where: { id: data.id } }); return NextResponse.json({ ok: true });
    }
    if (data.action === "upsertCoverage") {
      if (data.endTime <= data.startTime) return NextResponse.json({ error: "Coverage end time must be after its start time." }, { status: 400 });
      if (data.minimumBilingual > data.minimumStaff) return NextResponse.json({ error: "Bilingual coverage cannot exceed total staffing." }, { status: 400 });
      const containingWindow = await prisma.accountOperatingWindow.findFirst({ where: { accountId: data.accountId, dayOfWeek: data.dayOfWeek, startTime: { lte: data.startTime }, endTime: { gte: data.endTime } } });
      if (!containingWindow) return NextResponse.json({ error: "Coverage must be inside the account's operating hours for that day." }, { status: 409 });
      const { action: _, ...rule } = data; void _;
      return NextResponse.json(await prisma.coverageRequirement.upsert({ where: { accountId_dayOfWeek_startTime_endTime: { accountId: data.accountId, dayOfWeek: data.dayOfWeek, startTime: data.startTime, endTime: data.endTime } }, create: rule, update: { minimumStaff: data.minimumStaff, minimumBilingual: data.minimumBilingual } }));
    }
    if (data.action === "removeCoverage") { await prisma.coverageRequirement.delete({ where: { id: data.id } }); return NextResponse.json({ ok: true }); }
    if (data.enabled) await prisma.employeeAccountCapability.upsert({ where: { employeeId_accountId: { employeeId: data.employeeId, accountId: data.accountId } }, create: { employeeId: data.employeeId, accountId: data.accountId }, update: {} });
    else await prisma.employeeAccountCapability.deleteMany({ where: { employeeId: data.employeeId, accountId: data.accountId } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error && error.message.includes("Unique constraint") ? "This configuration already exists." : "The operation configuration could not be saved.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
