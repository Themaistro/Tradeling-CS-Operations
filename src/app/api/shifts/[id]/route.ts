import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
const schema=z.object({name:z.string().trim().min(2),startTime:z.string().regex(/^\d{2}:\d{2}$/),endTime:z.string().regex(/^\d{2}:\d{2}$/),color:z.string().optional()});
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){const{id}=await context.params;const parsed=schema.safeParse(await request.json());if(!parsed.success)return NextResponse.json({error:"Check the shift details."},{status:400});return NextResponse.json(await prisma.shift.update({where:{id},data:parsed.data}))}
export async function DELETE(_:Request,context:{params:Promise<{id:string}>}){const{id}=await context.params;await prisma.shift.update({where:{id},data:{active:false}});return NextResponse.json({ok:true})}
