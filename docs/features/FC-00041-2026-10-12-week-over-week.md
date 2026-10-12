# FC-00041 — Week-over-week check against last week's snapshot

**Date:** 2026-10-12 · **Slice:** M · **Risk:** Low · **Status:** approved · **Affected entities:** All

## What
Loading last week's snapshot shows a "Since last week" panel: who is new or missing, what settings changed, and whose hours or pay moved a lot.

## Why
Nothing compares weeks today. Three problems in the last month (a blank rate that paid $0 in the tool, and two rates that differed from what was actually paid) would have shown up next to last week's values.

## Where in UI
Payroll tab, "Since last week" panel above the Downloads panel.

## Touches
display, settings

## Risk
Low — read-only comparison; never changes the current session.

## Reversibility
Fully reversible via one revert commit.

## Definition of Done
1. "Load last week's snapshot" reads an FC-00037 snapshot into a separate read-only model; the current session is untouched.
2. People are matched by permanent employee ID.
3. The panel lists: new this week; paid last week but missing this week; rate changes; blank rates; pay-method changes; deposit-amount changes; flat-amount changes; Active switched on or off; hours swing; pay swing.
4. Swing defaults: ±8 hours, or ±25% of pay, whichever is hit first. Both are editable in the panel and saved in the settings file and the snapshot.
5. Entity totals table: hours, actual total, deposit, cash — last week, this week, difference.
6. Informational only; never blocks an export.
7. A snapshot from the same or a later week than the current one shows a warning.

## Out of scope
Comparing against payroll or settings exports (snapshot only). Multi-week trends.

## Assumptions
- Thresholds start at the defaults above and are tuned in use.

## Open questions
None.

## Tests
`tests/fc00041_week_over_week.test.js` — `test_matches_by_permanent_id_across_renames`, `test_lists_new_missing_and_setting_changes`, `test_swing_thresholds_and_edit`, `test_entity_totals_and_differences`, `test_current_session_unchanged`, `test_same_or_later_week_warns`

## Slice
M

## Affected entities
All
