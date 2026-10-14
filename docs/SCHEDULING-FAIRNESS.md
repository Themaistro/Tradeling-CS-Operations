# Scheduling fairness

The generator uses recorded work before the generated range to balance night shifts, weekend work and split-rest weeks. Fairness history is separate from the handover window used to check weekly and consecutive work limits. Regenerating a month does not count the month being replaced as previously worked history.

Coverage, account qualification, required language coverage, recorded leave and work limits remain constraints. Fairness is a preference, not a reason to relax those constraints. Saved shift/day-off preferences still apply when present; none are required.

The balancing pass prefers complete-week pattern exchanges. Where continuity prevents that, compensated exchanges within the same week can share the burden while retaining the daily shift headcounts. Two consecutive rest days are preferred; unavoidable split-rest weeks remain reviewable exceptions.

Generation checks the remaining days of the last scheduling week, even when that week crosses into the next month. These look-ahead assignments are not saved. The next month is still generated separately against the recorded previous roster. A bounded alternative-order search can resolve placement dead ends without lowering coverage or work limits.

Existing confirmed history is not changed by this process. Prepared tasks and breaks are generated from the resulting roster using their existing rules. Task rotation is separate from shift/rest balancing.

Run `npm run test:core` with development dependencies installed to check cross-month scheduling for both Sunday- and Monday-start weeks, alongside the existing task, break, leave and acknowledgement tests. A successful simulation is not a guarantee for future staffing or leave combinations; review each generated schedule.
