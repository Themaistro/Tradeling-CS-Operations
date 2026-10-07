# Tradeling CS Operations

A single workspace for the Customer Service team to prepare monthly schedules, coordinate daily responsibilities, and publish clear rosters to Slack.

This is a new application that brings together the strongest parts of the existing schedule generator and task bot. The original repositories remain unchanged.

## What is included

- One shared team directory for schedules, tasks, leave, and Slack
- Calendar-based monthly schedule generation and approval
- Preferred shifts, preferred days off, annual leave, emergency leave, comp off, public holidays, sick leave, and bilingual coverage
- Per-day staffing rules for headcount, calls, chats, tickets, and bilingual coverage
- Manual schedule corrections with protected published history
- Daily task assignments, notes, flexible breaks, and eligibility enforcement
- Manual and scheduled Slack posting
- Automatic daily-plan preparation when a monthly schedule is approved
- Weekly batch preparation and a final automatic plan check before each Slack post
- Slack acknowledgement recording through Socket Mode
- Live readiness, coverage, task, and Slack reporting
- Excel roster downloads, with an optional daily-tasks sheet
- A seven-day opening-history handover for the first transition or missing schedule history
- Portable JSON backups
- Single-administrator sign-in
- PostgreSQL persistence
- Docker setup for local testing and deployment

## Run locally with Docker

1. Copy `.env.example` to `.env`.
2. Set a strong administrator password and session secret.
3. Run `docker compose up --build`.
4. Open `http://localhost:3001`.

Docker starts both the application and its PostgreSQL database. Data is kept in a named volume, so restarting the containers does not reset the application.
Port 3001 is used by default so this app can run beside the original Task Bot on port 3000. Set `APP_PORT` to use another port.

The default local login is `admin` / `admin`. Change it before sharing the app with anyone.

## First schedule transition

Before generating the first live roster, open **Schedule → Previous history**. Confirm each employee's final seven days, shift, and current focus task. The generator uses this handover to continue work streaks and task rotation instead of starting from an empty history. After the first approved period, the screen pre-fills from saved schedule data and normally requires only confirmation.

## Run for development

Requirements: Node.js 22.19 or newer and PostgreSQL 16 or newer.

```bash
npm install
npx prisma generate
npx prisma db push
npx prisma db seed
npm run dev
```

Set `DATABASE_URL` in `.env` before running the database commands.

## Slack configuration

Create a Slack app with Socket Mode enabled and provide these values through the hosting environment:

- `SLACK_BOT_TOKEN` (`xoxb-...`)
- `SLACK_APP_TOKEN` (`xapp-...`)

The bot needs `chat:write`, `channels:read`, `groups:read`, and `im:write`. Enable Interactivity and Socket Mode so acknowledgement buttons can be received. After changing scopes, reinstall the app to the workspace.

Never commit real tokens. If a token has been shared in chat or source control, revoke it in Slack and issue a replacement.

## Deployment

The included container can run on any provider that supports Docker and persistent PostgreSQL. Before deployment:

1. Set every production value listed in `.env.example`.
2. Use a managed PostgreSQL database or preserve the included database volume.
3. Serve the app behind HTTPS on the company domain.
4. Restrict access to the internal team.
5. Configure automated database backups.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the application structure.
