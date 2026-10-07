import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

const employeeSchema = z.object({ name: z.string().trim().min(2).max(80), slackId: z.string().trim().max(30).optional(), isBilingual: z.boolean().default(false) });

export async function GET(request: Request) {
  const status = new URL(request.url).searchParams.get("status") === "archived" ? "INACTIVE" : "ACTIVE";
  const employees = await prisma.employee.findMany({ where: { status }, include: { preferredShift: true, dayOffPreferences: true, timeOff: { orderBy: { date: "asc" } } }, orderBy: { name: "asc" } });
  return NextResponse.json(employees);
}

export async function POST(request: Request) {
  const parsed = employeeSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Please check the employee details." }, { status: 400 });
  const slackId = parsed.data.slackId || null;
  const currentOwner = slackId ? await prisma.employee.findUnique({ where: { slackId }, select: { id: true, name: true, status: true } }) : null;
  if (currentOwner?.status === "ACTIVE") return NextResponse.json({ error: `This Slack ID is already assigned to ${currentOwner.name}.` }, { status: 409 });
  try {
    const employee = await prisma.$transaction(async (tx) => {
      if (currentOwner) await tx.employee.update({ where: { id: currentOwner.id }, data: { slackId: null } });
      return tx.employee.create({ data: { ...parsed.data, slackId } });
    });
    return NextResponse.json(employee, { status: 201 });
  } catch {
    return NextResponse.json({ error: "The employee could not be added. Check that the Slack ID is unique and try again." }, { status: 409 });
  }
}
