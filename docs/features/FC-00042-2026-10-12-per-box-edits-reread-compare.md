# FC-00042 — Per-box edit tracking; re-read shows values side by side

**Date:** 2026-10-12 · **Slice:** M · **Risk:** Medium-High · **Status:** done · **Affected entities:** All

## What
Every date and time box remembers on its own whether the owner edited it, and re-reading a row from its image never overwrites anything: each box shows the re-read value underneath with a choice of which to keep.

## Why
Edits are tracked per row today (FC-00029), so merge and split (FC-00043) cannot carry them correctly, and a row re-read (FC-00034) replaces every value after one confirmation. The owner: "Any box that is manually edited retains its manually edited value regardless of where it goes"; re-read should "put the values from the rereading underneath the current values and give an individual toggle on each box."

## Where in UI
Actuals Intake review table (box markers, re-read comparison row).

## Touches
ocr, display, schema

## Risk
Medium-High — changes how reviewer edits are recorded, which feeds payroll.

## Reversibility
Fully reversible via one revert commit.

## Definition of Done
1. Each box (date, In 1, Out 1, In 2, Out 2, In 3, Out 3) keeps its own OCR value and edited flag. An edited box shows a marker.
2. A row is a manual (MN) entry when any box is edited. For the FC-00029 supersede rule, a pair counts as manual when its In or Out box is edited. Pay results for existing FC-00029 tests are unchanged.
3. Setting a box back to its OCR value clears that box's edited flag only.
4. Re-read row (FC-00034) changes no value. It adds a comparison line: under each box, the re-read value with a toggle **Current | Re-read**, default **Current**. Buttons: **Use all re-read**, **Keep all current**, **Apply**, **Discard**.
5. Choosing Re-read on a box sets the box to the re-read value and makes it the box's new OCR value (edited flag cleared). Keeping Current on an edited box keeps the edit.
6. While a comparison is pending the row is unapproved and flagged; the pending comparison is saved in the snapshot (FC-00037).
7. The row's employee is not changed by a re-read (as in FC-00034).
8. Apply takes a checkpoint (FC-00039) and is logged in History.

## Built
- Per-box state is derived from the per-box OCR value (`row._ocr[box]`), which moves with the value when rows are merged or split (FC-00043). `editedBoxes(row)` lists them; edited boxes render blue with "Edited — OCR read …".
- `syncActualsFromReview` tags each pair manual by `_isManualPair` (In or Out edited; a hand-typed row is manual throughout). A date-only edit makes the row MN but its pairs stay OCR readings.
- `rerunOcrForRow` no longer asks and no longer replaces: it stores the reading in `row._reread` (values, per-box choice, model, confidence) and shows the comparison line. Approve (single and bulk) skips a row with a waiting re-read; the row's Approve button is disabled.
- Apply is a checkpoint ("Re-read apply · <employee> <date>") and a History line ("Re-read applied", revertable: value and OCR baseline both go back). Apply with every box on Current closes the comparison and restores the earlier approval; Discard does the same.
- The re-read itself is no longer a checkpoint (it changes no value). The FC-00034 test that expected a confirm was rewritten for the new flow.

## Verification
- `npm test`: 242 pass (234 + 8 new; FC-00034 and FC-00039 tests updated to the new flow, all FC-00029 tests unchanged).
- Five real weeks: every row's hours and pay identical to the v2 base; undo and snapshot round-trips still exact.
- Real browser (Chromium): re-read on an edited row shows the comparison; choosing Re-read on In 1 and Apply sets In 1, keeps the edited Out 1, and offers "Undo Re-read apply". No console errors.

## Out of scope
Re-reading a whole image (unchanged). Merge and split (FC-00043).

## Assumptions
- Default selection is Current on every box, so nothing changes unless the owner picks Re-read.
- Supersedes the row-level edit state of FC-00029 and the replace-on-confirm behavior of FC-00034; both cards' other behavior stays.

## Open questions
None.

## Tests
`tests/fc00042_per_box_edits.test.js` — `test_each_box_tracks_its_own_edit`, `test_box_reset_clears_only_that_box`, `test_pair_manual_if_either_box_edited`, `test_fc00029_pay_results_unchanged`, `test_reread_changes_nothing_until_apply`, `test_reread_toggle_per_box`, `test_choose_reread_becomes_new_ocr_baseline`, `test_pending_comparison_unapproves_row`

## Slice
M

## Affected entities
All
