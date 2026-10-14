import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { slackClient } from "@/lib/slack/client";
import { taskEmoji } from "@/components/ui/task-icon";
import { operationToday } from "@/lib/validation";
export async function POST(request: Request) {
  const body = z.object({ postId: z.string() }).safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Select a recorded post." }, { status: 400 });
  const post = await prisma.slackPostLog.findUnique({ where: { id: body.data.postId }, include: { deliveries: { where: { status: { in: ["FAILED", "SKIPPED"] } } } } });
  const settings = await prisma.appSettings.findUnique({ where: { id: "global" } });
  if (!post || post.status !== "SENT" || !settings || post.scheduleDate.toISOString().slice(0,10) !== operationToday(settings.timezone)) return NextResponse.json({ error: "Only today's failed personal briefings can be retried." }, { status: 409 });
  const plan = await prisma.dailyPlan.findUnique({ where: { date: post.scheduleDate } });
  if (plan && plan.revision !== post.planRevision) return NextResponse.json({ error: "Today's plan changed. Post the reviewed new briefing instead of retrying the old one." }, { status: 409 });
  const client = await slackClient();
  if (!client) return NextResponse.json({ error: "Slack is not configured." }, { status: 409 });
  let sent = 0, failed = 0;
  for (const delivery of post.deliveries) {
    const claimed = await prisma.slackDirectDelivery.updateMany({ where: { id: delivery.id, status: { in: ["FAILED", "SKIPPED"] } }, data: { status: "PENDING" } });
    if (!claimed.count) continue;
    try {
      const assignment = await prisma.shiftAssignment.findFirst({ where: { date: post.scheduleDate, employeeId: delivery.employeeId, status: "WORKING", employee: { status: "ACTIVE" }, schedulePeriod: { status: { in: ["APPROVED", "PUBLISHED"] } } }, include: { employee: true, shift: true } });
      if (!assignment?.employee.slackId) throw new Error("This agent is unavailable or has no Slack member ID.");
      const [tasks, breaks] = await Promise.all([prisma.taskAssignment.findMany({ where: { date: post.scheduleDate, employeeId: delivery.employeeId }, include: { category: true }, orderBy: { category: { order: "asc" } } }), prisma.breakSchedule.findMany({ where: { date: post.scheduleDate, employeeId: delivery.employeeId }, orderBy: { startTime: "asc" } })]);
      const conversation = await client.conversations.open({ users: assignment.employee.slackId });
      if (!conversation.channel?.id) throw new Error("Slack did not return a private channel.");
      const text = `*Your Daily Assignment · ${post.scheduleDate.toISOString().slice(0,10)}*\n${assignment.shift?.name} · ${assignment.shift?.startTime}–${assignment.shift?.endTime}\n\n*Your tasks*\n${tasks.map(t=>`${taskEmoji(t.category.name,t.category.icon)} *${t.category.name}* · P${t.priority} · ${t.startTime}–${t.endTime}${settings.includeNotesInSlack && t.note ? `\n${t.note}` : ""}`).join("\n")}\n\n*Your breaks*\n${breaks.map(b=>`${b.startTime}–${b.endTime} · ${b.type === "MAIN" ? "Main break" : "Short break"}`).join("\n")}`;
      await client.chat.postMessage({ channel: conversation.channel.id, text });
      await prisma.slackDirectDelivery.update({ where: { id: delivery.id }, data: { status: "SENT", error: null } }); sent++;
    } catch (error) {
      await prisma.slackDirectDelivery.update({ where: { id: delivery.id }, data: { status: "FAILED", error: error instanceof Error ? error.message : "Delivery failed." } }); failed++;
    }
  }
  return NextResponse.json({ sent, failed });
}
