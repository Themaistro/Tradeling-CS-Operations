# Application structure

Tradeling CS Operations combines workforce scheduling and daily task coordination around one shared employee directory.

## Main areas

- **Team** stores employee details, Slack IDs, language coverage, preferences, and time off.
- **Schedule** generates calendar-based shift assignments from staffing rules and employee availability.
- **Daily tasks** uses approved schedule assignments, so employees who are off or on leave cannot be assigned.
- **Slack** publishes the daily roster and records acknowledgements.
- **Settings** contains shift rules, posting options, security, and data tools.

## Operational flow

1. Team records define availability, shift preference, language coverage, and dated leave. Annual leave, comp off, and public holidays are planned before generation. Emergency leave can update an existing roster and removes that employee's tasks and breaks for the affected date.
2. For the first transition, opening history records the seven days before the target month and the current focus task for each employee. Later schedules inherit this information from approved history.
3. The generator combines team records, opening history, account coverage, and weekday staffing rules to produce a draft schedule.
4. Approval exposes only working employees to Daily Tasks and prepares task ownership and coverage-safe breaks for every working date in the month.
5. Daily task and break APIs independently verify that the employee is eligible for the selected date. A weekly batch action can safely fill missing plans without overwriting existing work.
6. Before an automatic Slack post, the worker builds today’s plan if it is still missing, then publishes the approved roster at the configured time.
7. Socket Mode acknowledgement clicks are written back to the same employee, category, and date.
8. Schedule downloads produce a shareable Excel roster. Daily task assignments are excluded by default and can be added as a separate sheet when a manager needs the combined file.

## Design principles

- Calendar dates are the source of truth; weekday templates are only inputs.
- Employee records are never duplicated across modules.
- Historical assignments remain intact when an employee becomes inactive.
- Secrets are supplied by the hosting environment and are never committed.
- Business rules live outside React components so they can be tested independently.
