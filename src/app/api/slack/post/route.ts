import { NextResponse } from "next/server";
import type { Block, KnownBlock } from "@slack/types";
import { prisma } from "@/lib/db/prisma";
import { slackClient } from "@/lib/slack/client";
import { taskEmoji } from "@/components/ui/task-icon";
import { planForPosting } from "@/lib/daily-plan";
import { boundedBlocks, BriefingSizeError } from "@/lib/slack/blocks";
import { dateKey } from "@/lib/validation";
import { randomUUID } from "node:crypto";
import { mainBreakCover } from "@/lib/main-break-cover";

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
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid posting request." }, { status: 400 });
  const { date: requestedDate, source: sourceValue, resend = false, preview = false } = body;
  const source = sourceValue === "AUTOMATIC" && request.headers.get("x-internal-key") === process.env.SESSION_SECRET ? "AUTOMATIC" : "MANUAL";
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
  if (!dateKey.safeParse(dateValue).success)
    return NextResponse.json(
      { error: "Select a valid date." },
      { status: 400 },
    );
  const client = await slackClient();
  if (!client && !preview)
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
      include: { category: { include: { account: true } } },
      orderBy: [{ category: { order: "asc" } }, { priority: "asc" }],
    }),
    prisma.breakSchedule.findMany({ where: { date, employee: { status: "ACTIVE" } } }),
  ]);
  if (!settings.slackChannelId && !preview)
    return NextResponse.json(
      { error: "Add a Slack channel ID in Settings first." },
      { status: 400 },
    );
  if (!assignments.length)
    return NextResponse.json(
      { error: "There is no approved working roster for this date." },
      { status: 400 },
    );
  if (!tasks.length || assignments.some(a => !tasks.some(t => t.employeeId === a.employeeId)) || tasks.some(t => !t.category.active || t.category.account?.active === false || !assignments.some(a => a.employeeId === t.employeeId && a.shift && t.startTime && t.endTime && t.startTime >= a.shift.startTime && t.endTime <= a.shift.endTime))) return NextResponse.json({ error: "The daily plan is incomplete or contains unavailable assignments. Review and rebuild it before posting." }, { status: 409 });
  const accountPlans = await prisma.account.findMany({ where: { active: true }, include: { taskCategories: { where: { active: true } }, coverageRequirements: true, employeeCapabilities: true } });
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (breaks.filter(b=>b.type === "MAIN").some(b=>!mainBreakCover(b.employeeId,b.startTime,b.endTime,date.getUTCDay(),assignments,breaks,accountPlans))) return NextResponse.json({ error: "A main break has no qualified live-service cover. Review the break plan before posting." }, { status: 409 });
  for (const account of accountPlans) for (const window of account.coverageRequirements.filter(w=>w.dayOfWeek === date.getUTCDay())) for (const category of account.taskCategories.filter(c=>c.mode === "FOCUS")) {
    const owners = tasks.filter(t=>normalize(t.category.name) === normalize(category.name) && account.employeeCapabilities.some(c=>c.employeeId === t.employeeId) && t.startTime && t.endTime && t.startTime < window.endTime && t.endTime > window.startTime);
    if (!owners.length || (category.isLive && !owners.some(t=>t.startTime! <= window.startTime && t.endTime! >= window.endTime))) return NextResponse.json({ error: `${account.name}: ${category.name} needs reviewed ownership for ${window.startTime}–${window.endTime} before posting.` }, { status: 409 });
  }
  for (const account of accountPlans) for (const category of account.taskCategories.filter(c=>c.mode === "EVERYONE")) for (const assignment of assignments) {
    if (!assignment.shift || !account.employeeCapabilities.some(c=>c.employeeId === assignment.employeeId)) continue;
    for (const window of account.coverageRequirements.filter(w=>w.dayOfWeek === date.getUTCDay())) {
      const start=window.startTime > assignment.shift.startTime ? window.startTime : assignment.shift.startTime;
      const end=window.endTime < assignment.shift.endTime ? window.endTime : assignment.shift.endTime;
      if(start>=end)continue;
      const owned=tasks.filter(t=>t.employeeId === assignment.employeeId && normalize(t.category.name) === normalize(category.name));
      if(!owned.some(t=>t.startTime && t.endTime && (category.isLive ? t.startTime<=start && t.endTime>=end : t.startTime<end && t.endTime>start))) return NextResponse.json({error:`${assignment.employee.name}: ${category.name} needs coverage for ${account.name} ${start}–${end}. Review the daily plan before posting.`},{status:409});
    }
  }
  let plan;
  try { plan = await planForPosting(date, Boolean(preview)); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Review the daily plan." }, { status: 409 }); }
  let delivery: Awaited<ReturnType<typeof prisma.slackPostLog.create>> | undefined;
  if (!preview) {
  const sent = await prisma.slackPostLog.findFirst({ where: { scheduleDate: date, channelId: settings.slackChannelId, status: "SENT" } });
  if (await prisma.slackPostLog.findFirst({ where: { scheduleDate: date, channelId: settings.slackChannelId, status: "PENDING" } })) return NextResponse.json({ error: "A delivery is already being processed or needs confirmation. Check posting history before resending." }, { status: 409 });
  if (sent && (source === "AUTOMATIC" || !resend)) return NextResponse.json(source === "AUTOMATIC" ? { ok: true, skipped: true } : { error: "Today's briefing has already been posted. Confirm a resend to send it again.", code: "ALREADY_POSTED" }, { status: source === "AUTOMATIC" ? 200 : 409 });
  const deliveryKey = `${dateValue}:${settings.slackChannelId}${resend && source === "MANUAL" ? `:${randomUUID()}` : ""}`;
  try { delivery = await prisma.slackPostLog.create({ data: { scheduleDate: date, channelId: settings.slackChannelId, source, status: "PENDING", deliveryKey, planRevision: plan.revision, postTime: settings.postTime, timezone: settings.timezone } }); }
  catch {
    const previous = await prisma.slackPostLog.findUnique({ where: { deliveryKey } });
    if (!previous || previous.status !== "FAILED" || !(await prisma.slackPostLog.updateMany({ where: { id: previous.id, status: "FAILED" }, data: { status: "PENDING", error: null, source, planRevision: plan.revision } })).count) return NextResponse.json({ error: "This briefing is already sent or being processed. Check posting history before retrying." }, { status: 409 });
    delivery = previous;
  }
  }
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
    return `${taskEmoji(task.category.name, task.category.icon)} *${task.category.name}:* ${people}${period}${note ? `\n_${note}_` : task.category.account ? `\n_${task.category.account.name}_` : ""}${settings.includeNotesInSlack ? group.slice(1).filter(t => t.note && t.note !== task.note).map(t=>`\n${mention(t.employeeId)}: ${cleanTaskNote(t.note)}`).join("") : ""}`;
  };
  const groupedTasks = [...taskGroups.values()];
  const firstShiftEnd = [...assignments].sort((a,b)=>(a.shift?.startTime || "").localeCompare(b.shift?.startTime || ""))[0]?.shift?.endTime;
  const eveningStart = accountPlans.flatMap(a=>a.coverageRequirements).filter(w=>w.dayOfWeek === date.getUTCDay() && firstShiftEnd && w.startTime >= firstShiftEnd).map(w=>w.startTime).sort()[0];
  const isEveryoneLive = (task: (typeof tasks)[number]) => task.category.mode === "EVERYONE" && task.category.isLive;
  const isEvening = (group: (typeof tasks)[number][]) => Boolean(eveningStart && group[0].startTime && group[0].startTime >= eveningStart);
  const primaryTaskLines = groupedTasks
    .filter((group) => !isEvening(group) && group[0].category.mode === "FOCUS" && !isEveryoneLive(group[0]))
    .map(formatTask);
  const supportingTaskLines = groupedTasks
    .filter((group) => !isEvening(group) && group[0].category.mode !== "FOCUS" && !isEveryoneLive(group[0]))
    .map(formatTask);
  const everyoneLive = groupedTasks.filter(group=>isEveryoneLive(group[0]));
  const liveHeading = [...new Set(everyoneLive.map(group=>group[0].category.name))].join(" / ");
  const liveIcon = everyoneLive[0] ? taskEmoji(everyoneLive[0][0].category.name,everyoneLive[0][0].category.icon) : "";
  const livePriorities = [...new Set(everyoneLive.flatMap(group=>group.map(t=>t.priority)))];
  const callLines = everyoneLive.map(formatTask);
  const eveningLines = groupedTasks.filter((group) => isEvening(group) && !isEveryoneLive(group[0])).map(formatTask);
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
    const covers = [...new Set(group.map(item=>item.coverEmployeeId).filter((id): id is string=>Boolean(id)))];
    return `• *${formatTime(group[0].startTime)}–${formatTime(group[0].endTime)}:* ${group.map((item) => mention(item.employeeId)).join("  •  ")} · ${label}${covers.length ? `\n  Live-service cover: ${covers.map(mention).join(" • ")}` : ""}`;
  });
  let postedTs: string | undefined;
  try {
    const blocks = boundedBlocks([
        {
          type: "header",
          text: { type: "plain_text", text: settings.slackMessageHeader },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `📅 *${new Intl.DateTimeFormat("en-AE", { timeZone: "UTC", weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(date)}*\nHere is today’s confirmed coverage and task ownership.`,
          },
        },
        { type: "divider" },
        { type: "section", text: { type: "mrkdwn", text: `*Team on duty*\n\n${shiftLines.join("\n\n")}` } },
        ...(callLines.length ? [{ type: "section" as const, text: { type: "mrkdwn" as const, text: `*${liveIcon} ${liveHeading} · ${livePriorities.length === 1 ? `Priority ${livePriorities[0]}` : "Live coverage"}*\nOn-duty agents handle these live queues alongside their assigned responsibilities, except during scheduled breaks.\n\n${callLines.join("\n\n")}` } }] : []),
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
                    value: `${dateValue}|${plan.revision}`,
                  },
                ],
              },
            ]
          : []),
      ] as (KnownBlock | Block)[]);
    if (preview) return NextResponse.json({ preview: true, blocks, mentions: Object.fromEntries(assignments.filter(a=>a.employee.slackId).map(a=>[a.employee.slackId,a.employee.name])) });
    if (!delivery || !client) throw new Error("The delivery could not be reserved.");
    const deliveryId = delivery.id;
    const result = await client.chat.postMessage({ channel: settings.slackChannelId, text: `${settings.slackMessageHeader} — ${dateValue}`, blocks });
    postedTs = result.ts;
    await prisma.slackPostLog.update({
      where: { id: deliveryId },
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
          await prisma.slackDirectDelivery.upsert({ where: { postId_employeeId: { postId: deliveryId, employeeId: assignment.employeeId } }, create: { postId: deliveryId, employeeId: assignment.employeeId, status: "SKIPPED", error: "Slack member ID is missing." }, update: { status: "SKIPPED", error: "Slack member ID is missing." } });
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
                return `• ${taskEmoji(task.category.name, task.category.icon)} *${task.category.name}* · P${task.priority}${period}${note ? `\n  _${note}_` : ""}`;
              })
              .join("\n")
          : "No tasks are assigned to you today.";
        const breakText = personalBreaks.length
          ? personalBreaks
              .map((item) => `• *${formatTime(item.startTime)}–${formatTime(item.endTime)}* · ${item.type === "MAIN" ? "Main break" : "Short break"}`)
              .join("\n")
          : "No breaks are scheduled yet.";
        const coverText = breaks.filter(item=>item.type === "MAIN" && item.coverEmployeeId === assignment.employeeId).map(item=>`• ${formatTime(item.startTime)}–${formatTime(item.endTime)} · live-service cover for ${mention(item.employeeId)}`).join("\n");
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
            blocks: boundedBlocks([
              { type: "header", text: { type: "plain_text", text: "Your Daily Assignment" } },
              { type: "section", text: { type: "mrkdwn", text: `Hi <@${assignment.employee.slackId}> — here is your plan for *${new Intl.DateTimeFormat("en-AE", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" }).format(date)}*.` } },
              { type: "section", text: { type: "mrkdwn", text: `*Shift*\n${shiftText}` } },
              { type: "divider" },
              { type: "section", text: { type: "mrkdwn", text: `*Your tasks*\n${taskText}` } },
              { type: "divider" },
              { type: "section", text: { type: "mrkdwn", text: `*Your breaks*\n${breakText}` } },
              ...(coverText ? [{ type: "section" as const, text: { type: "mrkdwn" as const, text: `*Your break-cover duties*\n${coverText}` } }] : []),
            ] as (KnownBlock | Block)[]),
          });
          await prisma.slackDirectDelivery.upsert({ where: { postId_employeeId: { postId: deliveryId, employeeId: assignment.employeeId } }, create: { postId: deliveryId, employeeId: assignment.employeeId, status: "SENT" }, update: { status: "SENT", error: null } });
          return { employee: assignment.employee.name, status: "sent" as const };
        } catch (error) {
          await prisma.slackDirectDelivery.upsert({ where: { postId_employeeId: { postId: deliveryId, employeeId: assignment.employeeId } }, create: { postId: deliveryId, employeeId: assignment.employeeId, status: "FAILED", error: error instanceof Error ? error.message : "Direct message failed." }, update: { status: "FAILED", error: error instanceof Error ? error.message : "Direct message failed." } });
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
    if (!delivery) return NextResponse.json({ error: message }, { status: 400 });
    await prisma.slackPostLog.update({
      where: { id: delivery.id },
      data: {
        scheduleDate: date,
        channelId: settings.slackChannelId,
        source,
        postTime: settings.postTime,
        timezone: settings.timezone,
        status: postedTs ? "SENT" : (error instanceof BriefingSizeError || (error && typeof error === "object" && "data" in error) ? "FAILED" : "PENDING"),
        messageTs: postedTs,
        error: message,
      },
    });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
