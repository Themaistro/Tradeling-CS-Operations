import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

function day(value:string){return new Date(`${value}T00:00:00.000Z`)}
export async function GET(request:Request){
  const url=new URL(request.url);
  const weekStartValue=url.searchParams.get("weekStart");
  if(weekStartValue){
    const start=day(weekStartValue); const end=new Date(start); end.setUTCDate(end.getUTCDate()+7);
    const [assignments,tasks,breaks]=await Promise.all([
      prisma.shiftAssignment.findMany({where:{date:{gte:start,lt:end},status:"WORKING",schedulePeriod:{status:{in:["APPROVED","PUBLISHED"]}}},select:{date:true}}),
      prisma.taskAssignment.findMany({where:{date:{gte:start,lt:end}},select:{date:true}}),
      prisma.breakSchedule.findMany({where:{date:{gte:start,lt:end}},select:{date:true}}),
    ]);
    const key=(value:Date)=>value.toISOString().slice(0,10);
    return NextResponse.json(Array.from({length:7},(_,index)=>{const current=new Date(start);current.setUTCDate(start.getUTCDate()+index);const dateKey=key(current);return{date:dateKey,agents:assignments.filter(item=>key(item.date)===dateKey).length,tasks:tasks.filter(item=>key(item.date)===dateKey).length,breaks:breaks.filter(item=>key(item.date)===dateKey).length}}));
  }
  const dateValue=url.searchParams.get("date");
  if(!dateValue)return NextResponse.json({error:"A date is required."},{status:400});
  const date=day(dateValue);
  const [assignments,categories,breaks,tasks]=await Promise.all([
    prisma.shiftAssignment.findMany({where:{date,status:"WORKING",schedulePeriod:{status:{in:["APPROVED","PUBLISHED"]}}},include:{employee:{include:{accountCapabilities:true}},shift:true},orderBy:{employee:{name:"asc"}}}),
    prisma.taskCategory.findMany({where:{active:true},include:{account:{include:{operatingWindows:true}}},orderBy:{order:"asc"}}),
    prisma.breakSchedule.findMany({where:{date}}),
    prisma.taskAssignment.findMany({where:{date},include:{category:true}}),
  ]);
  const weekday=date.getUTCDay();
  const dailyAssignments=assignments.map((assignment)=>({
    ...assignment,
    availableCategories:categories.filter((category)=>!category.accountId||Boolean(category.account?.active&&assignment.employee.accountCapabilities.some((capability)=>capability.accountId===category.accountId)&&assignment.shift&&category.account.operatingWindows.some((window)=>window.dayOfWeek===weekday&&assignment.shift!.startTime<window.endTime&&assignment.shift!.endTime>window.startTime))).map((category)=>({id:category.id,name:category.name,icon:category.icon,defaultPriority:category.defaultPriority,accountName:category.account?.name??null})),
  }));
  return NextResponse.json({date:dateValue,assignments:dailyAssignments,categories:categories.map((category)=>({id:category.id,name:category.name,icon:category.icon,defaultPriority:category.defaultPriority,accountName:category.account?.name??null})),breaks,tasks});
}
