# FC-00039 — Undo for big actions, and a change history with revert

**Date:** 2026-10-12 · **Slice:** M · **Risk:** Medium · **Status:** done · **Affected entities:** All

## What
Every large action can be undone in one click, and every individual change is listed in a History panel where any single line can be reverted.

## Why
There is no undo. An import, an OCR re-run or a removed entity cannot be taken back, and "Remove entity" deletes everything with no confirmation. The engine already records some field changes and can revert them (DECISIONS settled #7) but there is no screen for it, and punch edits and approvals are not recorded at all. The owner: "I think you need to have a way to click undo."

## Where in UI
"Undo <action>" button in the app header after a large action; History panel (toggle in the header); Remove-entity confirmation.

## Touches
display, schema, infra

## Risk
Medium — restores whole-session copies; must never restore a stale copy silently.

## Reversibility
Fully reversible via one revert commit.

## Definition of Done
1. A checkpoint (full in-memory copy of session state, no images) is taken automatically before: settings import Apply, Run OCR, image re-run, row re-read Apply, merge, split, schedule load, remove entity, open snapshot.
2. "Undo <action name>" restores that checkpoint exactly (deep-equal to the state before the action, including roster IDs and name matching).
3. If anything changed after the action, Undo first lists what will be lost (count and kinds of changes) and asks.
4. The last 10 checkpoints are kept in memory; they are not saved in the snapshot.
5. Remove entity asks for confirmation, naming the entity and what it holds (employees, punches), and is undoable.
6. History panel lists every logged change: time, screen, entity, employee, field, old → new, with **Revert** per line. A revert is logged as its own line (existing non-linear revert; nothing after it is dropped).
7. Logging is extended to punch time/date edits, approve/unapprove, employee assignment on a review row, add/delete review row, merge and split.
8. No global Ctrl+Z.

## Built
- Checkpoints wrap: schedule load (Excel, paste, schedule OCR), Run OCR, image re-run, row re-read, settings import, actuals import, Clear intake, Load New File (clear schedule), Remove entity. FC-00038 (settings Apply), FC-00042 (re-read Apply), FC-00043 (merge, split) and FC-00037 (open snapshot) use the same `_withCheckpoint` when they land.
- An action that changes nothing (declined, failed, no OCR match) leaves no checkpoint.
- Undo is refused while any checkpointed action is still running (an OCR run in progress).
- The warning counts logged changes made after the action, later big actions, and untracked edits (schedule cells, entity names). The action's own log lines are not counted.
- Restored review rows are fresh copies: anything holding an old row object must look it up by id again.
- History shows one "Added to roster" line per person (the schedule table re-sends it on every entity switch).
- Logged and revertable review types: `reviewEdit` (time, date, employee assignment), `reviewApprove`, `reviewApproveBulk`, `reviewRowAdd`, `reviewRowDelete`, `reviewIgnore`. A line whose row or entity is gone shows no Revert.

## Verification
- `npm test`: 218 pass (208 before + 10 new).
- Five real weeks: every row's hours, actual, deposit and cash identical to the v2 base (9e0aa83). On each week a schedule reload plus a later change, then Undo, returns the state, the change log and every payroll figure exactly.
- Real browser (Chromium): schedule load shows "Undo Schedule load"; Remove asks with counts and is undone; History lists lines and a Revert reverts only its own line. No console errors.

## Out of scope
Redo. Undo across a page reload (the snapshot covers that). Saving checkpoints to disk.

## Assumptions
- DECISIONS settled #7 stands: non-linear per-entry revert, not a linear undo stack.
- Checkpoints exclude image files; images stay attached to their jobs.

## Open questions
None.

## Tests
`tests/fc00039_undo_history.test.js` — `test_checkpoint_before_each_big_action`, `test_undo_restores_exact_state`, `test_undo_warns_when_later_changes_exist`, `test_only_last_ten_checkpoints_kept`, `test_remove_entity_confirms_and_undoes`, `test_history_lists_punch_edits_and_approvals`, `test_revert_single_line_keeps_later_changes`, plus `test_action_that_changes_nothing_leaves_no_checkpoint`, `test_undo_run_ocr_requeues_the_same_image_files`, `test_undo_refused_while_action_running`

## Slice
M

## Affected entities
All
