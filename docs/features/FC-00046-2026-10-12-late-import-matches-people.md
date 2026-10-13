# FC-00046 — A late settings import keeps every person's hours on their own row

**Date:** 2026-10-12 · **Slice:** M · **Risk:** High · **Status:** done · **Affected entities:** All

## What
When a settings file is applied after the schedules and timecards are in (on the Payroll tab, the owner's normal order):
- every person's hours stay on their own row;
- the session's people are matched to the file's people;
- no blank people are created.

Until a settings file is loaded for an entity, the IDs the tool made itself show as **"ID pending"**.

## Why
On a real week the owner applied the settings file on the Payroll tab after OCR and review. The import renamed people to the file's full names, for example ROOK → Rook Bellamy, and that part worked: IDs were never the problem.

The review rows still carried the old spellings:
- the name OCR read ("Rook. B");
- the fuzzy suggestion ("ROOK").

Timecard rows were matched to the schedule by exact text. So after the rename their hours went to separate "orphan" rows, and the schedule rows showed 0 hours. Rows also fell into Unrecognized, and each entity got one blank person from lookups of an empty name. The page went red, the owner undid the import and typed every rate by hand.

The earlier verification loaded the settings file before the timecards. That is not the owner's order, so it missed this.

## Where in UI
- **Review tab:** rows, tabs and the name dropdown follow the person, not only the exact spelling.
- **Payroll tab:**
  - payroll rows follow the person;
  - the settings preview gains two red sections, "Archived in the file but worked this week" and "Not matched: more than one person here matches one file person".
- **Every Employee ID cell** (schedule, review, payroll grid, Time Card Data, Payroll Calculation): "ID pending" for an ID the tool made itself while no settings file has been loaded for that entity.

## Touches
roster, settings, intake, display

## Risk
High. Changes how timecard rows find their person after a rename. Pay must not change on any real week.

## Reversibility
Fully reversible via one revert commit. In the tool, the import stays one undo step (FC-00039).

## Definition of Done
1. **Review rows, actuals and payroll follow the person.** A row's name resolves in this order:
   - the exact schedule name;
   - the same roster person reached through an alternate spelling or a former name;
   - the fuzzy suggestion, followed to its person;
   - the raw name.

   A rename also rewrites the suggestion a review row carries.
2. **Session people are matched to file people** by:
   - the same name (the FC-00036 rule);
   - then an alternate spelling or former name;
   - then a one-word name equal to the first name of exactly one **active** file person in that entity.

   A matched person takes the file's permanent ID, and every per-person store moves with them. The first-name match never applies to someone added with "Add as new employee" (FC-00048).
3. **Two session people matching one file person:**
   - the single strongest match is merged (same name beats alternate spelling beats first name), and the others stay separate and are listed in red;
   - if they are equally strong, none are merged;
   - merging the rest stays manual (FC-00043).

   A record the tool made only by looking a spelling up carries nothing, and is folded into the file person.
4. **Unmatched session people** stay, keep their hours, and get the next permanent ID after the file's highest.
5. **Archived in the file but worked this week:** the person is kept active and paid, and listed in red in the preview. Only punches inside the schedule week count, and ignored employees don't count.
6. **No nameless roster records** from an import, a schedule load or a screen refresh. Old blank records with nothing stored are dropped on the next import. The settings file never exports a blank row.
7. **"ID pending"** is display only. The ID stays in use internally, and pay and exports are unchanged.
8. **Preview equals Apply.**
9. **The owner's real session, replayed with the settings file applied late:**
   - before: 5 orphan rows and 3 blank records;
   - after: 1 orphan row (a person legitimately not on that week's schedule) and 0 blank records;
   - every person's hours equal the final payroll.
10. **Five earlier real weeks:**
    - pay is identical to the live version;
    - the settings-last order equals the settings-first order;
    - undo and snapshot round-trips are exact.

## Built
- `_personNameOnEntity`, `_schedNameForPerson`, `_registeredOffSchedule`: name lookups that never create an ID. `syncActualsFromReview`, `reviewBucketKey` and the review dropdown use them.
- `_propagateEmployeeRename` rewrites `_suggestedName`.
- `ensureRosterRecord`:
  - an empty name returns a transient record that is never stored;
  - a one-word name resolves to the unique active file person with that first name (`_recordForFirstName`), so a first-name schedule loaded after the file never creates a second person.
- `_fileMatchTier`, `_recordInUse` and the tiered `_mergeProvisionalRecords`; conflicts and archived-worked people appear in the preview (`_stageHtml`).
- `_dropBlankRecords` runs in `_ingestPayrollSettings`.
- `_isIdPending` / `_empIdText` at every ID display.
- An independent review found:
  - the first-name match could fold someone into an archived person;
  - an exact-name match was thrown away when a weaker one also matched;
  - a first-name schedule loaded after the file created a duplicate.

  All three are fixed and tested.

## Verification
- `npm test`: 326 pass (287 before this series, +39 new across FC-00046/47/48). Three older tests were updated to the new behavior:
  - fc00017: an off-schedule ID shows "ID pending";
  - fc00036: an archived-only spelling is no longer matched automatically;
  - fc00045: no "(orphan)" label.
- Private real-week harness:
  - five weeks, every export kind: cell values identical to the live version, apart from the intended removal of "(orphan)";
  - settings applied last equals settings applied first;
  - undo and snapshot round-trips exact;
  - the owner's real session replayed with the late import, as in DoD 9.
- Real browser (Chromium) with the real files: no console errors.

## Out of scope
- Loading the settings file first, and learned spellings (FC-00047).
- "Add as new employee" (FC-00048).

## Assumptions
- "Same name" is the FC-00036 rule, unchanged.
- Rates, pay methods and deposits in the file overwrite the session's values for matched people, as before. The preview shows those changes (FC-00038).
- When a file person has two session people that both appear as alternate spellings in the file itself, the file decides: both become that person (behavior unchanged from FC-00036).

## Open questions
None.

## Tests
`tests/fc00046_late_import_matches_people.test.js`:
- `test_late_import_keeps_people_when_ids_collide`
- `test_review_rows_follow_the_person_after_rename`
- `test_placeholder_shows_id_pending`
- `test_permanent_id_matches_first`
- `test_temp_id_moves_every_store`
- `test_first_name_match_unique_only`
- `test_idle_lookup_record_folds_into_file_person`
- `test_strongest_match_wins_weaker_reported`
- `test_first_name_never_folds_into_archived`
- `test_unmatched_session_person_kept_with_new_id`
- `test_no_blank_records_after_import_or_render`
- `test_archived_with_hours_flagged_and_paid`
- `test_preview_equals_apply_late_import`

## Slice
M

## Affected entities
All
