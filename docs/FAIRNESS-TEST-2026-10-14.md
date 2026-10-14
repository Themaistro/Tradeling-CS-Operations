# Fairness test — 14 October 2026

This test ran against the isolated test copy, not the live application. It used the supplied confirmed roster from 27 September through 25 October, the generated 26–31 October continuation, and the existing operation configuration. No additional future leave or public holidays were assumed.

November 2026, December 2026 and January 2027 were generated and approved sequentially. Each generated month was carried into the next. The confirmed October shifts and main breaks, including three 90-minute Friday exceptions, remained unchanged. No Slack deliveries were triggered.

| Check | November | December | January |
| --- | ---: | ---: | ---: |
| Coverage shortages | 0 | 0 | 0 |
| Weekly/consecutive work-limit violations | 0 | 0 | 0 |
| Missing tasks/breaks or uncovered breaks | 0 | 0 | 0 |
| Final rest-pattern warnings | 0 | 0 | 0 |
| Prepared task assignments | 434 | 459 | 441 |
| Prepared breaks | 256 | 270 | 258 |

The final run assigned 6–11 weekend working days per person across these three months, compared with 1–16 in the original test. Night duty is balanced against recorded history, not reset at month start: cumulative night counts including October history ranged from 18 to 23 days. These are observed results, not guaranteed bounds for other inputs or regenerated variations.

Every working agent retained shared live Calls at P1. No weekday day agent received multiple focus responsibilities. Solo weekend/evening agents continue to handle the required Hugo Boss queues.

Generation took approximately 0.7–1.1 seconds per month in the final test environment; daily-plan preparation during approval is additional work. Core regression tests also exercised Sunday- and Monday-start weeks.

Fairness remains a preference subject to coverage, leave and work limits. The separate issue where accepted pre-cutover exceptions can block whole-month approval was left out of scope at the user's request. The tests used an isolated deployment; publishing and upgrading the live application are separate steps.
