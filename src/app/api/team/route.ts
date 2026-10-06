import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

const employeeSchema = z.object({ name: z.string().trim().min(2).max(80), slackId: z.string().trim().max(30).optional(), isBilingual: z.boolean().default(false) });

export async function GET() {
  const employees = await prisma.employee.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" } });
  return NextResponse.json(employees);
}

export async function POST(request: Request) {
  const parsed = employeeSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Please check the employee details." }, { status: 400 });
  const employee = await prisma.employee.create({ data: { ...parsed.data, slackId: parsed.data.slackId || null } });
  return NextResponse.json(employee, { status: 201 });
}
