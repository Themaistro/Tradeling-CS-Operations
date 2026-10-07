import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  const [settings, shifts, employees, accounts] = await Promise.all([
    prisma.appSettings.upsert({ where: { id: "global" }, create: { id: "global" }, update: {} }),
    prisma.shift.findMany({ where: { active: true }, orderBy: { order: "asc" } }),
    prisma.employee.count({ where: { status: "ACTIVE" } }),
    prisma.account.count({ where: { active: true } }),
  ]);
  const slackConfigured = Boolean(process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN);
  return NextResponse.json({ settings, shifts, slackConfigured, readiness: { employees, accounts, shifts: shifts.length, ready: employees > 0 && accounts > 0 && shifts.length > 0 } });
}

const schema = z.object({ timezone: z.string().min(1), postTime: z.string().regex(/^\d{2}:\d{2}$/), slackChannelId: z.string().trim(), slackMessageHeader: z.string().trim().min(1).max(150), automationEnabled: z.boolean(), maxConsecutiveDays: z.number().int().min(1).max(7), maxWeeklyDays:z.number().int().min(1).max(7), historyWindowDays:z.number().int().min(3).max(14), scheduleBuildCutoff:z.number().int().min(1).max(28), wfhDays:z.array(z.number().int().min(0).max(6)), lateShiftWfh:z.boolean(), autoPrepareDailyPlans:z.boolean(), weekStartsOn: z.number().int().min(0).max(6), mainBreakMinutes:z.number().int().min(0).max(120),shortBreakMinutes:z.number().int().min(0).max(60),breakGapMinutes:z.number().int().min(0).max(60),maxConcurrentMainBreaks:z.number().int().min(1).max(10),mainBreakAfterMinutes:z.number().int().min(0).max(600),shortBreakDelayMinutes:z.number().int().min(0).max(600), requireAcknowledgement: z.boolean(), includeBreaksInSlack: z.boolean(), includeNotesInSlack: z.boolean() });
export async function PATCH(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Please check the settings." }, { status: 400 });
  return NextResponse.json(await prisma.appSettings.upsert({ where: { id: "global" }, create: { id: "global", ...parsed.data }, update: parsed.data }));
}
