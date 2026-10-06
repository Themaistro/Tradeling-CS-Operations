import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

const schema=z.object({name:z.string().trim().min(2).max(80),slackId:z.string().trim().max(30).nullable(),isBilingual:z.boolean(),preferredShiftId:z.string().nullable(),daysOff:z.array(z.number().int().min(0).max(6)),timeOff:z.array(z.object({date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),type:z.enum(["PTO","SICK","UNPAID","OTHER"]),note:z.string().max(200).nullable().optional()}))});

export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){const{id}=await context.params;const parsed=schema.safeParse(await request.json());if(!parsed.success)return NextResponse.json({error:"Please check the employee details."},{status:400});const{daysOff,timeOff,...employee}=parsed.data;await prisma.$transaction(async tx=>{await tx.employee.update({where:{id},data:{...employee,slackId:employee.slackId||null,preferredShiftId:employee.preferredShiftId||null}});await tx.dayOffPreference.deleteMany({where:{employeeId:id}});if(daysOff.length)await tx.dayOffPreference.createMany({data:daysOff.map(dayOfWeek=>({employeeId:id,rank:1,dayOfWeek}))});await tx.timeOff.deleteMany({where:{employeeId:id}});if(timeOff.length)await tx.timeOff.createMany({data:timeOff.map(item=>({employeeId:id,date:new Date(`${item.date}T00:00:00.000Z`),type:item.type,note:item.note||null}))})});return NextResponse.json({ok:true})}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  await prisma.employee.update({ where: { id }, data: { status: "INACTIVE" } });
  return NextResponse.json({ ok: true });
}
