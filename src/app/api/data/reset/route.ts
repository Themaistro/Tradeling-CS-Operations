import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (body?.confirmation !== "RESET_SCHEDULE_DATA") {
    return NextResponse.json({ error: "Reset confirmation is required." }, { status: 400 });
  }

  const removed = await prisma.$transaction(async (tx) => {
    const [taskAssignments, breaks, acknowledgements, slackPosts, openingHistory, schedulePeriods] = await Promise.all([
      tx.taskAssignment.deleteMany(),
      tx.breakSchedule.deleteMany(),
      tx.acknowledgement.deleteMany(),
      tx.slackPostLog.deleteMany(),
      tx.openingHistory.deleteMany(),
      tx.schedulePeriod.deleteMany(),
    ]);
    await tx.appSettings.upsert({
      where: { id: "global" },
      create: { id: "global", projectStartDate: null },
      update: { projectStartDate: null },
    });
    return {
      taskAssignments: taskAssignments.count,
      breaks: breaks.count,
      acknowledgements: acknowledgements.count,
      slackPosts: slackPosts.count,
      openingHistory: openingHistory.count,
      schedules: schedulePeriods.count,
    };
  });

  return NextResponse.json({ removed });
}
