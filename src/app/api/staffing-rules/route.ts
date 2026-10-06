import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

const schema=z.object({dayOfWeek:z.number().int().min(0).max(6),rules:z.array(z.object({shiftId:z.string(),minimumStaff:z.number().int().min(0),minimumBilingual:z.number().int().min(0),calls:z.number().int().min(0),chats:z.number().int().min(0),tickets:z.number().int().min(0)}))});
export async function PATCH(request:Request){const parsed=schema.safeParse(await request.json());if(!parsed.success)return NextResponse.json({error:"Check the staffing values."},{status:400});await prisma.$transaction(parsed.data.rules.map(rule=>prisma.staffingRule.upsert({where:{dayOfWeek_shiftId:{dayOfWeek:parsed.data.dayOfWeek,shiftId:rule.shiftId}},create:{dayOfWeek:parsed.data.dayOfWeek,...rule},update:rule})));return NextResponse.json({ok:true})}
