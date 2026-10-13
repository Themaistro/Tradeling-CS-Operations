# Production Deployment Handover

## Purpose

Tradeling CS Operations is an internal workforce-planning application for creating monthly rosters, preparing daily task ownership and breaks, and publishing each day’s approved plan to Slack.

This repository contains the complete application, Docker build, database schema, and operational documentation. No production credential is included in source control.

## What the receiving team needs

Provide the team with the following items through your approved secure channel. Do not add any of them to GitHub, tickets, or chat messages.

1. **Repository**: `https://github.com/Themaistro/Tradeling-CS-Operations`
2. **A Linux server** with Docker Engine and Docker Compose plugin available. Recommended minimum: 2 CPU cores, 2 GB RAM, and persistent storage for PostgreSQL backups.
3. **A company subdomain**, for example `cs-operations.company.com`, plus DNS access to point it to the server.
4. **HTTPS ownership**: the team should configure a reverse proxy such as Nginx, Caddy, or the company ingress, with a valid TLS certificate.
5. **A secure secret-management method** for the environment values listed below.
6. **Slack administration access** to the target workspace and the final target channel.
7. **The current operational configuration**, if the new installation should begin with existing team members, accounts, shifts, leave, and history rather than a clean start.

## Production environment values

Create a server-side `.env` file or equivalent secret-store entries. Values must be unique to the company deployment.

```env
POSTGRES_PASSWORD=<long-random-database-password>
ADMIN_USERNAME=<named-administrator-account>
ADMIN_PASSWORD=<long-random-administrator-password>
SESSION_SECRET=<at-least-32-random-characters>
APP_PORT=3001
TZ=Asia/Dubai

# Optional at deployment time; can also be saved through Settings → Slack.
SLACK_BOT_TOKEN=
SLACK_APP_TOKEN=
```

Do not use `admin/admin`, development passwords, or the example values. Keep the `.env` file readable only by the deployment account.

## Deployment procedure

1. Clone the repository on the server.
2. Create the production `.env` file using the values above.
3. Start the application and PostgreSQL:

   ```bash
   docker compose up -d --build
   ```

4. Confirm application health:

   ```bash
   curl http://127.0.0.1:3001/api/health
   ```

   Expected response:

   ```json
   {"status":"ok","database":"ok"}
   ```

5. Put the application behind the company reverse proxy and HTTPS domain. Proxy the chosen public domain to `http://127.0.0.1:3001`.
6. Do not expose port `3001` directly to the internet after the reverse proxy is working. Allow public access only through HTTPS on the company domain.
7. Configure scheduled PostgreSQL backups before treating the application as production-ready.

## Slack setup

The Slack app must be installed in the production workspace and invited to the target channel. Configure these in **Settings → Slack** after signing in:

- Bot user OAuth token (`xoxb-...`)
- App-level token for Socket Mode (`xapp-...`)
- Target Slack channel ID
- Daily posting time and application timezone

Required Slack capabilities:

- Socket Mode enabled
- Interactivity enabled
- `chat:write`
- `channels:read`
- `groups:read` when private channels are used
- `im:write` for agent briefings

After changing Slack scopes or tokens, reinstall the Slack app to the workspace if Slack requires it, then restart the application container:

```bash
docker compose restart app
```

Use **Settings → Slack → Test Slack connection** to verify channel delivery, direct messages, and acknowledgement connectivity.

## First operational setup

Complete these sections in this order after first sign-in:

1. **Team**: add active agents, Slack member IDs, bilingual status, and planned leave.
2. **Operations**: add accounts, operating hours, coverage requirements, and tasks.
3. **Settings**: configure shifts, break rules, scheduling limits, time zone, and daily posting time.
4. **Schedule → Previous history**: for the first live roster, enter the configured history window for each agent and set the transition date.
5. **Schedule**: generate, review warnings, approve, and optionally publish the period.
6. **Daily Tasks**: review the generated tasks and breaks before the first automatic post.
7. **Settings → Slack**: save tokens/channel and run the connection test.

Approving a schedule prepares daily plans for the approved month. It does **not** post an entire month to Slack. Automatic Slack delivery only runs at the configured daily posting minute; managers can post manually from Daily Tasks when needed.

## Verification before launch

The deployment owner should verify all of the following:

- HTTPS works on the company domain.
- Port 3001 is not public.
- The default administrator credentials have been replaced.
- Docker containers restart automatically after a server reboot.
- Database backups are scheduled and restoration has been tested.
- Slack connection test passes for channel, direct messages, and acknowledgements.
- A sample schedule can be generated and approved.
- A sample manual Slack post reaches the correct test channel and only scheduled agents receive private briefings.
- The automatic post time is checked in the configured timezone.

## Updating the application

From the deployment directory:

```bash
git pull --ff-only origin main
docker compose up -d --build
curl http://127.0.0.1:3001/api/health
```

Back up PostgreSQL before each update. Do not use reset commands or delete Docker volumes unless the business owner explicitly approves a clean start.

## Operational support notes

- Generated schedules, daily tasks, breaks, acknowledgements, and post logs live in PostgreSQL.
- Resetting operational data intentionally removes schedules, daily plans, breaks, acknowledgements, Slack post history, and transition history. It retains team, accounts, shifts, task configuration, settings, and saved Slack credentials.
- The weekly audit can be run after approval without sending Slack messages:

  ```bash
  docker compose exec app npm run audit:week -- YYYY-MM-DD
  ```

  Use a Monday date for the week being reviewed.
