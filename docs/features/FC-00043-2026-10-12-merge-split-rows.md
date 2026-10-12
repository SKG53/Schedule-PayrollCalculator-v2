# FC-00043 — Merge and split review rows by hand

**Date:** 2026-10-12 · **Slice:** M · **Risk:** Medium · **Status:** approved · **Affected entities:** All

## What
The owner can merge selected review rows for one employee into a single row of in/out pairs, or split a multi-pair row into one row per pair; the AI never decides.

## Why
OCR sometimes returns a shift with a break as one row with two pairs and sometimes as two rows, inconsistently. The owner: "if I let the AI decide, it's definitely going to mess something up somewhere."

## Where in UI
Actuals Intake review table: row checkboxes, Merge rows button, Split button on multi-pair rows, preview dialog.

## Touches
ocr, display

## Risk
Medium — regroups payroll inputs; values themselves never change.

## Reversibility
Fully reversible via one revert commit.

## Definition of Done
1. Each review row has a checkbox. **Merge rows** is enabled when two or more selected rows belong to the same employee and fall on the same date or on back-to-back dates.
2. Merge shows a preview before applying: the resulting pairs in time order, the date it will be filed under (the earliest clock-in date), the gap between pairs, and hours before → after. Confirm or Cancel.
3. A merged row holds at most 3 pairs; a merge needing more is refused with a message.
4. No time or date value changes. Per-box edit flags (FC-00042) travel with their boxes.
5. A merged row is unapproved, shows a "merged" badge and keeps links to every source image (all thumbnails shown).
6. **Split** on a row with two or more pairs creates one row per pair on the same date, each unapproved with a "split" badge; edit flags travel with their boxes.
7. Every merge and split takes a checkpoint (FC-00039) and is logged in History.
8. With the break minimum at 0, payroll hours are identical before and after any merge or split.

## Out of scope
Automatic merging. Merging across employees or across more than two consecutive dates.

## Assumptions
- No gap limit: the owner decides which rows belong together; the preview shows the gap and the hours effect.
- Overnight shifts are filed under the clock-in date (CLAUDE.md rule 4).

## Open questions
None.

## Tests
`tests/fc00043_merge_split.test.js` — `test_merge_same_date_rows`, `test_merge_back_to_back_dates_filed_under_clock_in`, `test_merge_refused_over_three_pairs`, `test_merge_refused_for_different_employees`, `test_split_one_row_per_pair`, `test_edit_flags_travel_with_boxes`, `test_merged_row_keeps_all_images`, `test_hours_unchanged_with_zero_break`, `test_merge_and_split_undoable`

## Slice
M

## Affected entities
All
