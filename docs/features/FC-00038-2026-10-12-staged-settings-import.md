# FC-00038 — Staged settings import: preview before anything changes

**Date:** 2026-10-12 · **Slice:** M · **Risk:** Medium · **Status:** done · **Affected entities:** All

## What
Uploading a settings file shows exactly what it would change; nothing is applied until the owner clicks Apply.

## Why
An import cannot be taken back today. A bad file silently overwrites rates, pay methods and IDs; a re-import overwrites manual edits made in the session; and an entity added after the import gets no settings at all. The owner: "you show the user what is actually going to be uploaded from that settings file before you actually do it… you cannot unimport something."

## Where in UI
Payroll Settings import (modal/panel shown after file selection).

## Touches
settings, roster, display

## Risk
Medium — the importer's apply path is unchanged; the new part is a read-only preview in front of it.

## Reversibility
Fully reversible via one revert commit.

## Definition of Done
1. Choosing a settings file parses it into a staging model. Session state is untouched until Apply (state deep-equal before preview, during preview and after Cancel).
2. The preview groups every row:
   - **Changes** — per person, per field, current → file value (rate, type, flat amount, pay method, deposit and typed-as, Active, aliases, notes, final-pass method, palette, default break when breaks are included).
   - **Identity changes** — anything FC-00036 would do: a session-minted record moved off a file ID, a session spelling merged into a file person, a name normalized.
   - **New** — people in the file not in the session.
   - **Not in file** — session people the file does not mention (left as they are).
   - **Blocking** (red) — an ID used by a different name, an alias that clashes with another person, an entity name with no match, the same ID twice in the file.
   - **Unchanged** — collapsed count.
3. A value changed by hand in this session that the file would overwrite is marked "your edit".
4. Apply is disabled while any blocking row is unresolved; each blocking row can be marked "skip this row".
5. Apply runs the existing importer on the non-skipped rows, takes a checkpoint first ("Undo settings import", FC-00039) and logs every change in History.
6. Rows for entities not loaded yet are kept as pending settings and applied, through the same preview, when an entity with that name is added or its schedule is loaded. Pending settings are saved in the snapshot (FC-00037).
7. Cancel discards the staging model; nothing changes.

## Built
- Choosing a settings file (with or without breaks) now opens **Settings import — preview**. The preview runs the real importer (`_ingestPayrollSettings`, FC-00036 rules included) on a copy of the session swapped in for one synchronous step; the live objects are put straight back, so the session, its change log, the undo list and the screen are untouched. Toasts, alerts and renders are suppressed while it runs.
- Groups: **Needs a decision** (red: an ID the session holds for another file person, the same ID twice in the file, an alias the importer refuses, an entity with no match), **Changes** (per person and per field, now → file; entity palette and default break; tool settings), **Identity changes** (a session name moved to another ID, folded into a file person, renamed or re-written), **New**, **Not in file (left as they are)**, **Unchanged** (collapsed).
- "your edit" marks a value the owner changed by hand this session (any logged change not made by a settings import; import lines are now logged with screen `settings-import`).
- Red rows: "skip this row"; an unknown entity: "keep for when it is added" or "skip". Apply stays disabled until each is decided; the preview recomputes after every choice.
- Apply = checkpoint "Settings import · <file>" + the existing importer on the rows kept + the Tool Settings sheet. Kept rows for unknown entities go to `session.pendingSettings` (in Undo checkpoints and the snapshot). When an entity with that name is named or its schedule is loaded, the same preview opens for those rows (with "Drop these waiting settings").

## Verification
- `npm test`: 259 pass (251 + 8 new; the FC-00039 test now applies the staged import).
- Real master settings file on each of the five real weeks (schedules and time cards loaded first): preview in under 40 ms, session untouched by the preview, no red rows, and the state after Apply equals the preview's simulated state on every week (one name's letter case is re-written to the schedule spelling by the next render, as before this card).
- Five real weeks unchanged against the v2 base; undo and snapshot round-trips exact.
- Real browser (Chromium): preview shows all groups; Apply is disabled until the unknown entity is decided; Apply sets the values and the threshold, keeps the waiting rows, and offers Undo. No console errors.

## Out of scope
Changing the settings file format. Per-field partial apply (whole rows only).

## Assumptions
- The importer's apply logic (FC-00036 identity rules included) is unchanged; the preview is computed by running it against a copy of the session.
- Exact red/neutral styling follows the existing banner styles.

## Open questions
None.

## Tests
`tests/fc00038_staged_settings_import.test.js` — `test_preview_changes_nothing_until_apply`, `test_cancel_leaves_state_identical`, `test_preview_lists_changes_new_missing_unchanged`, `test_identity_changes_previewed`, `test_blocking_rows_disable_apply_until_skipped`, `test_session_edit_marked_your_edit`, `test_pending_entity_settings_applied_when_entity_added`, `test_apply_is_undoable`

## Slice
M

## Affected entities
All
