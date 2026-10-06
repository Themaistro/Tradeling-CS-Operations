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
  const lines = assignments.map((a) => {
    const assigned =
      tasks
        .filter((t) => t.employeeId === a.employeeId)
        .map(
          (t) =>
            `${t.category.icon} ${t.category.name}${settings.includeNotesInSlack && t.note ? ` — ${t.note}` : ""}`,
        )
        .join(", ") || "No tasks assigned";
    const employeeBreaks = breaks.filter((b) => b.employeeId === a.employeeId).sort((left,right)=>left.startTime.localeCompare(right.startTime));
    const breakText = employeeBreaks.map((item)=>`${item.type === "MAIN" ? "Main" : "Short"} ${item.startTime}–${item.endTime}`).join(" · ");
    return `• *${a.employee.name}* · ${a.shift?.name || "Shift"}\n  ${assigned}${settings.includeBreaksInSlack && breakText ? `\n  ☕ ${breakText}` : ""}`;
  });
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
        { type: "section", text: { type: "mrkdwn", text: lines.join("\n\n") } },
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
