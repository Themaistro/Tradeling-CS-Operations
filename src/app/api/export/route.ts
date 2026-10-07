import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
export async function GET(){
  const [employees,accounts,shifts,staffingRules,taskCategories,settings,schedulePeriods,taskAssignments,breakSchedules,acknowledgements,slackPostLogs,openingHistory,rotationBaselines]=await Promise.all([
    prisma.employee.findMany({include:{dayOffPreferences:true,timeOff:true,accountCapabilities:true}}),
    prisma.account.findMany({include:{operatingWindows:true,coverageRequirements:true,employeeCapabilities:true}}),
    prisma.shift.findMany(),prisma.staffingRule.findMany(),prisma.taskCategory.findMany(),prisma.appSettings.findUnique({where:{id:"global"}}),prisma.schedulePeriod.findMany({include:{assignments:true}}),prisma.taskAssignment.findMany(),prisma.breakSchedule.findMany(),prisma.acknowledgement.findMany(),prisma.slackPostLog.findMany(),prisma.openingHistory.findMany(),prisma.rotationBaseline.findMany(),
  ]);
  return new NextResponse(JSON.stringify({exportedAt:new Date().toISOString(),employees,accounts,shifts,staffingRules,taskCategories,settings,schedulePeriods,taskAssignments,breakSchedules,acknowledgements,slackPostLogs,openingHistory,rotationBaselines},null,2),{headers:{"Content-Type":"application/json","Content-Disposition":`attachment; filename="tradeling-cs-operations-backup.json"`}});
}
