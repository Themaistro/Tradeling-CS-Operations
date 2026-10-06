import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const scenarioSchema = z.object({
  title: z.string().trim().min(3).max(100),
  type: z.enum(["ABSENCE", "DEMAND_SURGE", "TRAINING", "SYSTEM_OUTAGE", "CUSTOM"]),
  startDate: date,
  endDate: date,
  employeeId: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  staffingMultiplier: z.number().min(1).max(5).default(1),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
}).superRefine((value, context) => {
  if (value.endDate < value.startDate) context.addIssue({ code: "custom", message: "End date must be on or after the start date." });
  if (["ABSENCE", "TRAINING"].includes(value.type) && !value.employeeId) context.addIssue({ code: "custom", message: "Choose the affected employee." });
  if (value.type === "DEMAND_SURGE" && value.staffingMultiplier <= 1) context.addIssue({ code: "custom", message: "Demand surge multiplier must be greater than 1." });
  if (value.startTime && value.endTime && value.endTime <= value.startTime) context.addIssue({ code: "custom", message: "Scenario end time must be after its start time." });
  if (value.type === "TRAINING" && (!value.startTime || !value.endTime)) context.addIssue({ code: "custom", message: "Training and meetings require a start and end time." });
});

const asDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const scenarios = await prisma.operationScenario.findMany({
    where: from && to ? { startDate: { lte: asDate(to) }, endDate: { gte: asDate(from) } } : undefined,
    include: { employee: { select: { id: true, name: true } }, category: { select: { id: true, name: true, icon: true } } },
    orderBy: [{ status: "asc" }, { startDate: "asc" }],
  });
  return NextResponse.json(scenarios);
}

export async function POST(request: Request) {
  const parsed = scenarioSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the scenario details." }, { status: 400 });
  const { startDate, endDate, ...data } = parsed.data;
  const scenario = await prisma.operationScenario.create({ data: { ...data, startDate: asDate(startDate), endDate: asDate(endDate) }, include: { employee: true, category: true } });
  return NextResponse.json(scenario, { status: 201 });
}

export async function PATCH(request: Request) {
  const parsed = z.object({ id: z.string(), status: z.enum(["ACTIVE", "RESOLVED"]) }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid scenario update." }, { status: 400 });
  return NextResponse.json(await prisma.operationScenario.update({ where: { id: parsed.data.id }, data: { status: parsed.data.status } }));
}

export async function DELETE(request: Request) {
  const parsed = z.object({ id: z.string() }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid scenario." }, { status: 400 });
  await prisma.operationScenario.delete({ where: { id: parsed.data.id } });
  return NextResponse.json({ ok: true });
}
