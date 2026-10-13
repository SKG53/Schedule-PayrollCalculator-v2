# FC-00047 — Load last week's settings file first, and the tool learns spellings

**Date:** 2026-10-12 · **Slice:** M · **Risk:** Medium · **Status:** done · **Affected entities:** All

## What
- **Load the file first.** Last week's settings file can be loaded on the Schedules tab before any schedule. It opens the file's entities, and the tool prompts for it until one is loaded or the owner skips.
- **Names resolve to the file's people.** Schedule names and timecard names resolve to the file's people as they arrive.
- **Spellings are learned.** When the owner picks a person for a review row, the card's spelling is saved to that person and exported in the next settings file.
- **Archived people are never matched automatically.**

## Why
Names come from the schedule, and the rates used to arrive only at the end, when the file was applied on the Payroll tab. Two things went wrong with that:
- First-name schedule entries and full-name EasyClocking cards could become two people.
- A late import has to reconcile everyone after the fact (FC-00046).

The settings file the owner exports each week is now the only roster; there is no separate master file. Loading it first means every name meets the existing people as it arrives.

## Where in UI
- **Schedules tab, top:**
  - prompt: "Load last week's settings file first? Names, IDs and rates come from it." with **Load file** / **Skip**;
  - after Skip: a plain "Load last week's settings file" button;
  - once loaded: "✓ Settings file loaded · N people" and **Load another**.

  It uses the same preview and Apply as the Payroll tab (FC-00038). Cancel closes the entities the file opened.
- **Review tab:**
  - the name dropdown also lists active people who are not on this week's schedule, marked "(not on schedule)";
  - rows matching only an archived person show "Matches archived: <name>" and a **Reactivate** button.
- **Payroll tab:** the existing import stays and is the late-load path (FC-00046).

## Touches
roster, settings, intake, display

## Risk
Medium. Changes when names resolve to people. Pay must not change on any real week.

## Reversibility
Fully reversible via one revert commit. In the tool:
- loading the file is one undo step, and it also closes the entities the file opened;
- each learned spelling is part of the row edit's history.

## Definition of Done
1. **Loading on the Schedules tab:**
   - a settings file can be loaded before any schedule or timecard;
   - the file's entities are opened, reusing the empty starting entity;
   - preview and Apply are the same as on the Payroll tab;
   - Cancel or Undo closes the entities it opened.
2. **The prompt** shows until a file is loaded or Skip is pressed. Skip continues as before.
3. **Schedule names resolve to the file's people:**
   - same name, alternate spelling or former name;
   - or a one-word name that is the first name of exactly one active file person.

   No new ID is issued for anyone already in the file.
4. **Timecard names resolve the same way,** including EasyClocking full names against first-name schedule entries.
5. **Picking a person for a review row saves the card's spelling** to that person (same entity only), for that session and the next exported settings file. The spelling is not saved when:
   - it is that person's own name or already their alias;
   - it is another person's name;
   - it is ambiguous;
   - another review row read with the same spelling currently sits on a different person (saving it would move that row).

   A spelling the tool created by looking it up, with nothing stored on it, does not block saving. Moving the row to someone else takes the spelling back, unless another row still carries it.
6. **The Aliases column** of the exported settings file carries every saved spelling.
7. **Archived people** are never matched automatically: not by name, alternate spelling or first name. A name that matches only an archived person goes to Unrecognized with "Matches archived: <name>" and **Reactivate**.
8. **Five real weeks:** pay is identical to the live version, and undo and snapshot round-trips are exact.

## Built
- Schedules tab bar (`#settingsFirstBar`, `_settingsFirstBarHtml`) → `importSettingsFirstFile` → `importPayrollSettingsFile(…,{createEntities:true})` → `_openFileEntities`.
- The import's undo checkpoint is taken as of before the entities were opened, so Undo closes them. Cancel calls `_closeOpenedEntities`.
- `_learnSpelling`, `_spellingSafeToLearn` and `_unlearnSpelling`, called from `updateReviewField`. A row remembers the spelling it taught (`_learned`).
- `resolveAlias` and `matchEmployeeName` skip archived people. `matchEmployeeName` returns `{archived}`. `recomputeRowFlags` adds "Matches archived".
- An independent review found:
  - correcting one row's person could move the other rows read with that spelling, and change pay;
  - a mistaken pick was never taken back;
  - spellings stopped being learned after the Payroll tab had been viewed;
  - Undo left the opened entities behind.

  All four are fixed and tested.

## Verification
- `npm test`: 326 pass. The FC-00046 card has the detail.
- Real browser (Chromium) with the real files:
  - the prompt shows;
  - loading the file opens the 3 entities;
  - after Apply: "✓ Settings file loaded · 36 people";
  - the schedules load with archived people dropped;
  - payroll hours equal the final payroll;
  - no console errors.

## Out of scope
- The late import's matching (FC-00046).
- "Add as new employee" (FC-00048).
- Copying last week's schedule (later card).

## Assumptions
- Opening the file's entities from the Schedules tab: the owner's file names the entities, so loading it first sets them up.
- A saved spelling belongs to one entity's person. The same spelling can mean different people in different entities.
- Spellings are saved only when a person is picked for a row, or when a person is added or reactivated from a row. OCR's own guesses are not saved. Rename, merge and split do not save spellings (rename keeps the former name, which resolves in the session).

## Open questions
None.

## Tests
`tests/fc00047_settings_first.test.js`:
- `test_settings_on_schedules_tab_before_schedule`
- `test_cancel_closes_opened_entities`
- `test_prompt_once_when_no_settings`
- `test_schedule_names_resolve_to_file_ids`
- `test_full_name_timecard_resolves_to_first_name_person`
- `test_manual_match_saves_alias_to_id`
- `test_alias_exported_in_settings_file`
- `test_learned_spelling_never_takes_another_persons_name`
- `test_archived_not_auto_matched_reactivate_offered`
- `test_first_name_schedule_after_file_without_alias`
- `test_reassigning_one_row_never_moves_the_others`
- `test_correcting_a_pick_moves_the_learned_spelling`
- `test_learning_after_payroll_was_viewed`
- `test_undo_load_first_closes_opened_entities`

## Slice
M

## Affected entities
All
