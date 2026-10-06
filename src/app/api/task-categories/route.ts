import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

const schema = z.object({ name: z.string().trim().min(2).max(80), icon: z.string().trim().max(8).default("📌"), accountId:z.string().nullable().optional(),groupName:z.string().trim().max(80).nullable().optional(),isLive:z.boolean().default(false),mode:z.enum(["EVERYONE","FOCUS","SECONDARY"]).default("SECONDARY"),defaultPriority:z.number().int().min(1).max(2).default(2),rotationOrder:z.number().int().min(0).max(100).default(0) });
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Enter valid task details." }, { status: 400 });
  if (!parsed.data.accountId || !(await prisma.account.findUnique({ where: { id: parsed.data.accountId } }))) return NextResponse.json({ error: "Choose a valid account for this task." }, { status: 400 });
  const duplicate = await prisma.taskCategory.findFirst({ where: { accountId: parsed.data.accountId, name: { equals: parsed.data.name, mode: "insensitive" }, active: true } });
  if (duplicate) return NextResponse.json({ error: "This account already has a task with that name." }, { status: 409 });
  const category = await prisma.taskCategory.create({ data: { ...parsed.data, order: await prisma.taskCategory.count({ where: { accountId: parsed.data.accountId } }) } });
  return NextResponse.json(category, { status: 201 });
}
export async function PATCH(request: Request) {
  const parsed = schema.extend({ id: z.string() }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Enter valid task details." }, { status: 400 });
  const { id, ...data } = parsed.data;
  return NextResponse.json(await prisma.taskCategory.update({ where: { id }, data }));
}
export async function DELETE(request: Request) {
  const parsed = z.object({ id: z.string() }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid task." }, { status: 400 });
  const used = await prisma.taskAssignment.count({ where: { categoryId: parsed.data.id } });
  if (used) {
    await prisma.taskCategory.update({ where: { id: parsed.data.id }, data: { active: false } });
    return NextResponse.json({ ok: true, archived: true });
  }
  await prisma.taskCategory.delete({ where: { id: parsed.data.id } });
  return NextResponse.json({ ok: true, archived: false });
}
