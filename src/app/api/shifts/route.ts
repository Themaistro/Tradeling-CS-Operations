import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

const schema = z.object({ name: z.string().trim().min(2), startTime: z.string().regex(/^\d{2}:\d{2}$/), endTime: z.string().regex(/^\d{2}:\d{2}$/), minimumStaff: z.number().int().min(0).max(100), minimumBilingual: z.number().int().min(0).max(100) }).refine((value)=>value.endTime>value.startTime,{message:"End time must be after start time."});
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Please check the shift details." }, { status: 400 });
  if(parsed.data.minimumBilingual>parsed.data.minimumStaff)return NextResponse.json({error:"Bilingual coverage cannot be higher than total staffing."},{status:400});
  const { minimumStaff, minimumBilingual, ...shiftData } = parsed.data;
  const shift = await prisma.shift.create({ data: { ...shiftData, order: await prisma.shift.count(), staffingRules: { create: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, minimumStaff, minimumBilingual })) } }, include: { staffingRules: true } });
  return NextResponse.json(shift, { status: 201 });
}
