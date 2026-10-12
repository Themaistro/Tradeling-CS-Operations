import { NextResponse } from "next/server";
import { slackClient } from "@/lib/slack/client";
import { prisma } from "@/lib/db/prisma";

type RuntimeSocketStatus = { configured: boolean; connected: boolean; error: string | null; updatedAt: string };
function message(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback; }

async function checkSlack(verifyChannelPost = false) {
  const client = await slackClient();
  const settings = await prisma.appSettings.upsert({ where: { id: "global" }, create: { id: "global" }, update: {} });
  if (!client) return NextResponse.json({ connected: false, error: "Bot token is not configured. Add it in Settings → Slack." });
  try {
    const auth = await client.auth.test();
    const checks: { channel: { ok: boolean; detail: string }; directMessages: { ok: boolean; detail: string }; acknowledgements: { ok: boolean; detail: string } } = {
      channel: { ok: false, detail: "No channel ID has been saved." },
      directMessages: { ok: false, detail: "No active agent with a Slack member ID is available to check direct messages." },
      acknowledgements: { ok: false, detail: "Socket Mode is not connected." },
    };
    if (settings.slackChannelId) {
      try {
        if (verifyChannelPost) {
          const testPost = await client.chat.postMessage({ channel: settings.slackChannelId, text: "CS Operations connection test — this message is removed automatically." });
          try { if (testPost.ts) await client.chat.delete({ channel: settings.slackChannelId, ts: testPost.ts }); } catch { /* Posting is the required verification; keep a useful result if deletion is restricted. */ }
          checks.channel = { ok: true, detail: "The bot can post to the configured channel (a temporary test message was removed)." };
        } else {
          const channel = await client.conversations.info({ channel: settings.slackChannelId });
          const name = channel.channel?.name ? `#${channel.channel.name}` : settings.slackChannelId;
          checks.channel = { ok: true, detail: `Channel ${name} is available to the bot.` };
        }
      } catch (error) { checks.channel = { ok: false, detail: `The bot cannot access the configured channel: ${message(error, "unknown Slack error")}` }; }
    }
    const employee = await prisma.employee.findFirst({ where: { status: "ACTIVE", slackId: { not: null } }, orderBy: { name: "asc" }, select: { name: true, slackId: true } });
    if (employee?.slackId) {
      try {
        const conversation = await client.conversations.open({ users: employee.slackId });
        if (!conversation.channel?.id) {
          checks.directMessages = { ok: false, detail: `Slack did not create a private-message channel for ${employee.name}.` };
        } else if (verifyChannelPost) {
          const testMessage = await client.chat.postMessage({ channel: conversation.channel.id, text: "CS Operations private-message test — this message is removed automatically." });
          try { if (testMessage.ts) await client.chat.delete({ channel: conversation.channel.id, ts: testMessage.ts }); } catch { /* Sending is the verification; deletion is best effort. */ }
          checks.directMessages = { ok: true, detail: `A private-message test was delivered to ${employee.name}.` };
        } else {
          checks.directMessages = { ok: true, detail: `A private-message channel is available for ${employee.name}.` };
        }
      } catch (error) { checks.directMessages = { ok: false, detail: `A private-message test could not be delivered to ${employee.name}: ${message(error, "unknown Slack error")}` }; }
    }
    const socket = (globalThis as typeof globalThis & { __csSlackSocketStatus?: RuntimeSocketStatus }).__csSlackSocketStatus;
    if (!socket?.configured) checks.acknowledgements = { ok: false, detail: "Both saved tokens are required for Socket Mode acknowledgements." };
    else if (socket.connected) checks.acknowledgements = { ok: true, detail: "Socket Mode acknowledgements are connected." };
    else checks.acknowledgements = { ok: false, detail: socket.error || "Socket Mode is starting or unavailable. Restart the application after changing tokens." };
    const connected = checks.channel.ok && checks.directMessages.ok && checks.acknowledgements.ok;
    return NextResponse.json({ connected, team: auth.team, user: auth.user, channelId: settings.slackChannelId, checks });
  } catch (error) { return NextResponse.json({ connected: false, error: message(error, "Slack connection failed.") }); }
}

export async function GET() { return checkSlack(false); }
export async function POST() { return checkSlack(true); }
