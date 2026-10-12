# FC-00039 — Undo for big actions, and a change history with revert

**Date:** 2026-10-12 · **Slice:** M · **Risk:** Medium · **Status:** approved · **Affected entities:** All

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

## Out of scope
Redo. Undo across a page reload (the snapshot covers that). Saving checkpoints to disk.

## Assumptions
- DECISIONS settled #7 stands: non-linear per-entry revert, not a linear undo stack.
- Checkpoints exclude image files; images stay attached to their jobs.

## Open questions
None.

## Tests
`tests/fc00039_undo_history.test.js` — `test_checkpoint_before_each_big_action`, `test_undo_restores_exact_state`, `test_undo_warns_when_later_changes_exist`, `test_only_last_ten_checkpoints_kept`, `test_remove_entity_confirms_and_undoes`, `test_history_lists_punch_edits_and_approvals`, `test_revert_single_line_keeps_later_changes`

## Slice
M

## Affected entities
All
