# FC-00048 — Add a new employee from Unrecognized

**Date:** 2026-10-12 · **Slice:** M · **Risk:** Medium · **Status:** done · **Affected entities:** All

## What
On the review tab, timecard rows that match nobody are grouped by the name OCR read. Each group has an **Add as new employee** button, which:
- creates the person;
- moves the group's rows to them;
- gives them their own tab.

Every row's name dropdown also has **+ New employee…**. On the Payroll tab, a person with hours and no rate has a red rate cell and is listed in the export status. "(orphan)" no longer prints on exports.

## Why
A new hire's card landed under "Unrecognized" with nothing saying it would become a new person. The person only appeared later, on the Payroll tab, as an "orphan", and printed as "<name> (orphan)" on the final Excel. Two new hires in one week gave no sign that two people would be created. The name dropdown offered only schedule names.

## Where in UI
- **Review tab, Unrecognized:** a box listing each OCR name with its row count and **Add as new employee**. A name that matches an archived person shows "Matches archived: <name>" and **Reactivate** instead.
- **Review tab, sub-tabs:** a person who is confirmed but not on this week's schedule gets a tab marked "(not on schedule)".
- **Review tab, name dropdown on every row:**
  - schedule people;
  - confirmed people not on the schedule;
  - **+ New employee…**
- **Payroll tab:** a red rate cell for an hourly person with hours and no rate.
- **Downloads status:** "Rate missing: <names>".

## Touches
roster, intake, display, exports

## Risk
Medium. Creates people during review. IDs must stay unique and never be reused.

## Reversibility
Fully reversible via one revert commit. Adding or reactivating a person is one undo step.

## Definition of Done
1. Unrecognized rows are grouped by OCR name (the FC-00036 same-name rule), with a row count per group.
2. **Add as new employee:**
   - creates the person and marks them as added by the owner;
   - moves every row in the group to them;
   - saves the OCR spelling to them;
   - switches the screen to their tab.

   With a settings file loaded, the ID is the next permanent ID for the entity. Without one, it shows "ID pending" until a file is loaded (FC-00046).
3. **+ New employee…** in a row's dropdown asks for a name, creates the person the same way and moves that row. Cancel changes nothing.
4. **Existing names:**
   - a name that belongs to an archived person is refused, with a pointer to Reactivate;
   - a name that is already a scheduled person just moves the rows to them.
5. **Two new hires in one week show as two groups,** and no person is created until a button is clicked.
6. **A person without a rate:** the Payroll tab shows a red rate cell for an hourly person with hours and no rate, and the export status lists "Rate missing: <name>". Exports are not blocked (FC-00023); the stop is decided in a later card.
7. The new person, their rate and pay method are in the next exported settings file.
8. The word "orphan" no longer appears on exports.
9. **Five real weeks:** export cell values are identical to the live version apart from "(orphan)", and undo and snapshot round-trips are exact.

## Built
- `_unrecognizedGroups` / `_unrecognizedGroupsHtml` on the Unrecognized tab.
- `addNewEmployee` and `reactivateFromReview`, each one undo step.
- `__new__` in `updateReviewField`.
- Off-schedule tabs in the review table.
- `rate-missing` cell class, and `_rateMissingNames` → `downloadStatus` reason.
- " (orphan)" removed from the export labels.
- An independent review found:
  - a new-employee name that belonged to an archived or scheduled person was handled silently;
  - names containing quotes could break the new buttons.

  Both are fixed.

## Verification
- `npm test`: 326 pass. The FC-00046 card has the detail.
- Real browser (Chromium) with the real files: no console errors.
- On the real week, the one person who was not on the schedule was resolved to their existing settings-file record by first name. No duplicate was created.

## Out of scope
- Blocking exports (later card).
- Pay-type defaults for new people.

## Assumptions
- The button label is "Add as new employee"; the dropdown entry is "+ New employee…".
- A new person starts with the tool's default pay method, which the owner confirms in the Payroll tab's normal controls.

## Open questions
None.

## Tests
`tests/fc00048_add_new_employee.test.js`:
- `test_unrecognized_grouped_by_ocr_name`
- `test_add_as_new_creates_next_permanent_id`
- `test_add_as_new_without_file_shows_id_pending`
- `test_new_employee_from_dropdown`
- `test_two_new_hires_two_groups_nothing_created_before_click`
- `test_move_row_saves_alias`
- `test_missing_rate_red_and_listed`
- `test_new_person_in_settings_export`
- `test_no_orphan_label_on_exports`
- `test_reactivate_archived_from_review`
- `test_new_employee_name_of_archived_person_refused`
- `test_new_employee_name_of_scheduled_person_not_marked_new`

## Slice
M

## Affected entities
All
