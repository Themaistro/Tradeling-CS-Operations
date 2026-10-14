/* eslint-disable @typescript-eslint/no-require-imports */
const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const cron = require("node-cron");
const { PrismaClient } = require("@prisma/client");
const { SocketModeClient } = require("@slack/socket-mode");
const { createDecipheriv, createHash } = require("crypto");
require("dotenv").config();

const port = Number(process.env.PORT || 3000);
const app = next({ dev: process.env.NODE_ENV !== "production" });
const handle = app.getRequestHandler();
const prisma = new PrismaClient();

function decryptStoredSecret(value) {
  try {
    if (!value) return null;
    const secret = process.env.SESSION_SECRET;
    if (!secret) return null;
    const [iv, tag, encrypted] = value.split(".");
    if (!iv || !tag || !encrypted) return null;
    const key = createHash("sha256").update(secret).digest();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
  } catch (error) {
    console.error("Stored Slack credential could not be decrypted", error.message);
    return null;
  }
}

function minutesSinceMidnight(value) {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  return hours * 60 + minutes;
}

app.prepare().then(async () => {
  createServer((req, res) => handle(req, res, parse(req.url, true))).listen(
    port,
    "0.0.0.0",
    () => console.log(`CS Operations listening on ${port}`),
  );

  cron.schedule("* * * * *", async () => {
    try {
      const settings = await prisma.appSettings.findUnique({
        where: { id: "global" },
      });
      if (!settings?.automationEnabled || !settings.slackChannelId) return;
      const now = new Date();
      const time = new Intl.DateTimeFormat("en-GB", {
        timeZone: settings.timezone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        hourCycle: "h23",
      }).format(now);
      const weekday = new Intl.DateTimeFormat("en-US", {
        timeZone: settings.timezone,
        weekday: "short",
      }).format(now);
      const dayNumber = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
      }[weekday];
      const currentMinute = minutesSinceMidnight(time);
      const scheduledMinute = minutesSinceMidnight(settings.postTime);
      if (
        currentMinute === null ||
        scheduledMinute === null ||
        currentMinute !== scheduledMinute
      )
        return;
      const activeOperatingWindow = await prisma.accountOperatingWindow.findFirst({
        where: { dayOfWeek: dayNumber, account: { active: true } },
      });
      if (!activeOperatingWindow) return;
      const date = new Intl.DateTimeFormat("en-CA", {
        timeZone: settings.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now);
      const dateObject = new Date(`${date}T00:00:00.000Z`);
      if (
        await prisma.slackPostLog.findFirst({
          where: { scheduleDate: dateObject, status: "SENT" },
        })
      )
        return;
      const planResponse = await fetch(`http://127.0.0.1:${port}/api/daily/plan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-key": process.env.SESSION_SECRET || "",
        },
        body: JSON.stringify({ date, replace: false }),
      });
      if (!planResponse.ok) {
        const planResult = await planResponse.json().catch(() => ({}));
        if (planResult.code !== "PLAN_EXISTS") {
          console.error("Automated daily plan preparation failed", planResult.error || planResponse.statusText);
          return;
        }
      }
      const postResponse = await fetch(`http://127.0.0.1:${port}/api/slack/post`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-key": process.env.SESSION_SECRET || "",
        },
        body: JSON.stringify({ date, source: "AUTOMATIC" }),
      });
      if (!postResponse.ok) {
        const postResult = await postResponse.json().catch(() => ({}));
        console.error(
          "Automated Slack post failed",
          postResult.error || postResponse.statusText,
        );
      }
    } catch (error) {
      console.error("Automated Slack post failed", error);
    }
  });

  const storedSlack = await prisma.appSettings.findUnique({ where: { id: "global" } });
  const appToken = process.env.SLACK_APP_TOKEN || decryptStoredSecret(storedSlack?.slackAppTokenEncrypted);
  const botToken = process.env.SLACK_BOT_TOKEN || decryptStoredSecret(storedSlack?.slackBotTokenEncrypted);
  global.__csSlackSocketStatus = {
    configured: Boolean(appToken && botToken),
    connected: false,
    error: appToken && botToken ? null : "Both Slack tokens are required for acknowledgements.",
    updatedAt: new Date().toISOString(),
  };
  if (appToken && botToken) {
    const socket = new SocketModeClient({
      appToken,
    });
    socket.on("connected", () => { global.__csSlackSocketStatus = { configured: true, connected: true, error: null, updatedAt: new Date().toISOString() }; });
    socket.on("disconnected", () => { global.__csSlackSocketStatus = { configured: true, connected: false, error: "Socket Mode disconnected; reconnecting.", updatedAt: new Date().toISOString() }; });
    socket.on("error", (error) => {
      global.__csSlackSocketStatus = { configured: true, connected: false, error: error?.message || "Socket Mode connection failed.", updatedAt: new Date().toISOString() };
      console.error("Slack Socket Mode connection failed", error);
    });
    socket.on("interactive", async ({ body, ack }) => {
      await ack();
      const action = body.actions?.[0];
      if (action?.action_id !== "acknowledge_roster") return;
      try {
        const employee = await prisma.employee.findUnique({
          where: { slackId: body.user.id },
        });
        if (!employee) return;
        const [dateValue, revisionValue] = String(action.value || "").split("|");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return;
        const date = new Date(`${dateValue}T00:00:00.000Z`);
        const planRevision = Number(revisionValue || 1);
        const [plan, post] = await Promise.all([
          prisma.dailyPlan.findUnique({ where: { date } }),
          prisma.slackPostLog.findFirst({ where: { scheduleDate: date, messageTs: body.message?.ts, status: "SENT" } }),
        ]);
        if (!post || planRevision !== (plan?.revision || 1) || planRevision !== post.planRevision) return;
        const tasks = await prisma.taskAssignment.findMany({
          where: { date, employeeId: employee.id },
        });
        for (const task of tasks)
          await prisma.acknowledgement.upsert({
            where: {
              employeeId_taskCategoryId_scheduleDate_planRevision: {
                employeeId: employee.id,
                taskCategoryId: task.categoryId,
                scheduleDate: date,
                planRevision,
              },
            },
            create: {
              employeeId: employee.id,
              taskCategoryId: task.categoryId,
              scheduleDate: date,
              slackMessageTs: body.message.ts,
              planRevision,
            },
            // An acknowledgement is a first-confirmation record. Repeat button
            // clicks must not replace the original acknowledgement time.
            update: {},
          });
        // The acknowledgement is deliberately recorded without posting a second
        // Slack message. The main daily post must remain the only channel post;
        // managers can see each recorded acknowledgement in the Overview.
      } catch (error) {
        console.error("Slack acknowledgement failed", error);
      }
    });
    try {
      await socket.start();
      global.__csSlackSocketStatus = { configured: true, connected: true, error: null, updatedAt: new Date().toISOString() };
    } catch (error) {
      global.__csSlackSocketStatus = { configured: true, connected: false, error: error instanceof Error ? error.message : "Socket Mode connection failed.", updatedAt: new Date().toISOString() };
      console.error("Slack Socket Mode could not start", error);
    }
  }
});
