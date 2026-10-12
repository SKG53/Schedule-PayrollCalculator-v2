# FC-00038 — Staged settings import: preview before anything changes

**Date:** 2026-10-12 · **Slice:** M · **Risk:** Medium · **Status:** approved · **Affected entities:** All

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
