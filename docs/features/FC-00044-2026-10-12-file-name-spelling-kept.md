# FC-00044 — A name from the settings file keeps its spelling

**Date:** 2026-10-12 · **Slice:** S · **Risk:** Medium · **Status:** done · **Affected entities:** All

## What
When the settings (master) file gives a person's name, that spelling stays. A schedule, timecard or screen refresh that spells the same name in other capitals or punctuation ("QUILL" for "Quill") no longer rewrites the saved name. Deliberate renames still work.

## Why
Found while checking the settings-import preview on the real weeks: after a settings import, the next screen refresh changed two saved names to the schedule's capitals. Pay and IDs were unaffected, but the saved name drifted away from the master file, and the next downloaded settings file would carry the schedule's spelling. The name-display options (FC-00045) print the saved name, so it has to be the master file's.

## Where in UI
No new controls. Visible as names on screen and in exports matching the master settings file.

## Touches
roster, settings

## Risk
Medium — touches how names resolve to permanent IDs (FC-00036). IDs and pay must not change.

## Reversibility
Fully reversible via one revert commit.

## Definition of Done
1. A person whose record came from the settings file keeps the file's spelling when the same name arrives in other capitals or punctuation (schedule, timecards, review rows, screen refresh).
2. After a settings import, every place on screen that shows that person (schedule, review rows, actuals, payroll) shows the file's spelling.
3. A person not yet in any settings file keeps today's behavior.
4. Deliberate renames still win: a rename in the tool (click the name) or a different name in a later settings file changes the saved name, and the next downloaded settings file carries it.
5. IDs, aliases, matching and every pay figure on the five real weeks are unchanged.

## Built
- Cause: during a settings import, the Palette column re-renders the Payroll screen; that render looked people up by the schedule's spelling and the lookup re-wrote the saved name to it. The end-of-import pass then copied that spelling everywhere.
- `ensureRosterRecord` no longer re-writes the saved name of a person who came from a settings file when a name arrives that differs only in capitals or punctuation; it only finds them.
- The importer writes the file's spelling as the saved name, also when only the capitals differ from the session (a later file can change capitals). The existing end-of-import pass then rewrites the schedule, timecard rows and actuals to that spelling.
- A rename in the tool still refuses a change of capitals only (FC-00007 rule); change capitals in the settings file.

## Verification
- `npm test`: 279 pass (273 + 6 new). `test_schedule_caps_do_not_rewrite_file_name` fails on the code before this card.
- Real master settings file on the five real weeks (schedules and timecards loaded first): every saved name now equals the file's spelling, and the state after Apply equals the preview exactly, letter case included. Before this card two names drifted.
- Five real weeks: hours and pay identical to the live version; undo and snapshot round-trips exact.

## Out of scope
Changing which names count as the same person. The name-display options on exports (FC-00045).

## Assumptions
- "Same name" means the same letters ignoring case, spaces and periods, as FC-00036 already defines it.

## Open questions
None.

## Tests
`tests/fc00044_file_spelling_kept.test.js` — `test_schedule_caps_do_not_rewrite_file_name`, `test_import_after_schedule_rewrites_screen_names_to_file_spelling`, `test_name_without_file_record_unchanged`, `test_rename_in_tool_still_wins`, `test_rename_in_file_still_wins`, `test_ids_and_pay_unchanged`

## Slice
S

## Affected entities
All
