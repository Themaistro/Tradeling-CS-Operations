import { WebClient } from "@slack/web-api";
import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/security/encrypted-secret";

export async function slackTokens() {
  const settings = await prisma.appSettings.upsert({ where: { id: "global" }, create: { id: "global" }, update: {} });
  return {
    botToken: process.env.SLACK_BOT_TOKEN || decryptSecret(settings.slackBotTokenEncrypted),
    appToken: process.env.SLACK_APP_TOKEN || decryptSecret(settings.slackAppTokenEncrypted),
  };
}

export async function slackClient(){const { botToken }=await slackTokens();return botToken?new WebClient(botToken):null}
