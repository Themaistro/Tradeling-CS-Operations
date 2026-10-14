import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { operationHash } from "@/lib/daily-plan";
import { dateKey as validDate, operationToday } from "@/lib/validation";

function day(value:string){return new Date(`${value}T00:00:00.000Z`)}
export async function GET(request:Request){
  const url=new URL(request.url);
  const weekStartValue=url.searchParams.get("weekStart");
  const settings=await prisma.appSettings.findUnique({where:{id:"global"}});
  const today=day(operationToday(settings?.timezone||"UTC"));
  const rosterStatus={OR:[{schedulePeriod:{status:{in:["APPROVED","PUBLISHED"] as ("APPROVED"|"PUBLISHED")[]}},employee:{status:"ACTIVE" as const}},{date:{lt:today}}]};
  if(weekStartValue){
    if(!validDate.safeParse(weekStartValue).success)return NextResponse.json({error:"Choose a valid week."},{status:400});
    const start=day(weekStartValue); const end=new Date(start); end.setUTCDate(end.getUTCDate()+7);
    const [assignments,tasks,breaks]=await Promise.all([
      prisma.shiftAssignment.findMany({where:{date:{gte:start,lt:end},status:"WORKING",...rosterStatus},select:{date:true}}),
      prisma.taskAssignment.findMany({where:{date:{gte:start,lt:end}},select:{date:true}}),
      prisma.breakSchedule.findMany({where:{date:{gte:start,lt:end}},select:{date:true}}),
    ]);
    const key=(value:Date)=>value.toISOString().slice(0,10);
    return NextResponse.json(Array.from({length:7},(_,index)=>{const current=new Date(start);current.setUTCDate(start.getUTCDate()+index);const dateKey=key(current);return{date:dateKey,agents:assignments.filter(item=>key(item.date)===dateKey).length,tasks:tasks.filter(item=>key(item.date)===dateKey).length,breaks:breaks.filter(item=>key(item.date)===dateKey).length}}));
  }
  const dateValue=url.searchParams.get("date");
  if(!dateValue)return NextResponse.json({error:"A date is required."},{status:400});
  if(!validDate.safeParse(dateValue).success)return NextResponse.json({error:"Choose a valid date."},{status:400});
  const date=day(dateValue);
  const [assignments,categories,breaks,tasks]=await Promise.all([
    prisma.shiftAssignment.findMany({where:{date,status:"WORKING",...rosterStatus},include:{employee:{include:{accountCapabilities:true}},shift:true},orderBy:{employee:{name:"asc"}}}),
    prisma.taskCategory.findMany({where:{active:true},include:{account:{include:{operatingWindows:true}}},orderBy:{order:"asc"}}),
    prisma.breakSchedule.findMany({where:{date}}),
    prisma.taskAssignment.findMany({where:{date},include:{category:true}}),
  ]);
  const weekday=date.getUTCDay();
  const dailyAssignments=assignments.map((assignment)=>({
    ...assignment,
    availableCategories:categories.filter((category)=>!category.accountId||Boolean(category.account?.active&&assignment.employee.accountCapabilities.some((capability)=>capability.accountId===category.accountId)&&assignment.shift&&category.account.operatingWindows.some((window)=>window.dayOfWeek===weekday&&assignment.shift!.startTime<window.endTime&&assignment.shift!.endTime>window.startTime))).map((category)=>({id:category.id,name:category.name,icon:category.icon,defaultPriority:category.defaultPriority,accountName:category.account?.name??null})),
  }));
  const plan = await prisma.dailyPlan.findUnique({ where: { date } });
  const stale = Boolean(plan && plan.configHash !== await operationHash());
  return NextResponse.json({date:dateValue,planning:{revision:plan?.revision||1,stale,readOnly:date<today},assignments:dailyAssignments,categories:categories.map((category)=>({id:category.id,name:category.name,icon:category.icon,defaultPriority:category.defaultPriority,accountName:category.account?.name??null})),breaks,tasks});
}
