/* eslint-disable @typescript-eslint/no-require-imports */
const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const cron = require("node-cron");
const { PrismaClient } = require("@prisma/client");
const { WebClient } = require("@slack/web-api");
const { SocketModeClient } = require("@slack/socket-mode");
require("dotenv").config();

const port = Number(process.env.PORT || 3000);
const app = next({ dev: process.env.NODE_ENV !== "production" });
const handle = app.getRequestHandler();
const prisma = new PrismaClient();

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
      if (time !== settings.postTime) return;
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
      await fetch(`http://127.0.0.1:${port}/api/slack/post`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-key": process.env.SESSION_SECRET || "",
        },
        body: JSON.stringify({ date }),
      });
    } catch (error) {
      console.error("Automated Slack post failed", error);
    }
  });

  if (process.env.SLACK_APP_TOKEN && process.env.SLACK_BOT_TOKEN) {
    const socket = new SocketModeClient({
      appToken: process.env.SLACK_APP_TOKEN,
    });
    const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
    socket.on("interactive", async ({ body, ack }) => {
      await ack();
      const action = body.actions?.[0];
      if (action?.action_id !== "acknowledge_roster") return;
      try {
        const employee = await prisma.employee.findUnique({
          where: { slackId: body.user.id },
        });
        if (!employee) return;
        const date = new Date(`${action.value}T00:00:00.000Z`);
        const tasks = await prisma.taskAssignment.findMany({
          where: { date, employeeId: employee.id },
        });
        for (const task of tasks)
          await prisma.acknowledgement.upsert({
            where: {
              employeeId_taskCategoryId_scheduleDate: {
                employeeId: employee.id,
                taskCategoryId: task.categoryId,
                scheduleDate: date,
              },
            },
            create: {
              employeeId: employee.id,
              taskCategoryId: task.categoryId,
              scheduleDate: date,
              slackMessageTs: body.message.ts,
            },
            update: {
              acknowledgedAt: new Date(),
              slackMessageTs: body.message.ts,
            },
          });
        await slack.chat.postEphemeral({
          channel: body.channel.id,
          user: body.user.id,
          text: "✅ Your assignments have been acknowledged.",
        });
      } catch (error) {
        console.error("Slack acknowledgement failed", error);
      }
    });
    await socket.start();
  }
});
