# FC-00037 — Session snapshot: save and reopen every screen

**Date:** 2026-10-12 · **Slice:** L · **Risk:** Medium-High · **Status:** done · **Affected entities:** All

## What
One "Save snapshot" file holds the whole session; opening it restores every screen (schedules, punches, edits, approvals, settings, payroll, previews) exactly as it was left.

## Why
The tool keeps everything only in the open browser tab. A refresh or a closed tab loses the session, a finished week cannot be reopened as it was, and there is nothing to compare this week against. The owner: "if I need to open up that week in exactly the same way that I was looking at it, all I have to do is upload that snapshot and everything will just repopulate every screen."

## Where in UI
App header (Save snapshot / Open snapshot), Downloads page (FC-00040, Snapshot line), Actuals Intake (Re-attach images prompt after opening).

## Touches
schema, display, ocr, settings, infra

## Risk
Medium-High — every piece of session state must round-trip; a partial restore would show wrong payroll without any error.

## Reversibility
Fully reversible via one revert commit. The file format is new; nothing existing reads or writes it.

## Definition of Done
1. **Save snapshot** downloads one file, `<file labels>_<MMDDtoMMDD>_Snapshot.json` (same naming as the other exports, FC-00040).
2. The file carries everything a screen shows or a calculation uses: entities (name, code, schedule rows, date labels, breaks, break-confirmed flag, palette), every review row with every field (sources, per-box edit state, approvals, flags, job ids, superseded/merged markers), synced actuals, the roster (IDs, canonical names, aliases, former names, from-file flag, Active), every employee-keyed store (wage, wage-blank, pay method, split deposit, flat amount, break overrides, notes, final-pass method), pending settings for entities not yet loaded (FC-00038), the change history, week-over-week thresholds (FC-00041), download ticks (FC-00040), and the active tab, sub-tab and entity.
3. **Open snapshot** in a fresh tab restores the session; the review tables, Payroll Calculation tables, Combined preview and every export are identical to the moment of saving (deep-equal state; identical rendered HTML; identical export cells).
4. Images are referenced, not stored. Per uploaded image the snapshot keeps: file name, entity, kind (TC/EC/MIX), byte size, SHA-256 fingerprint and an embedded thumbnail (JPEG, long edge 200 px, ≤ 15 KB).
5. After opening, thumbnails show from the embedded copies. A "Re-attach images" prompt lets the owner pick that week's timecard files; each file is matched by fingerprint (never by name). Matched images regain full size, the image modal and re-read. Unmatched images are listed; a file whose fingerprint matches nothing is not attached.
6. The file carries a schema tag and version. An unknown or newer version is refused with a plain message. Opening a snapshot into a session that already has data asks first and is undoable (FC-00039).
7. Leaving or refreshing the page with changes made since the last snapshot asks first.
8. The snapshot never contains the Gemini API key or any browser preference.
9. Real names and wages never enter the repository: tests use fabricated data only.

## Built
- Header: **Save snapshot**, **Open snapshot**. File name `<labels>_<MMDDtoMMDD>_Snapshot.json`; labels default to Nirvana / Zion / Hefner by entity code, otherwise the entity name without spaces (FC-00040 makes them editable).
- The snapshot is the same full state an Undo checkpoint holds (FC-00039) plus registered extra parts (today: the editable preview copy). Later cards register their own parts (pending settings, thresholds, download ticks) with `_registerSnapshotPart`.
- Image manifest per file: name, entity, kind, size, type, SHA-256, thumbnail (JPEG, 200 px long edge, ≤ 15 KB, quality stepped down until it fits). Queued images not yet run are kept too and go back into their queue when re-attached.
- After opening, review rows show the small copy (dashed outline); re-run and re-read say to re-attach first. A banner at the top of Actuals Intake lists missing images with a **Re-attach images…** picker. Matching is by SHA-256 only; a file that matches nothing is reported and not attached.
- Save and Open are refused while an OCR run or re-read is in progress.
- Undo of "Open snapshot" also puts the screen (tab, entity) back.

## Verification
- `npm test`: 228 pass (218 + 10 new).
- Five real weeks: snapshot of the fully loaded week (170–210 KB without images) reopened in a fresh session gives the identical state and identical pay on every row.
- Real browser (Chromium): Save downloads `Alpha_Snapshot.json` with a 2.3 KB thumbnail; reopening in a new tab restores tab, entity and settings, shows the re-attach banner; picking the image re-attaches it by fingerprint. No console errors.

## Out of scope
Autosave. Password or encryption. Merging two snapshots. Storing full-size images. Multiple users or computers at once.

## Assumptions
- One user, picking the week back up later. Saving is manual.
- JSON data file, read only by the tool.
- Nothing is stored online; the file lives where the owner saves it (their own week folders).
- Image fingerprint = SHA-256 of the original file bytes (WebCrypto).

## Open questions
None.

## Tests
`tests/fc00037_snapshot.test.js` — `test_snapshot_round_trip_restores_identical_state`, `test_restored_screens_render_identically`, `test_restored_exports_identical`, `test_snapshot_has_no_api_key`, `test_images_rematched_by_fingerprint_not_name`, `test_changed_image_not_attached`, `test_unknown_version_refused`, `test_open_into_busy_session_asks_and_is_undoable`, `test_leave_page_warning_only_with_unsaved_changes`, plus `test_snapshot_file_name_uses_labels_and_week`

## Slice
L — sub-slices: (a) state save/restore, (b) image manifest, thumbnails and re-attach, (c) leave-page warning.

## Affected entities
All
