import { NextResponse } from "next/server";
import type { Block, KnownBlock } from "@slack/types";
import { prisma } from "@/lib/db/prisma";
import { slackClient } from "@/lib/slack/client";
export async function POST(request: Request) {
  const { date: dateValue } = await request.json();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue || ""))
    return NextResponse.json(
      { error: "Select a valid date." },
      { status: 400 },
    );
  const client = slackClient();
  if (!client)
    return NextResponse.json(
      { error: "Slack bot token is not configured by the host." },
      { status: 400 },
    );
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  const [settings, assignments, tasks, breaks] = await Promise.all([
    prisma.appSettings.upsert({
      where: { id: "global" },
      create: { id: "global" },
      update: {},
    }),
    prisma.shiftAssignment.findMany({
      where: {
        date,
        status: "WORKING",
        schedulePeriod: { status: { in: ["APPROVED", "PUBLISHED"] } },
      },
      include: { employee: true, shift: true },
      orderBy: { employee: { name: "asc" } },
    }),
    prisma.taskAssignment.findMany({
      where: { date },
      include: { category: true },
    }),
    prisma.breakSchedule.findMany({ where: { date } }),
  ]);
  if (!settings.slackChannelId)
    return NextResponse.json(
      { error: "Add a Slack channel ID in Settings first." },
      { status: 400 },
    );
  if (!assignments.length)
    return NextResponse.json(
      { error: "There is no approved working roster for this date." },
      { status: 400 },
    );
  const mention = (employeeId: string) => { const assignment = assignments.find((item) => item.employeeId === employeeId); return assignment?.employee.slackId ? `<@${assignment.employee.slackId}>` : `*${assignment?.employee.name ?? "Unassigned"}*`; };
  const taskGroups = Map.groupBy(tasks, (task) => `${task.category.name}|${task.startTime ?? ""}|${task.endTime ?? ""}`);
  const taskLines = [...taskGroups.values()].map((group) => {
    const task = group[0];
    const people = group.map((item) => `${mention(item.employeeId)} P${item.priority}`).join(", ");
    const period = task.startTime && task.endTime ? ` · ${task.startTime}–${task.endTime}` : "";
    const context = settings.includeNotesInSlack && task.note ? ` _(${task.note})_` : "";
    return `*${task.category.name}*${period}: ${people}${context}`;
  });
  const shiftLine = assignments.map((assignment) => `${mention(assignment.employeeId)} · ${assignment.shift?.name ?? "Shift"} ${assignment.shift?.startTime ?? ""}–${assignment.shift?.endTime ?? ""}`).join("\n");
  const breakGroups = Map.groupBy(breaks.sort((left, right) => left.startTime.localeCompare(right.startTime)), (item) => `${item.type}|${item.startTime}|${item.endTime}`);
  const breakLines = [...breakGroups.values()].map((group) => `• ${group[0].type === "MAIN" ? "Main" : "Short"} ${group[0].startTime}–${group[0].endTime}: ${group.map((item) => mention(item.employeeId)).join(", ")}`);
  try {
    const result = await client.chat.postMessage({
      channel: settings.slackChannelId,
      text: `${settings.slackMessageHeader} — ${dateValue}`,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: settings.slackMessageHeader },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${new Intl.DateTimeFormat("en-AE", { timeZone: settings.timezone, weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(date)}*`,
          },
        },
        { type: "section", text: { type: "mrkdwn", text: `*Shift coverage*\n${shiftLine}` } },
        { type: "divider" },
        { type: "section", text: { type: "mrkdwn", text: `*Task ownership*\n${taskLines.join("\n\n")}` } },
        ...(settings.includeBreaksInSlack && breakLines.length ? [{ type: "divider" as const }, { type: "section" as const, text: { type: "mrkdwn" as const, text: `*Break plan*\n${breakLines.join("\n")}` } }] : []),
        ...(settings.requireAcknowledgement
          ? [
              {
                type: "actions",
                elements: [
                  {
                    type: "button",
                    text: {
                      type: "plain_text",
                      text: "✓ Acknowledge assignments",
                    },
                    action_id: "acknowledge_roster",
                    value: dateValue,
                    style: "primary",
                  },
                ],
              },
            ]
          : []),
      ] as (KnownBlock | Block)[],
    });
    await prisma.slackPostLog.create({
      data: {
        scheduleDate: date,
        channelId: settings.slackChannelId,
        messageTs: result.ts,
        status: "SENT",
        postedAt: new Date(),
      },
    });
    return NextResponse.json({ ok: true, ts: result.ts });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Slack post failed.";
    await prisma.slackPostLog.create({
      data: {
        scheduleDate: date,
        channelId: settings.slackChannelId,
        status: "FAILED",
        error: message,
      },
    });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
