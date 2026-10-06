import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
const schema=z.object({name:z.string().trim().min(2),startTime:z.string().regex(/^\d{2}:\d{2}$/),endTime:z.string().regex(/^\d{2}:\d{2}$/),color:z.string().optional()}).refine((value)=>value.endTime>value.startTime,{message:"End time must be after start time."});
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){const{id}=await context.params;const parsed=schema.safeParse(await request.json());if(!parsed.success)return NextResponse.json({error:parsed.error.issues[0]?.message??"Check the shift details."},{status:400});return NextResponse.json(await prisma.shift.update({where:{id},data:parsed.data}))}
export async function DELETE(_:Request,context:{params:Promise<{id:string}>}){const{id}=await context.params;if(await prisma.shift.count({where:{active:true}})<=1)return NextResponse.json({error:"At least one active shift is required."},{status:409});await prisma.shift.update({where:{id},data:{active:false}});return NextResponse.json({ok:true})}
