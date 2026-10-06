# Application structure

Tradeling CS Operations combines workforce scheduling and daily task coordination around one shared employee directory.

## Main areas

- **Team** stores employee details, Slack IDs, language coverage, preferences, and time off.
- **Schedule** generates calendar-based shift assignments from staffing rules and employee availability.
- **Daily tasks** uses approved schedule assignments, so employees who are off or on leave cannot be assigned.
- **Slack** publishes the daily roster and records acknowledgements.
- **Settings** contains shift rules, posting options, security, and data tools.

## Operational flow

1. Team records define availability, shift preference, language coverage, and dated leave.
2. The generator combines those records with weekday staffing rules and produces a draft schedule.
3. Approval exposes only working employees to Daily Tasks.
4. Daily task and break APIs independently verify that the employee is eligible for the selected date.
5. The Slack worker publishes the approved roster manually or at the configured time.
6. Socket Mode acknowledgement clicks are written back to the same employee, category, and date.

## Design principles

- Calendar dates are the source of truth; weekday templates are only inputs.
- Employee records are never duplicated across modules.
- Historical assignments remain intact when an employee becomes inactive.
- Secrets are supplied by the hosting environment and are never committed.
- Business rules live outside React components so they can be tested independently.
