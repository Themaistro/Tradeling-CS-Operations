import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { encryptSecret } from "@/lib/security/encrypted-secret";

const schema = z.object({
  botToken: z.string().trim().refine((value) => !value || value.startsWith("xoxb-"), "Bot token must start with xoxb-."),
  appToken: z.string().trim().refine((value) => !value || value.startsWith("xapp-"), "App token must start with xapp-."),
});

export async function PUT(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the Slack tokens." }, { status: 400 });
  if (!parsed.data.botToken && !parsed.data.appToken) return NextResponse.json({ error: "Enter at least one token to update." }, { status: 400 });
  try {
    const data: { slackBotTokenEncrypted?: string; slackAppTokenEncrypted?: string } = {};
    if (parsed.data.botToken) data.slackBotTokenEncrypted = encryptSecret(parsed.data.botToken);
    if (parsed.data.appToken) data.slackAppTokenEncrypted = encryptSecret(parsed.data.appToken);
    const settings = await prisma.appSettings.upsert({ where: { id: "global" }, create: { id: "global", ...data }, update: data });
    return NextResponse.json({ ok: true, botTokenConfigured: Boolean(process.env.SLACK_BOT_TOKEN || settings.slackBotTokenEncrypted), appTokenConfigured: Boolean(process.env.SLACK_APP_TOKEN || settings.slackAppTokenEncrypted), restartRequired: Boolean(parsed.data.appToken) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The credentials could not be encrypted." }, { status: 500 });
  }
}

export async function DELETE() {
  await prisma.appSettings.upsert({ where: { id: "global" }, create: { id: "global" }, update: { slackBotTokenEncrypted: null, slackAppTokenEncrypted: null } });
  return NextResponse.json({ ok: true });
}
