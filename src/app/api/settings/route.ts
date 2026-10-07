import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  const [settings, shifts, employees, employeesWithSlack, employeesWithAccounts, accounts, operatingWindows, coverageRequirements, tasks, staffingRules, approvedSchedules] = await Promise.all([
    prisma.appSettings.upsert({ where: { id: "global" }, create: { id: "global" }, update: {} }),
    prisma.shift.findMany({ where: { active: true }, orderBy: { order: "asc" } }),
    prisma.employee.count({ where: { status: "ACTIVE" } }),
    prisma.employee.count({ where: { status: "ACTIVE", slackId: { not: null } } }),
    prisma.employee.count({ where: { status: "ACTIVE", accountCapabilities: { some: {} } } }),
    prisma.account.count({ where: { active: true } }),
    prisma.accountOperatingWindow.count({ where: { account: { active: true } } }),
    prisma.coverageRequirement.count({ where: { account: { active: true } } }),
    prisma.taskCategory.count({ where: { active: true, account: { active: true } } }),
    prisma.staffingRule.count({ where: { shift: { active: true } } }),
    prisma.schedulePeriod.count({ where: { status: { in: ["APPROVED", "PUBLISHED"] } } }),
  ]);
  const botTokenConfigured = Boolean(process.env.SLACK_BOT_TOKEN || settings.slackBotTokenEncrypted);
  const appTokenConfigured = Boolean(process.env.SLACK_APP_TOKEN || settings.slackAppTokenEncrypted);
  const { slackBotTokenEncrypted: _bot, slackAppTokenEncrypted: _app, ...safeSettings } = settings;
  void _bot; void _app;
  const slackConfigured = botTokenConfigured && appTokenConfigured;
  return NextResponse.json({
    settings: safeSettings,
    shifts,
    slackConfigured,
    slackCredentials: { botTokenConfigured, appTokenConfigured },
    readiness: {
      employees,
      employeesWithSlack,
      employeesWithAccounts,
      accounts,
      operatingWindows,
      coverageRequirements,
      tasks,
      shifts: shifts.length,
      staffingRules,
      approvedSchedules,
      slackReady: slackConfigured && Boolean(settings.slackChannelId),
      ready: employees > 0 && accounts > 0 && operatingWindows > 0 && coverageRequirements > 0 && tasks > 0 && shifts.length > 0 && staffingRules > 0,
    },
  });
}

const schema = z.object({ timezone: z.string().min(1), postTime: z.string().regex(/^\d{2}:\d{2}$/), slackChannelId: z.string().trim(), slackMessageHeader: z.string().trim().min(1).max(150), automationEnabled: z.boolean(), maxConsecutiveDays: z.number().int().min(1).max(7), maxWeeklyDays:z.number().int().min(1).max(7), historyWindowDays:z.number().int().min(3).max(14), scheduleBuildCutoff:z.number().int().min(1).max(28), wfhDays:z.array(z.number().int().min(0).max(6)), lateShiftWfh:z.boolean(), autoPrepareDailyPlans:z.boolean(), weekStartsOn: z.number().int().min(0).max(6), mainBreakMinutes:z.number().int().min(0).max(120),shortBreakMinutes:z.number().int().min(0).max(60),breakGapMinutes:z.number().int().min(0).max(60),maxConcurrentMainBreaks:z.number().int().min(1).max(10),mainBreakAfterMinutes:z.number().int().min(0).max(600),shortBreakDelayMinutes:z.number().int().min(0).max(600), requireAcknowledgement: z.boolean(), includeBreaksInSlack: z.boolean(), includeNotesInSlack: z.boolean() });
export async function PATCH(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Please check the settings." }, { status: 400 });
  const saved=await prisma.appSettings.upsert({ where: { id: "global" }, create: { id: "global", ...parsed.data }, update: parsed.data });
  const { slackBotTokenEncrypted: _bot, slackAppTokenEncrypted: _app, ...safeSettings }=saved; void _bot; void _app;
  return NextResponse.json(safeSettings);
}
