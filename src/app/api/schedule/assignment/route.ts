import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
const schema=z.object({id:z.string(),status:z.enum(["WORKING","OFF","PTO","SICK"]),shiftId:z.string().nullable().optional()});
export async function PATCH(request:Request){const parsed=schema.safeParse(await request.json());if(!parsed.success)return NextResponse.json({error:"Invalid assignment."},{status:400});const assignment=await prisma.shiftAssignment.findUnique({where:{id:parsed.data.id},include:{schedulePeriod:true}});if(!assignment)return NextResponse.json({error:"Assignment not found."},{status:404});if(assignment.schedulePeriod.status==="PUBLISHED")return NextResponse.json({error:"Published schedules cannot be edited."},{status:409});return NextResponse.json(await prisma.shiftAssignment.update({where:{id:parsed.data.id},data:{status:parsed.data.status,shiftId:parsed.data.status==="WORKING"?parsed.data.shiftId: null,source:"manual"}}))}
