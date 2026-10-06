import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

const schema = z.object({ name: z.string().trim().min(2).max(50), icon: z.string().trim().max(8).default("📌") });
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid category name." }, { status: 400 });
  const category = await prisma.taskCategory.create({ data: { ...parsed.data, order: await prisma.taskCategory.count() } });
  return NextResponse.json(category, { status: 201 });
}
