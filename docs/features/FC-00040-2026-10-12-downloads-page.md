# FC-00040 — Downloads page: every export in one list

**Date:** 2026-10-12 · **Slice:** M · **Risk:** Low · **Status:** done · **Affected entities:** All

## What
The last screen lists every export, one line per export with format choices, and downloads the ticked ones individually or as one zip.

## Why
Exports are separate buttons, each file is named by hand afterwards, and nothing shows at a glance what is ready or what is still wrong before downloading.

## Where in UI
Payroll tab, new "Downloads" panel at the bottom (existing export buttons stay).

## Touches
exports, display

## Risk
Low — it calls the existing export writers; no calculation changes.

## Reversibility
Fully reversible via one revert commit.

## Definition of Done
1. One line per export; formats are checkboxes on that line:

   | Export | Formats (default) |
   |---|---|
   | Payroll report (Combined) | ☑ Excel ☑ PDF |
   | Reviewed timecards (Actuals Intake, re-importable) | ☑ Excel ☐ PDF |
   | Settings (new master) | ☑ Excel |
   | Snapshot (FC-00037) | ☑ data file |
   | Accountant file | placeholder, disabled: "coming soon" |
   | Cash-only, Deposit-only, Time Card Data, Payroll Calculation, Full Report | ☐ Excel ☐ PDF each |
   | Manager schedule report (per entity) | ☐ Excel |

2. Each line shows the exact file name(s) it will save, a one-line description, and status: ✓ Ready, or ⚠ with the reason (unapproved rows per entity, punches outside the week, Active unchecked with hours, break not confirmed). Nothing is ever blocked (FC-00023).
3. File names follow the owner's convention: `<labels>_<MMDDtoMMDD>_AllEmployeesPayroll.xlsx/.pdf`, `…_AllEmployeesTimecards.xlsx`, `…_AllEmployeesPayroll_Settings.xlsx`, `…_Snapshot.json`; `<labels>` = each loaded entity's file label joined by `_` (defaults: Nirvana, Zion, Hefner), `MMDDtoMMDD` from the schedule week.
4. A per-entity file label is editable and saved in the settings file.
5. **Download selected** saves each ticked file. **Download all (.zip)** saves one `<labels>_<MMDDtoMMDD>_All.zip` with every ticked file.
6. Tick choices persist for the session and are saved in the snapshot.

## Built
- Payroll tab, bottom: **Downloads** (below Since last week). Each line: name, one-line description, the exact file name(s), format ticks, and ✓ Ready or ⚠ reasons (rows not approved per entity, punch days outside the schedule week, Active unchecked with hours, break not confirmed, nothing to export yet). Never blocks.
- The existing writers run with downloads captured (`downloadBlob`, `_savePdf`, `_downloadText` hand over their bytes), then the files are saved under the convention. Export content is unchanged. The break-confirmation question is asked once per download, not once per file.
- Names: `<labels>_<MMDDtoMMDD>_AllEmployeesPayroll.xlsx/.pdf`, `_AllEmployeesTimecards.xlsx/.pdf`, `_AllEmployeesPayroll_Settings.xlsx`, `_Snapshot.json`, `_CashOnly`, `_DepositOnly`, `_TimeCardData`, `_PayrollCalculation`, `_FullReport`; manager reports per entity as `<label>_<next week MMDDtoMMDD>_ManagerReport.xlsx`. `exportManager` now takes an entity index and only reads the on-screen table for the entity on screen.
- File labels: one box per entity at the top of the panel (letters, digits, `-`, `_`); saved as tool settings, so they ride in the settings file's Tool Settings sheet (`File label · <Entity>`) and in the snapshot.
- **Download selected** saves each ticked file; **Download all (.zip)** saves `<labels>_<range>_All.zip` (JSZip 3.10.1 from cdnjs). A snapshot downloaded either way counts as saved for the leave-page warning. Ticks are kept for the session and in the snapshot.

## Verification
- `npm test`: 265 pass (259 + 6 new).
- Real browser (Chromium, real ExcelJS / jsPDF / JSZip): the zip held payroll .xlsx and .pdf, timecards .xlsx, settings .xlsx (Payroll Settings + Tool Settings sheets), the manager report and the snapshot; every .xlsx opens, the PDF is a PDF, the snapshot parses. No console errors.
- Five real weeks unchanged against the v2 base.

## Out of scope
The accountant file itself (parked until the owner's call with the accountant). Changing any export's content.

## Assumptions
- JSZip loaded from cdnjs at a pinned version.
- Existing export buttons remain as they are.

## Open questions
None.

## Tests
`tests/fc00040_downloads_page.test.js` — `test_lists_every_export_with_defaults`, `test_file_names_follow_convention`, `test_status_reports_unapproved_and_exclusions`, `test_download_selected_writes_each_file`, `test_zip_contains_ticked_files_only`, `test_accountant_line_disabled`

## Slice
M

## Affected entities
All
