# FC-00045 — Choose how names print on exports

**Date:** 2026-10-12 · **Slice:** M · **Risk:** Low · **Status:** done · **Affected entities:** All

## What
The owner chooses how employee names print on the exports: as saved, FIRST LAST in capitals, or FIRST name only in capitals. One choice for all exports, or a choice per export.

## Why
The owner: "on the final export, can you give me the option to display as-is, in all caps with both first and last (or initial) or all caps with just first name?" and "choice per export OR choice for all exports. Need a toggle for that too."

## Where in UI
Payroll tab, Downloads panel: a "Names on exports" control at the top, and a name dropdown on each export line when "Per export" is on. The Combined preview shows the payroll report's choice.

## Touches
exports, display, settings

## Risk
Low — printing only; IDs, saved names and pay never change.

## Reversibility
Fully reversible via one revert commit.

## Definition of Done
1. Three options:
   | Option | Saved name → printed |
   |---|---|
   | As saved (default) | Avery Stone → Avery Stone |
   | FIRST LAST | Avery Stone → AVERY STONE · Bram M. → BRAM M. |
   | FIRST | Avery Stone → AVERY |
2. The name used is the person's saved name under their permanent ID (FC-00036, kept in the file's spelling by FC-00044).
3. FIRST: when two people in the same entity would print the same, each gets the initial of their last name ("AVERY S.", "AVERY T."). If that still matches, both print FIRST LAST.
4. A toggle switches between **Same for all exports** (one dropdown) and **Per export** (a dropdown on each line). Switching back to Same for all keeps the per-export choices for next time.
5. Applies to the payroll report (Combined), Cash-only, Deposit-only, Time Card Data, Payroll Calculation, Full report and the manager schedule report, in Excel and PDF, whether downloaded from the Downloads panel or the existing buttons. The Combined preview and a new editable copy follow the payroll report's choice.
6. Never applies to the settings file or the reviewed-timecards export: both are loaded back into the tool and must keep saved names.
7. Labels such as "(flat)" stay as they are; only the name part changes. A name with no saved record (an unrecognized punch) follows the same option.
8. The choice is saved in the settings file's Tool Settings sheet and in the snapshot.

## Built
- Downloads panel, top: "Names on exports: ○ Same for all [As saved ▾] ○ Per export". With Per export, each of the seven export lines gets its own "Names" dropdown; an export without its own choice follows the "all" choice.
- One formatter (`_makeNameFormatter`) is used by every pay report through `_columnsFor` (Excel, PDF and the Combined preview, so the editable copy follows too), by the all-entity preview and by the manager report. The Full report's sections use the Full report's choice.
- The saved name is looked up by permanent ID without creating one; a name with no record prints as it arrived, formatted the same way.
- Tool Settings sheet rows: "Names on exports · same or per export" (Same for all / Per export), "Names on exports · all exports" and "Names on exports · <export>" (As saved / FIRST LAST / FIRST), written in words and read back from the file. The settings preview (FC-00038) shows them in words too.

## Verification
- `npm test`: 286 pass (279 + 7 new).
- Five real weeks, every export kind (six pay reports and three manager reports): cell values identical to the live version in "As saved". In FIRST and FIRST LAST: every name in capitals, no two printed names alike within an entity.
- Real browser (Chromium, real jsPDF): Per export with FIRST on the payroll report; the preview and the PDF both print "AVERY S.", "AVERY T.", "BRAM". No console errors.

## Out of scope
Changing saved names (renames work as today). Name display on screens other than the Combined preview.

## Assumptions
- First name = the first word of the saved name; last initial = first letter of the last word.

## Open questions
None.

## Tests
`tests/fc00045_export_name_display.test.js` — `test_three_options_format_names`, `test_first_only_disambiguates_within_entity`, `test_same_for_all_vs_per_export_toggle`, `test_settings_and_timecards_keep_saved_names`, `test_flat_label_kept_and_unrecognized_names_follow_option`, `test_choice_saved_in_settings_file_and_snapshot`, `test_pay_and_ids_unchanged`

## Slice
M

## Affected entities
All
