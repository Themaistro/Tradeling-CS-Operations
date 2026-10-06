import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  const [settings, shifts] = await Promise.all([
    prisma.appSettings.upsert({ where: { id: "global" }, create: { id: "global" }, update: {} }),
    prisma.shift.findMany({ where: { active: true }, include: { staffingRules: true }, orderBy: { order: "asc" } }),
  ]);
  return NextResponse.json({ settings, shifts, slackConfigured: Boolean(process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN) });
}

const schema = z.object({ timezone: z.string().min(1), postTime: z.string().regex(/^\d{2}:\d{2}$/), slackChannelId: z.string().trim(), automationEnabled: z.boolean(), maxConsecutiveDays: z.number().int().min(1).max(7) });
export async function PATCH(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Please check the settings." }, { status: 400 });
  return NextResponse.json(await prisma.appSettings.upsert({ where: { id: "global" }, create: { id: "global", ...parsed.data }, update: parsed.data }));
}
