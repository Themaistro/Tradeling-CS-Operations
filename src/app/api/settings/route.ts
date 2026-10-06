import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  const [settings, shifts, taskCategories] = await Promise.all([
    prisma.appSettings.upsert({ where: { id: "global" }, create: { id: "global" }, update: {} }),
    prisma.shift.findMany({ where: { active: true }, include: { staffingRules: true }, orderBy: { order: "asc" } }),
    prisma.taskCategory.findMany({ where: { active: true }, orderBy: { order: "asc" } }),
  ]);
  return NextResponse.json({ settings, shifts, taskCategories, slackConfigured: Boolean(process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN) });
}

const schema = z.object({ timezone: z.string().min(1), postTime: z.string().regex(/^\d{2}:\d{2}$/), slackChannelId: z.string().trim(), slackMessageHeader: z.string().trim().min(1).max(150), automationEnabled: z.boolean(), maxConsecutiveDays: z.number().int().min(1).max(7), workingDays: z.string().regex(/^\d(,\d)*$/), weekStartsOn: z.number().int().min(0).max(6), defaultBreakMinutes: z.number().int().min(0).max(240), mainBreakMinutes:z.number().int().min(0).max(120),shortBreakMinutes:z.number().int().min(0).max(60),breakGapMinutes:z.number().int().min(0).max(60),mainBreakAfterMinutes:z.number().int().min(0).max(600),shortBreakDelayMinutes:z.number().int().min(0).max(600), projectStartDate: z.string().nullable().transform(v=>v?new Date(v):null).optional(), scheduleBuildCutoff:z.number().int().min(1).max(31).optional(), splitDate:z.number().int().min(1).max(28).optional(), generationScope:z.enum(["full","split"]).optional(), requireAcknowledgement: z.boolean(), includeBreaksInSlack: z.boolean(), includeNotesInSlack: z.boolean() }).refine((value)=>value.mainBreakMinutes+value.shortBreakMinutes===value.defaultBreakMinutes,{message:"Main and short breaks must equal the total break entitlement."});
export async function PATCH(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Please check the settings." }, { status: 400 });
  return NextResponse.json(await prisma.appSettings.upsert({ where: { id: "global" }, create: { id: "global", ...parsed.data }, update: parsed.data }));
}
