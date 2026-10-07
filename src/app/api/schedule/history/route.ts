import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

const statuses = ["WORKING", "OFF", "ANNUAL_LEAVE", "EMERGENCY_LEAVE", "COMP_OFF", "PUBLIC_HOLIDAY", "SICK", "UNPAID_LEAVE", "OTHER_LEAVE"] as const;
const input = z.object({
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
  entries: z.array(z.object({
    employeeId: z.string(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: z.enum(statuses),
    shiftId: z.string().nullable(),
    workLocation: z.enum(["OFFICE", "WFH"]).default("OFFICE"),
  })),
  rotations: z.array(z.object({ employeeId: z.string(), taskCategoryId: z.string().nullable() })),
});

function windowFor(year: number, month: number) {
  const end = new Date(Date.UTC(year, month - 1, 1));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 7);
  return { start, end, dates: Array.from({ length: 7 }, (_, index) => new Date(start.getTime() + index * 86400000).toISOString().slice(0, 10)) };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const year = Number(url.searchParams.get("year"));
  const month = Number(url.searchParams.get("month"));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return NextResponse.json({ error: "Choose a valid schedule month." }, { status: 400 });
  const { start, end, dates } = windowFor(year, month);
  const [employees, shifts, categories, saved, scheduled, rotations] = await Promise.all([
    prisma.employee.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" } }),
    prisma.shift.findMany({ where: { active: true }, orderBy: { order: "asc" } }),
    prisma.taskCategory.findMany({ where: { active: true, mode: "FOCUS" }, orderBy: { rotationOrder: "asc" } }),
    prisma.openingHistory.findMany({ where: { date: { gte: start, lt: end } } }),
    prisma.shiftAssignment.findMany({ where: { date: { gte: start, lt: end }, schedulePeriod: { status: { in: ["APPROVED", "PUBLISHED"] } } } }),
    prisma.rotationBaseline.findMany(),
  ]);
  const entries = employees.flatMap((employee) => dates.map((date) => {
    const existing = saved.find((item) => item.employeeId === employee.id && item.date.toISOString().slice(0, 10) === date);
    const schedule = scheduled.find((item) => item.employeeId === employee.id && item.date.toISOString().slice(0, 10) === date);
    const item = existing ?? schedule;
    return { employeeId: employee.id, date, status: item?.status ?? "OFF", shiftId: item?.shiftId ?? employee.preferredShiftId ?? shifts[0]?.id ?? null, workLocation: item?.workLocation ?? "OFFICE" };
  }));
  return NextResponse.json({ dates, employees: employees.map(({ id, name, isBilingual }) => ({ id, name, isBilingual })), shifts, categories, entries, rotations: employees.map((employee) => ({ employeeId: employee.id, taskCategoryId: rotations.find((item) => item.employeeId === employee.id)?.taskCategoryId ?? null })), saved: saved.length > 0, inherited: !saved.length && scheduled.length > 0 });
}

export async function PUT(request: Request) {
  const parsed = input.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Review the previous-history entries." }, { status: 400 });
  const { start, end, dates } = windowFor(parsed.data.year, parsed.data.month);
  const allowedDates = new Set(dates);
  if (parsed.data.entries.some((item) => !allowedDates.has(item.date) || (item.status === "WORKING" && !item.shiftId))) return NextResponse.json({ error: "Every working history day needs a valid shift." }, { status: 400 });
  const activeEmployees = new Set((await prisma.employee.findMany({ where: { status: "ACTIVE" }, select: { id: true } })).map((item) => item.id));
  if (parsed.data.entries.some((item) => !activeEmployees.has(item.employeeId))) return NextResponse.json({ error: "The history contains an inactive employee." }, { status: 409 });
  await prisma.$transaction(async (tx) => {
    await tx.openingHistory.deleteMany({ where: { date: { gte: start, lt: end } } });
    await tx.openingHistory.createMany({ data: parsed.data.entries.map((item) => ({ employeeId: item.employeeId, date: new Date(`${item.date}T00:00:00.000Z`), status: item.status, shiftId: item.status === "WORKING" ? item.shiftId : null, workLocation: item.status === "WORKING" ? item.workLocation : "OFFICE" })) });
    for (const rotation of parsed.data.rotations) await tx.rotationBaseline.upsert({ where: { employeeId: rotation.employeeId }, create: { employeeId: rotation.employeeId, effectiveDate: new Date(`${dates.at(-1)}T00:00:00.000Z`), taskCategoryId: rotation.taskCategoryId }, update: { effectiveDate: new Date(`${dates.at(-1)}T00:00:00.000Z`), taskCategoryId: rotation.taskCategoryId } });
  });
  return NextResponse.json({ ok: true, savedDays: dates.length });
}
