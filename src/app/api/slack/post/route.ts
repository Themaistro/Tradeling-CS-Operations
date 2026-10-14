import { NextResponse } from "next/server";
import type { Block, KnownBlock } from "@slack/types";
import { prisma } from "@/lib/db/prisma";
import { slackClient } from "@/lib/slack/client";
import { taskEmoji } from "@/components/ui/task-icon";

function formatTime(value?: string | null) {
  if (!value) return "";
  const [hoursValue, minutes = "00"] = value.split(":");
  const hours = Number(hoursValue);
  if (!Number.isFinite(hours)) return value;
  const suffix = hours >= 12 ? "PM" : "AM";
  const hour = hours % 12 || 12;
  return `${hour}:${minutes} ${suffix}`;
}

function cleanTaskNote(value?: string | null) {
  return value
    ?.replace(/\s*[·|]\s*primary focus\s*$/i, "")
    .replace(/\s*[·|]\s*secondary\s*$/i, "")
    .trim();
}

export async function POST(request: Request) {
  const { date: requestedDate, source: sourceValue } = await request.json();
  const source = sourceValue === "AUTOMATIC" ? "AUTOMATIC" : "MANUAL";
  const settings = await prisma.appSettings.upsert({
    where: { id: "global" },
    create: { id: "global" },
    update: {},
  });
  const dateValue = requestedDate || new Intl.DateTimeFormat("en-CA", {
    timeZone: settings.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue))
    return NextResponse.json(
      { error: "Select a valid date." },
      { status: 400 },
    );
  const client = await slackClient();
  if (!client)
    return NextResponse.json(
      { error: "Slack bot token is not configured. Add it in Settings → Slack." },
      { status: 400 },
    );
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  const [assignments, tasks, breaks] = await Promise.all([
    prisma.shiftAssignment.findMany({
      where: {
        date,
        status: "WORKING",
        employee: { status: "ACTIVE" },
        schedulePeriod: { status: { in: ["APPROVED", "PUBLISHED"] } },
      },
      include: { employee: true, shift: true },
      orderBy: { employee: { name: "asc" } },
    }),
    prisma.taskAssignment.findMany({
      where: { date, employee: { status: "ACTIVE" } },
      include: { category: true },
      orderBy: [{ category: { order: "asc" } }, { priority: "asc" }],
    }),
    prisma.breakSchedule.findMany({ where: { date, employee: { status: "ACTIVE" } } }),
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
  const taskGroups = Map.groupBy(tasks, (task) => `${task.categoryId}|${task.startTime ?? ""}|${task.endTime ?? ""}`);
  const formatTask = (group: (typeof tasks)[number][]) => {
    const task = group[0];
    const people = group
      .map((item) => mention(item.employeeId))
      .join("  •  ");
    const period = task.startTime && task.endTime
      ? ` · ${formatTime(task.startTime)}–${formatTime(task.endTime)}`
      : "";
    const note = settings.includeNotesInSlack ? cleanTaskNote(task.note) : "";
    return `${taskEmoji(task.category.name, task.category.icon === "📌" ? null : task.category.icon)} *${task.category.name}:* ${people}${period}${note ? `\n_${note}_` : ""}`;
  };
  const groupedTasks = [...taskGroups.values()];
  // The later call-coverage window comes from the generated account plan.
  // Do not infer a fixed handover time from a shift name or account name.
  const callStarts = [...new Set(tasks.filter((task) => /call/i.test(task.category.name) && task.startTime).map((task) => task.startTime!))].sort();
  const eveningStart = callStarts.length > 1 ? callStarts.at(-1) : undefined;
  const isEvening = (group: (typeof tasks)[number][]) => Boolean(eveningStart && group[0].startTime === eveningStart);
  const primaryTaskLines = groupedTasks
    .filter((group) => !isEvening(group) && group[0].category.mode === "FOCUS" && !/call/i.test(group[0].category.name))
    .map(formatTask);
  const supportingTaskLines = groupedTasks
    .filter((group) => !isEvening(group) && group[0].category.mode !== "FOCUS" && !/call/i.test(group[0].category.name))
    .map(formatTask);
  const callLines = groupedTasks.filter((group) => /call/i.test(group[0].category.name)).map(formatTask);
  const eveningLines = groupedTasks.filter((group) => isEvening(group) && !/call/i.test(group[0].category.name)).map(formatTask);
  const shiftGroups = Map.groupBy(assignments, (assignment) => assignment.shiftId ?? "unassigned");
  const shiftLines = [...shiftGroups.values()]
    .sort((left, right) => (left[0].shift?.order ?? 999) - (right[0].shift?.order ?? 999))
    .map((group) => {
      const shift = group[0].shift;
      const startHour = Number(shift?.startTime?.split(":")[0] ?? 0);
      const icon = startHour >= 12 ? "🌙" : "☀️";
      const schedule = shift
        ? `${formatTime(shift.startTime)}–${formatTime(shift.endTime)}`
        : "Time not set";
      const people = group
        .map((item) => `${mention(item.employeeId)}${item.workLocation === "WFH" ? " _(WFH)_" : ""}`)
        .join("  •  ");
      return `*${icon} ${shift?.name ?? "Shift"} · ${schedule}*\n${people}`;
    });
  const sharedCoverageGroups = Map.groupBy(tasks.filter((task) => task.note?.includes("shared coverage")), (task) => task.employeeId);
  const sharedCoverageLines = [...sharedCoverageGroups.entries()].map(([employeeId, employeeTasks]) => {
    const start = employeeTasks.map((task) => task.startTime).filter((value): value is string => Boolean(value)).sort()[0];
    const end = employeeTasks.map((task) => task.endTime).filter((value): value is string => Boolean(value)).sort().at(-1);
    const detail = (cleanTaskNote(employeeTasks[0]?.note ?? "") ?? "").replace(/ · (shared coverage|primary focus during shared coverage)$/i, "");
    return `• ${mention(employeeId)} · *${formatTime(start)}–${formatTime(end)}* · ${detail}\n  Supports daytime responsibilities before taking over evening coverage.`;
  });
  const breakGroups = Map.groupBy(breaks.sort((left, right) => left.startTime.localeCompare(right.startTime)), (item) => `${item.type}|${item.startTime}|${item.endTime}`);
  const breakLines = [...breakGroups.values()].map((group) => {
    const label = group[0].type === "MAIN" ? "Main break" : "Short break";
    return `• *${formatTime(group[0].startTime)}–${formatTime(group[0].endTime)}:* ${group.map((item) => mention(item.employeeId)).join("  •  ")} · ${label}`;
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
            text: `📅 *${new Intl.DateTimeFormat("en-AE", { timeZone: settings.timezone, weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(date)}*\nHere is today’s confirmed coverage and task ownership.`,
          },
        },
        { type: "divider" },
        { type: "section", text: { type: "mrkdwn", text: `*Team on duty*\n\n${shiftLines.join("\n\n")}` } },
        ...(callLines.length ? [{ type: "section" as const, text: { type: "mrkdwn" as const, text: `*☎️ Calls · Live coverage*\nOn-duty agents handle calls alongside their assigned responsibilities, except during scheduled breaks.\n\n${callLines.join("\n\n")}` } }] : []),
        ...(sharedCoverageLines.length
          ? [{ type: "divider" as const }, { type: "section" as const, text: { type: "mrkdwn" as const, text: `*Daytime support and evening handover*\n${sharedCoverageLines.join("\n")}` } }]
          : []),
        { type: "divider" },
        ...(primaryTaskLines.length
          ? [{ type: "section" as const, text: { type: "mrkdwn" as const, text: `*Assigned responsibilities*\n_Account coverage and times are shown with each task._\n\n${primaryTaskLines.join("\n\n")}` } }]
          : []),
        ...(supportingTaskLines.length
          ? [{ type: "section" as const, text: { type: "mrkdwn" as const, text: `*Supporting responsibilities*\n\n${supportingTaskLines.join("\n\n")}` } }]
          : []),
        ...(eveningLines.length ? [{ type: "divider" as const }, { type: "section" as const, text: { type: "mrkdwn" as const, text: `*🌙 Evening responsibilities · from ${formatTime(eveningStart)}*\nEvening agents take over the account responsibilities below, alongside calls.\n\n${eveningLines.join("\n\n")}` } }] : []),
        ...(settings.includeBreaksInSlack && breakLines.length ? [{ type: "divider" as const }, { type: "section" as const, text: { type: "mrkdwn" as const, text: `*☕ Break plan*\n${breakLines.join("\n")}` } }] : []),
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
        source,
        postTime: settings.postTime,
        timezone: settings.timezone,
        status: "SENT",
        postedAt: new Date(),
      },
    });
    const directMessageResults = await Promise.all(
      assignments.map(async (assignment) => {
        if (!assignment.employee.slackId) {
          return { employee: assignment.employee.name, status: "skipped" as const, error: "Slack member ID is missing." };
        }

        const personalTasks = tasks.filter((task) => task.employeeId === assignment.employeeId);
        const personalBreaks = breaks
          .filter((item) => item.employeeId === assignment.employeeId)
          .sort((left, right) => left.startTime.localeCompare(right.startTime));
        const taskText = personalTasks.length
          ? personalTasks
              .map((task) => {
                const period = task.startTime && task.endTime
                  ? ` · ${formatTime(task.startTime)}–${formatTime(task.endTime)}`
                  : "";
                const note = settings.includeNotesInSlack ? cleanTaskNote(task.note) : "";
                return `• ${taskEmoji(task.category.name, task.category.icon === "📌" ? null : task.category.icon)} *${task.category.name}* · P${task.priority}${period}${note ? `\n  _${note}_` : ""}`;
              })
              .join("\n")
          : "No tasks are assigned to you today.";
        const breakText = personalBreaks.length
          ? personalBreaks
              .map((item) => `• *${formatTime(item.startTime)}–${formatTime(item.endTime)}* · ${item.type === "MAIN" ? "Main break" : "Short break"}`)
              .join("\n")
          : "No breaks are scheduled yet.";
        const shift = assignment.shift;
        const shiftText = shift
          ? `${shift.name} · ${formatTime(shift.startTime)}–${formatTime(shift.endTime)}${assignment.workLocation === "WFH" ? " · WFH" : ""}`
          : "Shift time is not set.";

        try {
          const conversation = await client.conversations.open({ users: assignment.employee.slackId });
          if (!conversation.channel?.id) throw new Error("Slack did not return a direct-message channel.");
          await client.chat.postMessage({
            channel: conversation.channel.id,
            text: `Your assignments for ${dateValue}`,
            blocks: [
              { type: "header", text: { type: "plain_text", text: "Your Daily Assignment" } },
              { type: "section", text: { type: "mrkdwn", text: `Hi <@${assignment.employee.slackId}> — here is your plan for *${new Intl.DateTimeFormat("en-AE", { timeZone: settings.timezone, weekday: "long", month: "long", day: "numeric" }).format(date)}*.` } },
              { type: "section", text: { type: "mrkdwn", text: `*Shift*\n${shiftText}` } },
              { type: "divider" },
              { type: "section", text: { type: "mrkdwn", text: `*Your tasks*\n${taskText}` } },
              { type: "divider" },
              { type: "section", text: { type: "mrkdwn", text: `*Your breaks*\n${breakText}` } },
            ] as (KnownBlock | Block)[],
          });
          return { employee: assignment.employee.name, status: "sent" as const };
        } catch (error) {
          return {
            employee: assignment.employee.name,
            status: "failed" as const,
            error: error instanceof Error ? error.message : "Direct message failed.",
          };
        }
      }),
    );
    const sent = directMessageResults.filter((item) => item.status === "sent").length;
    const failed = directMessageResults.filter((item) => item.status === "failed");
    const skipped = directMessageResults.filter((item) => item.status === "skipped");
    return NextResponse.json({
      ok: true,
      ts: result.ts,
      directMessages: {
        sent,
        failed: failed.length,
        skipped: skipped.length,
        issues: [...failed, ...skipped],
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Slack post failed.";
    await prisma.slackPostLog.create({
      data: {
        scheduleDate: date,
        channelId: settings.slackChannelId,
        source,
        postTime: settings.postTime,
        timezone: settings.timezone,
        status: "FAILED",
        error: message,
      },
    });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
