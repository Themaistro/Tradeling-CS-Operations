import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

function day(value:string){return new Date(`${value}T00:00:00.000Z`)}
export async function GET(request:Request){
  const dateValue=new URL(request.url).searchParams.get("date");
  if(!dateValue)return NextResponse.json({error:"A date is required."},{status:400});
  const date=day(dateValue);
  const [assignments,categories,breaks,tasks]=await Promise.all([
    prisma.shiftAssignment.findMany({where:{date,status:"WORKING",schedulePeriod:{status:{in:["APPROVED","PUBLISHED"]}}},include:{employee:true,shift:true},orderBy:{employee:{name:"asc"}}}),
    prisma.taskCategory.findMany({where:{active:true},orderBy:{order:"asc"}}),
    prisma.breakSchedule.findMany({where:{date}}),
    prisma.taskAssignment.findMany({where:{date},include:{category:true}}),
  ]);
  return NextResponse.json({date:dateValue,assignments,categories,breaks,tasks});
}
